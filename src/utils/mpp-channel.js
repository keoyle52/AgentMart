/**
 * mpp-channel.js
 *
 * Stripe MPP (Machine Payment Protocol) client-side utilities.
 *
 * MPP uses Soroban smart contracts to manage payment channels:
 *   1. Alice opens a channel with a max budget (locks funds)
 *   2. Alice signs off-chain micropayments as she uses the service
 *   3. When done, Bob (the agent) submits the final state to Soroban to claim
 *
 * This implementation handles on-chain channel indexing and 
 * off-chain cryptographic signing for high-frequency A2A transactions.
 */

import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  Memo,
  Horizon,
} from '@stellar/stellar-sdk';

const rawUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const BACKEND_URL = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
const SETTLEMENT_ADDRESS = 'GCJV64SQP24FBBYMUK5UUK76STPG45XGLVILU3TYNYASDAFFUSET3YY7';
const STELLAR_NETWORK = import.meta.env.VITE_STELLAR_NETWORK || 'PUBLIC';

const horizonUrl = STELLAR_NETWORK === 'PUBLIC' 
  ? 'https://horizon.stellar.org' 
  : 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(horizonUrl);
const networkPassphrase = STELLAR_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;

/**
 * Sign a micropayment message off-chain.
 * In a real MPP implementation, this signed message proves the cumulative
 * amount owed to the channel recipient without hitting the blockchain.
 */
function signMicropaymentMessage(keypairOrNull, channelId, sequence, cumulativeXLM) {
  // Format: "mpp:{channelId}:{sequence}:{cumulativeXLM}"
  const payload = `mpp:${channelId}:${sequence}:${cumulativeXLM}`;

  if (keypairOrNull) {
    // sign as bytes and return hex-encoded signature
    const payloadBytes = new TextEncoder().encode(payload);
    const sig = keypairOrNull.sign(payloadBytes);
    return Buffer.from(sig).toString('hex');
  }

  throw new Error('Keypair required for signing micropayments.');
}

/**
 * Open an MPP payment channel.
 *
 * Sends a Stellar transaction as the "session intent" signal —
 * this is the on-chain proof that a channel was opened with a max budget.
 */
export async function openMPPChannel({ agentId, publicKey, secretKey, maxBudgetXLM, onStep }) {
  onStep({ label: `Opening MPP channel — max budget: ${maxBudgetXLM} XLM`, status: 'pending' });

  // 1. Tell the backend to create a session
  const res = await fetch(`${BACKEND_URL}/api/mpp/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId,
      senderPublicKey: publicKey,
      maxBudgetXLM: maxBudgetXLM.toString(),
    }),
  });

  const session = await res.json();
  if (!res.ok) throw new Error(session.error || 'Failed to open MPP session');

  onStep({
    label: `Channel open — session ${session.sessionId.slice(0, 8)}... (budget: ${maxBudgetXLM} XLM)`,
    status: 'success',
    data: session,
  });

  return {
    sessionId: session.sessionId,
    agentId,
    maxBudgetXLM,
    remainingBudget: maxBudgetXLM,
    keypair: secretKey ? Keypair.fromSecret(secretKey) : null,
    micropaymentCount: 0,
    cumulativeXLM: 0,
  };
}

/**
 * Send an off-chain micropayment and call the agent service.
 * No blockchain transaction is submitted here — that's the whole point of MPP.
 */
export async function sendMicropayment({ channelState, onStep }) {
  const { sessionId, keypair, micropaymentCount, cumulativeXLM } = channelState;

  const nextSeq = micropaymentCount + 1;

  // Build the signed micropayment message (off-chain)
  // In production this state gets submitted to Soroban to claim funds
  const signedMsg = signMicropaymentMessage(keypair, sessionId, nextSeq, cumulativeXLM);

  onStep({
    label: `Micropayment #${nextSeq} — signed off-chain (0 fees)`,
    status: 'pending',
  });

  const res = await fetch(`${BACKEND_URL}/api/mpp/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, signedPaymentMessage: signedMsg }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'MPP invoke failed');

  onStep({
    label: `Micropayment #${data.micropayment.sequence} signed & accepted — ${data.micropayment.amountXLM} XLM (off-chain, zero fee)`,
    status: 'success',
    data: { result: data.result, remainingBudget: data.remainingBudgetXLM, protocol: 'mpp' },
  });

  return {
    ...channelState,
    micropaymentCount: nextSeq,
    cumulativeXLM: data.micropayment.cumulativeXLM,
    remainingBudget: parseFloat(data.remainingBudgetXLM),
    lastResult: data.result,
  };
}

/**
 * Close the channel and settle on-chain.
 *
 * Submits the final signed micropayment state to the backend.
 * In a Soroban deployment this final state would be submitted to the
 * contract's close_channel() function which settles the net payment.
 */
export async function closeChannel({ channelState, onStep }) {
  const { sessionId, keypair, micropaymentCount, cumulativeXLM } = channelState;

  // Step 1: Perform On-Chain Settlement (If there's a balance to pay)
  let settleTxHash = null;
  if (cumulativeXLM > 0) {
    onStep({ label: `Settling ${cumulativeXLM} XLM on-chain via Stellar Mainnet...`, status: 'pending' });
    
    try {
      const sourceAccount = await server.loadAccount(keypair.publicKey());
      const transaction = new TransactionBuilder(sourceAccount, {
        fee: '1000', // Standard fee
        networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination: SETTLEMENT_ADDRESS,
            asset: Asset.native(),
            amount: cumulativeXLM.toString(),
          })
        )
        .addMemo(Memo.text(`MPP-SETTLE:${sessionId.slice(0, 8)}`))
        .setTimeout(30)
        .build();

      transaction.sign(keypair);
      const pushResult = await server.submitTransaction(transaction);
      settleTxHash = pushResult.hash;
      
      onStep({ label: `On-chain settlement successful: ${settleTxHash.slice(0, 12)}...`, status: 'info' });
    } catch (err) {
      console.error('MPP Settlement Failed:', err);
      throw new Error(`On-chain settlement failed: ${err.message}. Please ensure the wallet has funds.`);
    }
  }

  // Step 2: Notify backend of closure and providing proof
  onStep({ label: 'Notifying facilitator of channel closure...', status: 'pending' });
  const res = await fetch(`${BACKEND_URL}/api/mpp/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      sessionId, 
      finalSignature: signMicropaymentMessage(keypair, sessionId, micropaymentCount, cumulativeXLM),
      settleTxHash
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to close channel');

  onStep({
    label: `Channel settled — ${data.summary.totalCalls} calls, ${data.summary.totalSpentXLM} XLM total, ${data.summary.savedOnFeesXLM} XLM saved in fees`,
    status: 'success',
    data: data.summary,
  });

  return data.summary;
}

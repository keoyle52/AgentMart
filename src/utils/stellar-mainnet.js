import {
  Horizon,
  Keypair,
  Memo,
  TransactionBuilder,
  Networks,
  Asset,
  Operation,
} from '@stellar/stellar-sdk';

const rawUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const BACKEND_URL = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
const STELLAR_NETWORK = import.meta.env.VITE_STELLAR_NETWORK || 'PUBLIC';

const horizonUrl =
  STELLAR_NETWORK === 'PUBLIC'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';

const networkPassphrase =
  STELLAR_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;

const server = new Horizon.Server(horizonUrl);

// Wallet — Autonomous (secret-key) mode only

// Low-level payment builders

async function buildPaymentTx(sourcePublicKey, destinationAddress, amountXLM) {
  const account = await server.loadAccount(sourcePublicKey);
  return new TransactionBuilder(account, {
    fee: await server.fetchBaseFee(),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: destinationAddress,
        asset: Asset.native(),
        amount: amountXLM.toString(),
      })
    )
    .addMemo(Memo.text('x402:agentmart'))
    .setTimeout(30)
    .build();
}

async function payWithAutonomousKey(secretKey, destinationAddress, amountXLM) {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const tx = await buildPaymentTx(sourceKeypair.publicKey(), destinationAddress, amountXLM);
  tx.sign(sourceKeypair);
  const response = await server.submitTransaction(tx);
  return response.hash;
}

// x402 Protocol Flow
/**
 * Full x402 flow:
 *  1. POST /api/agents/:id/invoke  → expect 402 with payment details
 *  2. Pay on-chain (autonomous key)
 *  3. POST /api/x402/verify        → server verifies tx on Stellar, returns service result
 *
 * @param {string} agentId
 * @param {'secret'} authMode
 * @param {string} publicKey  - sender public key
 * @param {string|null} secretKey - only for autonomous mode
 * @param {function} onStep   - callback(step: {label, status}) for UI updates
 */
export async function invokeAgentX402(agentId, publicKey, secretKey, onStep) {
  // Step 1 — Invoke agent (expect 402)
  onStep({ label: 'Requesting service...', status: 'pending' });
  const invokeRes = await fetch(`${BACKEND_URL}/api/agents/${agentId}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }),
  });

  if (invokeRes.status !== 402) {
    const body = await invokeRes.json().catch(() => ({}));
    throw new Error(body.error || `Unexpected status ${invokeRes.status}`);
  }

  const { paymentDetails } = await invokeRes.json();
  onStep({
    label: `HTTP 402 intercepted — must pay ${paymentDetails.amount} XLM`,
    status: 'warning',
    data: { nonce: paymentDetails.nonce, destination: paymentDetails.destination },
  });

  // Step 2 — Pay on-chain (autonomous secret-key mode)
  onStep({ label: `Signing & submitting payment (${paymentDetails.amount} XLM)...`, status: 'pending' });
  const txHash = await payWithAutonomousKey(secretKey, paymentDetails.destination, paymentDetails.amount);
  onStep({ label: `Payment submitted on-chain`, status: 'info', data: { txHash } });

  // Step 3 — Wait briefly for network propagation, then verify
  await new Promise((r) => setTimeout(r, 3000));
  onStep({ label: 'Verifying payment with x402 facilitator...', status: 'pending' });

  const verifyRes = await fetch(`${BACKEND_URL}/api/x402/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txHash, nonce: paymentDetails.nonce, agentId }),
  });

  const verifyData = await verifyRes.json();

  if (!verifyRes.ok) {
    throw new Error(verifyData.error || 'Verification failed');
  }

  // Step 4 — Service delivered
  onStep({
    label: `Service delivered by ${verifyData.agentName}`,
    status: 'success',
    data: {
      txHash,
      explorerUrl: verifyData.explorerUrl,
      result: verifyData.result,
      protocol: 'x402',
    },
  });

  return verifyData;
}

// MPP Channel Flow

export async function openMPPSession(agentId, publicKey, maxBudgetXLM, onStep) {
  onStep({ label: `Opening MPP payment channel (budget: ${maxBudgetXLM} XLM)...`, status: 'pending' });

  const res = await fetch(`${BACKEND_URL}/api/mpp/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, senderPublicKey: publicKey, maxBudgetXLM }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to open MPP session');

  onStep({ label: `MPP channel opened — Session ${data.sessionId.substring(0, 8)}...`, status: 'success', data });
  return data;
}

export async function invokeMPPAgent(sessionId, onStep) {
  onStep({ label: `Sending off-chain micropayment (session ${sessionId.substring(0, 8)}...)`, status: 'pending' });

  const res = await fetch(`${BACKEND_URL}/api/mpp/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'MPP invoke failed');

  onStep({
    label: `Micropayment #${data.micropayment.sequence} — ${data.micropayment.amountXLM} XLM (off-chain, no fee)`,
    status: 'success',
    data: { result: data.result, remainingBudget: data.remainingBudgetXLM, protocol: 'mpp' },
  });

  return data;
}

export async function closeMPPSession(sessionId, onStep) {
  onStep({ label: `Closing MPP channel and settling on-chain...`, status: 'pending' });

  const res = await fetch(`${BACKEND_URL}/api/mpp/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to close MPP session');

  onStep({
    label: `MPP session closed — ${data.summary.totalCalls} calls, ${data.summary.totalSpentXLM} XLM total`,
    status: 'success',
    data: data.summary,
  });
  return data;
}

// Balance helpers

export async function fetchBalance(publicKey) {
  const account = await server.loadAccount(publicKey);
  const native = account.balances.find((b) => b.asset_type === 'native');
  return native ? parseFloat(native.balance) : 0;
}

export { server };

import { 
  TransactionBuilder, 
  Networks, 
  Operation, 
  Keypair, 
  Asset, 
  Horizon,
  Memo
} from '@stellar/stellar-sdk';

const BASE_FEE = '100'; // Default base fee

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

// Official USDC Asset on Stellar Mainnet (Circle)
const USDC_ASSET = new Asset(
  'USDC', 
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
);

// Wallet — Autonomous (secret-key) mode only

// Low-level payment builders

async function buildPaymentTx(sourcePublicKey, destinationAddress, amountUSDC) {
  const account = await server.loadAccount(sourcePublicKey);
  return new TransactionBuilder(account, {
    fee: await server.fetchBaseFee(),
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: destinationAddress,
        asset: USDC_ASSET,
        amount: amountUSDC.toString(),
      })
    )
    .addMemo(Memo.text('x402:agentmart'))
    .setTimeout(30)
    .build();
}

async function payWithAutonomousKey(secretKey, destinationAddress, amountUSDC) {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const tx = await buildPaymentTx(sourceKeypair.publicKey(), destinationAddress, amountUSDC);
  tx.sign(sourceKeypair);
  
  try {
    const response = await server.submitTransaction(tx);
    return response.hash;
  } catch (error) {
    // Extract detailed Stellar error codes from Horizon's response
    const codes = error.response?.data?.extras?.result_codes;
    if (codes) {
      const opErrors = codes.operations ? codes.operations.join(', ') : '';
      const txError = codes.transaction || '';
      const detailedMsg = opErrors ? `${txError} -> ${opErrors}` : txError;
      throw new Error(`Stellar Horizon Error: ${detailedMsg}`);
    }
    throw error;
  }
}

/**
 * Setup a trustline for the official Circle USDC asset.
 * Required for accounts that have never held USDC on Stellar.
 */
export async function setupTrustline(secretKey) {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const account = await server.loadAccount(sourceKeypair.publicKey());
  
  const tx = new TransactionBuilder(account, {
    fee: await server.fetchBaseFee(),
    networkPassphrase,
  })
    .addOperation(
      Operation.changeTrust({
        asset: USDC_ASSET,
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(sourceKeypair);
  const response = await server.submitTransaction(tx);
  return response.hash;
}

/**
 * Full x402 Official Flow:
 *  1. POST /api/agents/:id/invoke      → Intercept 402, parse 'PAYMENT-REQUIRED' header
 *  2. Pay on-chain via Stellar         → Get Transaction Hash
 *  3. POST /api/agents/:id/invoke      → Add 'PAYMENT-SIGNATURE' header, get real result
 */
export async function invokeAgentX402(agentId, publicKey, secretKey, onStep) {
  // Step 1 — Initial Invocation (Expect 402)
  onStep({ label: 'Requesting service (Handshake)...', status: 'pending' });
  const initialRes = await fetch(`${BACKEND_URL}/api/agents/${agentId}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }), // Input parameters go here
  });

  if (initialRes.status !== 402) {
    const body = await initialRes.json().catch(() => ({}));
    throw new Error(body.error || `Unexpected status ${initialRes.status}`);
  }

  // Official header is 'PAYMENT-REQUIRED' (v2 uses Base64 JSON)
  const paymentRequiredRaw = initialRes.headers.get('PAYMENT-REQUIRED');
  if (!paymentRequiredRaw) throw new Error('Missing PAYMENT-REQUIRED header');
  
  const paymentConfig = JSON.parse(atob(paymentRequiredRaw));
  const accepted = paymentConfig.accepts[0]; 
  let amount = accepted.amount;
  
  // Official x402 units are in 10^-7 (stroops). Convert for Stellar SDK.
  if (amount && !amount.toString().includes('.')) {
    amount = (parseFloat(amount) / 10000000).toFixed(7).replace(/\.?0+$/, '');
  }

  onStep({
    label: `x402 Handshake: Payment of ${amount} USDC requested`,
    status: 'warning'
  });

  // Step 2 — Pay on-chain
  onStep({ label: `Submitting payment to ${accepted.payTo.substring(0, 8)}...`, status: 'pending' });
  const txHash = await payWithAutonomousKey(secretKey, accepted.payTo, amount);
  onStep({ label: `Payment submitted: ${txHash.substring(0, 12)}...`, status: 'info', data: { txHash } });

  // Step 3 — Submit official proof
  onStep({ label: `Waiting for facilitator to index (3s)...`, status: 'pending' });
  await new Promise(r => setTimeout(r, 3000));
  
  onStep({ label: `Verifying payment proof...`, status: 'pending' });
  
  // Official x402 v2 Proof Format: base64(JSON({ x402Version, accepted, proof }))
  const paymentPayload = {
    x402Version: 2,
    accepted: accepted,
    proof: { transaction: txHash }
  };
  const signature = btoa(JSON.stringify(paymentPayload));

  const finalRes = await fetch(`${BACKEND_URL}/api/agents/${agentId}/invoke`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': signature
    },
    body: JSON.stringify({ agentId }),
  });

  const finalData = await finalRes.json().catch(() => ({}));
  if (!finalRes.ok) {
    throw new Error(finalData.error || 'Payment verification failed');
  }

  // Step 4 — Service delivered
  onStep({
    label: `Service delivered by agent`,
    status: 'success',
    data: {
      txHash,
      explorerUrl: `https://stellar.expert/explorer/${STELLAR_NETWORK === 'PUBLIC' ? 'public' : 'testnet'}/tx/${txHash}`,
      result: finalData.result,
      protocol: 'x402',
    },
  });

  return finalData;
}

// MPP Channel Flow

export async function openMPPSession(agentId, publicKey, maxBudgetUSDC, onStep) {
  onStep({ label: `Opening MPP payment channel (budget: ${maxBudgetUSDC} USDC)...`, status: 'pending' });

  const res = await fetch(`${BACKEND_URL}/api/mpp/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, senderPublicKey: publicKey, maxBudgetXLM: maxBudgetUSDC }),
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
    label: `Micropayment #${data.micropayment.sequence} — ${data.micropayment.amountUSDC} USDC (off-chain, no fee)`,
    status: 'success',
    data: { result: data.result, remainingBudget: data.remainingBudgetUSDC, protocol: 'mpp' },
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
    label: `MPP session closed — ${data.summary.totalCalls} calls, ${data.summary.totalSpentUSDC} USDC total`,
    status: 'success',
    data: data.summary,
  });
  return data;
}

// Balance helpers

export async function fetchBalance(publicKey) {
  try {
    const account = await server.loadAccount(publicKey);
    const native = account.balances.find((b) => b.asset_type === 'native');
    const usdc = account.balances.find(
      (b) => b.asset_code === 'USDC' && b.asset_issuer === 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
    );
    return {
      native: native ? parseFloat(native.balance) : 0,
      usdc: usdc ? parseFloat(usdc.balance) : 0,
      hasUSDCTrustline: !!usdc,
    };
  } catch (err) {
    console.error('Fetch balance failed:', err);
    return { native: 0, usdc: 0 };
  }
}

export { server };

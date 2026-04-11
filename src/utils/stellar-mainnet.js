import { 
  TransactionBuilder, 
  Networks, 
  Operation, 
  Keypair, 
  Asset, 
  Horizon, 
  BASE_FEE,
  Memo
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

// Official USDC Asset on Stellar Mainnet
const USDC_ASSET = new Asset(
  'USDC', 
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X7KGX3MHO77S6Z6Z6Z6Z6Z6Z'
);

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
        asset: USDC_ASSET,
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

  // Official header is 'PAYMENT-REQUIRED'
  const paymentRequiredRaw = initialRes.headers.get('PAYMENT-REQUIRED');
  if (!paymentRequiredRaw) throw new Error('Missing PAYMENT-REQUIRED header in 402 response');
  
  const paymentConfig = JSON.parse(paymentRequiredRaw);
  const paymentDetails = paymentConfig.accepts[0]; // Official spec usually allows multiple, we take first

  onStep({
    label: `x402 Handshake: Payment of ${paymentDetails.price} requested`,
    status: 'warning',
    data: { destination: paymentDetails.payTo },
  });

  // Step 2 — Pay on-chain (Autonomous mode)
  onStep({ label: `Signing & submitting payment to ${paymentDetails.payTo.substring(0, 8)}...`, status: 'pending' });
  const txHash = await payWithAutonomousKey(secretKey, paymentDetails.payTo, paymentDetails.price);
  onStep({ label: `Payment submitted: ${txHash.substring(0, 12)}...`, status: 'info', data: { txHash } });

  // Step 3 — Wait for propagation and submit proof
  // Facilitators usually need a few seconds for Horizon to index the tx
  await new Promise((r) => setTimeout(r, 4000));
  onStep({ label: 'Verifying proof via official x402 middleware...', status: 'pending' });

  const finalRes = await fetch(`${BACKEND_URL}/api/agents/${agentId}/invoke`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': txHash // Reverting to spec-compliant header
    },
    body: JSON.stringify({ agentId, txHash }), // Passing txHash in body too for convenience
  });

  const finalData = await finalRes.json();

  if (!finalRes.ok) {
    throw new Error(finalData.error || 'Official verification failed');
  }

  // Step 4 — Service delivered
  onStep({
    label: `Service delivered by ${finalData.agentName}`,
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

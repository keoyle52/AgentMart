import { 
  TransactionBuilder, 
  Networks, 
  Operation, 
  Keypair, 
  Asset, 
  Horizon,
  Address,
  nativeToScVal,
  xdr,
  rpc,
  Contract
} from '@stellar/stellar-sdk';

const BASE_FEE = '100'; // Default base fee

const rawUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const BACKEND_URL = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
const STELLAR_NETWORK = 'PUBLIC';

const horizonUrl = 'https://horizon.stellar.org';

const networkPassphrase = Networks.PUBLIC;

const server = new Horizon.Server(horizonUrl);
const rpcServer = new rpc.Server('https://mainnet.sorobanrpc.com');
const usdcContract = new Contract('CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75');

// Wallet — Autonomous (secret-key) mode only

// Low-level payment builders

/**
 * Builds a Soroban Transaction for USDC transfer (Managed Relay Compliance).
 * Uses rpcServer.prepareTransaction to automatically hydrate auth entries and resources.
 */
async function buildSorobanTransferTx(secretKey, destination, amountUSDC) {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const from = sourceKeypair.publicKey();
  const account = await server.loadAccount(from);

  // 1. Format Arguments (USDC decimals: 7)
  const amountStroops = BigInt(Math.round(parseFloat(amountUSDC) * 10000000));
  const fromScVal = nativeToScVal(from, { type: 'address' });
  const toScVal = nativeToScVal(destination, { type: 'address' });
  const amountScVal = nativeToScVal(amountStroops, { type: 'i128' });

  // 2. Build the Initial Transaction via Contract Class
  const tx = new TransactionBuilder(account, {
    fee: '100000', // Base fee to be refined by simulation
    networkPassphrase,
  })
    .addOperation(usdcContract.call('transfer', fromScVal, toScVal, amountScVal))
    .setTimeout(120)
    .build();

  // 3. Simulate and Prepare (Hydrates fossils, footprints, and adds auth entries)
  const preparedTx = await rpcServer.prepareTransaction(tx);
  return preparedTx;
}

async function payWithAutonomousKey(secretKey, destinationAddress, amountUSDC) {
  const sourceKeypair = Keypair.fromSecret(secretKey);
  const tx = await buildSorobanTransferTx(secretKey, destinationAddress, amountUSDC);
  
  // 4. Sign ONLY the Auth Entries
  // Per OpenZeppelin relayer rules, the main envelope must remain unsigned (sponsored).
  tx.signAuthEntries(sourceKeypair);
  
  return {
    xdr: tx.toXDR(),
    hash: tx.hash().toString('hex')
  };
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

  // Extract price correctly (handles both string and AssetAmount object from v2 spec)
  const priceValue = amount || (typeof accepted.price === 'object' ? (parseFloat(accepted.price.amount) / 10000000).toString() : accepted.price);

  onStep({ label: `x402 Handshake: Payment of ${priceValue} USDC requested`, status: 'info' });

  // Step 2 — Pay on-chain (Soroban Native)
  onStep({ label: `Preparing signed Soroban authorization...`, status: 'pending' });
  
  const { xdr: txXdr, hash: txHash } = await payWithAutonomousKey(secretKey, accepted.payTo, priceValue);
  onStep({ label: `Soroban proof generated.`, status: 'info', data: { txHash } });

  // Step 3 — Submit official proof
  onStep({ label: `Waiting for relayer indexing (15s)...`, status: 'pending' });
  await new Promise(r => setTimeout(r, 15000));
  
  onStep({ label: `Submitting Soroban XDR to relayer...`, status: 'pending' });
  
  // Official x402 v2 Proof Format: base64(JSON({ x402Version, accepted, proof }))
  accepted.network = 'stellar:pubnet';
  const paymentPayload = {
    x402Version: 2,
    accepted: accepted,
    proof: { transaction: txXdr }
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
      explorerUrl: `https://stellar.expert/explorer/public/tx/${txHash}`,
      result: finalData.result,
      priceUSDC: '0.001',
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
    body: JSON.stringify({ agentId, senderPublicKey: publicKey, maxBudgetUSDC: maxBudgetUSDC }),
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

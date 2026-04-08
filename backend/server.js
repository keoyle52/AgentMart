import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { Horizon, Networks } from '@stellar/stellar-sdk';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3001;

const SETTLEMENT_ADDRESS =
  process.env.SETTLEMENT_ADDRESS ||
  'GB3P3TDKYJ7EHYBYY42Y3W5ND3KZZVOM4CBRC5W2OAKIQW7NIVCIG22S';

const STELLAR_NETWORK = process.env.STELLAR_NETWORK || 'PUBLIC';
const horizonServer = new Horizon.Server(
  STELLAR_NETWORK === 'PUBLIC'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org'
);

// In-memory nonce store to prevent replay attacks
// In production, use Redis or a DB
const pendingNonces = new Map(); // nonce -> { agentId, amount, expiresAt }

// Agents registered in the marketplace
const AGENTS = {
  'web-scraper': {
    id: 'web-scraper',
    name: 'Web Scraper Agent',
    description: 'Extracts structured data from any public URL.',
    priceXLM: '0.001',
    protocol: 'x402',
    invoke: () => ({
      status: 'success',
      result: {
        title: 'Stellar Development Foundation',
        url: 'https://stellar.org',
        summary: 'The Stellar Development Foundation supports the growth and development of the open-source Stellar network.',
        wordCount: 2847,
        extractedAt: new Date().toISOString(),
      },
    }),
  },
  'price-oracle': {
    id: 'price-oracle',
    name: 'Price Oracle Agent',
    description: 'Delivers real-time asset prices from aggregated sources.',
    priceXLM: '0.0005',
    protocol: 'x402',
    invoke: () => ({
      status: 'success',
      result: {
        XLM_USD: (0.095 + Math.random() * 0.01).toFixed(4),
        XLM_EUR: (0.087 + Math.random() * 0.01).toFixed(4),
        BTC_USD: (62000 + Math.random() * 500).toFixed(2),
        ETH_USD: (3100 + Math.random() * 50).toFixed(2),
        source: 'Aggregated (CoinGecko + Binance + Kraken)',
        timestamp: new Date().toISOString(),
      },
    }),
  },
  'security-auditor': {
    id: 'security-auditor',
    name: 'Security Auditor Agent',
    description: 'Scans Soroban smart contracts for vulnerabilities.',
    priceXLM: '0.02',
    protocol: 'x402',
    invoke: () => ({
      status: 'success',
      result: {
        contractId: 'CAHT...XYZW',
        findings: [
          { severity: 'LOW', issue: 'Missing event emission on state change', line: 42 },
          { severity: 'INFO', issue: 'Consider adding reentrancy guard', line: 88 },
        ],
        score: 94,
        scannedAt: new Date().toISOString(),
      },
    }),
  },
  'translator': {
    id: 'translator',
    name: 'Realtime Translator Agent',
    description: 'Context-aware A2A language translation at machine speed.',
    priceXLM: '0.001',
    protocol: 'mpp',
    invoke: () => ({
      status: 'success',
      result: {
        originalText: 'The x402 protocol enables machine-to-machine payments.',
        translatedText: 'El protocolo x402 permite pagos máquina a máquina.',
        targetLanguage: 'es',
        confidence: 0.98,
        model: 'AgentMart-NMT-v2',
      },
    }),
  },
  'code-executor': {
    id: 'code-executor',
    name: 'Sandboxed Code Executor',
    description: 'Runs isolated code snippets and returns output.',
    priceXLM: '0.005',
    protocol: 'x402',
    invoke: () => ({
      status: 'success',
      result: {
        language: 'python',
        input: 'print(sum(range(1, 101)))',
        stdout: '5050',
        stderr: '',
        executionTimeMs: 12,
        memoryUsedKB: 128,
      },
    }),
  },
  'image-generator': {
    id: 'image-generator',
    name: 'AI Image Generator',
    description: 'Generates images from text prompts via A2A inference.',
    priceXLM: '0.01',
    protocol: 'mpp',
    invoke: () => ({
      status: 'success',
      result: {
        prompt: 'A futuristic agent marketplace on the Stellar blockchain',
        imageUrl: 'https://picsum.photos/seed/agentmart/512/512',
        model: 'AgentMart-Diffusion-v1',
        generatedAt: new Date().toISOString(),
      },
    }),
  },
};

// Middleware
app.use(cors());
app.use(express.json());

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Routes

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', network: STELLAR_NETWORK, agents: Object.keys(AGENTS).length });
});

// List all agents
app.get('/api/agents', (_req, res) => {
  res.json(
    Object.values(AGENTS).map(({ id, name, description, priceXLM, protocol }) => ({
      id, name, description, priceXLM, protocol,
    }))
  );
});

/**
 * CORE x402 ENDPOINT
 * Phase 1: Client invokes agent → Server responds with 402 + payment details
 *
 * HTTP 402 Payment Required is the heart of the x402 protocol.
 * The server tells the client exactly how much to pay, to whom, and with what nonce.
 */
app.post('/api/agents/:agentId/invoke', (req, res) => {
  const agent = AGENTS[req.params.agentId];
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  // Check if request already has a payment proof header (Phase 2)
  const paymentProof = req.headers['x-payment-proof'];
  if (paymentProof) {
    // Redirect to verification (handled by /verify endpoint)
    return res.status(400).json({ error: 'Use POST /api/x402/verify to submit payment proof' });
  }

  // Phase 1: Issue 402 with payment details
  const nonce = uuidv4();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

  pendingNonces.set(nonce, {
    agentId: agent.id,
    amount: agent.priceXLM,
    expiresAt,
  });

  // Clean up expired nonces
  for (const [k, v] of pendingNonces.entries()) {
    if (v.expiresAt < Date.now()) pendingNonces.delete(k);
  }

  const paymentDetails = {
    version: '1.0',
    protocol: 'x402',
    network: STELLAR_NETWORK === 'PUBLIC' ? 'stellar:mainnet' : 'stellar:testnet',
    amount: agent.priceXLM,
    asset: 'XLM',
    destination: SETTLEMENT_ADDRESS,
    nonce,
    expiresAt: new Date(expiresAt).toISOString(),
    agentId: agent.id,
  };

  // RFC-compliant: 402 with payment details in headers AND body
  res.status(402)
    .set('X-Payment-Details', JSON.stringify(paymentDetails))
    .set('X-Payment-Version', '1.0')
    .json({
      error: 'Payment Required',
      message: `This agent requires ${agent.priceXLM} XLM per request.`,
      paymentDetails,
    });
});

/**
 * x402 VERIFICATION ENDPOINT
 * Phase 2: Client pays on-chain and submits proof → Server verifies on Stellar → Returns service result
 */
app.post('/api/x402/verify', async (req, res) => {
  const { txHash, nonce, agentId } = req.body;

  if (!txHash || !nonce || !agentId) {
    return res.status(400).json({ error: 'Missing required fields: txHash, nonce, agentId' });
  }

  // Validate nonce
  const pending = pendingNonces.get(nonce);
  if (!pending) {
    return res.status(400).json({ error: 'Invalid or expired nonce. Please invoke the agent again.' });
  }
  if (pending.agentId !== agentId) {
    return res.status(400).json({ error: 'Nonce agent mismatch.' });
  }
  if (pending.expiresAt < Date.now()) {
    pendingNonces.delete(nonce);
    return res.status(400).json({ error: 'Payment nonce expired. Please invoke the agent again.' });
  }

  const agent = AGENTS[agentId];
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  try {
    // Verify the transaction on Stellar
    const tx = await horizonServer.transactions().transaction(txHash).call();

    // Check it's not expired (submitted within last 10 minutes)
    const txTime = new Date(tx.created_at).getTime();
    if (Date.now() - txTime > 10 * 60 * 1000) {
      return res.status(400).json({ error: 'Transaction is too old. Please submit a fresh payment.' });
    }

    // Parse operations to verify payment amount + destination
    const ops = await horizonServer.operations().forTransaction(txHash).call();
    const paymentOp = ops.records.find(
      (op) =>
        op.type === 'payment' &&
        op.to === SETTLEMENT_ADDRESS &&
        op.asset_type === 'native' &&
        parseFloat(op.amount) >= parseFloat(pending.amount)
    );

    if (!paymentOp) {
      return res.status(402).json({
        error: 'Payment verification failed',
        message: `Could not find a valid payment of ${pending.amount} XLM to ${SETTLEMENT_ADDRESS} in transaction ${txHash}.`,
      });
    }

    // ✅ Payment verified — consume nonce and return service result
    pendingNonces.delete(nonce);

    const serviceResult = agent.invoke();

    console.log(`✅ x402 verified: agent=${agentId}, tx=${txHash}, amount=${paymentOp.amount} XLM`);

    return res.json({
      status: 'verified',
      protocol: 'x402',
      txHash,
      amountPaid: paymentOp.amount + ' XLM',
      agentId,
      agentName: agent.name,
      explorerUrl: `https://stellar.expert/explorer/${STELLAR_NETWORK === 'PUBLIC' ? 'public' : 'testnet'}/tx/${txHash}`,
      ...serviceResult,
    });
  } catch (err) {
    console.error('Verification error:', err.message);

    // If tx not found on network yet, tell client to retry
    if (err?.response?.status === 404) {
      return res.status(404).json({
        error: 'Transaction not yet found on the network. Please retry in a few seconds.',
      });
    }

    return res.status(500).json({ error: 'Server error during verification: ' + err.message });
  }
});

// MPP Session endpoints (Phase 2 - Day 2)

const mppSessions = new Map(); // sessionId → session state

app.post('/api/mpp/open', (req, res) => {
  const { agentId, senderPublicKey, maxBudgetXLM, openTxHash } = req.body;
  if (!agentId || !senderPublicKey || !maxBudgetXLM) {
    return res.status(400).json({ error: 'Missing: agentId, senderPublicKey, maxBudgetXLM' });
  }

  const sessionId = uuidv4();
  const session = {
    sessionId,
    agentId,
    senderPublicKey,
    maxBudgetXLM: parseFloat(maxBudgetXLM),
    spentXLM: 0,
    micropayments: [],
    openedAt: new Date().toISOString(),
    openTxHash: openTxHash || null,
    status: 'open',
  };
  mppSessions.set(sessionId, session);

  console.log(`📂 MPP Session opened: ${sessionId} for agent ${agentId}`);

  res.json({
    sessionId,
    status: 'open',
    agentId,
    maxBudgetXLM,
    message: 'MPP payment channel opened. Use sessionId for subsequent requests.',
  });
});

app.post('/api/mpp/invoke', (req, res) => {
  const { sessionId, signedPaymentMessage } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  const session = mppSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'open') return res.status(400).json({ error: 'Session not open' });

  const agent = AGENTS[session.agentId];
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const cost = parseFloat(agent.priceXLM);
  if (session.spentXLM + cost > session.maxBudgetXLM) {
    return res.status(402).json({
      error: 'Channel budget exhausted',
      spentXLM: session.spentXLM,
      maxBudgetXLM: session.maxBudgetXLM,
    });
  }

  // Record micropayment (off-chain)
  const payment = {
    sequence: session.micropayments.length + 1,
    amountXLM: cost,
    cumulativeXLM: session.spentXLM + cost,
    signedMessage: signedPaymentMessage || 'off-chain-signed',
    timestamp: new Date().toISOString(),
  };
  session.micropayments.push(payment);
  session.spentXLM += cost;

  const serviceResult = agent.invoke();

  console.log(`⚡ MPP micropayment: session=${sessionId}, seq=${payment.sequence}, cost=${cost} XLM`);

  res.json({
    status: 'success',
    protocol: 'mpp',
    sessionId,
    micropayment: payment,
    remainingBudgetXLM: (session.maxBudgetXLM - session.spentXLM).toFixed(6),
    ...serviceResult,
  });
});

app.post('/api/mpp/close', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  const session = mppSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.status = 'closed';
  session.closedAt = new Date().toISOString();

  console.log(`🔒 MPP Session closed: ${sessionId}, total spent: ${session.spentXLM} XLM over ${session.micropayments.length} calls`);

  res.json({
    status: 'closed',
    sessionId,
    summary: {
      totalCalls: session.micropayments.length,
      totalSpentXLM: session.spentXLM.toFixed(6),
      savedOnFeesXLM: (session.micropayments.length * 0.00001 - 0.00001).toFixed(6),
      openedAt: session.openedAt,
      closedAt: session.closedAt,
    },
    message: 'Submit the final signed state to Soroban to settle the channel on-chain.',
  });
});

app.get('/api/mpp/session/:sessionId', (req, res) => {
  const session = mppSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT} - Network: ${STELLAR_NETWORK}`);
});

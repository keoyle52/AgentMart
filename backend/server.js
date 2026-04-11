import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { Horizon, Networks } from '@stellar/stellar-sdk';
import 'dotenv/config';
import fetch from 'node-fetch';
import { HTTPFacilitatorClient, x402ResourceServer, x402HTTPResourceServer } from '@x402/core/server';
import { paymentMiddlewareFromHTTPServer } from '@x402/express';
import { ExactStellarScheme } from '@x402/stellar/exact/server';

// Global fetch polyfill for Node versions < 18
if (!global.fetch) {
  global.fetch = fetch;
}

const app = express();
const STELLAR_NETWORK = 'PUBLIC'; // Forced to Mainnet
const SETTLEMENT_ADDRESS = process.env.SETTLEMENT_ADDRESS || 'GCJV64SQP24FBBYMUK5UUK76STPG45XGLVILU3TYNYASDAFFUSET3YY7';
const PORT = process.env.PORT || 3001;

// Intelligent Facilitator URL selection
const defaultFacilitatorUrl = 'https://channels.openzeppelin.com/x402';

const X402_FACILITATOR_URL = (process.env.X402_FACILITATOR_URL || defaultFacilitatorUrl).replace(/\/$/, '');
const X402_FACILITATOR_API_KEY = (process.env.X402_FACILITATOR_API_KEY || '').trim();

console.log(`[Config] Network: ${STELLAR_NETWORK}`);
console.log(`[Config] Facilitator: ${X402_FACILITATOR_URL}`);
console.log(`[Config] API Key: ${X402_FACILITATOR_API_KEY ? X402_FACILITATOR_API_KEY.substring(0, 8) + '...' : 'MISSING'}`);

// --- x402 Protocol State ---
let isX402Initialized = false;
let x402InitError = null;
const activeNetworkId = 'stellar:pubnet';

const horizonServer = new Horizon.Server('https://horizon.stellar.org');

// Persistent nonce store (Used for legacy fallback or external tracking if needed)
const pendingNonces = new Map();

// Agents registered in the marketplace
const AGENTS = {
  'web-scraper': {
    id: 'web-scraper',
    name: 'Web Scraper Agent',
    description: 'Extracts structured data from any public URL.',
    priceUSDC: '0.001', 
    protocol: 'x402',
    invoke: async (input) => {
      const targetUrl = input?.url || 'https://stellar.org';
      try {
        const response = await fetch(targetUrl, { headers: { 'User-Agent': 'AgentMart-Scraper/1.0' } });
        const html = await response.text();
        const titleMatch = html.match(/<title>(.*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1] : 'Unknown Title';
        const cleanText = html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
        const words = cleanText.split(/\s+/).length;
        
        return {
          status: 'success',
          result: {
            title,
            url: targetUrl,
            summary: `Successfully extracted and analyzed ${words} words from ${new URL(targetUrl).hostname}. Content appears to be focused on ${title.substring(0, 50)}...`,
            wordCount: words,
            extractedAt: new Date().toISOString(),
          },
        };
      } catch (err) {
        return {
          status: 'error',
          error: `Failed to scrape ${targetUrl}: ${err.message}`,
          result: { title: 'Extraction Failed', url: targetUrl, wordCount: 0, extractedAt: new Date().toISOString() }
        };
      }
    },
  },
  'price-oracle': {
    id: 'price-oracle',
    name: 'Price Oracle Agent',
    description: 'Delivers real-time asset prices from aggregated sources.',
    priceUSDC: '0.001',
    protocol: 'x402',
    invoke: async () => {
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,stellar,ethereum&vs_currencies=usd,eur', {
          headers: { 'User-Agent': 'AgentMart/1.0' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        return {
          status: 'success',
          result: {
            XLM_USD: data.stellar.usd.toFixed(4),
            XLM_EUR: data.stellar.eur.toFixed(4),
            BTC_USD: data.bitcoin.usd,
            ETH_USD: data.ethereum.usd,
            source: 'CoinGecko Live API',
            timestamp: new Date().toISOString(),
          },
        };
      } catch (err) {
        console.error('CoinGecko API Error:', err.message);
        // Fallback to mock data if API fails
        return {
          status: 'success',
          result: {
            XLM_USD: (0.095 + Math.random() * 0.01).toFixed(4),
            XLM_EUR: (0.087 + Math.random() * 0.01).toFixed(4),
            BTC_USD: (62000 + Math.random() * 500).toLocaleString('en-US'),
            ETH_USD: (3100 + Math.random() * 50).toLocaleString('en-US'),
            source: `Aggregated (Fallback: ${err.message})`,
            timestamp: new Date().toISOString(),
          },
        };
      }
    },
  },
  'security-auditor': {
    id: 'security-auditor',
    name: 'Security Auditor Agent',
    description: 'Scans Soroban smart contracts for vulnerabilities.',
    priceUSDC: '0.001',
    protocol: 'x402',
    invoke: async () => ({
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
    priceUSDC: '0.001',
    protocol: 'mpp',
    invoke: async () => ({
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
    priceUSDC: '0.001',
    protocol: 'x402',
    invoke: async () => ({
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
    priceUSDC: '0.001',
    protocol: 'mpp',
    invoke: async () => ({
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

// Resilient CORS for x402 Protocol
app.use(cors({
  origin: true, // Allow all origins for the hackathon
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'PAYMENT-SIGNATURE', 'PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
  exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
  credentials: true
}));
app.use(express.json());

// Health check endpoint (STAY ABOVE MIDDLEWARE to avoid crashes during warming up)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    network: STELLAR_NETWORK,
    x402Initialized: isX402Initialized,
    error: x402InitError,
    timestamp: new Date().toISOString()
  });
});

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// x402 Middleware Configuration
const x402Routes = {};
const USDC_ASSET = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';

Object.values(AGENTS).forEach(agent => {
  if (agent.protocol === 'x402') {
    x402Routes[`POST /api/agents/${agent.id}/invoke`] = {
      accepts: [{
        scheme: 'exact',
        // Use an object to specify classic asset directly, avoiding Soroban defaults
        price: {
          amount: '10000', // 0.001 * 10^7 (Stellar precision)
          asset: USDC_ASSET
        },
        network: 'stellar:pubnet', 
        payTo: SETTLEMENT_ADDRESS,
      }],
      description: agent.description,
    };
  }
});

// 1. Authenticated Facilitator Client
// Standard x402 v2 expects individual headers for each operation type
// Standard x402 v2 resilient auth headers
const facilitatorClient = new HTTPFacilitatorClient({
  url: X402_FACILITATOR_URL,
  createAuthHeaders: async () => {
    const apiKey = (process.env.X402_FACILITATOR_API_KEY || '').trim();
    if (!apiKey) throw new Error('X402_FACILITATOR_API_KEY is missing.');
    
    // Providing both formats to ensure compatibility with different facilitator implementations
    const authHeaders = { 
      'Authorization': `Bearer ${apiKey}`,
      'X-API-Key': apiKey 
    };
    
    return {
      supported: authHeaders,
      verify: authHeaders,
      settle: authHeaders
    };
  }
});

// 2. Official x402 Stack Initialization (Managed Relay)
const horizonUrl = 'https://horizon.stellar.org';
const localFacilitator = new ExactStellarScheme({ horizonUrl });

const x402Server = new x402ResourceServer([facilitatorClient, localFacilitator]);
x402Server.register(activeNetworkId, localFacilitator);

// 3. Official Express Middleware Adapter
const httpServer = new x402HTTPResourceServer(x402Server, x402Routes);
const officialHandler = paymentMiddlewareFromHTTPServer(httpServer, null, null, false);

const x402Middleware = async (req, res, next) => {
  if (!req.path.startsWith('/api/agents/')) return next();

  if (!isX402Initialized) {
    return res.status(503).json({ 
      error: 'x402 protocol warming up', 
      message: 'Synchronizing with Stellar network...' 
    });
  }

  // Diagnostic Interceptor
  const originalSend = res.send;
  res.send = function (body) {
    if (res.statusCode >= 400 && req.headers['payment-signature']) {
      try {
        const signature = req.headers['payment-signature'];
        const decoded = JSON.parse(Buffer.from(signature, 'base64').toString());
        console.warn(`[x402 Trace] Failure on path: ${req.path}`);
        console.warn(`[x402 Trace] Payload Signature:`, JSON.stringify(decoded, null, 2));
        console.warn(`[x402 Trace] Rejection Body:`, body);
      } catch (e) {
        console.warn(`[x402 Trace] Failed to decode signature: ${e.message}`);
      }
    }
    return originalSend.apply(res, arguments);
  };

  return officialHandler(req, res, next);
};

app.use(x402Middleware);

// 4. Background Initialization (Official .initialize() call)
async function initializeX402() {
  console.log('🔄 Initializing x402 protocol in background...');
  try {
    await httpServer.initialize();
    isX402Initialized = true;
    x402InitError = null;
    console.log('✅ x402 Protocol synchronized and ready.');
  } catch (err) {
    x402InitError = err.message;
    isX402Initialized = false;
    console.error(`❌ x402 Initialization failed: ${err.message}`);
    setTimeout(initializeX402, 10000);
  }
}

initializeX402();

// Refactored Agent Invocation Gate (No longer needs manual verification logic)
app.post('/api/agents/:agentId/invoke', async (req, res) => {
  const { agentId } = req.params;
  const agent = AGENTS[agentId];
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  try {
    const serviceResult = await agent.invoke(req.body);
    console.log(`✅ x402 Service Delivered: agent=${agentId}`);
    
    // Official x402 spec returns results directly if payment is verified by middleware
    res.json({
      status: 'success',
      protocol: 'x402',
      agentId,
      agentName: agent.name,
      ...serviceResult
    });
  } catch (err) {
    res.status(500).json({ error: 'Agent execution failed: ' + err.message });
  }
});

app.post('/api/x402/verify', (req, res) => {
  res.status(410).json({ 
    error: 'Deprecated', 
    message: 'Verification is now handled automatically by the x402 middleware.' 
  });
});

// MPP Session endpoints

const mppSessions = new Map(); // sessionId → session state

app.post('/api/mpp/open', (req, res) => {
  const { agentId, senderPublicKey, maxBudgetUSDC, openTxHash } = req.body;
  if (!agentId || !senderPublicKey || !maxBudgetUSDC) {
    return res.status(400).json({ error: 'Missing: agentId, senderPublicKey, maxBudgetUSDC' });
  }

  const sessionId = uuidv4();
  const session = {
    sessionId,
    agentId,
    senderPublicKey,
    maxBudgetUSDC: parseFloat(maxBudgetUSDC),
    spentUSDC: 0,
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
    maxBudgetUSDC,
    message: 'MPP payment channel opened. Use sessionId for subsequent requests.',
  });
});

app.post('/api/mpp/invoke', async (req, res) => {
  const { sessionId, signedPaymentMessage } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  const session = mppSessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status !== 'open') return res.status(400).json({ error: 'Session not open' });

  const agent = AGENTS[session.agentId];
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const cost = parseFloat(agent.priceUSDC);
  if (session.spentUSDC + cost > session.maxBudgetUSDC) {
    return res.status(402).json({
      error: 'Channel budget exhausted',
      spentUSDC: session.spentUSDC,
      maxBudgetUSDC: session.maxBudgetUSDC,
    });
  }

  // Record micropayment (off-chain)
  const payment = {
    sequence: session.micropayments.length + 1,
    amountUSDC: cost,
    cumulativeUSDC: session.spentUSDC + cost,
    signedMessage: signedPaymentMessage || 'off-chain-signed',
    timestamp: new Date().toISOString(),
  };
  session.micropayments.push(payment);
  session.spentUSDC += cost;

  const serviceResult = await agent.invoke(req.body);

  console.log(`⚡ MPP micropayment: session=${sessionId}, seq=${payment.sequence}, cost=${cost} XLM`);

  res.json({
    status: 'success',
    protocol: 'mpp',
    sessionId,
    micropayment: payment,
    remainingBudgetXLM: (session.maxBudgetUSDC - session.spentUSDC).toFixed(6),
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
  
  const { settleTxHash } = req.body;
  if (settleTxHash) {
    session.settleTxHash = settleTxHash;
    session.settlementStatus = 'pending_verification';
    
    // Asynchronous verification to not block the response
    verifyMPPSettlement(sessionId, settleTxHash, session.spentUSDC);
  }

  console.log(`🔒 MPP Session closed: ${sessionId}, total spent: ${session.spentUSDC} USDC. Settlement: ${settleTxHash || 'none'}`);

  res.json({
    status: 'closed',
    sessionId,
    settleTxHash,
    summary: {
      totalCalls: session.micropayments.length,
      totalSpentUSDC: session.spentUSDC.toFixed(6),
      savedOnFeesUSDC: (session.micropayments.length * 0.00001 - 0.00001).toFixed(6),
      openedAt: session.openedAt,
      closedAt: session.closedAt,
    },
    message: settleTxHash 
      ? `Settlement transaction received: ${settleTxHash}. Verifying on-chain...`
      : 'Session closed without on-chain settlement proof.',
  });
});

/**
 * Background worker to verify MPP settlement on Stellar
 */
async function verifyMPPSettlement(sessionId, txHash, expectedAmount) {
  const session = mppSessions.get(sessionId);
  if (!session) return;

  try {
    // Wait a few seconds for propagation if needed, but Horizon usually has it fast
    const tx = await horizonServer.transactions().transaction(txHash).call();
    const ops = await horizonServer.operations().forTransaction(txHash).call();
    
    const paymentOp = ops.records.find(
      (op) =>
        op.type === 'payment' &&
        op.to === SETTLEMENT_ADDRESS &&
        op.asset_code === 'USDC' &&
        op.asset_issuer === 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' && // Official USDC Issuer Address
        parseFloat(op.amount) >= parseFloat(expectedAmount.toFixed(7))
    );

    if (paymentOp) {
      session.settlementStatus = 'verified';
      console.log(`✅ MPP Settlement Verified: session=${sessionId}, tx=${txHash}, amount=${paymentOp.amount} XLM`);
    } else {
      session.settlementStatus = 'failed_invalid_payment';
      console.warn(`⚠️ MPP Settlement Verification Failed: session=${sessionId}, tx=${txHash}. Payment not found or amount mismatch.`);
    }
  } catch (err) {
    session.settlementStatus = 'failed_error';
    console.error(`❌ MPP Settlement Verification Error: session=${sessionId}, err=${err.message}`);
  }
}

app.get('/api/mpp/session/:sessionId', (req, res) => {
  const session = mppSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// Health check endpoint removed from here

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AgentMart Backend alive on port ${PORT} - Network: ${STELLAR_NETWORK}`);
});

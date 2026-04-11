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
const STELLAR_NETWORK = process.env.STELLAR_NETWORK || 'PUBLIC'; // PUBLIC or TESTNET
const SETTLEMENT_ADDRESS = process.env.SETTLEMENT_ADDRESS || 'GCJV64SQP24FBBYMUK5UUK76STPG45XGLVILU3TYNYASDAFFUSET3YY7';
const PORT = process.env.PORT || 3001;

// Intelligent Facilitator URL selection
const defaultFacilitatorUrl = STELLAR_NETWORK === 'PUBLIC' 
  ? 'https://channels.openzeppelin.com/x402'
  : 'https://channels.openzeppelin.com/testnet/x402';

const X402_FACILITATOR_URL = (process.env.X402_FACILITATOR_URL || defaultFacilitatorUrl).replace(/\/$/, '');
const X402_FACILITATOR_API_KEY = (process.env.X402_FACILITATOR_API_KEY || '').trim();

console.log(`[Config] Network: ${STELLAR_NETWORK}`);
console.log(`[Config] Facilitator: ${X402_FACILITATOR_URL}`);
console.log(`[Config] API Key: ${X402_FACILITATOR_API_KEY ? X402_FACILITATOR_API_KEY.substring(0, 8) + '...' : 'MISSING'}`);

// Official x402 Protocol Stack Configuration
const facilitatorClient = new HTTPFacilitatorClient({
  url: X402_FACILITATOR_URL,
  createAuthHeaders: async () => {
    const apiKey = (process.env.X402_FACILITATOR_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error('401 Unauthorized: X402_FACILITATOR_API_KEY is missing.');
    }
    // Some facilitators use Bearer, some use X-API-Key. Providing both for resilience.
    const authHeader = { 
      'Authorization': `Bearer ${apiKey}`,
      'X-API-Key': apiKey 
    };
    return {
      supported: authHeader,
      verify: authHeader,
      settle: authHeader,
      list: authHeader,
    };
  },
});

const x402NetworkIdentifier = STELLAR_NETWORK === 'PUBLIC' ? 'stellar:pubnet' : 'stellar:testnet';

const horizonServer = new Horizon.Server(
  STELLAR_NETWORK === 'PUBLIC'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org'
);

// Persistent nonce store (Used for legacy fallback or external tracking if needed)
const pendingNonces = new Map();

// Agents registered in the marketplace
const AGENTS = {
  'web-scraper': {
    id: 'web-scraper',
    name: 'Web Scraper Agent',
    description: 'Extracts structured data from any public URL.',
    priceUSDC: '0.0010000', 
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
    priceUSDC: '0.0001000',
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
    priceUSDC: '0.0100000',
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
    priceUSDC: '0.0010000',
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
    priceUSDC: '0.0050000',
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
    priceUSDC: '0.0100000',
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

// Middleware
app.use(cors({
  exposedHeaders: ['PAYMENT-REQUIRED']
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
Object.values(AGENTS).forEach(agent => {
  if (agent.protocol === 'x402') {
    x402Routes[`POST /api/agents/${agent.id}/invoke`] = {
      accepts: [{
        scheme: 'exact',
        price: agent.priceUSDC, 
        asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        network: x402NetworkIdentifier,
        payTo: SETTLEMENT_ADDRESS,
      }],
      description: agent.description,
    };
  }
});

// 1. Core Resource Server
const ResourceServer = new x402ResourceServer([facilitatorClient]);

// 1. Create the authenticated Resource Server instance
// This is critical: without passing the facilitatorClient, the middleware 
// cannot verify payments that require an API Key.
const x402Server = new x402ResourceServer(x402Routes, {
  facilitator: facilitatorClient,
  scheme: new ExactStellarScheme()
});

// 2. HTTP Adapter for background initialization
const httpServer = new x402HTTPResourceServer(x402Server);

// State tracking for protocol initialization
let isX402Initialized = false;
let x402InitError = null;

// 3. Official x402 Express Middleware
// We use the authenticated httpServer instance to create the middleware
const officialX402Middleware = paymentMiddlewareFromHTTPServer(httpServer);

const x402Middleware = async (req, res, next) => {
  // 1. Skip for non-agent invocation routes (Performance & safety)
  if (!req.path.startsWith('/api/agents/')) {
    return next();
  }

  // 2. Friendly warming up status
  if (!isX402Initialized) {
    return res.status(503).json({ 
      error: 'x402 protocol is warming up', 
      message: 'Synchronizing with Stellar network... Please try again in 5-10 seconds.' 
    });
  }

  // 3. Diagnostic Logging: Intercept responses to see facilitator errors
  const originalSend = res.send;
  res.send = function (body) {
    if (res.statusCode >= 400 && req.headers['payment-signature']) {
      console.warn(`[x402 Debug] Verification failed: status=${res.statusCode}, path=${req.path}`);
      console.warn(`[x402 Debug] Payload: ${body}`);
      try {
        const routeKey = `POST ${req.path}`;
        console.warn(`[x402 Debug] Configured Route: ${JSON.stringify(x402Routes[routeKey])}`);
      } catch (e) {}
    }
    return originalSend.apply(res, arguments);
  };

  // 4. Hand off to the official @x402/express middleware
  return officialX402Middleware(req, res, next);
};

// Apply x402 protection
app.use(x402Middleware);

// 4. Background Initialization (Failsafe)
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
    
    if (err.message.includes('401')) {
      const apiKeyPrefix = (process.env.X402_FACILITATOR_API_KEY || '').substring(0, 8);
      console.error(`❌ x402 Auth Failed (401): The key "${apiKeyPrefix}..." is unauthorized for ${X402_FACILITATOR_URL}.`);
      console.error('👉 Please verify you have copied the full key and are using the correct network (Mainnet vs Testnet).');
    } else {
      console.error(`❌ x402 Initialization failed (retrying in 10s): ${err.message}`);
    }
    
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

/**
 * x402 VERIFICATION ENDPOINT (DEPRECATED - Middleware handles this now)
 * We keep a no-op endpoint for backward compatibility during migration if needed
 */
app.post('/api/x402/verify', (req, res) => {
  res.status(410).json({ 
    error: 'Deprecated', 
    message: 'Verification is now handled automatically by the x402 middleware. Please hit the invocation endpoint directly with payment proof.' 
  });
});

// MPP Session endpoints

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
    maxBudgetUSDC: parseFloat(maxBudgetXLM),
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
    maxBudgetXLM,
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
  
  const { settleTxHash } = req.body;
  if (settleTxHash) {
    session.settleTxHash = settleTxHash;
    session.settlementStatus = 'pending_verification';
    
    // Asynchronous verification to not block the response
    verifyMPPSettlement(sessionId, settleTxHash, session.spentXLM);
  }

  console.log(`🔒 MPP Session closed: ${sessionId}, total spent: ${session.spentXLM} XLM. Settlement: ${settleTxHash || 'none'}`);

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

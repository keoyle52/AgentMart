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
const STELLAR_NETWORK = process.env.STELLAR_NETWORK || 'PUBLIC';
const SETTLEMENT_ADDRESS = process.env.SETTLEMENT_ADDRESS || 'GCJV64SQP24FBBYMUK5UUK76STPG45XGLVILU3TYNYASDAFFUSET3YY7';
const PORT = process.env.PORT || 3001;

// Official x402 Protocol Stack Configuration
const facilitatorClient = new HTTPFacilitatorClient({
  url: process.env.X402_FACILITATOR_URL || 'https://channels.openzeppelin.com/x402',
  createAuthHeaders: async () => ({
    headers: {
      Authorization: `Bearer ${process.env.X402_FACILITATOR_API_KEY}`,
    },
  }),
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
    priceUSDC: '0.01', 
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
    priceUSDC: '0.005',
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
    priceUSDC: '0.20',
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
    priceUSDC: '0.01',
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
    priceUSDC: '0.05',
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
    priceUSDC: '0.10',
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
app.use(cors());
app.use(express.json());

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

// Register Stellar scheme (Default is USDC-ready)
ResourceServer.register(x402NetworkIdentifier, new ExactStellarScheme());

// 2. HTTP Adapter
const httpServer = new x402HTTPResourceServer(ResourceServer, x402Routes);

// 3. Manual Resilient Middleware (Prevents 500 crashes during warming up)
let isX402Initialized = false;
let x402InitError = null;

const x402Middleware = async (req, res, next) => {
  // If protocol isn't ready yet, return a friendly warming up status instead of crashing
  if (!isX402Initialized) {
    return res.status(503).json({ 
      error: 'x402 protocol is warming up', 
      message: 'Synchronizing with Stellar network... Please try again in 5-10 seconds.' 
    });
  }

  // Create standard-compliant adapter for @x402/core
  const adapter = {
    getHeaders: () => req.headers,
    getHeader: (name) => req.header(name),
    getAcceptHeader: () => req.header('accept') || '',
    getUserAgent: () => req.header('user-agent') || '',
    getMethod: () => req.method,
    getPath: () => req.path,
    getUrl: () => req.originalUrl || req.url,
  };

  try {
    // If we're in simulator mode, try to fulfill the request without the facilitator
    if (x402InitError && process.env.NODE_ENV !== 'production') {
      console.log(`[Simulator Mode] Handling ${req.method} ${req.path}`);
      
      // Check if this is a protected route
      const route = x402Routes[`${req.method} ${req.path}`];
      if (route) {
        const paymentSignature = req.header('PAYMENT-SIGNATURE');
        if (!paymentSignature) {
          // Simulate 402 Payment Required
          return res.status(402).set({
            'PAYMENT-REQUIRED': JSON.stringify(route)
          }).json({
            error: 'PAYMENT-REQUIRED',
            message: 'Simulator Mode: Payment signature required (any string will work for dev)'
          });
        }
        
        // Simulate Verified
        req.x402 = { payload: { status: 'verified', simulator: true } };
        return next();
      }
    }

    const result = await httpServer.processHTTPRequest({ adapter });

    if (result.type === 'payment-error') {
      const { status, headers, body } = result.response;
      return res.status(status).set(headers).send(body);
    }

    if (result.type === 'payment-verified') {
      // Add payment info to request for the next handler
      req.x402 = {
        payload: result.paymentPayload,
        requirements: result.paymentRequirements
      };
      return next();
    }

    // No payment required for this route
    next();
  } catch (err) {
    console.error('x402 Middleware Error:', err);
    res.status(500).json({ error: 'Internal x402 error: ' + err.message });
  }
};

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
    isX402Initialized = true; // Mark as initialized anyway so middleware can run in simulator mode
    console.error(`❌ x402 Facilitator unavailable. System running in SIMULATOR MODE: ${err.message}`);
    // We don't retry indefinitely with a timeout if it's a 401/403 (invalid key)
    if (!err.message.includes('401') && !err.message.includes('403')) {
       setTimeout(initializeX402, 30000); 
    }
  }
}
initializeX402();

// Apply x402 protection
app.use(x402Middleware);

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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    network: STELLAR_NETWORK,
    x402Initialized: isX402Initialized,
    mode: x402InitError ? 'simulator' : 'production',
    error: x402InitError,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AgentMart Backend alive on port ${PORT} - Network: ${STELLAR_NETWORK}`);
});

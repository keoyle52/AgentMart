import { useState, useCallback, useEffect } from 'react';
import './App.css';
import WalletConnect from './components/WalletConnect';
import Marketplace from './components/Marketplace';
import AgentDashboard from './components/AgentDashboard';
import TxHistory from './components/TxHistory';
import MPPSession from './components/MPPSession';
import ResultViewer from './components/ResultViewer';
import { ShieldCheck, Activity, Cpu, Wifi } from 'lucide-react';
import { invokeAgentX402, fetchBalance } from './utils/stellar-mainnet';
import { openMPPChannel, sendMicropayment, closeChannel } from './utils/mpp-channel';
import { Keypair } from '@stellar/stellar-sdk';

// MPP agents registered in the marketplace (mirrors backend AGENTS)
const MPP_AGENTS = [
  { id: 'translator', name: 'Realtime Translator', priceUSDC: '0.01' },
  { id: 'image-generator', name: 'AI Image Generator', priceUSDC: '0.10' },
];

function App() {
  const [balances, setBalances] = useState({ xlm: 0, usdc: 0 });
  const [address, setAddress] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [secretKey, setSecretKey] = useState(null);
  const [logs, setLogs] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState([]); // captured service results from agents

  // full channel state objects keyed by agentId
  // each has: { sessionId, remainingBudget, keypair, micropaymentCount, ... }
  const [activeMPPSessions, setActiveMPPSessions] = useState({});
  // per-agent step logs for MPPSession panel visualisation
  const [mppSteps, setMppSteps] = useState({}); // agentId → [{label, status, data?}]
  const [systemState, setSystemState] = useState({ 
    status: 'connecting', 
    mode: 'production', 
    x402Initialized: false 
  });

  const addMppStep = useCallback((agentId, step) => {
    setMppSteps((prev) => ({
      ...prev,
      [agentId]: [...(prev[agentId] || []), step],
    }));
  }, []);

  // Logger
  const addLog = useCallback((message, type = 'default', extra = {}) => {
    setLogs((prev) => [...prev, { message, type, time: Date.now(), ...extra }]);
  }, []);

  // Health check on load
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const rawUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
        const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
        const res = await fetch(`${url}/api/health`);
        const data = await res.json();
        setSystemState({
           ...data,
           status: 'ok'
        });
        if (!data.x402Initialized) {
          addLog('x402 Facilitator is syncing or unreachable. Some services may return 503.', 'warning');
        } else {
          addLog('Full x402 Protocol connection established.', 'success');
        }
      } catch (err) {
        setSystemState({ status: 'error', mode: 'none', x402Initialized: false });
        addLog('Could not connect to backend. Please check if the server is running.', 'error');
      }
    };
    checkHealth();
  }, [addLog]);

  // Wallet handlers
  const handleWalletConnected = async (pubKey, bal, mode, secKey = null) => {
    if (!mode || mode !== 'secret') {
      setIsConnected(false);
      setAddress(null);
      setSecretKey(null);
      setBalances({ xlm: 0, usdc: 0 });
      setActiveMPPSessions({});
      addLog('Wallet disconnected or invalid mode.', 'warning');
      return;
    }

    try {
      const kp = Keypair.fromSecret(secKey);
      setSecretKey(secKey);
      setIsConnected(true);
      setAddress(kp.publicKey());
      const bals = await fetchBalance(kp.publicKey());
      setBalances(bals);
      addLog(`Autonomous Agent key linked. Address: ${kp.publicKey().substring(0, 8)}...`, 'info');
      addLog('Agent is running in autonomous mode — no human approval required per tx.', 'default');
    } catch {
      addLog('Invalid secret key or account not found on network.', 'error');
    }
  };

  // x402 calls
  const handlePurchase = async (agent) => {
    if (!isConnected) {
      addLog('Please connect a wallet or import an agent key first.', 'error');
      return;
    }
    if (isProcessing) return;

    // MPP agents need a session opened first
    if (agent.protocol === 'mpp') {
      await handleOpenMPPSession(agent);
      return;
    }

    setIsProcessing(true);
    addLog(`━━━ Invoking ${agent.name} via x402 ━━━`, 'default');

    try {
      await invokeAgentX402(
        agent.id,
        address,
        secretKey,
        (step) => {
          addLog(step.label, step.status, {
            explorerUrl: step.data?.explorerUrl,
          });

          // Capture service result for ResultViewer
          if (step.status === 'success' && step.data?.result) {
            setResults((prev) => [
              ...prev,
              {
                agentId: agent.id,
                agentName: agent.name,
                result: step.data.result,
                protocol: 'x402',
                explorerUrl: step.data.explorerUrl,
                time: Date.now(),
              },
            ]);
          }
        }
      );

      // Refresh balance after payment
      try {
        const updated = await fetchBalance(address);
        setBalances(updated);
      } catch {
        // block empty, ignoring this safely
      }
    } catch (err) {
      addLog(`Transaction failed: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // MPP integration
  const handleOpenMPPSession = async (agent) => {
    if (!isConnected) { addLog('Please connect a wallet first.', 'error'); return; }
    if (isProcessing) return;
    setIsProcessing(true);
    addLog(`━━━ Opening MPP channel for ${agent.name} ━━━`, 'default');

    try {
      const MAX_BUDGET = 0.5; // 0.5 USDC
      // reset steps for this agent
      setMppSteps((prev) => ({ ...prev, [agent.id]: [] }));
      const channelState = await openMPPChannel({
        agentId: agent.id,
        publicKey: address,
        secretKey, // signs off-chain micropayments autonomously
        maxBudgetUSDC: MAX_BUDGET,
        onStep: (step) => {
          addLog(step.label, step.status);
          addMppStep(agent.id, step);
        },
      });

      setActiveMPPSessions((prev) => ({ ...prev, [agent.id]: channelState }));
    } catch (err) {
      addLog(`Failed to open MPP channel: ${err.message}`, 'error');
      addMppStep(agent.id, { label: err.message, status: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMPPInvoke = async (agent, channelState) => {
    if (!isConnected || isProcessing) return;
    setIsProcessing(true);

    try {
      const updated = await sendMicropayment({
        channelState,
        onStep: (step) => {
          addLog(step.label, step.status);
          addMppStep(agent.id, step);
          if (step.data?.result) {
            setResults((prev) => [
              ...prev,
              {
                agentId: agent.id,
                agentName: agent.name,
                result: step.data.result,
                protocol: 'mpp',
                time: Date.now(),
              },
            ]);
          }
        },
      });
      setActiveMPPSessions((prev) => ({ ...prev, [agent.id]: updated }));
    } catch (err) {
      addLog(`MPP invoke failed: ${err.message}`, 'error');
      addMppStep(agent.id, { label: err.message, status: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Render tree
  return (
    <div className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
        <div>
          <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.2rem', letterSpacing: '-0.03em' }}>
            AgentMart
          </h1>
          <p className="text-muted" style={{ margin: 0, fontSize: '1rem' }}>
            Stellar x402 + Stripe MPP · Machine-to-Machine Payment Economy
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div className="glass-panel" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.6rem', borderRadius: '50px', fontSize: '0.85rem' }}>
            <ShieldCheck size={16} color="#10b981" />
            <span>Stellar Mainnet</span>
          </div>
          <div className="glass-panel" style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.6rem', borderRadius: '50px', fontSize: '0.85rem' }}>
            <Activity size={16} color="#60a5fa" />
            <span>Live</span>
          </div>
        </div>
      </header>

      <main style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '2.5rem', alignItems: 'start' }}>
        {/* Left column */}
        <div className="flex flex-col gap-8">
          <Marketplace
            onPurchase={handlePurchase}
            onMPPInvoke={handleMPPInvoke}
            disabled={isProcessing}
            activeMPPSessions={activeMPPSessions}
          />
          <AgentDashboard logs={logs} />
          <ResultViewer results={results} onClear={() => setResults([])} />
          <TxHistory logs={logs} />
        </div>

        {/* Right sidebar */}
        <div className="flex flex-col gap-5" style={{ position: 'sticky', top: '2rem' }}>
          <WalletConnect
            onWalletConnected={handleWalletConnected}
            address={address}
            balances={balances}
            isConnected={isConnected}
          />

          {/* System Status */}
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Cpu size={16} color="#8b5cf6" /> System Status
            </h4>
            <div className="flex flex-col gap-3" style={{ fontSize: '0.85rem' }}>
              {[
                { 
                   label: 'x402 Facilitator', 
                   value: systemState.mode === 'simulator' ? 'Simulator' : (systemState.x402Initialized ? 'Connected' : 'Syncing...'), 
                   color: systemState.mode === 'simulator' ? '#f59e0b' : (systemState.x402Initialized ? '#10b981' : '#94a3b8') 
                },
                { label: 'Stripe MPP', value: Object.keys(activeMPPSessions).length > 0 ? `${Object.keys(activeMPPSessions).length} session(s) active` : 'Standby', color: Object.keys(activeMPPSessions).length > 0 ? '#a78bfa' : '#94a3b8' },
                { label: 'Stellar Network', value: 'Mainnet', color: '#f8fafc' },
                { 
                   label: 'System Mode', 
                   value: systemState.x402Initialized ? 'Real-Verified' : (systemState.status === 'error' ? 'Disconnected' : 'Syncing...'), 
                   color: systemState.x402Initialized ? '#10b981' : (systemState.status === 'error' ? '#ef4444' : '#f59e0b') 
                },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex justify-between items-center">
                  <span className="text-muted">{label}</span>
                  <span style={{ color, fontWeight: 500 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* MPP Session Panels — one per MPP agent */}
          <div className="flex flex-col gap-4">
            {MPP_AGENTS.map((mppAgent) => (
              <MPPSession
                key={mppAgent.id}
                agent={mppAgent}
                session={activeMPPSessions[mppAgent.id] ?? null}
                isProcessing={isProcessing}
                steps={mppSteps[mppAgent.id] ?? []}
                onOpen={() => handleOpenMPPSession(mppAgent)}
                onInvoke={() => handleMPPInvoke(mppAgent, activeMPPSessions[mppAgent.id])}
                onClose={async () => {
                  setIsProcessing(true);
                  try {
                    await closeChannel({
                      channelState: activeMPPSessions[mppAgent.id],
                      onStep: (step) => {
                        addLog(step.label, step.status);
                        addMppStep(mppAgent.id, step);
                      },
                    });
                    setActiveMPPSessions((prev) => { const n = { ...prev }; delete n[mppAgent.id]; return n; });
                  } catch (e) {
                    addLog('Failed to close session: ' + e.message, 'error');
                    addMppStep(mppAgent.id, { label: e.message, status: 'error' });
                  } finally {
                    setIsProcessing(false);
                  }
                }}
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;

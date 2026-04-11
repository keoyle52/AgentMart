import React, { useState } from 'react';
import {
  Globe, Shield, Bot, Zap, Database, Image,
  ChevronRight, Loader2, CheckCircle2, XCircle,
} from 'lucide-react';

const AGENTS = [
  {
    id: 'web-scraper',
    name: 'Web Scraper Agent',
    icon: Globe,
    iconColor: '#60a5fa',
    desc: 'Extracts structured data from any public URL on demand.',
    priceUSDC: '0.01',
    protocol: 'x402',
    category: 'Data',
  },
  {
    id: 'price-oracle',
    name: 'Price Oracle Agent',
    icon: Database,
    iconColor: '#34d399',
    desc: 'Aggregated real-time asset prices from multiple CEX sources.',
    priceUSDC: '0.005',
    protocol: 'x402',
    category: 'Finance',
  },
  {
    id: 'security-auditor',
    name: 'Security Auditor',
    icon: Shield,
    iconColor: '#f87171',
    desc: 'Scans Soroban smart contracts for vulnerabilities & risks.',
    priceUSDC: '0.20',
    protocol: 'x402',
    category: 'Security',
  },
  {
    id: 'translator',
    name: 'Realtime Translator',
    icon: Bot,
    iconColor: '#f59e0b',
    desc: 'Context-aware A2A language translation at machine speed.',
    priceUSDC: '0.01',
    protocol: 'mpp',
    category: 'Language',
  },
  {
    id: 'code-executor',
    name: 'Code Executor',
    icon: Zap,
    iconColor: '#a78bfa',
    desc: 'Sandboxed execution of code snippets with stdout/stderr.',
    priceUSDC: '0.05',
    protocol: 'x402',
    category: 'Compute',
  },
  {
    id: 'image-generator',
    name: 'AI Image Generator',
    icon: Image,
    iconColor: '#f472b6',
    desc: 'Generates images from text prompts via A2A inference.',
    priceUSDC: '0.10',
    protocol: 'mpp',
    category: 'Creative',
  },
];

const PROTOCOL_STYLES = {
  x402: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', label: 'x402' },
  mpp: { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', label: 'MPP' },
};

export default function Marketplace({ onPurchase, onMPPInvoke, disabled, activeMPPSessions }) {
  const [hoveredId, setHoveredId] = useState(null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h3 style={{ margin: 0, fontFamily: 'Outfit', fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Zap size={22} color="#f59e0b" />
          Agent Marketplace
        </h3>
        <span className="text-muted" style={{ fontSize: '0.8rem' }}>
          {AGENTS.length} agents available
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {AGENTS.map((agent) => {
          const Icon = agent.icon;
          const proto = PROTOCOL_STYLES[agent.protocol];
          const isHovered = hoveredId === agent.id;
          const activeSession = activeMPPSessions?.[agent.id];

          return (
            <div
              key={agent.id}
              className="glass-panel"
              onMouseEnter={() => setHoveredId(agent.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                transition: 'all 0.2s ease',
                border: isHovered
                  ? `1px solid ${proto.color}40`
                  : '1px solid rgba(255,255,255,0.07)',
                transform: isHovered ? 'translateY(-2px)' : 'none',
              }}
            >
              {/* Header */}
              <div className="flex items-center gap-3">
                <div style={{
                  padding: '0.75rem',
                  background: `${agent.iconColor}15`,
                  borderRadius: '10px',
                  border: `1px solid ${agent.iconColor}25`,
                }}>
                  <Icon size={20} color={agent.iconColor} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.1rem' }}>
                    {agent.name}
                  </div>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '8px',
                    background: proto.bg,
                    color: proto.color,
                    fontWeight: 600,
                    letterSpacing: '0.03em',
                  }}>
                    {proto.label}
                  </span>
                </div>
              </div>

              <p className="text-muted" style={{ margin: 0, fontSize: '0.875rem', lineHeight: '1.5' }}>
                {agent.desc}
              </p>

              {/* Price + Action */}
              <div className="flex justify-between items-center" style={{ marginTop: 'auto' }}>
                <div>
                  <span style={{ fontWeight: 700, color: '#10b981', fontSize: '1.05rem' }}>
                    {agent.priceUSDC} USDC
                  </span>
                  <span className="text-muted" style={{ fontSize: '0.75rem', marginLeft: '0.3rem' }}>
                    / request
                  </span>
                </div>

                {agent.protocol === 'x402' ? (
                  <button
                    className="btn btn-primary"
                    onClick={() => onPurchase(agent)}
                    disabled={disabled}
                    style={{ fontSize: '0.85rem', padding: '0.45rem 1rem', gap: '0.3rem' }}
                  >
                    {disabled ? <Loader2 size={14} className="spin" /> : <ChevronRight size={14} />}
                    {disabled ? 'Processing...' : 'Invoke x402'}
                  </button>
                ) : (
                  <div className="flex gap-2 items-center">
                    {activeSession ? (
                      <button
                        className="btn btn-primary"
                        onClick={() => onMPPInvoke(agent, activeSession)}
                        disabled={disabled}
                        style={{ fontSize: '0.85rem', padding: '0.45rem 1rem', background: 'rgba(167,139,250,0.2)', borderColor: '#a78bfa' }}
                      >
                        ⚡ Call MPP
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary"
                        onClick={() => onPurchase(agent)}
                        disabled={disabled}
                        style={{ fontSize: '0.85rem', padding: '0.45rem 1rem', background: 'rgba(167,139,250,0.2)', borderColor: '#a78bfa' }}
                      >
                        Open Session
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Active session indicator */}
              {activeSession && (
                <div style={{
                  fontSize: '0.75rem',
                  color: '#a78bfa',
                  background: 'rgba(167,139,250,0.08)',
                  borderRadius: '6px',
                  padding: '0.3rem 0.6rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}>
                  <CheckCircle2 size={12} />
                  MPP Channel Active · {parseFloat(activeSession.remainingBudget || 0).toFixed(4)} USDC remaining
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

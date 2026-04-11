import React, { useRef, useEffect } from 'react';
import { Terminal, ExternalLink, CheckCircle2, AlertCircle, Info, Clock } from 'lucide-react';

const STEP_ICONS = {
  success: <CheckCircle2 size={14} color="#10b981" />,
  error: <AlertCircle size={14} color="#ef4444" />,
  warning: <AlertCircle size={14} color="#f59e0b" />,
  info: <Info size={14} color="#60a5fa" />,
  pending: <Clock size={14} color="#94a3b8" className="spin" />,
  default: <Terminal size={14} color="#94a3b8" />,
};

const STEP_COLORS = {
  success: '#10b981',
  error: '#ef4444',
  warning: '#f59e0b',
  info: '#60a5fa',
  pending: '#94a3b8',
  default: '#cbd5e1',
};

export default function AgentDashboard({ logs }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="flex items-center justify-between">
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem' }}>
          <Terminal size={18} color="#60a5fa" />
          Live Protocol Log
        </h3>
        <span className="text-muted" style={{ fontSize: '0.75rem' }}>
          {logs.length} events
        </span>
      </div>

      <div
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: '0.82rem',
          lineHeight: '1.7',
          minHeight: '240px',
          maxHeight: '360px',
          overflowY: 'auto',
          background: 'rgba(0,0,0,0.35)',
          borderRadius: '10px',
          padding: '1rem',
          border: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.2rem',
        }}
      >
        {logs.length === 0 ? (
          <span className="text-muted" style={{ fontSize: '0.8rem', userSelect: 'none' }}>
            No activity yet. Connect a wallet and invoke an agent to begin.
          </span>
        ) : (
          logs.map((log, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
                padding: '0.25rem 0',
                borderBottom: i < logs.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                animation: 'fadeInUp 0.2s ease',
              }}
            >
              {/* Timestamp */}
              <span style={{ color: '#475569', flexShrink: 0, fontSize: '0.72rem', marginTop: '2px' }}>
                {new Date(log.time).toLocaleTimeString('en-US', { hour12: false })}
              </span>

              {/* Icon */}
              <span style={{ flexShrink: 0, marginTop: '2px' }}>
                {STEP_ICONS[log.type] || STEP_ICONS.default}
              </span>

              {/* Message */}
              <span style={{ color: STEP_COLORS[log.type] || STEP_COLORS.default, wordBreak: 'break-all' }}>
                {log.message}
              </span>

              {/* Explorer link */}
              {log.explorerUrl && (
                <a
                  href={log.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#60a5fa', flexShrink: 0, marginTop: '2px' }}
                  title="View on Stellar Expert"
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* x402 Protocol Steps Explainer */}
      <div style={{ padding: '0.75rem 1rem', background: 'rgba(96,165,250,0.06)', borderRadius: '8px', border: '1px solid rgba(96,165,250,0.15)' }}>
        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.75rem', color: '#60a5fa', fontWeight: 600, letterSpacing: '0.05em' }}>
          x402 PROTOCOL FLOW
        </p>
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.72rem', color: '#94a3b8' }}>
          {['Invoke Agent', '← 402 Payment Required', '→ Pay USDC On-chain', '→ Submit Proof', '← Service Delivered'].map((step, i) => (
            <React.Fragment key={i}>
              <span style={{ padding: '0.15rem 0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '4px' }}>{step}</span>
              {i < 4 && <span style={{ color: '#334155' }}>▶</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

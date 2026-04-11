import React, { useState } from 'react';
import { ExternalLink, ChevronDown, ChevronUp, Clock } from 'lucide-react';

// Shows the protocol log as a proper transaction history table.
// Filters out plain "info" entries and only keeps real payment events.
export default function TxHistory({ logs }) {
  const [expanded, setExpanded] = useState(null);

  // pull out entries that have a real tx hash or represent a completed payment
  const txs = logs.filter(l => l.explorerUrl || (l.type === 'success' && (l.message?.includes('XLM') || l.message?.includes('USDC'))));

  if (txs.length === 0) {
    return null; // nothing to show yet, don't clutter the UI
  }

  return (
    <div className="glass-panel" style={{ padding: '1.5rem' }}>
      <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Clock size={18} color="#f59e0b" />
        Transaction History
        <span style={{
          marginLeft: 'auto',
          fontSize: '0.75rem',
          padding: '0.2rem 0.6rem',
          background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: '10px',
          color: '#f59e0b',
          fontWeight: 600,
        }}>
          {txs.length} tx{txs.length !== 1 ? 's' : ''}
        </span>
      </h3>

      <div className="flex flex-col gap-2">
        {txs.map((tx, i) => {
          const isOpen = expanded === i;
          // try to extract a short agent name from message
          const agentMatch = tx.message?.match(/delivered by (.+)/);
          const agentName = agentMatch ? agentMatch[1] : 'Agent';

          // figure out which protocol badge to show
          const isMPP = tx.message?.toLowerCase().includes('mpp') || tx.message?.toLowerCase().includes('micropayment');
          const proto = isMPP ? 'MPP' : 'x402';
          const protoColor = isMPP ? '#a78bfa' : '#60a5fa';

          return (
            <div
              key={i}
              style={{
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '10px',
                overflow: 'hidden',
                background: 'rgba(255,255,255,0.02)',
                transition: 'border-color 0.15s',
              }}
            >
              {/* Row header */}
              <button
                onClick={() => setExpanded(isOpen ? null : i)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{
                  fontSize: '0.7rem',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '6px',
                  background: `${protoColor}15`,
                  border: `1px solid ${protoColor}40`,
                  color: protoColor,
                  fontWeight: 600,
                  flexShrink: 0,
                }}>
                  {proto}
                </span>

                <span style={{ flexGrow: 1, fontSize: '0.875rem', color: '#e2e8f0' }}>
                  {agentName}
                </span>

                <span style={{ fontSize: '0.75rem', color: '#475569', flexShrink: 0 }}>
                  {new Date(tx.time).toLocaleTimeString()}
                </span>

                {isOpen ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
              </button>

              {/* Expanded detail */}
              {isOpen && (
                <div style={{
                  padding: '0.75rem 1rem 1rem',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                  fontSize: '0.8rem',
                  color: '#94a3b8',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                }}>
                  <div style={{ wordBreak: 'break-all' }}>{tx.message}</div>
                  {tx.explorerUrl && (
                    <a
                      href={tx.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        color: '#60a5fa',
                        marginTop: '0.25rem',
                        fontSize: '0.78rem',
                      }}
                    >
                      <ExternalLink size={12} />
                      View on Stellar Expert
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

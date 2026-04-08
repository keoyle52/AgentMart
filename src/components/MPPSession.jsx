/**
 * MPPSession.jsx
 *
 * Visualizes the Stripe MPP (Machine Payment Protocol) payment channel lifecycle:
 *   1. Open Channel  — lock max budget (on-chain signal)
 *   2. Micropayments — signed off-chain, zero fees, instant
 *   3. Close Channel — settle final state on Soroban
 *
 * This component is displayed when an MPP agent card is expanded in the sidebar.
 */

import React, { useState } from 'react';
import {
  Zap, Lock, Unlock, CheckCircle2, XCircle, Loader2,
  ArrowRight, ChevronDown, ChevronUp, Activity,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single step row in the channel timeline.
 * status: 'pending' | 'success' | 'error' | 'idle'
 */
function StepRow({ step, index }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: <Loader2 size={14} className="spin" style={{ color: '#60a5fa' }} />,
    success: <CheckCircle2 size={14} style={{ color: '#10b981' }} />,
    error: <XCircle size={14} style={{ color: '#ef4444' }} />,
    idle: <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }} />,
  }[step.status] ?? null;

  const lineColor = {
    pending: '#60a5fa',
    success: '#10b981',
    error: '#ef4444',
    idle: 'rgba(255,255,255,0.12)',
  }[step.status];

  const hasData = step.data && Object.keys(step.data).length > 0;

  return (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', position: 'relative' }}>
      {/* Timeline connector */}
      {index > 0 && (
        <div style={{
          position: 'absolute',
          left: 7,
          top: -12,
          width: 2,
          height: 12,
          background: lineColor,
          opacity: 0.4,
        }} />
      )}

      {/* Icon */}
      <div style={{ flexShrink: 0, marginTop: '0.1rem' }}>
        {statusIcon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.8rem',
            color: step.status === 'idle' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.85)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
            cursor: hasData ? 'pointer' : 'default',
            userSelect: 'none',
          }}
          onClick={() => hasData && setExpanded((e) => !e)}
        >
          <span style={{ flex: 1 }}>{step.label}</span>
          {hasData && (expanded
            ? <ChevronUp size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
            : <ChevronDown size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
          )}
        </div>

        {/* Expandable data preview */}
        {hasData && expanded && (
          <pre style={{
            marginTop: '0.4rem',
            padding: '0.5rem',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '6px',
            fontSize: '0.7rem',
            color: '#a78bfa',
            overflowX: 'auto',
            maxHeight: '120px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {JSON.stringify(step.data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

/**
 * Budget progress bar — shows remaining XLM in the channel.
 */
function BudgetBar({ spent, max }) {
  const pct = max > 0 ? Math.min((spent / max) * 100, 100) : 0;
  const remaining = Math.max(max - spent, 0);

  const barColor = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10b981';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.4rem' }}>
        <span style={{ color: 'rgba(255,255,255,0.5)' }}>Channel Budget</span>
        <span style={{ color: barColor, fontWeight: 600 }}>
          {remaining.toFixed(5)} XLM left
        </span>
      </div>
      <div style={{
        height: 6,
        borderRadius: 3,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: barColor,
          borderRadius: 3,
          transition: 'width 0.4s ease, background 0.4s ease',
          boxShadow: `0 0 8px ${barColor}80`,
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginTop: '0.3rem', color: 'rgba(255,255,255,0.3)' }}>
        <span>0 XLM</span>
        <span>{max} XLM max</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Props:
 *   agent        — The agent object { id, name, priceXLM, ... }
 *   session      — Current channel state from App.jsx (null if no session)
 *   isProcessing — Global processing lock
 *   onOpen       — () => void — triggers handleOpenMPPSession
 *   onInvoke     — () => void — triggers handleMPPInvoke
 *   onClose      — () => void — triggers close + settle
 *   steps        — Array of { label, status, data? } for visualisation
 */
export default function MPPSession({ agent, session, isProcessing, onOpen, onInvoke, onClose, steps = [] }) {
  const hasSession = !!session;
  const callCount = session?.micropaymentCount ?? 0;
  const maxBudget = session?.maxBudgetXLM ?? 0.1;
  const spent = maxBudget - (session?.remainingBudget ?? maxBudget);
  const budgetExhausted = session && session.remainingBudget <= parseFloat(agent.priceXLM);

  return (
    <div style={{
      background: 'rgba(167,139,250,0.04)',
      border: '1px solid rgba(167,139,250,0.18)',
      borderRadius: '12px',
      padding: '1.25rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <div style={{
          padding: '0.5rem',
          background: 'rgba(167,139,250,0.12)',
          borderRadius: '8px',
          border: '1px solid rgba(167,139,250,0.2)',
        }}>
          <Activity size={16} color="#a78bfa" />
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#a78bfa' }}>
            MPP Payment Channel
          </div>
          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>
            {agent.name} · {agent.priceXLM} XLM per call
          </div>
        </div>
        {/* Status badge */}
        <div style={{ marginLeft: 'auto' }}>
          {hasSession ? (
            <span style={{
              fontSize: '0.7rem',
              padding: '0.2rem 0.6rem',
              borderRadius: '20px',
              background: 'rgba(16,185,129,0.12)',
              color: '#10b981',
              border: '1px solid rgba(16,185,129,0.3)',
              fontWeight: 600,
            }}>
              ● OPEN
            </span>
          ) : (
            <span style={{
              fontSize: '0.7rem',
              padding: '0.2rem 0.6rem',
              borderRadius: '20px',
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.35)',
              border: '1px solid rgba(255,255,255,0.1)',
              fontWeight: 600,
            }}>
              ○ CLOSED
            </span>
          )}
        </div>
      </div>

      {/* Budget bar — only if session is open */}
      {hasSession && (
        <BudgetBar spent={spent} max={maxBudget} />
      )}

      {/* Step timeline */}
      {steps.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem',
          padding: '0.75rem',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: '8px',
          maxHeight: '200px',
          overflowY: 'auto',
        }}>
          {steps.map((step, i) => (
            <StepRow key={i} step={step} index={i} />
          ))}
        </div>
      )}

      {/* Session meta — if open */}
      {hasSession && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem',
          fontSize: '0.78rem',
        }}>
          {[
            { label: 'Session ID', value: session.sessionId?.slice(0, 10) + '...' },
            { label: 'Micropayments', value: callCount },
            { label: 'Spent', value: `${spent.toFixed(5)} XLM` },
            { label: 'Tx Fees Paid', value: '0 (off-chain)' },
          ].map(({ label, value }) => (
            <div key={label} style={{
              padding: '0.5rem',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.68rem', marginBottom: '0.2rem' }}>{label}</div>
              <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* How MPP works — shown before session is open */}
      {!hasSession && steps.length === 0 && (
        <div style={{
          fontSize: '0.78rem',
          color: 'rgba(255,255,255,0.45)',
          lineHeight: '1.6',
          padding: '0.5rem',
          borderLeft: '2px solid rgba(167,139,250,0.3)',
          paddingLeft: '0.75rem',
        }}>
          <strong style={{ color: '#a78bfa', display: 'block', marginBottom: '0.3rem' }}>How MPP works</strong>
          <p style={{ margin: '0 0 0.3rem 0' }}>1. <strong>Open</strong> — lock a max budget in a payment channel</p>
          <p style={{ margin: '0 0 0.3rem 0' }}>2. <strong>Invoke</strong> — sign micropayments off-chain (zero fees)</p>
          <p style={{ margin: 0 }}>3. <strong>Settle</strong> — submit final state on Soroban once done</p>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.6rem' }}>
        {!hasSession ? (
          <button
            className="btn btn-primary"
            onClick={onOpen}
            disabled={isProcessing}
            style={{
              flex: 1,
              background: 'rgba(167,139,250,0.15)',
              borderColor: 'rgba(167,139,250,0.4)',
              color: '#a78bfa',
              justifyContent: 'center',
              gap: '0.4rem',
            }}
          >
            {isProcessing ? <Loader2 size={14} className="spin" /> : <Unlock size={14} />}
            Open MPP Channel
          </button>
        ) : (
          <>
            <button
              className="btn btn-primary"
              onClick={onInvoke}
              disabled={isProcessing || budgetExhausted}
              style={{
                flex: 1,
                background: 'rgba(167,139,250,0.15)',
                borderColor: 'rgba(167,139,250,0.4)',
                color: '#a78bfa',
                justifyContent: 'center',
                gap: '0.4rem',
              }}
            >
              {isProcessing ? <Loader2 size={14} className="spin" /> : <Zap size={14} />}
              {budgetExhausted ? 'Budget Exhausted' : 'Send Micropayment'}
            </button>
            <button
              className="btn"
              onClick={onClose}
              disabled={isProcessing}
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                color: '#ef4444',
                gap: '0.4rem',
                padding: '0.5rem 0.9rem',
              }}
            >
              <Lock size={14} />
              Settle
            </button>
          </>
        )}
      </div>
    </div>
  );
}

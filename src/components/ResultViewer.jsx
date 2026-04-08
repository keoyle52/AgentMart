/**
 * ResultViewer.jsx
 * Renders the rich service result returned by each agent after payment.
 * Each agent type has a custom renderer to make the demo look polished and real.
 */

import React, { useState } from 'react';
import {
  Globe, Database, Shield, Bot, Zap, Image as ImageIcon,
  X, ExternalLink, TrendingUp, AlertTriangle, CheckCircle,
  Clock, Code, Languages, Cpu,
} from 'lucide-react';

function Chip({ color, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
      fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '10px',
      background: `${color}15`, border: `1px solid ${color}30`, color, fontWeight: 500,
    }}>
      {children}
    </span>
  );
}

function WebScraperResult({ result }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Globe size={16} color="#60a5fa" />
        <span style={{ fontWeight: 600, color: '#60a5fa', fontSize: '0.9rem' }}>{result.title}</span>
      </div>
      <div style={{ fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.6 }}>{result.summary}</div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Chip color="#60a5fa">{result.wordCount?.toLocaleString()} words</Chip>
        <Chip color="#10b981">Structured JSON</Chip>
        <Chip color="#f59e0b">x402 Verified</Chip>
      </div>
      <div style={{ fontSize: '0.72rem', color: '#475569' }}>Extracted: {new Date(result.extractedAt).toLocaleTimeString()}</div>
    </div>
  );
}

function PriceOracleResult({ result }) {
  const prices = [
    { label: 'XLM/USD', value: `$${result.XLM_USD}`, color: '#10b981' },
    { label: 'XLM/EUR', value: `€${result.XLM_EUR}`, color: '#10b981' },
    { label: 'BTC/USD', value: `$${parseFloat(result.BTC_USD).toLocaleString()}`, color: '#f59e0b' },
    { label: 'ETH/USD', value: `$${parseFloat(result.ETH_USD).toLocaleString()}`, color: '#a78bfa' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        {prices.map(({ label, value, color }) => (
          <div key={label} style={{ padding: '0.6rem 0.75rem', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: `1px solid ${color}20` }}>
            <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.2rem' }}>{label}</div>
            <div style={{ fontWeight: 700, color, fontSize: '0.95rem', fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {value} <TrendingUp size={10} style={{ opacity: 0.7 }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '0.72rem', color: '#475569' }}>Source: {result.source}</div>
    </div>
  );
}

function SecurityAuditorResult({ result }) {
  const severityColor = { HIGH: '#ef4444', MEDIUM: '#f59e0b', LOW: '#60a5fa', INFO: '#94a3b8' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: `conic-gradient(#10b981 ${result.score * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#10b981', fontSize: '0.9rem' }}>
            {result.score}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 600, color: '#10b981', fontSize: '0.9rem' }}>Security Score: {result.score}/100</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Contract: {result.contractId}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {result.findings?.map((f, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', borderLeft: `3px solid ${severityColor[f.severity] || '#94a3b8'}` }}>
            <AlertTriangle size={12} color={severityColor[f.severity]} style={{ marginTop: 2, flexShrink: 0 }} />
            <div>
              <span style={{ fontSize: '0.7rem', color: severityColor[f.severity], fontWeight: 600 }}>{f.severity}</span>
              <span style={{ fontSize: '0.78rem', color: '#cbd5e1', marginLeft: '0.5rem' }}>{f.issue}</span>
              <span style={{ fontSize: '0.7rem', color: '#475569', marginLeft: '0.4rem' }}>line {f.line}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TranslatorResult({ result }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.25)', borderRadius: '8px', border: '1px solid rgba(96,165,250,0.15)' }}>
        <div style={{ fontSize: '0.7rem', color: '#60a5fa', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Original (EN)</div>
        <div style={{ fontSize: '0.85rem', color: '#e2e8f0', lineHeight: 1.5 }}>{result.originalText}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}><Languages size={14} color="#a78bfa" /></div>
      <div style={{ padding: '0.75rem', background: 'rgba(167,139,250,0.06)', borderRadius: '8px', border: '1px solid rgba(167,139,250,0.2)' }}>
        <div style={{ fontSize: '0.7rem', color: '#a78bfa', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Translated ({result.targetLanguage?.toUpperCase()})</div>
        <div style={{ fontSize: '0.85rem', color: '#ddd6fe', lineHeight: 1.5, fontStyle: 'italic' }}>{result.translatedText}</div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Chip color="#10b981">{((result.confidence || 0) * 100).toFixed(0)}% confidence</Chip>
        <Chip color="#a78bfa">{result.model}</Chip>
        <Chip color="#f59e0b">Off-chain MPP</Chip>
      </div>
    </div>
  );
}

function CodeExecutorResult({ result }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', fontFamily: 'JetBrains Mono, monospace' }}>
        <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.4rem' }}># {result.language} · {result.input}</div>
        <div style={{ fontSize: '0.95rem', color: '#4ade80', fontWeight: 600 }}>{result.stdout}</div>
        {result.stderr && <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '0.3rem' }}>{result.stderr}</div>}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Chip color="#a78bfa"><Clock size={10} /> {result.executionTimeMs}ms</Chip>
        <Chip color="#60a5fa"><Cpu size={10} /> {result.memoryUsedKB}KB RAM</Chip>
        <Chip color="#10b981">Sandboxed</Chip>
      </div>
    </div>
  );
}

function ImageGeneratorResult({ result }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(244,114,182,0.2)' }}>
        <img src={result.imageUrl} alt={result.prompt} style={{ width: '100%', display: 'block', maxHeight: 200, objectFit: 'cover' }} loading="lazy" />
      </div>
      <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontStyle: 'italic', lineHeight: 1.4 }}>"{result.prompt}"</div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Chip color="#f472b6">{result.model}</Chip>
        <Chip color="#a78bfa">MPP Generated</Chip>
      </div>
    </div>
  );
}

const RENDERERS = {
  'web-scraper': WebScraperResult,
  'price-oracle': PriceOracleResult,
  'security-auditor': SecurityAuditorResult,
  'translator': TranslatorResult,
  'code-executor': CodeExecutorResult,
  'image-generator': ImageGeneratorResult,
};

const AGENT_ICONS = {
  'web-scraper': Globe, 'price-oracle': Database, 'security-auditor': Shield,
  'translator': Bot, 'code-executor': Zap, 'image-generator': ImageIcon,
};

const AGENT_COLORS = {
  'web-scraper': '#60a5fa', 'price-oracle': '#34d399', 'security-auditor': '#f87171',
  'translator': '#f59e0b', 'code-executor': '#a78bfa', 'image-generator': '#f472b6',
};

export default function ResultViewer({ results = [], onClear }) {
  const [activeIndex, setActiveIndex] = useState(null);

  if (results.length === 0) return null;

  const activeIdx = activeIndex !== null ? activeIndex : results.length - 1;
  const active = results[activeIdx];
  const Renderer = RENDERERS[active.agentId];
  const Icon = AGENT_ICONS[active.agentId] || Code;
  const color = AGENT_COLORS[active.agentId] || '#60a5fa';

  return (
    <div className="glass-panel" style={{
      padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem',
      border: `1px solid ${color}25`, animation: 'fadeInUp 0.3s ease',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ padding: '0.6rem', background: `${color}15`, borderRadius: '10px', border: `1px solid ${color}25`, flexShrink: 0 }}>
          <Icon size={18} color={color} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '1rem', color: '#f1f5f9' }}>{active.agentName}</div>
          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
            {active.protocol === 'mpp' ? '⚡ MPP Off-chain · ' : '🔗 x402 On-chain · '}
            {new Date(active.time).toLocaleTimeString()}
          </div>
        </div>
        <span style={{
          fontSize: '0.68rem', padding: '0.2rem 0.5rem', borderRadius: '8px',
          background: active.protocol === 'mpp' ? 'rgba(167,139,250,0.12)' : 'rgba(96,165,250,0.12)',
          color: active.protocol === 'mpp' ? '#a78bfa' : '#60a5fa',
          border: `1px solid ${active.protocol === 'mpp' ? '#a78bfa30' : '#60a5fa30'}`,
          fontWeight: 600,
        }}>
          {active.protocol === 'mpp' ? 'MPP' : 'x402'}
        </span>
        <CheckCircle size={16} color="#10b981" />
        <button onClick={onClear} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: '0.2rem', display: 'flex', alignItems: 'center' }}>
          <X size={16} />
        </button>
      </div>

      {/* Result tabs */}
      {results.length > 1 && (
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', padding: '0.3rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
          {results.map((r, i) => {
            const RIcon = AGENT_ICONS[r.agentId] || Code;
            const rColor = AGENT_COLORS[r.agentId] || '#60a5fa';
            return (
              <button key={i} onClick={() => setActiveIndex(i)} style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.3rem 0.6rem', borderRadius: '6px', border: 'none', cursor: 'pointer',
                fontSize: '0.72rem', fontWeight: i === activeIdx ? 600 : 400,
                background: i === activeIdx ? `${rColor}20` : 'transparent',
                color: i === activeIdx ? rColor : '#64748b', transition: 'all 0.15s',
              }}>
                <RIcon size={11} />{r.agentName.split(' ')[0]}
              </button>
            );
          })}
        </div>
      )}

      {/* Result content */}
      <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
        {Renderer && active.result ? (
          <Renderer result={active.result} />
        ) : (
          <pre style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(active.result, null, 2)}
          </pre>
        )}
      </div>

      {active.explorerUrl && (
        <a href={active.explorerUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#60a5fa', textDecoration: 'none' }}>
          <ExternalLink size={12} /> View on Stellar Expert
        </a>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { Wallet, Key, RefreshCw, Unplug } from 'lucide-react';
import { connectFreighter } from '../utils/stellar-mainnet';

export default function WalletConnect({ onWalletConnected, address, balance, isConnected, authMode, setAuthMode }) {
  const [secretKeyInput, setSecretKeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFreighterConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await connectFreighter();
      onWalletConnected(data.publicKey, data.balance, 'freighter');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleSecretKeySubmit = () => {
    if (!secretKeyInput.startsWith('S') || secretKeyInput.length !== 56) {
      setError('Invalid Stellar Secret Key — must start with S and be 56 characters.');
      return;
    }
    onWalletConnected(null, 0, 'secret', secretKeyInput); // App.js will fetch balance
  };

  const disconnect = () => {
     onWalletConnected(null, 0, null);
  };

  return (
    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="flex justify-between items-center">
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Wallet size={20} color="#8b5cf6" />
          Agent Wallet
        </h3>
        <span className="text-muted" style={{ fontSize: '0.85rem' }}>
          {isConnected ? <span style={{color:'#10b981'}}>Connected</span> : 'Disconnected'}
        </span>
      </div>

      {!isConnected ? (
         <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
            <div className="flex gap-2" style={{ background: 'rgba(255,255,255,0.05)', padding: '0.2rem', borderRadius: '8px' }}>
               <button 
                 className={`btn ${authMode === 'freighter' ? 'btn-primary' : ''}`} 
                 onClick={() => setAuthMode('freighter')}
                 style={{ flex: 1, padding: '0.4rem', fontSize: '0.8rem', background: authMode === 'freighter' ? '' : 'transparent' }}>
                 Freighter
               </button>
               <button 
                 className={`btn ${authMode === 'secret' ? 'btn-primary' : ''}`} 
                 onClick={() => setAuthMode('secret')}
                 style={{ flex: 1, padding: '0.4rem', fontSize: '0.8rem', background: authMode === 'secret' ? '' : 'transparent' }}>
                 Autonomous
               </button>
            </div>
            
            {authMode === 'freighter' ? (
                <div className="flex flex-col gap-2">
                   <p style={{fontSize: '0.85rem', color: '#94a3b8', margin: 0}}>Signs transactions manually via browser extension (Freighter).</p>
                   <button className="btn btn-primary w-full justify-center" onClick={handleFreighterConnect} disabled={loading}>
                      {loading ? <RefreshCw size={16} className="spin" /> : 'Connect Freighter'}
                   </button>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                   <p style={{fontSize: '0.85rem', color: '#94a3b8', margin: 0}}>Import an agent secret key to sign transactions autonomously in the background (A2A mode).</p>
                   <input 
                      type="password" 
                      placeholder="S..." 
                      className="glass-panel"
                      value={secretKeyInput}
                      onChange={(e) => { setSecretKeyInput(e.target.value); setError(null); }}
                      style={{ padding: '0.5rem', width: '100%', color: 'white', outline: 'none' }} 
                   />
                   <button className="btn btn-primary w-full justify-center" onClick={handleSecretKeySubmit}>
                      Import Key
                   </button>
                </div>
            )}
            {error && <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>{error}</span>}
         </div>
      ) : (
         <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem', background: 'rgba(0,0,0,0.3)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex justify-between items-start">
               <div style={{ display: 'flex', flexDirection: 'column' }}>
                 <span className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Network Balance</span>
                 <span style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'Outfit', display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                   {balance.toFixed(4)} <span style={{ fontSize: '1rem', color: '#10b981' }}>XLM</span>
                 </span>
               </div>
               <button className="btn" onClick={disconnect} style={{ padding: '0.4rem', border: 'none', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                   <Unplug size={16} />
               </button>
            </div>
            
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', background: 'rgba(255,255,255,0.04)', padding: '0.4rem 0.8rem', borderRadius: '6px', fontFamily: 'monospace' }}>
               {address ? `${address.substring(0,8)}...${address.substring(address.length-4)}` : 'S... (Hidden)'}
               <span style={{float: 'right', color: '#8b5cf6'}}>{authMode === 'freighter' ? 'Manual' : 'Autonomous'}</span>
            </div>
         </div>
      )}
      
      <div className="flex flex-col gap-2" style={{ marginTop: '0.5rem' }}>
         <span style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>Active Protocols</span>
         <div className="flex justify-between items-center" style={{ padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: '0.85rem' }}>Stellar x402</span>
            <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem', border: '1px solid #10b981', borderRadius: '12px', color: '#10b981', background: 'rgba(16,185,129,0.1)' }}>{isConnected ? 'Active' : 'Offline'}</span>
         </div>
         <div className="flex justify-between items-center" style={{ padding: '0.5rem 0' }}>
            <span style={{ fontSize: '0.85rem' }}>Stripe MPP</span>
            <span style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem', border: '1px solid #8b5cf6', borderRadius: '12px', color: '#8b5cf6', background: 'rgba(139,92,246,0.1)' }}>Awaiting Session</span>
         </div>
      </div>
    </div>
  );
}

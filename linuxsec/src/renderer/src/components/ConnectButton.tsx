import React from 'react';
import { Power, Loader2 } from 'lucide-react';
import type { VpnState } from '../../../shared/types';

interface ConnectButtonProps {
  state: VpnState;
  onToggle: () => void;
}

export const ConnectButton: React.FC<ConnectButtonProps> = ({ state, onToggle }) => {
  const isConnected = state === 'connected';
  const isConnecting = state === 'connecting' || state === 'reconnecting';
  const isError = state === 'error';

  let ringClass = 'border-slate-700/60 text-slate-400 hover:border-slate-500';
  let glowColor = 'transparent';

  if (isConnected) {
    ringClass = 'border-emerald-500 text-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.35)]';
    glowColor = 'rgba(16, 185, 129, 0.2)';
  } else if (isConnecting) {
    ringClass = 'border-blue-500 text-blue-400 shadow-[0_0_35px_rgba(59,130,246,0.3)]';
    glowColor = 'rgba(59, 130, 246, 0.2)';
  } else if (isError) {
    ringClass = 'border-red-500 text-red-400 shadow-[0_0_35px_rgba(239,68,68,0.3)]';
    glowColor = 'rgba(239, 68, 68, 0.2)';
  }

  return (
    <div className="relative flex items-center justify-center my-6">
      {/* Outer animated pulsating waves when connected or connecting */}
      {(isConnected || isConnecting) && (
        <div
          className="absolute w-44 h-44 rounded-full animate-pulse-ring pointer-events-none"
          style={{ backgroundColor: glowColor }}
        />
      )}

      {/* Main Action Button */}
      <button
        onClick={onToggle}
        disabled={state === 'disconnecting'}
        className={`relative z-10 w-36 h-36 rounded-full border-4 flex flex-col items-center justify-center bg-[var(--bg-secondary)] transition-all duration-300 transform active:scale-95 cursor-pointer disabled:opacity-50 ${ringClass}`}
      >
        {isConnecting ? (
          <Loader2 className="w-14 h-14 animate-spin text-blue-500 mb-1" />
        ) : (
          <Power className={`w-14 h-14 mb-1 transition-transform duration-300 ${isConnected ? 'scale-105' : ''}`} />
        )}

        <span className="text-[11px] font-bold uppercase tracking-wider mt-1">
          {isConnected ? 'ОТКЛЮЧИТЬ' : isConnecting ? 'ПОДКЛЮЧЕНИЕ' : isError ? 'ПОВТОРИТЬ' : 'ПОДКЛЮЧИТЬ'}
        </span>
      </button>
    </div>
  );
};

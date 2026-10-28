import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Clock, Globe, ChevronRight, AlertTriangle, ShieldCheck } from 'lucide-react';
import { ConnectButton } from './ConnectButton';
import type { VpnTunnelStatus, ServerProfile } from '../../../shared/types';

interface HomeScreenProps {
  status: VpnTunnelStatus;
  selectedServer?: ServerProfile;
  onToggleConnect: () => void;
  onOpenServers: () => void;
}

function formatBytesPerSec(bytes: number): string {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatDuration(startTime?: number): string {
  if (!startTime) return '00:00:00';
  const diffSec = Math.floor((Date.now() - startTime) / 1000);
  const hrs = Math.floor(diffSec / 3600).toString().padStart(2, '0');
  const mins = Math.floor((diffSec % 3600) / 60).toString().padStart(2, '0');
  const secs = (diffSec % 60).toString().padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  status,
  selectedServer,
  onToggleConnect,
  onOpenServers,
}) => {
  const [durationStr, setDurationStr] = useState('00:00:00');

  useEffect(() => {
    if (status.state === 'connected' && status.connectedSince) {
      const timer = setInterval(() => {
        setDurationStr(formatDuration(status.connectedSince));
      }, 1000);
      return () => clearInterval(timer);
    } else {
      setDurationStr('00:00:00');
    }
  }, [status.state, status.connectedSince]);

  const isConnected = status.state === 'connected';
  const server = status.activeProfile || selectedServer;

  return (
    <div className="flex-1 flex flex-col items-center justify-between p-5 overflow-y-auto">
      {/* Top Status Title */}
      <div className="text-center mt-1">
        <div className="flex items-center justify-center gap-2 mb-1">
          {isConnected ? (
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          ) : (
            <Globe className="w-5 h-5 text-slate-400" />
          )}
          <span className="text-xs font-semibold tracking-wider uppercase text-[var(--text-secondary)]">
            {isConnected
              ? 'Соединение защищено'
              : status.state === 'connecting'
              ? 'Установка туннеля...'
              : status.state === 'reconnecting'
              ? 'Восстановление связи...'
              : status.state === 'error'
              ? 'Ошибка подключения'
              : 'VPN не активен'}
          </span>
        </div>
        <h1 className="text-xl font-bold text-[var(--text-primary)]">
          {isConnected
            ? server?.countryName || 'Подключено'
            : 'Безопасный доступ'}
        </h1>
      </div>

      {/* Big Animated Connect Button */}
      <ConnectButton state={status.state} onToggle={onToggleConnect} />

      {/* Error Notice */}
      {status.errorMessage && (
        <div className="w-full mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2.5 text-xs text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1 overflow-hidden break-words">{status.errorMessage}</div>
        </div>
      )}

      {/* Server Selection Card */}
      <div
        onClick={onOpenServers}
        className="w-full p-3.5 rounded-xl glass-panel hover:border-blue-500/40 cursor-pointer transition-all flex items-center justify-between mb-3"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none">{server?.flag || '🌐'}</span>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {server?.name || 'Выберите сервер'}
            </span>
            <span className="text-[11px] text-[var(--text-secondary)]">
              {server?.city ? `${server.city}, ` : ''}{server?.countryName || 'Все локации'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {server?.protocol && (
            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              {server.protocol}
            </span>
          )}
          <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
        </div>
      </div>

      {/* IP & Location Card */}
      <div className="w-full p-3 rounded-xl glass-panel mb-3 text-xs">
        <div className="flex justify-between items-center py-1 border-b border-[var(--border-color)]">
          <span className="text-[var(--text-muted)]">Исходный IP (ISP):</span>
          <span className="font-mono text-[var(--text-secondary)]">
            {status.originalPublicIp?.ip || 'Определение...'}
          </span>
        </div>
        <div className="flex justify-between items-center py-1 mt-1">
          <span className="text-[var(--text-muted)]">Текущий IP туннеля:</span>
          <span className={`font-mono font-medium ${isConnected ? 'text-emerald-400 font-bold' : 'text-[var(--text-primary)]'}`}>
            {isConnected ? status.currentPublicIp?.ip || 'Защищено' : status.originalPublicIp?.ip || 'Локальный'}
          </span>
        </div>
      </div>

      {/* Real-time Traffic & Timer Stats */}
      <div className="w-full grid grid-cols-3 gap-2">
        <div className="p-2.5 rounded-xl glass-panel flex flex-col items-center justify-center text-center">
          <div className="flex items-center gap-1 text-[11px] text-emerald-400 mb-1">
            <ArrowDown className="w-3.5 h-3.5" />
            <span>Входящий</span>
          </div>
          <span className="text-xs font-bold font-mono text-[var(--text-primary)]">
            {formatBytesPerSec(status.currentDownloadSpeed)}
          </span>
        </div>

        <div className="p-2.5 rounded-xl glass-panel flex flex-col items-center justify-center text-center">
          <div className="flex items-center gap-1 text-[11px] text-blue-400 mb-1">
            <ArrowUp className="w-3.5 h-3.5" />
            <span>Исходящий</span>
          </div>
          <span className="text-xs font-bold font-mono text-[var(--text-primary)]">
            {formatBytesPerSec(status.currentUploadSpeed)}
          </span>
        </div>

        <div className="p-2.5 rounded-xl glass-panel flex flex-col items-center justify-center text-center">
          <div className="flex items-center gap-1 text-[11px] text-amber-400 mb-1">
            <Clock className="w-3.5 h-3.5" />
            <span>Время</span>
          </div>
          <span className="text-xs font-bold font-mono text-[var(--text-primary)]">
            {durationStr}
          </span>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Activity, HardDrive, Shield } from 'lucide-react';
import type { VpnTunnelStatus } from '../../../shared/types';

interface StatsScreenProps {
  status: VpnTunnelStatus;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export const StatsScreen: React.FC<StatsScreenProps> = ({ status }) => {
  // Store 20 recent speed points for live chart
  const [speedHistory, setSpeedHistory] = useState<{ down: number; up: number }[]>(
    Array(20).fill({ down: 0, up: 0 })
  );

  useEffect(() => {
    setSpeedHistory((prev) => {
      const next = [...prev.slice(1), { down: status.currentDownloadSpeed, up: status.currentUploadSpeed }];
      return next;
    });
  }, [status.currentDownloadSpeed, status.currentUploadSpeed]);

  const maxSpeed = Math.max(...speedHistory.map((p) => Math.max(p.down, p.up)), 1024 * 50); // min 50KB/s scale

  const renderSvgPath = (key: 'down' | 'up') => {
    const width = 340;
    const height = 100;
    const step = width / (speedHistory.length - 1);

    const points = speedHistory.map((p, i) => {
      const x = i * step;
      const y = height - (p[key] / maxSpeed) * (height - 10);
      return `${x},${y}`;
    });

    return `M ${points.join(' L ')}`;
  };

  return (
    <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-4">
      {/* Top Header */}
      <div className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-blue-500" />
        <h2 className="text-sm font-bold text-[var(--text-primary)]">Мониторинг трафика</h2>
      </div>

      {/* Real-time SVG Graph */}
      <div className="p-4 rounded-xl glass-panel flex flex-col">
        <div className="flex items-center justify-between text-xs mb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>Входящий</span>
            </div>
            <div className="flex items-center gap-1.5 text-blue-400">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span>Исходящий</span>
            </div>
          </div>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            Пик: {formatBytes(maxSpeed)}/s
          </span>
        </div>

        <div className="w-full h-28 relative flex items-center justify-center overflow-hidden">
          <svg className="w-full h-full overflow-visible" viewBox="0 0 340 100" preserveAspectRatio="none">
            {/* Grid lines */}
            <line x1="0" y1="25" x2="340" y2="25" stroke="rgba(255,255,255,0.05)" strokeDasharray="4" />
            <line x1="0" y1="50" x2="340" y2="50" stroke="rgba(255,255,255,0.05)" strokeDasharray="4" />
            <line x1="0" y1="75" x2="340" y2="75" stroke="rgba(255,255,255,0.05)" strokeDasharray="4" />

            {/* Lines */}
            <path
              d={renderSvgPath('down')}
              fill="none"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="transition-all duration-300"
            />
            <path
              d={renderSvgPath('up')}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2"
              strokeLinecap="round"
              className="transition-all duration-300"
            />
          </svg>
        </div>
      </div>

      {/* Total Data Transferred Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3.5 rounded-xl glass-panel">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] mb-1">
            <ArrowDown className="w-4 h-4 text-emerald-400" />
            <span>Всего получено</span>
          </div>
          <div className="text-base font-bold font-mono text-[var(--text-primary)]">
            {formatBytes(status.bytesReceived)}
          </div>
        </div>

        <div className="p-3.5 rounded-xl glass-panel">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] mb-1">
            <ArrowUp className="w-4 h-4 text-blue-400" />
            <span>Всего отправлено</span>
          </div>
          <div className="text-base font-bold font-mono text-[var(--text-primary)]">
            {formatBytes(status.bytesSent)}
          </div>
        </div>
      </div>

      {/* Network Interface Information */}
      <div className="p-3.5 rounded-xl glass-panel space-y-2 text-xs">
        <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)] mb-2">
          <HardDrive className="w-4 h-4 text-slate-400" />
          <span>Сетевой стек Linux</span>
        </div>

        <div className="flex justify-between py-1 border-b border-[var(--border-color)]">
          <span className="text-[var(--text-muted)]">Туннельный интерфейс:</span>
          <span className="font-mono text-[var(--text-secondary)]">
            {status.interfaceName || 'Не активен'}
          </span>
        </div>

        <div className="flex justify-between py-1 border-b border-[var(--border-color)]">
          <span className="text-[var(--text-muted)]">Протокол туннеля:</span>
          <span className="font-mono uppercase text-blue-400 font-semibold">
            {status.activeProfile?.protocol || 'N/A'}
          </span>
        </div>

        <div className="flex justify-between py-1 border-b border-[var(--border-color)]">
          <span className="text-[var(--text-muted)]">Шлюз назначения (Endpoint):</span>
          <span className="font-mono text-[var(--text-secondary)]">
            {status.activeProfile?.endpoint || 'N/A'}
          </span>
        </div>

        <div className="flex justify-between py-1">
          <span className="text-[var(--text-muted)]">Шифрование данных:</span>
          <span className="flex items-center gap-1 text-emerald-400 font-semibold">
            <Shield className="w-3.5 h-3.5" />
            <span>ChaCha20-Poly1305 / AES-GCM</span>
          </span>
        </div>
      </div>
    </div>
  );
};

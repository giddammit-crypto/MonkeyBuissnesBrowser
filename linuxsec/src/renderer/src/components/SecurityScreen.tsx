import React from 'react';
import { ShieldCheck, Lock, Globe, Split, ShieldAlert } from 'lucide-react';
import type { VpnSettings } from '../../../shared/types';

interface SecurityScreenProps {
  settings: VpnSettings;
  onUpdateSettings: (partial: Partial<VpnSettings>) => void;
}

export const SecurityScreen: React.FC<SecurityScreenProps> = ({ settings, onUpdateSettings }) => {
  return (
    <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-3">
      {/* Top Header */}
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="w-5 h-5 text-blue-500" />
        <h2 className="text-sm font-bold text-[var(--text-primary)]">Параметры безопасности</h2>
      </div>

      {/* Kill Switch Card */}
      <div className="p-3.5 rounded-xl glass-panel space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-[var(--text-primary)]">
                Аварийная блокировка (Kill Switch)
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                nftables / iptables межсетевой экран
              </div>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.killSwitchEnabled}
              onChange={(e) => onUpdateSettings({ killSwitchEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] pl-10">
          Блокирует весь входящий и исходящий трафик вне защищенного туннеля при непредвиденном обрыве VPN-соединения.
        </p>
      </div>

      {/* DNS Leak Protection */}
      <div className="p-3.5 rounded-xl glass-panel space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-[var(--text-primary)]">
                Защита от утечек DNS (DNS Leak Protection)
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                Принудительный приоритет в systemd-resolved
              </div>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.dnsLeakProtection}
              onChange={(e) => onUpdateSettings({ dnsLeakProtection: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] pl-10">
          Направляет все запросы доменных имен исключительно через зашифрованный туннель, предотвращая слежку провайдера.
        </p>
      </div>

      {/* IPv6 Leak Protection */}
      <div className="p-3.5 rounded-xl glass-panel space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-[var(--text-primary)]">
                Защита от утечек IPv6
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                Изоляция незашифрованных маршрутов IPv6
              </div>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.ipv6LeakProtection}
              onChange={(e) => onUpdateSettings({ ipv6LeakProtection: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] pl-10">
          Блокирует утечки трафика через IPv6 интерфейсы, если VPN-сервер работает исключительно по протоколу IPv4.
        </p>
      </div>

      {/* Split Tunneling */}
      <div className="p-3.5 rounded-xl glass-panel space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
              <Split className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-[var(--text-primary)]">
                Раздельное туннелирование (Split Tunneling)
              </div>
              <div className="text-[10px] text-[var(--text-muted)]">
                Исключение локальных сетей и адресов
              </div>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.splitTunnelEnabled}
              onChange={(e) => onUpdateSettings({ splitTunnelEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)] pl-10">
          Позволяет сохранять прямой доступ к локальным сетевым принтерам, NAS и ресурсам (192.168.0.0/16, 10.0.0.0/8).
        </p>
      </div>
    </div>
  );
};

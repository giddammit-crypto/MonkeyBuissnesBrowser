import React from 'react';
import { Settings, Play, Power, Server, Palette, Info } from 'lucide-react';
import type { VpnSettings } from '../../../shared/types';

interface SettingsScreenProps {
  settings: VpnSettings;
  onUpdateSettings: (partial: Partial<VpnSettings>) => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ settings, onUpdateSettings }) => {
  const dnsPresets = [
    { name: 'Cloudflare', servers: ['1.1.1.1', '1.0.0.1'] },
    { name: 'Quad9 (Защита от фишинга)', servers: ['9.9.9.9', '149.112.112.112'] },
    { name: 'Google Public DNS', servers: ['8.8.8.8', '8.8.4.4'] },
    { name: 'AdGuard (Блокировка рекламы)', servers: ['94.140.14.14', '94.140.15.15'] },
  ];

  return (
    <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-3">
      {/* Top Header */}
      <div className="flex items-center gap-2 mb-1">
        <Settings className="w-5 h-5 text-blue-500" />
        <h2 className="text-sm font-bold text-[var(--text-primary)]">Настройки приложения</h2>
      </div>

      {/* Auto-start on boot */}
      <div className="p-3.5 rounded-xl glass-panel flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
            <Play className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-[var(--text-primary)]">
              Автозапуск при входе в Linux
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">
              ~/.config/autostart/linuxsec.desktop
            </div>
          </div>
        </div>

        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoStartOnBoot}
            onChange={(e) => onUpdateSettings({ autoStartOnBoot: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {/* Auto-connect on start */}
      <div className="p-3.5 rounded-xl glass-panel flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
            <Power className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-[var(--text-primary)]">
              Автоматическое подключение
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">
              Подключаться к VPN сразу при старте программы
            </div>
          </div>
        </div>

        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoConnectOnStart}
            onChange={(e) => onUpdateSettings({ autoConnectOnStart: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {/* Protocol Selection */}
      <div className="p-3.5 rounded-xl glass-panel space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
          <Server className="w-4 h-4 text-slate-400" />
          <span>Предпочитаемый VPN-протокол</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(['wireguard', 'openvpn', 'auto'] as const).map((proto) => (
            <button
              key={proto}
              type="button"
              onClick={() => onUpdateSettings({ preferredProtocol: proto })}
              className={`py-1.5 rounded-lg text-xs font-medium transition-all ${
                settings.preferredProtocol === proto
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)]'
              }`}
            >
              {proto === 'wireguard' ? 'WireGuard' : proto === 'openvpn' ? 'OpenVPN' : 'Авто'}
            </button>
          ))}
        </div>
      </div>

      {/* Custom DNS selection */}
      <div className="p-3.5 rounded-xl glass-panel space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-[var(--text-primary)]">
            Пользовательские DNS-серверы
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.customDnsEnabled}
              onChange={(e) => onUpdateSettings({ customDnsEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        {settings.customDnsEnabled && (
          <div className="space-y-2 pt-1">
            <div className="grid grid-cols-2 gap-1.5">
              {dnsPresets.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => onUpdateSettings({ customDnsServers: preset.servers })}
                  className={`p-2 rounded-lg text-left text-[11px] border transition-colors ${
                    settings.customDnsServers[0] === preset.servers[0]
                      ? 'border-blue-500 bg-blue-500/10 text-blue-300 font-semibold'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)]'
                  }`}
                >
                  <div className="truncate">{preset.name}</div>
                  <div className="font-mono text-[9px] text-[var(--text-muted)] truncate">
                    {preset.servers.join(', ')}
                  </div>
                </button>
              ))}
            </div>

            <input
              type="text"
              value={settings.customDnsServers.join(', ')}
              onChange={(e) =>
                onUpdateSettings({
                  customDnsServers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                })
              }
              placeholder="1.1.1.1, 8.8.8.8"
              className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        )}
      </div>

      {/* About Box */}
      <div className="p-3.5 rounded-xl glass-panel space-y-1 text-xs">
        <div className="flex items-center gap-1.5 font-bold text-[var(--text-primary)]">
          <Info className="w-4 h-4 text-blue-500" />
          <span>О программе Linuxsec</span>
        </div>
        <p className="text-[11px] text-[var(--text-secondary)]">
          Версия 1.0.0 (Production Release)
        </p>
        <p className="text-[10px] text-[var(--text-muted)]">
          Полноценный VPN-клиент для Linux. WireGuard, OpenVPN, NetworkManager D-Bus, nftables Kill Switch, systemd-resolved DNS Lock.
        </p>
      </div>
    </div>
  );
};

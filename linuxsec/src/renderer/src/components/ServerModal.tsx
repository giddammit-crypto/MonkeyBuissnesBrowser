import React, { useState } from 'react';
import { X, Shield } from 'lucide-react';
import type { ServerProfile } from '../../../shared/types';

interface ServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (profile: Partial<ServerProfile> & { name: string; protocol: 'wireguard' | 'openvpn' }) => void;
}

export const ServerModal: React.FC<ServerModalProps> = ({ isOpen, onClose, onSave }) => {
  const [name, setName] = useState('');
  const [countryName, setCountryName] = useState('Германия');
  const [countryCode, setCountryCode] = useState('de');
  const [flag, setFlag] = useState('🇩🇪');
  const [city, setCity] = useState('Франкфурт');
  const [protocol, setProtocol] = useState<'wireguard' | 'openvpn'>('wireguard');

  // WireGuard fields
  const [endpoint, setEndpoint] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [address, setAddress] = useState('10.14.0.2/24');
  const [dns, setDns] = useState('1.1.1.1');

  // OpenVPN fields
  const [rawConfig, setRawConfig] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !endpoint) return;

    if (protocol === 'wireguard') {
      onSave({
        name,
        countryName,
        countryCode,
        flag,
        city,
        protocol: 'wireguard',
        endpoint,
        wireguard: {
          privateKey,
          publicKey,
          endpoint,
          address: address.split(',').map((s) => s.trim()).filter(Boolean),
          dns: dns.split(',').map((s) => s.trim()).filter(Boolean),
          allowedIps: ['0.0.0.0/0'],
          persistentKeepalive: 25,
        },
      });
    } else {
      const parts = endpoint.split(':');
      const host = parts[0];
      const port = parseInt(parts[1] || '1194', 10);
      onSave({
        name,
        countryName,
        countryCode,
        flag,
        city,
        protocol: 'openvpn',
        endpoint,
        openvpn: {
          rawConfig: rawConfig || `client\ndev tun\nproto udp\nremote ${host} ${port}\n`,
          remoteHost: host,
          remotePort: port,
          proto: 'udp',
        },
      });
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl glass-panel bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-500" />
            <h2 className="text-sm font-bold text-[var(--text-primary)]">Новый VPN-сервер</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 overflow-y-auto space-y-3 text-xs">
          <div>
            <label className="block text-[var(--text-secondary)] mb-1">Название сервера</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Мой WireGuard сервер"
              className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[var(--text-secondary)] mb-1">Страна</label>
              <input
                type="text"
                value={countryName}
                onChange={(e) => setCountryName(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label className="block text-[var(--text-secondary)] mb-1">Флаг</label>
              <input
                type="text"
                value={flag}
                onChange={(e) => setFlag(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[var(--text-secondary)] mb-1">Протокол</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setProtocol('wireguard')}
                className={`py-1.5 rounded-lg font-medium transition-all ${
                  protocol === 'wireguard'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)]'
                }`}
              >
                WireGuard
              </button>
              <button
                type="button"
                onClick={() => setProtocol('openvpn')}
                className={`py-1.5 rounded-lg font-medium transition-all ${
                  protocol === 'openvpn'
                    ? 'bg-blue-600 text-white'
                    : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border border-[var(--border-color)]'
                }`}
              >
                OpenVPN
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[var(--text-secondary)] mb-1">Endpoint (IP:Порт или Домен:Порт)</label>
            <input
              type="text"
              required
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="198.51.100.1:51820"
              className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-blue-500 font-mono"
            />
          </div>

          {protocol === 'wireguard' ? (
            <>
              <div>
                <label className="block text-[var(--text-secondary)] mb-1">PrivateKey (Клиент)</label>
                <input
                  type="password"
                  required
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder="32-byte base64 key"
                  className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] font-mono"
                />
              </div>

              <div>
                <label className="block text-[var(--text-secondary)] mb-1">PublicKey (Сервер)</label>
                <input
                  type="text"
                  required
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  placeholder="32-byte base64 key"
                  className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[var(--text-secondary)] mb-1">Address</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[var(--text-secondary)] mb-1">DNS</label>
                  <input
                    type="text"
                    value={dns}
                    onChange={(e) => setDns(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] font-mono"
                  />
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-[var(--text-secondary)] mb-1">OpenVPN Конфигурация (.ovpn текст)</label>
              <textarea
                rows={5}
                value={rawConfig}
                onChange={(e) => setRawConfig(e.target.value)}
                placeholder="client&#10;dev tun&#10;proto udp&#10;..."
                className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-primary)] font-mono"
              />
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors shadow-sm"
            >
              Сохранить сервер
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

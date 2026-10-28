import React, { useState } from 'react';
import { Search, Star, Plus, Upload, Trash2, Check, RefreshCw } from 'lucide-react';
import type { ServerProfile } from '../../../shared/types';

interface ServersScreenProps {
  servers: ServerProfile[];
  activeServerId?: string;
  onSelectServer: (server: ServerProfile) => void;
  onToggleFavorite: (id: string) => void;
  onDeleteServer: (id: string) => void;
  onImportWireGuard: () => void;
  onImportOpenVpn: () => void;
  onOpenAddModal: () => void;
  onRefreshPings: () => void;
  isPinging: boolean;
}

export const ServersScreen: React.FC<ServersScreenProps> = ({
  servers,
  activeServerId,
  onSelectServer,
  onToggleFavorite,
  onDeleteServer,
  onImportWireGuard,
  onImportOpenVpn,
  onOpenAddModal,
  onRefreshPings,
  isPinging,
}) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'favorites' | 'wireguard' | 'openvpn'>('all');

  const filtered = servers.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.countryName.toLowerCase().includes(search.toLowerCase()) ||
      (s.city && s.city.toLowerCase().includes(search.toLowerCase()));

    if (!matchesSearch) return false;
    if (filter === 'favorites') return s.isFavorite;
    if (filter === 'wireguard') return s.protocol === 'wireguard';
    if (filter === 'openvpn') return s.protocol === 'openvpn';
    return true;
  });

  const getPingBadge = (ping?: number) => {
    if (!ping || ping >= 999) return <span className="text-[10px] text-[var(--text-muted)]">-- ms</span>;
    let color = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (ping > 120) color = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    if (ping > 220) color = 'text-red-400 bg-red-500/10 border-red-500/20';
    return (
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${color}`}>
        {ping} ms
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col p-4 overflow-hidden">
      {/* Top Search & Actions */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 relative flex items-center">
          <Search className="w-4 h-4 absolute left-3 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Поиск серверов и стран..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500"
          />
        </div>

        <button
          onClick={onRefreshPings}
          disabled={isPinging}
          title="Проверить задержку серверов"
          className="p-2 rounded-lg glass-panel hover:border-blue-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isPinging ? 'animate-spin text-blue-500' : ''}`} />
        </button>

        <button
          onClick={onOpenAddModal}
          title="Добавить сервер"
          className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-sm"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-3 text-[11px]">
        {(['all', 'favorites', 'wireguard', 'openvpn'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              filter === tab
                ? 'bg-blue-600/20 text-blue-400 font-semibold border border-blue-500/30'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)]'
            }`}
          >
            {tab === 'all'
              ? 'Все'
              : tab === 'favorites'
              ? 'Избранные'
              : tab === 'wireguard'
              ? 'WireGuard'
              : 'OpenVPN'}
          </button>
        ))}
      </div>

      {/* Import Banners */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={onImportWireGuard}
          className="p-2 rounded-lg border border-dashed border-[var(--border-color)] hover:border-blue-500/40 hover:bg-[var(--bg-card)] flex items-center justify-center gap-1.5 text-xs text-[var(--text-secondary)] transition-colors"
        >
          <Upload className="w-3.5 h-3.5 text-blue-400" />
          <span>Импорт .conf</span>
        </button>

        <button
          onClick={onImportOpenVpn}
          className="p-2 rounded-lg border border-dashed border-[var(--border-color)] hover:border-blue-500/40 hover:bg-[var(--bg-card)] flex items-center justify-center gap-1.5 text-xs text-[var(--text-secondary)] transition-colors"
        >
          <Upload className="w-3.5 h-3.5 text-amber-400" />
          <span>Импорт .ovpn</span>
        </button>
      </div>

      {/* Servers Scroll Area */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {filtered.length === 0 ? (
          <div className="text-center py-10 text-xs text-[var(--text-muted)]">
            Нет серверов, соответствующих условиям поиска.
          </div>
        ) : (
          filtered.map((server) => {
            const isSelected = activeServerId === server.id;
            return (
              <div
                key={server.id}
                onClick={() => onSelectServer(server)}
                className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-[var(--border-color)] glass-panel hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl leading-none">{server.flag || '🌐'}</span>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        {server.name}
                      </span>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-blue-400" />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)] mt-0.5">
                      <span>{server.city || server.countryName}</span>
                      <span>•</span>
                      <span className="uppercase text-[var(--text-muted)]">{server.protocol}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                  {getPingBadge(server.ping)}

                  <button
                    onClick={() => onToggleFavorite(server.id)}
                    className="p-1 text-[var(--text-muted)] hover:text-amber-400 transition-colors"
                  >
                    <Star
                      className={`w-4 h-4 ${
                        server.isFavorite ? 'fill-amber-400 text-amber-400' : ''
                      }`}
                    />
                  </button>

                  <button
                    onClick={() => onDeleteServer(server.id)}
                    title="Удалить сервер"
                    className="p-1 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

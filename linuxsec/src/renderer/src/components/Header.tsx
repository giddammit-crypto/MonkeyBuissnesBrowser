import React from 'react';
import { Shield, Minus, X, Sun, Moon } from 'lucide-react';
import type { VpnState } from '../../../shared/types';

interface HeaderProps {
  state: VpnState;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({ state, theme, onToggleTheme }) => {
  const handleMinimize = () => {
    (window as any).linuxsec?.system?.minimizeWindow();
  };

  const handleClose = () => {
    (window as any).linuxsec?.system?.closeWindow();
  };

  const getStatusColor = () => {
    switch (state) {
      case 'connected':
        return '#10b981'; // emerald-500
      case 'connecting':
      case 'reconnecting':
        return '#3b82f6'; // blue-500
      case 'error':
        return '#ef4444'; // red-500
      default:
        return '#64748b'; // slate-500
    }
  };

  return (
    <header className="h-12 w-full flex items-center justify-between px-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] titlebar-drag">
      <div className="flex items-center gap-2.5">
        <div className="relative flex items-center justify-center">
          <Shield className="w-5 h-5 text-blue-500" />
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[var(--bg-secondary)]"
            style={{ backgroundColor: getStatusColor() }}
          />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-bold text-sm tracking-wide text-[var(--text-primary)]">Linuxsec</span>
          <span className="text-[10px] uppercase font-semibold text-[var(--text-muted)] tracking-wider">VPN</span>
        </div>
      </div>

      <div className="flex items-center gap-1 titlebar-no-drag">
        <button
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
          className="p-1.5 rounded-md hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <button
          onClick={handleMinimize}
          title="Свернуть"
          className="p-1.5 rounded-md hover:bg-[var(--bg-card-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>

        <button
          onClick={handleClose}
          title="Закрыть в трей"
          className="p-1.5 rounded-md hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-400 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

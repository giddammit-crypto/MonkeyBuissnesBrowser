import React from 'react';
import { Power, Globe, Activity, CheckCircle2, ShieldCheck, Settings } from 'lucide-react';

export type TabId = 'home' | 'servers' | 'stats' | 'diagnostics' | 'security' | 'settings';

interface NavigationProps {
  currentTab: TabId;
  onSelectTab: (tab: TabId) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ currentTab, onSelectTab }) => {
  const tabs = [
    { id: 'home' as TabId, label: 'VPN', icon: Power },
    { id: 'servers' as TabId, label: 'Серверы', icon: Globe },
    { id: 'stats' as TabId, label: 'Трафик', icon: Activity },
    { id: 'diagnostics' as TabId, label: 'Аудит', icon: CheckCircle2 },
    { id: 'security' as TabId, label: 'Защита', icon: ShieldCheck },
    { id: 'settings' as TabId, label: 'Опции', icon: Settings },
  ];

  return (
    <nav className="h-14 w-full flex items-center justify-around px-2 border-t border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = currentTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`flex flex-col items-center justify-center gap-1 py-1 px-2.5 rounded-lg transition-all ${
              isActive
                ? 'text-blue-500 font-semibold'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
            <span className="text-[10px] tracking-tight">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

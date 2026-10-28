import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Navigation, type TabId } from './components/Navigation';
import { HomeScreen } from './components/HomeScreen';
import { ServersScreen } from './components/ServersScreen';
import { ServerModal } from './components/ServerModal';
import { StatsScreen } from './components/StatsScreen';
import { DiagnosticsScreen } from './components/DiagnosticsScreen';
import { SecurityScreen } from './components/SecurityScreen';
import { SettingsScreen } from './components/SettingsScreen';
import type {
  VpnTunnelStatus,
  ServerProfile,
  VpnSettings,
  DiagnosticsReport,
} from '../../shared/types';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<TabId>('home');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [status, setStatus] = useState<VpnTunnelStatus>({
    state: 'disconnected',
    bytesReceived: 0,
    bytesSent: 0,
    currentDownloadSpeed: 0,
    currentUploadSpeed: 0,
  });
  const [servers, setServers] = useState<ServerProfile[]>([]);
  const [selectedServer, setSelectedServer] = useState<ServerProfile | undefined>();
  const [settings, setSettings] = useState<VpnSettings>({
    autoStartOnBoot: false,
    autoConnectOnStart: false,
    killSwitchEnabled: false,
    dnsLeakProtection: true,
    ipv6LeakProtection: true,
    customDnsEnabled: false,
    customDnsServers: ['1.1.1.1', '1.0.0.1'],
    splitTunnelEnabled: false,
    splitTunnelExcludedIps: [],
    splitTunnelExcludedApps: [],
    theme: 'dark',
    preferredProtocol: 'wireguard',
  });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isPinging, setIsPinging] = useState(false);

  const api = (window as any).linuxsec;

  // Initial load and event subscriptions
  useEffect(() => {
    if (!api) return;

    // Load initial status
    api.vpn.getStatus().then((s: VpnTunnelStatus) => {
      setStatus(s);
      if (s.activeProfile) {
        setSelectedServer(s.activeProfile);
      }
    }).catch(console.error);

    // Load servers
    api.profiles.getAll().then((list: ServerProfile[]) => {
      setServers(list);
      if (list.length > 0 && !selectedServer) {
        setSelectedServer(list[0]);
      }
    }).catch(console.error);

    // Load settings
    api.settings.get().then((sett: VpnSettings) => {
      setSettings(sett);
      if (sett.theme === 'light') {
        setTheme('light');
        document.documentElement.setAttribute('data-theme', 'light');
      }
    }).catch(console.error);

    // Subscribe to VPN status changes
    const unsubStatus = api.vpn.onStatusChanged((newStatus: VpnTunnelStatus) => {
      setStatus(newStatus);
      if (newStatus.activeProfile) {
        setSelectedServer(newStatus.activeProfile);
      }
    });

    // Subscribe to real-time traffic ticks
    const unsubTraffic = api.vpn.onTrafficStats((traffic: any) => {
      setStatus((prev) => ({
        ...prev,
        bytesReceived: traffic.bytesReceived,
        bytesSent: traffic.bytesSent,
        currentDownloadSpeed: traffic.downloadBps,
        currentUploadSpeed: traffic.uploadBps,
      }));
    });

    return () => {
      unsubStatus();
      unsubTraffic();
    };
  }, []);

  const handleToggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    api?.settings?.update({ theme: nextTheme });
  };

  const handleToggleConnect = async () => {
    if (!api) return;
    if (status.state === 'connected') {
      await api.vpn.disconnect();
    } else {
      const target = selectedServer || servers[0];
      if (target) {
        await api.vpn.connect(target.id);
      }
    }
  };

  const handleSelectServer = (server: ServerProfile) => {
    setSelectedServer(server);
    setCurrentTab('home');
  };

  const handleToggleFavorite = async (id: string) => {
    const target = servers.find((s) => s.id === id);
    if (!target) return;
    const updated = { ...target, isFavorite: !target.isFavorite };
    await api.profiles.save(updated);
    const refreshed = await api.profiles.getAll();
    setServers(refreshed);
  };

  const handleDeleteServer = async (id: string) => {
    await api.profiles.delete(id);
    const refreshed = await api.profiles.getAll();
    setServers(refreshed);
    if (selectedServer?.id === id) {
      setSelectedServer(refreshed[0]);
    }
  };

  const handleImportWireGuard = async () => {
    const imported = await api.profiles.importWireGuard();
    if (imported) {
      const refreshed = await api.profiles.getAll();
      setServers(refreshed);
      setSelectedServer(imported);
      setCurrentTab('home');
    }
  };

  const handleImportOpenVpn = async () => {
    const imported = await api.profiles.importOpenVpn();
    if (imported) {
      const refreshed = await api.profiles.getAll();
      setServers(refreshed);
      setSelectedServer(imported);
      setCurrentTab('home');
    }
  };

  const handleSaveCustomServer = async (profileData: any) => {
    const saved = await api.profiles.save(profileData);
    const refreshed = await api.profiles.getAll();
    setServers(refreshed);
    setSelectedServer(saved);
  };

  const handleRefreshPings = async () => {
    if (isPinging) return;
    setIsPinging(true);
    try {
      const pings = await api.profiles.pingAll();
      setServers((prev) =>
        prev.map((s) => (pings[s.id] !== undefined ? { ...s, ping: pings[s.id] } : s))
      );
    } finally {
      setIsPinging(false);
    }
  };

  const handleUpdateSettings = async (partial: Partial<VpnSettings>) => {
    const updated = await api.settings.update(partial);
    setSettings(updated);
  };

  const handleRunDiagnostics = async (): Promise<DiagnosticsReport> => {
    return api.diagnostics.run();
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <Header state={status.state} theme={theme} onToggleTheme={handleToggleTheme} />

      <main className="flex-1 flex flex-col overflow-hidden">
        {currentTab === 'home' && (
          <HomeScreen
            status={status}
            selectedServer={selectedServer}
            onToggleConnect={handleToggleConnect}
            onOpenServers={() => setCurrentTab('servers')}
          />
        )}

        {currentTab === 'servers' && (
          <ServersScreen
            servers={servers}
            activeServerId={selectedServer?.id}
            onSelectServer={handleSelectServer}
            onToggleFavorite={handleToggleFavorite}
            onDeleteServer={handleDeleteServer}
            onImportWireGuard={handleImportWireGuard}
            onImportOpenVpn={handleImportOpenVpn}
            onOpenAddModal={() => setIsAddModalOpen(true)}
            onRefreshPings={handleRefreshPings}
            isPinging={isPinging}
          />
        )}

        {currentTab === 'stats' && <StatsScreen status={status} />}

        {currentTab === 'diagnostics' && (
          <DiagnosticsScreen onRunDiagnostics={handleRunDiagnostics} />
        )}

        {currentTab === 'security' && (
          <SecurityScreen
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
          />
        )}

        {currentTab === 'settings' && (
          <SettingsScreen
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
          />
        )}
      </main>

      <Navigation currentTab={currentTab} onSelectTab={setCurrentTab} />

      <ServerModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={handleSaveCustomServer}
      />
    </div>
  );
};

export interface MemoryTabState {
  tabId: string;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  loading: boolean;
  downloading: boolean;
  hasFormEdits?: boolean;
  capturing?: boolean;
  lastInteractionAt: number;
  lifecycle: 'active' | 'background' | 'hibernated' | 'crashed';
}

export interface MemoryMetrics {
  sampledAt: number;
  availableMemory: number;
  processes: Array<{ pid: number; type: string; cpuPercent: number; workingSetSize: number }>;
}

export class MemoryManager {
  private readonly tabs = new Map<string, MemoryTabState>();
  private lastMetrics: MemoryMetrics | null = null;

  registerTab(state: MemoryTabState): void {
    this.tabs.set(state.tabId, state);
  }

  updateTab(tabId: string, patch: Partial<MemoryTabState>): void {
    const current = this.tabs.get(tabId);
    if (current) this.tabs.set(tabId, { ...current, ...patch });
  }

  removeTab(tabId: string): void {
    this.tabs.delete(tabId);
  }

  markInteraction(tabId: string): void {
    this.updateTab(tabId, { lastInteractionAt: Date.now() });
  }

  canHibernate(tabId: string, idleMinutes: number): { allowed: boolean; reason?: string } {
    const tab = this.tabs.get(tabId);
    if (!tab) return { allowed: false, reason: 'unknown-tab' };
    if (tab.active) return { allowed: false, reason: 'active-tab' };
    if (tab.pinned) return { allowed: false, reason: 'pinned-tab' };
    if (tab.audible) return { allowed: false, reason: 'audible-tab' };
    if (tab.loading) return { allowed: false, reason: 'loading' };
    if (tab.downloading) return { allowed: false, reason: 'download-in-progress' };
    if (tab.hasFormEdits) return { allowed: false, reason: 'unsaved-form' };
    if (tab.capturing) return { allowed: false, reason: 'media-capture' };
    if (Date.now() - tab.lastInteractionAt < idleMinutes * 60_000) return { allowed: false, reason: 'recent-interaction' };
    return { allowed: true };
  }

  sample(): MemoryMetrics {
    const electronRuntime = require('electron') as typeof import('electron');
    const processes = electronRuntime.app.getAppMetrics().map((process) => ({
      pid: process.pid,
      type: process.type,
      cpuPercent: process.cpu.percentCPUUsage,
      workingSetSize: process.memory.workingSetSize,
    }));
    this.lastMetrics = {
      sampledAt: Date.now(),
      availableMemory: process.getSystemMemoryInfo().available,
      processes,
    };
    return this.lastMetrics;
  }

  metrics(): MemoryMetrics | null {
    return this.lastMetrics;
  }
}

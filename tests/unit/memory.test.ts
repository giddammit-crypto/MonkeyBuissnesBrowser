import { describe, expect, it } from 'vitest';
import { MemoryManager } from '../../src/services/memory/MemoryManager';

describe('MemoryManager eligibility', () => {
  it('protects active, audible, loading, downloading and pinned tabs', () => {
    const manager = new MemoryManager();
    manager.registerTab({ tabId: 'tab-1', active: true, pinned: false, audible: false, loading: false, downloading: false, lastInteractionAt: 0, lifecycle: 'active' });
    expect(manager.canHibernate('tab-1', 0).reason).toBe('active-tab');

    manager.updateTab('tab-1', { active: false, audible: true });
    expect(manager.canHibernate('tab-1', 0).reason).toBe('audible-tab');
    manager.updateTab('tab-1', { audible: false, loading: true });
    expect(manager.canHibernate('tab-1', 0).reason).toBe('loading');
    manager.updateTab('tab-1', { loading: false, downloading: true });
    expect(manager.canHibernate('tab-1', 0).reason).toBe('download-in-progress');
    manager.updateTab('tab-1', { downloading: false, pinned: true });
    expect(manager.canHibernate('tab-1', 0).reason).toBe('pinned-tab');
  });

  it('protects unsaved forms and media capture from automatic discard', () => {
    const manager = new MemoryManager();
    manager.registerTab({ tabId: 'dirty', active: false, pinned: false, audible: false, loading: false, downloading: false, lastInteractionAt: 0, lifecycle: 'background', hasFormEdits: true });
    expect(manager.canHibernate('dirty', 0).reason).toBe('unsaved-form');
    manager.updateTab('dirty', { hasFormEdits: false, capturing: true });
    expect(manager.canHibernate('dirty', 0).reason).toBe('media-capture');
    manager.updateTab('dirty', { capturing: false });
    expect(manager.canHibernate('dirty', 0)).toEqual({ allowed: true });
  });

  it('respects the idle threshold after recent user interaction', () => {
    const manager = new MemoryManager();
    manager.registerTab({ tabId: 'recent', active: false, pinned: false, audible: false, loading: false, downloading: false, lastInteractionAt: Date.now(), lifecycle: 'background' });
    expect(manager.canHibernate('recent', 5).reason).toBe('recent-interaction');
  });

  it('allows an idle background tab when no exclusion applies', () => {
    const manager = new MemoryManager();
    manager.registerTab({ tabId: 'tab-2', active: false, pinned: false, audible: false, loading: false, downloading: false, lastInteractionAt: 0, lifecycle: 'background' });
    expect(manager.canHibernate('tab-2', 0)).toEqual({ allowed: true });
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const dialogs = vi.hoisted(() => ({ showOpenDialog: vi.fn(), showMessageBox: vi.fn() }));
vi.mock('electron', () => ({ dialog: dialogs }));
import { LocalExtensionManager } from '../../src/services/extensions/LocalExtensionManager';
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); vi.restoreAllMocks(); dialogs.showOpenDialog.mockReset(); dialogs.showMessageBox.mockReset(); });
function fixture(version = '1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-lifecycle-')); roots.push(root);
  const extension = path.join(root, 'extension'); fs.mkdirSync(extension);
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Test', version }));
  dialogs.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [extension] });
  dialogs.showMessageBox.mockResolvedValue({ response: 1 });
  const runtime = { loadExtension: vi.fn(async () => ({ id: 'test' })), removeExtension: vi.fn() };
  const session = { extensions: runtime } as any;
  return { manager: LocalExtensionManager.forSession(session, root), session, runtime, root, extension };
}
describe('local extensions failure consistency', () => {
  it('shares registration across windows and restores a saved extension only once per session', async () => {
    const { manager, session, runtime, root, extension } = fixture();
    fs.mkdirSync(path.join(root, 'browser-data'));
    fs.writeFileSync(path.join(root, 'browser-data/extensions.json'), JSON.stringify([{ directory: extension }]));
    // A different Electron Session represents the next browser process.
    const nextSession = { ...session };
    const firstWindow = LocalExtensionManager.forSession(nextSession, root);
    const secondWindow = LocalExtensionManager.forSession(nextSession, root);
    expect(firstWindow).not.toBe(manager);
    await Promise.all([firstWindow.restore(), secondWindow.restore()]);
    expect(runtime.loadExtension).toHaveBeenCalledExactlyOnceWith(extension, { allowFileAccess: false });
    expect(firstWindow.list()).toHaveLength(1);
    secondWindow.remove('test');
    expect(firstWindow.list()).toEqual([]);
    await firstWindow.restore();
    expect(runtime.loadExtension).toHaveBeenCalledOnce();
  });

  it('retries a concurrent install after an earlier persistence failure rolls back', async () => {
    const { manager, runtime } = fixture();
    vi.spyOn((manager as any).saved, 'set').mockImplementationOnce(() => { throw new Error('Disk full'); });
    const results = await Promise.allSettled([manager.install({} as any), manager.install({} as any)]);
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(runtime.removeExtension).toHaveBeenCalledOnce();
    expect(runtime.loadExtension).toHaveBeenCalledTimes(2);
    expect(manager.list()).toHaveLength(1);
  });

  it('retains the running extension when its removal cannot be saved', async () => {
    const { manager, runtime } = fixture();
    await manager.install({} as any);
    vi.spyOn((manager as any).saved, 'set').mockImplementationOnce(() => { throw new Error('Disk full'); });
    expect(() => manager.remove('test')).toThrow('Disk full');
    expect(runtime.removeExtension).not.toHaveBeenCalled();
    expect(manager.list()).toHaveLength(1);
  });

  it('retains active and durable registration when Electron refuses removal', async () => {
    const { manager, runtime, root } = fixture();
    await manager.install({} as any);
    const registered = fs.readFileSync(path.join(root, 'browser-data/extensions.json'), 'utf8');
    runtime.removeExtension.mockImplementationOnce(() => { throw new Error('Runtime busy'); });
    expect(() => manager.remove('test')).toThrow('Runtime busy');
    expect(manager.list()).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, 'browser-data/extensions.json'), 'utf8')).toBe(registered);
  });
  it('does not unload an already working extension when re-registration cannot be saved', async () => {
    const { manager, runtime } = fixture();
    await manager.install({} as any);
    vi.spyOn((manager as any).saved, 'set').mockImplementationOnce(() => { throw new Error('Disk full'); });
    await expect(manager.install({} as any)).rejects.toThrow('Disk full');
    expect(manager.list()).toHaveLength(1);
    expect(runtime.removeExtension).not.toHaveBeenCalled();
    expect(runtime.loadExtension).toHaveBeenCalledOnce();
  });
  it('rolls back newly loaded code after a failed durable registration', async () => {
    const { manager, runtime } = fixture();
    vi.spyOn((manager as any).saved, 'set').mockImplementationOnce(() => { throw new Error('Disk full'); });
    await expect(manager.install({} as any)).rejects.toThrow('Disk full');
    expect(runtime.removeExtension).toHaveBeenCalledWith('test');
    expect(manager.list()).toEqual([]);
  });
  it('keeps a newly loaded entry visible if the rollback unload also fails', async () => {
    const { manager, runtime } = fixture();
    vi.spyOn((manager as any).saved, 'set').mockImplementationOnce(() => { throw new Error('Disk full'); });
    runtime.removeExtension.mockImplementationOnce(() => { throw new Error('Runtime busy'); });
    await expect(manager.install({} as any)).rejects.toThrow('Disk full');
    expect(manager.list()).toHaveLength(1);
  });
  it('rejects an empty manifest version before loading extension code', async () => {
    const { manager, runtime } = fixture('');
    await expect(manager.install({} as any)).rejects.toThrow('имя или версия');
    expect(runtime.loadExtension).not.toHaveBeenCalled();
  });
});

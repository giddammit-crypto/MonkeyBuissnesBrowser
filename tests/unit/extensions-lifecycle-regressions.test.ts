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
  return { manager: new LocalExtensionManager({ extensions: runtime } as any, root), runtime, root };
}
describe('local extensions failure consistency', () => {
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

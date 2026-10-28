import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterEngine } from '../../src/services/adblock/FilterEngine';
import { BrowsecHealthCheckEngine } from '../../src/services/browsec/BrowsecHealthCheck';
import { BrowsecService } from '../../src/services/browsec/BrowsecService';
vi.mock('electron', () => ({ dialog: {} }));
import { LocalExtensionManager } from '../../src/services/extensions/LocalExtensionManager';

const directories: string[] = [];
const engines: BrowsecHealthCheckEngine[] = [];
afterEach(() => {
  engines.forEach(engine => engine.destroy()); engines.length = 0;
  vi.useRealTimers();
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }));
});
function directory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-resource-'));
  directories.push(root); return root;
}
class Socket extends EventEmitter {
  destroy = vi.fn(() => this);
  write = vi.fn(() => true);
}
function probe(socket = new Socket()) {
  const engine = new BrowsecHealthCheckEngine({ autoStart: false, tlsConnect: (() => socket) as any });
  engines.push(engine);
  return { socket, engine, promise: engine.checkServer({ host: 'probe.example', port: 443 }) };
}

describe('plugin resource and lifecycle regressions', () => {
  it('keeps blocked-host detail bounded while preserving the total', () => {
    const engine = new FilterEngine();
    for (let index = 0; index < 1500; index++) engine.shouldBlock(`https://host${index}.example/ads/banner`, 'image');
    expect(engine.stats().blockedTotal).toBe(1500);
    expect(Object.keys(engine.stats().blockedByHost)).toHaveLength(1024);
  });
  it('matches domain suffix rules without matching lookalike hosts and invalidates exception decisions', () => {
    const engine = new FilterEngine();
    engine.addRule('custom-ad.example');
    expect(engine.shouldBlock('https://sub.custom-ad.example/a', 'image')).toBe(true);
    expect(engine.shouldBlock('https://notcustom-ad.example/a', 'image')).toBe(false);
    const exceptions = ['https://example.com'];
    engine.setExceptions(exceptions);
    exceptions[0] = 'other.test';
    expect(engine.isException('https://sub.example.com/page')).toBe(true);
    engine.setExceptions([]);
    expect(engine.isException('https://sub.example.com/page')).toBe(false);
  });
  it('settles a gracefully closed probe instead of leaving the full check stuck', async () => {
    const { socket, promise } = probe();
    socket.emit('close', false);
    expect(await promise).toBe(false);
    expect(socket.destroy).toHaveBeenCalledOnce();
  });
  it('handles a fragmented successful proxy status line', async () => {
    const { socket, promise } = probe();
    socket.emit('secureConnect');
    socket.emit('data', Buffer.from('HTTP/1.1 2'));
    socket.emit('data', Buffer.from('00 Connection established\r\n\r\n'));
    expect(await promise).toBe(true);
  });
  it('does not accept an error line merely containing 200 elsewhere', async () => {
    const { socket, promise } = probe();
    socket.emit('data', Buffer.from('HTTP/1.1 502 Error upstream-200\r\n\r\n'));
    expect(await promise).toBe(false);
  });
  it('rejects unbounded proxy headers', async () => {
    const { socket, promise } = probe();
    socket.emit('data', Buffer.alloc(8193, 'a'));
    expect(await promise).toBe(false);
  });
  it('destroys active sockets on disposal and settles outstanding promises', async () => {
    const { socket, engine, promise } = probe();
    engine.destroy();
    expect(await promise).toBe(false);
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(engine.getDeadServers().size).toBe(0);
  });
  it('enforces an overall deadline even when the socket never emits timeout', async () => {
    vi.useFakeTimers();
    const { promise } = probe();
    await vi.advanceTimersByTimeAsync(8001);
    expect(await promise).toBe(false);
  });
  it('cancels the Browsec delayed startup check when disposed', async () => {
    vi.useFakeTimers();
    const service = new BrowsecService(directory(), { enableHealthCheck: true, startupDelayMs: 100 });
    const spy = vi.spyOn(service, 'checkServersHealth');
    service.destroy();
    await vi.advanceTimersByTimeAsync(200);
    expect(spy).not.toHaveBeenCalled();
  });
  it('durably persists one health snapshot per completed probe batch', async () => {
    const service = new BrowsecService(directory(), { enableHealthCheck: false });
    vi.spyOn(service.getHealthCheck(), 'checkServer').mockResolvedValue(true);
    const writes = vi.spyOn(fs, 'renameSync');
    try {
      await service.checkServersHealth();
      expect(writes).toHaveBeenCalledTimes(1);
    } finally { writes.mockRestore(); service.destroy(); }
  });
  it('deduplicates concurrent extension loads and never enables local-file access', async () => {
    const root = directory();
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Test', version: '1' }));
    const loadExtension = vi.fn(async () => ({ id: 'test' }));
    const manager = new LocalExtensionManager({ extensions: { loadExtension } } as any, directory());
    const load = (manager as any).load.bind(manager);
    const results = await Promise.all([load(root), load(root)]);
    expect(results[0]).toEqual(results[1]);
    expect(loadExtension).toHaveBeenCalledExactlyOnceWith(root, { allowFileAccess: false });
  });
  it('rejects oversized extension manifests before parsing or loading extension code', async () => {
    const root = directory();
    fs.writeFileSync(path.join(root, 'manifest.json'), ' '.repeat(1024 * 1024 + 1));
    const loadExtension = vi.fn();
    const manager = new LocalExtensionManager({ extensions: { loadExtension } } as any, directory());
    await expect((manager as any).load(root)).rejects.toThrow(/слишком большой/);
    expect(loadExtension).not.toHaveBeenCalled();
  });
});

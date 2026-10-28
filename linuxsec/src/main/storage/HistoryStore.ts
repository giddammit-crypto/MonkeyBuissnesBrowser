import fs from 'node:fs';
import path from 'node:path';

export interface VpnHistoryEntry {
  id: string;
  serverId: string;
  serverName: string;
  protocol: 'wireguard' | 'openvpn';
  startTime: number;
  endTime: number;
  durationMs: number;
  bytesReceived: number;
  bytesSent: number;
  exitStatus: 'normal' | 'error' | 'killswitch_triggered';
  errorMessage?: string;
}

export class HistoryStore {
  private filePath: string;
  private history: VpnHistoryEntry[] = [];
  private maxEntries = 100;

  constructor(baseDir: string) {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    }
    this.filePath = path.join(baseDir, 'history.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.history = parsed;
        }
      }
    } catch (err) {
      console.error('[HistoryStore] Failed to load history:', err);
    }
  }

  public getEntries(): VpnHistoryEntry[] {
    return [...this.history];
  }

  public addEntry(entry: VpnHistoryEntry): void {
    this.history.unshift(entry);
    if (this.history.length > this.maxEntries) {
      this.history = this.history.slice(0, this.maxEntries);
    }
    this.save();
  }

  public clear(): void {
    this.history = [];
    this.save();
  }

  private save(): void {
    try {
      const tempPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(this.history, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error('[HistoryStore] Failed to write history:', err);
    }
  }
}

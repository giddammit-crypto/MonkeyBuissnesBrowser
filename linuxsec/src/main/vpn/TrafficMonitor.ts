import fs from 'node:fs';
import { EventEmitter } from 'node:events';

export interface TrafficSnapshot {
  interfaceName: string;
  bytesReceived: number;
  bytesSent: number;
  downloadSpeedBps: number;
  uploadSpeedBps: number;
}

export class TrafficMonitor extends EventEmitter {
  private intervalTimer?: NodeJS.Timeout;
  private currentIface?: string;
  private lastRxBytes = 0;
  private lastTxBytes = 0;
  private lastTimestamp = 0;
  private pollIntervalMs = 1000;

  public start(interfaceName: string): void {
    this.stop();
    this.currentIface = interfaceName;
    this.lastRxBytes = this.readInterfaceBytes(interfaceName, 'rx');
    this.lastTxBytes = this.readInterfaceBytes(interfaceName, 'tx');
    this.lastTimestamp = Date.now();

    this.intervalTimer = setInterval(() => {
      this.poll();
    }, this.pollIntervalMs);
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
    this.currentIface = undefined;
    this.lastRxBytes = 0;
    this.lastTxBytes = 0;
  }

  private poll(): void {
    if (!this.currentIface) return;

    const now = Date.now();
    const timeDeltaSec = (now - this.lastTimestamp) / 1000;
    if (timeDeltaSec <= 0) return;

    const currentRx = this.readInterfaceBytes(this.currentIface, 'rx');
    const currentTx = this.readInterfaceBytes(this.currentIface, 'tx');

    const rxDelta = Math.max(0, currentRx - this.lastRxBytes);
    const txDelta = Math.max(0, currentTx - this.lastTxBytes);

    const downloadSpeedBps = Math.round(rxDelta / timeDeltaSec);
    const uploadSpeedBps = Math.round(txDelta / timeDeltaSec);

    this.lastRxBytes = currentRx;
    this.lastTxBytes = currentTx;
    this.lastTimestamp = now;

    const snapshot: TrafficSnapshot = {
      interfaceName: this.currentIface,
      bytesReceived: currentRx,
      bytesSent: currentTx,
      downloadSpeedBps,
      uploadSpeedBps,
    };

    this.emit('stats', snapshot);
  }

  private readInterfaceBytes(iface: string, direction: 'rx' | 'tx'): number {
    try {
      const p = `/sys/class/net/${iface}/statistics/${direction}_bytes`;
      if (fs.existsSync(p)) {
        const val = fs.readFileSync(p, 'utf8').trim();
        return parseInt(val, 10) || 0;
      }
    } catch {
      // Ignore if interface is temporarily down
    }
    return 0;
  }
}

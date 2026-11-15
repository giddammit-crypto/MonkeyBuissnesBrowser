export type CaptureKind = 'audio' | 'video';

/** Match Chromium's secure-context exception for loopback development sites. */
export function captureOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return url.origin;
    const host = url.hostname.toLowerCase();
    if (url.protocol === 'http:' && (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host))) return url.origin;
  } catch { /* Opaque and malformed origins cannot receive capture access. */ }
  return undefined;
}

export function isTrustedCaptureUI(url: string, knownContents: boolean): boolean {
  try { const parsed = new URL(url); return knownContents && parsed.protocol === 'app:' && parsed.hostname === 'shell'; }
  catch { return false; }
}

export function captureKinds(permission: string, mediaTypes?: readonly string[]): CaptureKind[] {
  if (permission === 'audioCapture' || permission === 'speechRecognition') return ['audio'];
  if (permission !== 'media' || !mediaTypes?.length || mediaTypes.some(kind => kind !== 'audio' && kind !== 'video')) return [];
  return [...new Set(mediaTypes)] as CaptureKind[];
}

export function captureLabel(kinds: readonly CaptureKind[]): string {
  return kinds.includes('audio') && kinds.includes('video') ? 'микрофону и камере' : kinds.includes('audio') ? 'микрофону' : 'камере';
}

/** Memory-only, independently instantiated for regular and private sessions. */
export class MediaPermissionGrants {
  private readonly revisions = new Map<string, number>();
  private readonly grants = new Map<string, Set<CaptureKind>>();
  private key(top: string, requester: string): string | undefined {
    const a = captureOrigin(top), b = captureOrigin(requester);
    return a && b ? JSON.stringify([a, b]) : undefined;
  }
  has(top: string, requester: string, kinds: readonly CaptureKind[]): boolean {
    const key = this.key(top, requester);
    return Boolean(key && kinds.length && kinds.every(kind => this.grants.get(key)?.has(kind)));
  }
  revision(top: string): number {
    return this.revisions.get(captureOrigin(top) ?? '') ?? 0;
  }
  reset(top: string): void {
    const origin = captureOrigin(top);
    if (!origin) return;
    for (const key of this.grants.keys()) {
      if (JSON.parse(key)[0] === origin) this.grants.delete(key);
    }
    this.revisions.set(origin, this.revision(origin) + 1);
  }
  allow(top: string, requester: string, kinds: readonly CaptureKind[]): void {
    const key = this.key(top, requester);
    if (!key) return;
    const allowed = this.grants.get(key) ?? new Set<CaptureKind>();
    for (const kind of kinds) allowed.add(kind);
    this.grants.set(key, allowed);
  }
}

export async function requestSystemCapture(
  kinds: readonly CaptureKind[],
  platform: string,
  ask: (kind: 'microphone' | 'camera') => Promise<boolean>,
): Promise<boolean> {
  if (platform !== 'darwin') return true;
  try {
    for (const kind of kinds) if (!await ask(kind === 'audio' ? 'microphone' : 'camera')) return false;
    return true;
  } catch { return false; }
}

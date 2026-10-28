import type { WireGuardProfileData } from '../../shared/types';

export class WireGuardParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireGuardParserError';
  }
}

const BASE64_KEY_REGEX = /^[A-Za-z0-9+/]{43}=$/;
const FORBIDDEN_HOOKS = ['preup', 'postup', 'predown', 'postdown', 'table', 'fwmark'];

export function isValidWireGuardKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  return BASE64_KEY_REGEX.test(trimmed);
}

export function parseWireGuardConfig(rawText: string): WireGuardProfileData {
  if (!rawText || typeof rawText !== 'string') {
    throw new WireGuardParserError('Empty or invalid configuration content');
  }

  const lines = rawText.split(/\r?\n/);
  let currentSection = '';

  let privateKey = '';
  const addresses: string[] = [];
  const dnsServers: string[] = [];
  let mtu: number | undefined;

  let publicKey = '';
  let endpoint = '';
  const allowedIps: string[] = [];
  let presharedKey: string | undefined;
  let persistentKeepalive: number | undefined;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    // Remove comments
    const line = rawLine.replace(/[#;].*$/, '').trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([A-Za-z0-9_-]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase();
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) {
      continue;
    }

    const key = line.slice(0, eqIdx).trim().toLowerCase();
    const val = line.slice(eqIdx + 1).trim();

    if (FORBIDDEN_HOOKS.includes(key)) {
      throw new WireGuardParserError(
        `Security violation: WireGuard configuration contains forbidden directive "${key}". Scripts and hooks are not permitted.`
      );
    }

    if (currentSection === 'interface') {
      if (key === 'privatekey') {
        if (!isValidWireGuardKey(val)) {
          throw new WireGuardParserError('Invalid WireGuard PrivateKey format (must be valid 32-byte base64)');
        }
        privateKey = val;
      } else if (key === 'address') {
        const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
        addresses.push(...parts);
      } else if (key === 'dns') {
        const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
        dnsServers.push(...parts);
      } else if (key === 'mtu') {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed) && parsed >= 576 && parsed <= 65535) {
          mtu = parsed;
        }
      }
    } else if (currentSection === 'peer') {
      if (key === 'publickey') {
        if (!isValidWireGuardKey(val)) {
          throw new WireGuardParserError('Invalid WireGuard PublicKey format (must be valid 32-byte base64)');
        }
        publicKey = val;
      } else if (key === 'endpoint') {
        endpoint = val;
      } else if (key === 'allowedips') {
        const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
        allowedIps.push(...parts);
      } else if (key === 'presharedkey') {
        if (isValidWireGuardKey(val)) {
          presharedKey = val;
        }
      } else if (key === 'persistentkeepalive') {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed) && parsed >= 0) {
          persistentKeepalive = parsed;
        }
      }
    }
  }

  if (!privateKey) {
    throw new WireGuardParserError('Missing required [Interface] PrivateKey');
  }
  if (!publicKey) {
    throw new WireGuardParserError('Missing required [Peer] PublicKey');
  }
  if (!endpoint) {
    throw new WireGuardParserError('Missing required [Peer] Endpoint');
  }
  if (addresses.length === 0) {
    throw new WireGuardParserError('Missing required [Interface] Address');
  }
  if (allowedIps.length === 0) {
    allowedIps.push('0.0.0.0/0', '::/0');
  }

  return {
    privateKey,
    address: addresses,
    dns: dnsServers.length > 0 ? dnsServers : undefined,
    publicKey,
    endpoint,
    allowedIps,
    presharedKey,
    persistentKeepalive,
    mtu,
  };
}

export function generateWireGuardConfigText(data: WireGuardProfileData): string {
  const lines: string[] = ['[Interface]'];
  lines.push(`PrivateKey = ${data.privateKey}`);
  lines.push(`Address = ${data.address.join(', ')}`);
  if (data.dns && data.dns.length > 0) {
    lines.push(`DNS = ${data.dns.join(', ')}`);
  }
  if (data.mtu) {
    lines.push(`MTU = ${data.mtu}`);
  }

  lines.push('');
  lines.push('[Peer]');
  lines.push(`PublicKey = ${data.publicKey}`);
  lines.push(`Endpoint = ${data.endpoint}`);
  lines.push(`AllowedIPs = ${data.allowedIps.join(', ')}`);
  if (data.presharedKey) {
    lines.push(`PresharedKey = ${data.presharedKey}`);
  }
  if (data.persistentKeepalive) {
    lines.push(`PersistentKeepalive = ${data.persistentKeepalive}`);
  }

  return lines.join('\n') + '\n';
}

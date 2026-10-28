import type { OpenVpnProfileData } from '../../shared/types';

export class OpenVpnParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenVpnParserError';
  }
}

const FORBIDDEN_OPENVPN_DIRECTIVES = [
  'up',
  'down',
  'route-up',
  'route-pre-down',
  'client-connect',
  'client-disconnect',
  'learn-address',
  'auth-user-pass-verify',
  'tls-verify',
  'ipchange',
  'script-security',
  'plugin',
];

export function parseOpenVpnConfig(rawText: string): OpenVpnProfileData {
  if (!rawText || typeof rawText !== 'string') {
    throw new OpenVpnParserError('Empty or invalid OpenVPN configuration content');
  }

  const lines = rawText.split(/\r?\n/);
  let remoteHost = '';
  let remotePort = 1194;
  let proto: 'udp' | 'tcp' = 'udp';
  let authRequired = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    // Remove comments
    const line = rawLine.replace(/^[#;].*$/, '').trim();
    if (!line) continue;

    // Check words
    const tokens = line.split(/\s+/);
    const directive = tokens[0].toLowerCase();

    if (FORBIDDEN_OPENVPN_DIRECTIVES.includes(directive)) {
      throw new OpenVpnParserError(
        `Security violation: OpenVPN configuration contains forbidden directive "${directive}". External scripts and plugins are not allowed.`
      );
    }

    if (directive === 'remote' && tokens.length >= 2) {
      remoteHost = tokens[1];
      if (tokens.length >= 3) {
        const p = parseInt(tokens[2], 10);
        if (!isNaN(p) && p > 0 && p <= 65535) {
          remotePort = p;
        }
      }
      if (tokens.length >= 4) {
        const pr = tokens[3].toLowerCase();
        if (pr.includes('tcp')) proto = 'tcp';
        else if (pr.includes('udp')) proto = 'udp';
      }
    } else if (directive === 'port' && tokens.length >= 2) {
      const p = parseInt(tokens[1], 10);
      if (!isNaN(p) && p > 0 && p <= 65535) {
        remotePort = p;
      }
    } else if (directive === 'proto' && tokens.length >= 2) {
      const pr = tokens[1].toLowerCase();
      if (pr.includes('tcp')) proto = 'tcp';
      else if (pr.includes('udp')) proto = 'udp';
    } else if (directive === 'auth-user-pass') {
      authRequired = true;
    }
  }

  if (!remoteHost) {
    throw new OpenVpnParserError('Missing required "remote" host in OpenVPN configuration');
  }

  // Extract ca certificate block if present
  let caCert: string | undefined;
  const caMatch = rawText.match(/<ca>([\s\S]*?)<\/ca>/i);
  if (caMatch) {
    caCert = caMatch[1].trim();
  }

  let userCert: string | undefined;
  const certMatch = rawText.match(/<cert>([\s\S]*?)<\/cert>/i);
  if (certMatch) {
    userCert = certMatch[1].trim();
  }

  let userKey: string | undefined;
  const keyMatch = rawText.match(/<key>([\s\S]*?)<\/key>/i);
  if (keyMatch) {
    userKey = keyMatch[1].trim();
  }

  return {
    rawConfig: rawText,
    remoteHost,
    remotePort,
    proto,
    authRequired,
    caCert,
    userCert,
    userKey,
  };
}

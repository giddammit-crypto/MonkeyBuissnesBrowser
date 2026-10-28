import { describe, it, expect } from 'vitest';
import { parseWireGuardConfig, generateWireGuardConfigText, isValidWireGuardKey, WireGuardParserError } from '../../src/main/vpn/WireGuardParser';
import { parseOpenVpnConfig, OpenVpnParserError } from '../../src/main/vpn/OpenVpnParser';

describe('WireGuardParser', () => {
  it('validates 32-byte base64 keys correctly', () => {
    expect(isValidWireGuardKey('aW52YWxpZA==')).toBe(false);
    expect(isValidWireGuardKey('2J5dKxJ+3B9oP9X9wN6j9D9vL1gP1xK1eL0sO8mK2eA=')).toBe(true);
    expect(isValidWireGuardKey('')).toBe(false);
  });

  it('successfully parses a valid WireGuard configuration', () => {
    const conf = `
[Interface]
PrivateKey = 2J5dKxJ+3B9oP9X9wN6j9D9vL1gP1xK1eL0sO8mK2eA=
Address = 10.14.0.2/24, fd00::2/64
DNS = 1.1.1.1, 8.8.8.8
MTU = 1420

[Peer]
PublicKey = 3K6eLyK+4C0pQ0Y0xO7k0E0wM2hQ2yL2fM1tP9nL3fB=
Endpoint = 198.51.100.1:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`;
    const parsed = parseWireGuardConfig(conf);
    expect(parsed.privateKey).toBe('2J5dKxJ+3B9oP9X9wN6j9D9vL1gP1xK1eL0sO8mK2eA=');
    expect(parsed.publicKey).toBe('3K6eLyK+4C0pQ0Y0xO7k0E0wM2hQ2yL2fM1tP9nL3fB=');
    expect(parsed.endpoint).toBe('198.51.100.1:51820');
    expect(parsed.address).toEqual(['10.14.0.2/24', 'fd00::2/64']);
    expect(parsed.dns).toEqual(['1.1.1.1', '8.8.8.8']);
    expect(parsed.mtu).toBe(1420);
    expect(parsed.persistentKeepalive).toBe(25);

    const generated = generateWireGuardConfigText(parsed);
    expect(generated).toContain('[Interface]');
    expect(generated).toContain('[Peer]');
    expect(generated).toContain('Endpoint = 198.51.100.1:51820');
  });

  it('strictly rejects malicious hooks like PostUp and PreUp', () => {
    const malicious = `
[Interface]
PrivateKey = 2J5dKxJ+3B9oP9X9wN6j9D9vL1gP1xK1eL0sO8mK2eA=
Address = 10.14.0.2/24
PostUp = rm -rf /

[Peer]
PublicKey = 3K6eLyK+4C0pQ0Y0xO7k0E0wM2hQ2yL2fM1tP9nL3fB=
Endpoint = 198.51.100.1:51820
AllowedIPs = 0.0.0.0/0
`;
    expect(() => parseWireGuardConfig(malicious)).toThrow(WireGuardParserError);
    expect(() => parseWireGuardConfig(malicious)).toThrow(/forbidden directive "postup"/i);
  });
});

describe('OpenVpnParser', () => {
  it('successfully parses valid OpenVPN configuration', () => {
    const ovpn = `
client
dev tun
proto udp
remote vpn.example.com 1194
resolv-retry infinite
nobind
auth-user-pass
<ca>
-----BEGIN CERTIFICATE-----
MIIBtest
-----END CERTIFICATE-----
</ca>
`;
    const parsed = parseOpenVpnConfig(ovpn);
    expect(parsed.remoteHost).toBe('vpn.example.com');
    expect(parsed.remotePort).toBe(1194);
    expect(parsed.proto).toBe('udp');
    expect(parsed.authRequired).toBe(true);
    expect(parsed.caCert).toContain('-----BEGIN CERTIFICATE-----');
  });

  it('strictly rejects malicious execution directives like up/down/script-security', () => {
    const malicious = `
client
dev tun
remote 1.2.3.4 1194
script-security 2
up /tmp/malicious.sh
`;
    expect(() => parseOpenVpnConfig(malicious)).toThrow(OpenVpnParserError);
    expect(() => parseOpenVpnConfig(malicious)).toThrow(/forbidden directive/i);
  });
});

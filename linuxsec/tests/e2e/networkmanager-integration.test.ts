import { describe, it, expect } from 'vitest';
import { NetworkManagerBackend } from '../../src/main/vpn/NetworkManagerBackend';
import type { ServerProfile } from '../../shared/types';
import { execSync } from 'node:child_process';

describe('NetworkManager Local Integration', () => {
  const backend = new NetworkManagerBackend();

  it('detects NetworkManager availability on the system', async () => {
    const available = await backend.isAvailable();
    expect(available).toBe(true);
  });

  it('imports, inspects, and safely deletes a WireGuard connection without root privileges', async () => {
    // Generate valid WireGuard private and public keys using wg command
    const privKey = execSync('wg genkey').toString().trim();
    const pubKey = execSync(`echo "${privKey}" | wg pubkey`).toString().trim();
    const peerPriv = execSync('wg genkey').toString().trim();
    const peerPub = execSync(`echo "${peerPriv}" | wg pubkey`).toString().trim();

    const profile: ServerProfile = {
      id: 'int-test-wg',
      name: 'Integration Test WG',
      countryCode: 'nl',
      countryName: 'Netherlands',
      flag: '🇳🇱',
      protocol: 'wireguard',
      endpoint: '192.0.2.1:51820',
      wireguard: {
        privateKey: privKey,
        publicKey: peerPub,
        endpoint: '192.0.2.1:51820',
        address: ['10.200.0.2/24'],
        allowedIps: ['0.0.0.0/0'],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 1. Import and prepare
    const result = await backend.importAndPrepareProfile(profile, {
      dnsLeakProtection: true,
      ipv6LeakProtection: true,
    });

    expect(result.connectionId).toMatch(/^lsec_/);

    // 2. Verify connection exists in NetworkManager
    const check = execSync(`nmcli connection show ${result.connectionId}`).toString();
    expect(check).toContain(result.connectionId);
    expect(check).toContain('wireguard');

    // 3. Clean up
    await backend.deleteConnection(result.connectionId);

    // 4. Verify connection is gone
    expect(() => execSync(`nmcli connection show ${result.connectionId}`)).toThrow();
  });
});

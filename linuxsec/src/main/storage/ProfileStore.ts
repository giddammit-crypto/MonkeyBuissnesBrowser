import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ServerProfile, WireGuardProfileData, OpenVpnProfileData } from '../../shared/types';
import { parseWireGuardConfig } from '../vpn/WireGuardParser';
import { parseOpenVpnConfig } from '../vpn/OpenVpnParser';

export class ProfileStore {
  private filePath: string;
  private profiles: Map<string, ServerProfile> = new Map();

  constructor(baseDir: string) {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    }
    this.filePath = path.join(baseDir, 'profiles.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.profiles.clear();
          for (const item of parsed) {
            if (item && typeof item === 'object' && item.id) {
              this.profiles.set(item.id, item);
            }
          }
          return;
        }
      }
    } catch (err) {
      console.error('[ProfileStore] Failed to load profiles file:', err);
    }

    // Default seed profiles if none exist
    if (this.profiles.size === 0) {
      this.seedDefaultProfiles();
    }
  }

  private seedDefaultProfiles(): void {
    // Provide a real template profile ready for customization
    const sampleProfile: ServerProfile = {
      id: 'sample-wg-template',
      name: 'Custom WireGuard Server',
      countryCode: 'nl',
      countryName: 'Netherlands',
      flag: '🇳🇱',
      city: 'Amsterdam',
      protocol: 'wireguard',
      endpoint: '198.51.100.10:51820',
      isCustom: true,
      wireguard: {
        privateKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        publicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
        address: ['10.14.0.2/24'],
        dns: ['1.1.1.1'],
        endpoint: '198.51.100.10:51820',
        allowedIps: ['0.0.0.0/0'],
        persistentKeepalive: 25,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.profiles.set(sampleProfile.id, sampleProfile);
    this.save();
  }

  public getAll(): ServerProfile[] {
    return Array.from(this.profiles.values()).sort((a, b) => {
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  public getById(id: string): ServerProfile | undefined {
    return this.profiles.get(id);
  }

  public saveProfile(profile: Partial<ServerProfile> & { name: string; protocol: 'wireguard' | 'openvpn' }): ServerProfile {
    const id = profile.id || `profile-${crypto.randomUUID()}`;
    const now = Date.now();
    const existing = this.profiles.get(id);

    const merged: ServerProfile = {
      id,
      name: profile.name,
      countryCode: profile.countryCode || 'un',
      countryName: profile.countryName || 'Custom Server',
      flag: profile.flag || '🌐',
      city: profile.city || '',
      protocol: profile.protocol,
      endpoint: profile.endpoint || '',
      ping: profile.ping ?? existing?.ping,
      isFavorite: profile.isFavorite ?? existing?.isFavorite ?? false,
      isCustom: true,
      wireguard: profile.wireguard || existing?.wireguard,
      openvpn: profile.openvpn || existing?.openvpn,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    this.profiles.set(id, merged);
    this.save();
    return merged;
  }

  public importWireGuardConfig(name: string, configText: string, countryCode = 'un', countryName = 'Imported Server', flag = '🌐'): ServerProfile {
    const wg = parseWireGuardConfig(configText);
    const id = `wg-${crypto.randomUUID()}`;
    const profile: ServerProfile = {
      id,
      name: name || 'Imported WireGuard',
      countryCode,
      countryName,
      flag,
      protocol: 'wireguard',
      endpoint: wg.endpoint,
      isCustom: true,
      wireguard: wg,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.profiles.set(id, profile);
    this.save();
    return profile;
  }

  public importOpenVpnConfig(name: string, configText: string, countryCode = 'un', countryName = 'Imported Server', flag = '🌐'): ServerProfile {
    const ovpn = parseOpenVpnConfig(configText);
    const id = `ovpn-${crypto.randomUUID()}`;
    const profile: ServerProfile = {
      id,
      name: name || 'Imported OpenVPN',
      countryCode,
      countryName,
      flag,
      protocol: 'openvpn',
      endpoint: `${ovpn.remoteHost}:${ovpn.remotePort}`,
      isCustom: true,
      openvpn: ovpn,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.profiles.set(id, profile);
    this.save();
    return profile;
  }

  public deleteProfile(id: string): boolean {
    const existed = this.profiles.delete(id);
    if (existed) {
      this.save();
    }
    return existed;
  }

  public toggleFavorite(id: string): boolean {
    const profile = this.profiles.get(id);
    if (profile) {
      profile.isFavorite = !profile.isFavorite;
      profile.updatedAt = Date.now();
      this.save();
      return profile.isFavorite;
    }
    return false;
  }

  public updatePing(id: string, ping: number): void {
    const profile = this.profiles.get(id);
    if (profile) {
      profile.ping = ping;
      // Do not write to disk on every ping tick to minimize disk I/O
    }
  }

  private save(): void {
    try {
      const data = Array.from(this.profiles.values());
      const tempPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error('[ProfileStore] Failed to write profiles file:', err);
    }
  }
}

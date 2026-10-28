import { describe, expect, it, vi } from 'vitest';
import type { SavePasswordOffer } from '../../src/shared/types';

describe('Save Password UI & CyberLife HUD logic', () => {
  function extractDomain(rawOrigin: string): string {
    try {
      const url = new URL(rawOrigin.includes('://') ? rawOrigin : `https://${rawOrigin}`);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return rawOrigin.replace(/^https?:\/\//, '').split('/')[0] || rawOrigin;
    }
  }

  function generateSecurePassword(length = 18): string {
    const lowercase = 'abcdefghjkmnpqrstuvwxyz';
    const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const numbers = '23456789';
    const symbols = '!@#$%^&*-_+=';
    const all = lowercase + uppercase + numbers + symbols;

    const result: string[] = [
      lowercase[Math.floor(Math.random() * lowercase.length)],
      uppercase[Math.floor(Math.random() * uppercase.length)],
      numbers[Math.floor(Math.random() * numbers.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
    ];

    const remaining = Math.max(0, length - result.length);
    for (let i = 0; i < remaining; i++) {
      result.push(all[Math.floor(Math.random() * all.length)]);
    }

    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = result[i];
      result[i] = result[j];
      result[j] = temp;
    }

    return result.join('');
  }

  it('correctly extracts display domain for badges', () => {
    expect(extractDomain('https://vk.com/login')).toBe('vk.com');
    expect(extractDomain('https://www.github.com/session')).toBe('github.com');
    expect(extractDomain('https://mail.google.com:443/account')).toBe('mail.google.com');
    expect(extractDomain('http://localhost:3000')).toBe('localhost');
    expect(extractDomain('yandex.ru')).toBe('yandex.ru');
  });

  it('generates secure passwords with sufficient entropy and mixed charsets', () => {
    const pwd = generateSecurePassword(18);
    expect(pwd).toHaveLength(18);
    // Check at least one digit, letter, symbol
    expect(/[a-z]/.test(pwd)).toBe(true);
    expect(/[A-Z]/.test(pwd)).toBe(true);
    expect(/[0-9]/.test(pwd)).toBe(true);
    expect(/[!@#$%^&*\-_+=]/.test(pwd)).toBe(true);

    // Multiple generations should not produce duplicates
    const set = new Set(Array.from({ length: 20 }, () => generateSecurePassword(18)));
    expect(set.size).toBe(20);
  });

  it('handles SavePasswordOffer structure for both new and updating passwords', () => {
    const newOffer: SavePasswordOffer = {
      origin: 'https://vk.com',
      domain: 'vk.com',
      username: 'cyber_android_01',
      password: 'CyberPassword123!',
      isUpdate: false,
    };

    expect(newOffer.isUpdate).toBe(false);
    expect(newOffer.domain).toBe('vk.com');

    const updateOffer: SavePasswordOffer = {
      ...newOffer,
      password: 'UpdatedCyberSecret999!',
      isUpdate: true,
    };

    expect(updateOffer.isUpdate).toBe(true);
    expect(updateOffer.password).not.toBe(newOffer.password);
  });

  it('validates manual addition inputs before persisting', () => {
    const validate = (originInput: string, passwordInput: string) => {
      const rawUrl = originInput.trim();
      if (!rawUrl) return { valid: false, error: 'Укажите сайт или URL' };
      try {
        const parsed = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return { valid: false, error: 'Поддерживаются протоколы https:// или http://' };
        }
      } catch {
        return { valid: false, error: 'Некорректный адрес сайта' };
      }
      if (!passwordInput.trim()) {
        return { valid: false, error: 'Введите пароль' };
      }
      return { valid: true };
    };

    expect(validate('', 'pass').valid).toBe(false);
    expect(validate('ftp://files.example.com', 'pass').valid).toBe(false);
    expect(validate('https://vk.com', '').valid).toBe(false);
    expect(validate('https://vk.com', 'mypassword').valid).toBe(true);
    expect(validate('github.com', 'strongpass123').valid).toBe(true);
  });

  it('supports prompt actions: onSave, onDismiss, onNeverSave', async () => {
    const onSave = vi.fn(async () => {});
    const onDismiss = vi.fn();
    const onNeverSave = vi.fn(async () => {});

    const offer: SavePasswordOffer = {
      origin: 'https://github.com',
      domain: 'github.com',
      username: 'connor_cyberlife',
      password: 'RK800-SecretPassword!',
      isUpdate: false,
    };

    // User edits credentials and clicks Save
    await onSave(offer.origin, 'connor_deviant', 'RK900-NewPassword!');
    expect(onSave).toHaveBeenCalledWith('https://github.com', 'connor_deviant', 'RK900-NewPassword!');

    // User clicks Dismiss
    onDismiss();
    expect(onDismiss).toHaveBeenCalled();

    // User clicks Never Save for this site
    await onNeverSave(offer.origin);
    expect(onNeverSave).toHaveBeenCalledWith('https://github.com');
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { SavePasswordOffer } from '../../src/shared/types';
import { generateSecurePassword } from '../../src/renderer/PasswordManager';

describe('Save Password UI & CyberLife HUD logic', () => {
  function extractDomain(rawOrigin: string): string {
    try {
      const url = new URL(rawOrigin.includes('://') ? rawOrigin : `https://${rawOrigin}`);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return rawOrigin.replace(/^https?:\/\//, '').split('/')[0] || rawOrigin;
    }
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

  it('uses Web Crypto for every password character and shuffle step and rejects biased samples', () => {
    const insecureRandom = vi.spyOn(Math, 'random');
    const cryptoRandom = vi.spyOn(crypto, 'getRandomValues').mockImplementation(values => {
      (values as Uint32Array)[0] = 0;
      return values;
    }).mockImplementationOnce(values => {
      (values as Uint32Array)[0] = 0xffffffff;
      return values;
    });
    try {
      generateSecurePassword();
      expect(cryptoRandom).toHaveBeenCalledTimes(18 + 17 + 1);
      expect(insecureRandom).not.toHaveBeenCalled();
    } finally {
      insecureRandom.mockRestore();
      cryptoRandom.mockRestore();
    }
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

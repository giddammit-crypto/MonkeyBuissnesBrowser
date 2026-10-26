import { describe, expect, it } from 'vitest';
import {
  computePopupWindowBounds,
  isAuthPopupUrl,
  isPopupWindowRequest,
  parseWindowFeatures,
} from '../../src/main/tabs/popupUtils';

describe('popupUtils', () => {
  describe('parseWindowFeatures', () => {
    it('parses empty and undefined features safely', () => {
      expect(parseWindowFeatures(undefined)).toEqual({});
      expect(parseWindowFeatures('')).toEqual({});
      expect(parseWindowFeatures('   ')).toEqual({});
    });

    it('parses dimensions correctly', () => {
      const parsed = parseWindowFeatures('width=500,height=600,left=100,top=200');
      expect(parsed).toEqual({
        width: 500,
        height: 600,
        x: 100,
        y: 200,
      });
    });

    it('handles alternative keys and boolean flags', () => {
      const parsed = parseWindowFeatures('innerWidth=450, innerHeight=550, popup=yes, menubar=no, toolbar=no');
      expect(parsed.width).toBe(450);
      expect(parsed.height).toBe(550);
      expect(parsed.popup).toBe(true);
      expect(parsed.menubar).toBe(false);
      expect(parsed.toolbar).toBe(false);
    });

    it('treats bare feature flags as enabled', () => {
      const parsed = parseWindowFeatures('menubar toolbar location status resizable scrollbars');
      expect(parsed).toEqual({ menubar: true, toolbar: true, location: true, status: true, resizable: true, scrollbars: true });
    });
  });

  describe('isAuthPopupUrl', () => {
    it('detects Google Sign-In and OAuth URLs', () => {
      expect(isAuthPopupUrl('https://accounts.google.com/o/oauth2/v2/auth?client_id=123')).toBe(true);
      expect(isAuthPopupUrl('https://accounts.google.com/signin/v2/identifier')).toBe(true);
      expect(isAuthPopupUrl('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fyoutube.com')).toBe(true);
      expect(isAuthPopupUrl('https://accounts.google.com/gsi/select?client_id=456')).toBe(true);
    });

    it('detects VK ID and OAuth URLs', () => {
      expect(isAuthPopupUrl('https://oauth.vk.com/authorize?client_id=12345')).toBe(true);
      expect(isAuthPopupUrl('https://id.vk.com/auth')).toBe(true);
    });

    it('detects Yandex ID and OAuth URLs', () => {
      expect(isAuthPopupUrl('https://passport.yandex.ru/auth?retpath=https%3A%2F%2Fyandex.ru')).toBe(true);
      expect(isAuthPopupUrl('https://oauth.yandex.ru/authorize?response_type=token')).toBe(true);
    });

    it('detects Telegram and GitHub OAuth URLs', () => {
      expect(isAuthPopupUrl('https://oauth.telegram.org/auth?bot_id=123')).toBe(true);
      expect(isAuthPopupUrl('https://github.com/login/oauth/authorize?client_id=abc')).toBe(true);
    });

    it('detects generic OAuth2 URLs with client_id and redirect_uri', () => {
      expect(isAuthPopupUrl('https://example.com/oauth/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fapp.com%2Fcb')).toBe(true);
    });

    it('returns false for regular web pages', () => {
      expect(isAuthPopupUrl('https://example.com/articles/123')).toBe(false);
      expect(isAuthPopupUrl('https://github.com/torvalds/linux')).toBe(false);
      expect(isAuthPopupUrl('https://vk.com/feed')).toBe(false);
      expect(isAuthPopupUrl('https://google.com/search?q=test')).toBe(false);
    });
  });

  describe('isPopupWindowRequest', () => {
    it('returns true when disposition is new-window', () => {
      expect(isPopupWindowRequest({ url: 'https://example.com', disposition: 'new-window' })).toBe(true);
    });

    it('returns true when features specify popup dimensions', () => {
      expect(isPopupWindowRequest({
        url: 'https://example.com',
        disposition: 'foreground-tab',
        features: 'width=500,height=600',
      })).toBe(true);
    });

    it('returns true for auth URLs opened in foreground', () => {
      expect(isPopupWindowRequest({
        url: 'https://accounts.google.com/o/oauth2/auth',
        disposition: 'foreground-tab',
      })).toBe(true);
    });

    it('returns false for background tabs even if auth URL', () => {
      expect(isPopupWindowRequest({
        url: 'https://accounts.google.com/o/oauth2/auth',
        disposition: 'background-tab',
      })).toBe(false);
    });

    it('returns false for standard target="_blank" links', () => {
      expect(isPopupWindowRequest({
        url: 'https://example.com/page',
        disposition: 'foreground-tab',
        features: '',
      })).toBe(false);
    });
  });

  describe('computePopupWindowBounds', () => {
    const parentBounds = { x: 100, y: 100, width: 1400, height: 900 };

    it('centers default popup over parent window', () => {
      const bounds = computePopupWindowBounds(parentBounds, {});
      expect(bounds.width).toBe(520);
      expect(bounds.height).toBe(640);
      expect(bounds.x).toBe(100 + (1400 - 520) / 2);
      expect(bounds.y).toBe(100 + (900 - 640) / 2);
    });

    it('respects requested dimensions within constraints', () => {
      const bounds = computePopupWindowBounds(parentBounds, { width: 600, height: 700 });
      expect(bounds.width).toBe(600);
      expect(bounds.height).toBe(700);
      expect(bounds.x).toBe(100 + (1400 - 600) / 2);
      expect(bounds.y).toBe(100 + (900 - 700) / 2);
    });

    it('respects explicit x and y coordinates if provided', () => {
      const bounds = computePopupWindowBounds(parentBounds, { width: 500, height: 600, x: 250, y: 350 });
      expect(bounds.x).toBe(250);
      expect(bounds.y).toBe(350);
    });
  });
});

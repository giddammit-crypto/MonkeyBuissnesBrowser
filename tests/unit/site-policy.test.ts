import { describe, expect, it } from 'vitest';
import { canRequestStorageAccess, getExternalPageUrl, getGoogleAuthNotice, getSiteKey, isGoogleYouTubeSignInRequest, normalizeCookieExceptions, shouldStripThirdPartyCookies } from '../../src/shared/sitePolicy';
const policy = (requestUrl: string, topLevelUrl: string, extra = {}) => shouldStripThirdPartyCookies({ requestUrl, topLevelUrl, resourceType: 'xhr', isPrivate: false, enabled: true, ...extra });
describe('site-aware cookie policy', () => {
  it('keeps search engine login subdomains same-site', () => {
    expect(policy('https://accounts.google.com/session','https://www.google.com/search?q=test')).toBe(false);
    expect(policy('https://passport.yandex.ru/auth','https://yandex.ru/')).toBe(false);
    expect(policy('https://consent.youtube.com/save','https://www.youtube.com/')).toBe(false);
    expect(policy('https://auth.example.co.uk/session','https://www.example.co.uk/')).toBe(false);
  });
  it('blocks actual third parties, private PSL tenants and scheme changes', () => {
    expect(policy('https://tracker.com','https://www.youtube.com')).toBe(true);
    expect(policy('https://accounts.google.com','https://accounts.google.com.evil.test')).toBe(true);
    expect(policy('https://one.github.io','https://two.github.io')).toBe(true);
    expect(policy('http://example.com','https://example.com')).toBe(true);
    expect(policy('https://tracker.com','about:blank')).toBe(true);
  });
  it('allows explicit exceptions only in normal browsing and does not affect navigations', () => {
    expect(policy('https://accounts.google.com','https://www.youtube.com',{exceptions:['https://youtube.com']})).toBe(false);
    expect(policy('https://accounts.google.com','https://www.youtube.com',{isPrivate:true,exceptions:['https://youtube.com']})).toBe(true);
    expect(policy('https://accounts.google.com','https://www.youtube.com',{resourceType:'mainFrame'})).toBe(false);
    expect(policy('https://tracker.com','https://www.youtube.com',{enabled:false})).toBe(false);
  });
  it('normalizes exceptions and handles loopback / IDN without widening hosts', () => {
    expect(getSiteKey('https://ПРИМЕР.РФ/path')).toBe('https://xn--e1afmkfd.xn--p1ai');
    expect(getSiteKey('http://127.0.0.1:8080/path')).toBe('http://127.0.0.1');
    expect(normalizeCookieExceptions(['https://www.youtube.com/path','https://youtube.com','javascript:alert(1)',42])).toEqual(['https://youtube.com']);
  });
  it('preserves only the HTTPS Google/YouTube account hand-off in normal browsing', () => {
    for (const [request, top] of [
      ['https://accounts.google.com/RotateCookies', 'https://www.youtube.com/'],
      ['https://accounts.youtube.com/CheckConnection', 'https://accounts.google.com/'],
      ['https://www.youtube.com/accounts/SetSID', 'https://accounts.google.com/'],
      ['https://accounts.google.com/ListAccounts', 'https://music.youtube.com/'],
    ]) {
      expect(isGoogleYouTubeSignInRequest(request, top)).toBe(true);
      expect(policy(request, top)).toBe(false);
      expect(policy(request, top, {googleSignInCompatibility: false})).toBe(true);
      expect(policy(request, top, {isPrivate: true})).toBe(true);
    }
  });
  it('does not widen sign-in compatibility to trackers, lookalikes or all YouTube content', () => {
    for (const [request, top] of [
      ['https://doubleclick.net/', 'https://www.youtube.com/'],
      ['https://accounts.google.com/', 'https://attacker.test/'],
      ['https://accounts.google.com.attacker.test/', 'https://www.youtube.com/'],
      ['https://accounts.google.com/', 'https://youtube.com.attacker.test/'],
      ['http://accounts.google.com/', 'https://www.youtube.com/'],
      ['https://accounts.google.com:8443/', 'https://www.youtube.com/'],
      ['https://user:pass@accounts.google.com/', 'https://www.youtube.com/'],
      ['https://www.youtube.com/youtubei/v1/browse', 'https://www.google.com/'],
      ['https://www.youtube.com/accounts-evil/SetSID', 'https://accounts.google.com/'],
    ]) {
      expect(isGoogleYouTubeSignInRequest(request, top)).toBe(false);
      expect(policy(request, top)).toBe(true);
    }
  });
  it('permits requesting storage access only in eligible secure normal contexts', () => {
    const input = {requestUrl:'https://accounts.google.com/',topLevelUrl:'https://www.youtube.com/',isPrivate:false};
    expect(canRequestStorageAccess(input)).toBe(true);
    expect(canRequestStorageAccess({...input,isPrivate:true})).toBe(false);
    expect(canRequestStorageAccess({...input,googleSignInCompatibility:false})).toBe(false);
    expect(canRequestStorageAccess({...input,topLevelUrl:'https://attacker.test/'})).toBe(false);
    expect(canRequestStorageAccess({...input,topLevelUrl:'https://custom.test/',exceptions:['https://custom.test']})).toBe(true);
    expect(canRequestStorageAccess({...input,requestUrl:'data:text/html,test'})).toBe(false);
  });
});
describe('Google auth help and explicit external navigation', () => {
  it('recognizes rejected login versions and OAuth but not unrelated hosts', () => {
    expect(getGoogleAuthNotice('https://accounts.google.com/v3/signin/rejected?continue=x')?.title).toContain('ограничил');
    expect(getGoogleAuthNotice('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')).not.toBeNull();
    expect(getGoogleAuthNotice('https://accounts.google.com/ServiceLogin?service=youtube')?.message).toContain('совместимости');
    expect(getGoogleAuthNotice('https://www.google.com/search?q=unsafe')).toBeNull();
    expect(getGoogleAuthNotice('https://accounts.google.com.evil.test/signin/rejected')).toBeNull();
  });
  it('opens a fresh supported sign-in entry for rejected YouTube logins without copying hostile continue URLs', () => {
    expect(getExternalPageUrl('https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fwww.youtube.com%2F')).toBe('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.youtube.com%2F');
    expect(getExternalPageUrl('https://accounts.google.com/signin/rejected?continue=https://evil.test')).not.toContain('evil.test');
    expect(getExternalPageUrl('javascript:alert(1)')).toBeNull();
    expect(getExternalPageUrl('https://username:password@example.com')).toBeNull();
  });
});

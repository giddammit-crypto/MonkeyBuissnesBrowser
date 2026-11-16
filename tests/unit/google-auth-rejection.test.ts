import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ ipcRenderer: { send: vi.fn() } }));
import { isInlineGoogleAuthRejection } from '../../src/preload/page-preload';
import { getExternalPageUrl, getGoogleAuthNotice } from '../../src/shared/sitePolicy';

it('recognizes inline Google rejection at a normal login URL in English and Russian', () => {
  for (const text of ['This browser or app may not be secure.', 'This browser or app\nmay not be secure.', 'Этот браузер или приложение могут быть небезопасными.', 'Возможно, этот браузер или приложение небезопасны.']) {
    expect(isInlineGoogleAuthRejection('https://accounts.google.com/v3/signin/challenge/pwd', text)).toBe(true);
  }
  expect(isInlineGoogleAuthRejection('https://accounts.google.com/ServiceLogin', 'Sign in securely to your account')).toBe(false);
});

it('does not promote lookalikes, insecure origins, ports, or ordinary login pages to a Google refusal', () => {
  for (const url of ['http://accounts.google.com', 'https://accounts.google.com.evil.test', 'https://accounts.google.com:8443', 'https://user@accounts.google.com', 'https://example.com']) {
    expect(isInlineGoogleAuthRejection(url, 'This browser or app may not be secure')).toBe(false);
    expect(getGoogleAuthNotice(url, true)).toBeNull();
  }
  expect(getGoogleAuthNotice('https://accounts.google.com/ServiceLogin')).toBeNull();
});

it('offers a fresh known-service URL for inline refusal without replaying challenge secrets', () => {
  const url = 'https://accounts.google.com/v3/signin/challenge/pwd?service=mail&TL=secret&continue=https://evil.test';
  expect(getGoogleAuthNotice(url, true)?.title).toContain('отклонил');
  expect(getExternalPageUrl(url, true)).toBe('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmail.google.com%2F');
  expect(getExternalPageUrl('https://example.com/login', true)).toBe('https://example.com/login');
});

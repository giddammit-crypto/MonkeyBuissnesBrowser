import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { CREDENTIAL_WORLD, fillSavedCredential, getCredentialOrigin } from '../../src/main/passwords/PasswordAutofill';

function setup() {
  const contents = Object.assign(new EventEmitter(), {
    url: 'https://login.example.test/signin', mainFrame: {}, destroyed: false,
    getURL() { return this.url; }, isDestroyed() { return this.destroyed; },
    executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValueOnce({ eligible: true, filled: false }).mockResolvedValue({ filled: true, ignored: 'not part of API' }),
  });
  const store = {
    summaries: vi.fn(() => [{ id: 'credential', origin: 'https://login.example.test', username: 'user' }]),
    getForOrigin: vi.fn(() => ({ username: 'user', password: 'fake-test-password' })),
  };
  return { contents, store, input: { contents: contents as never, store: store as never, passwordId: 'credential', isCurrent: () => true, confirm: vi.fn(async () => true) } };
}

describe('credential origin policy', () => {
  it('matches exact HTTPS origin including ports and rejects HTTP, userinfo and unsupported schemes', () => {
    expect(getCredentialOrigin('https://example.test:444/login')).toBe('https://example.test:444');
    expect(getCredentialOrigin('https://EXAMPLE.test/login')).toBe('https://example.test');
    for (const url of ['http://example.test', 'https://user:pass@example.test/login', 'file:///x', 'javascript:bad']) expect(getCredentialOrigin(url)).toBeNull();
  });
});

describe('explicit main-process credential fill', () => {
  it('probes first, confirms, then retrieves the exact origin secret and returns only status', async () => {
    const { contents, store, input } = setup();
    input.confirm.mockImplementation(async () => { expect(store.getForOrigin).not.toHaveBeenCalled(); return true; });
    const result = await fillSavedCredential(input);
    expect(result).toEqual({ filled: true });
    expect(store.getForOrigin).toHaveBeenCalledWith('credential', 'https://login.example.test');
    expect(contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2);
    expect(contents.executeJavaScriptInIsolatedWorld.mock.calls[0][0]).toBe(CREDENTIAL_WORLD);
    expect(contents.executeJavaScriptInIsolatedWorld.mock.calls[0][1][0].code).not.toContain('fake-test-password');
    expect(contents.listenerCount('did-start-navigation')).toBe(0);
    expect(JSON.stringify(result)).not.toContain('password');
  });
  it('does not retrieve a secret when native confirmation is declined or visible form probe fails', async () => {
    const first = setup(); first.input.confirm.mockResolvedValue(false);
    expect(await fillSavedCredential(first.input)).toMatchObject({ filled: false });
    expect(first.store.getForOrigin).not.toHaveBeenCalled();
    const second = setup(); second.contents.executeJavaScriptInIsolatedWorld.mockReset().mockResolvedValue({ filled: false, reason: 'No visible form' });
    expect(await fillSavedCredential(second.input)).toMatchObject({ filled: false });
    expect(second.input.confirm).not.toHaveBeenCalled();
    expect(second.store.getForOrigin).not.toHaveBeenCalled();
  });
  it('rejects other-origin credential IDs before a native prompt or DOM probe', async () => {
    const { input, store, contents } = setup();
    store.summaries.mockReturnValue([{ id: 'credential', origin: 'https://other.example.test', username: 'user' }]);
    await expect(fillSavedCredential(input)).rejects.toThrow('нет выбранной записи');
    expect(input.confirm).not.toHaveBeenCalled();
    expect(contents.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  });
  it('blocks a navigation away and back during confirmation even when the final URL matches', async () => {
    const { input, contents, store } = setup();
    input.confirm.mockImplementation(async () => { contents.emit('did-start-navigation', { isMainFrame: true }); return true; });
    await expect(fillSavedCredential(input)).rejects.toThrow('изменились');
    expect(store.getForOrigin).not.toHaveBeenCalled();
    expect(contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(1);
  });
  it('blocks changed active tab/contents and sanitizes execution errors instead of exposing injected secrets', async () => {
    const first = setup(); let current = true;
    first.input.isCurrent = () => current;
    first.input.confirm.mockImplementation(async () => { current = false; return true; });
    await expect(fillSavedCredential(first.input)).rejects.toThrow('изменились');
    expect(first.store.getForOrigin).not.toHaveBeenCalled();
    const second = setup();
    second.contents.executeJavaScriptInIsolatedWorld.mockReset().mockResolvedValueOnce({ eligible: true }).mockRejectedValueOnce(new Error('fake-test-password'));
    try { await fillSavedCredential(second.input); throw new Error('Expected rejection'); }
    catch (error) { expect((error as Error).message).not.toContain('fake-test-password'); }
  });
});

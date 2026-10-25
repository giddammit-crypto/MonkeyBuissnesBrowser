import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

// No Google traffic, credentials or trusted production certificates are used.
// Exact fixture names are remapped to one LOCAL port; all other DNS names fail.
// Certificate bypass and proxy disabling below apply only to this temporary test.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-youtube-cookie-e2e-'));
// Generate a new disposable localhost key for this run. No key is distributed in
// the repository or reused across runs; neither file enters a trust store.
const keyPath = path.join(dataPath, 'localhost-key.pem');
const certPath = path.join(dataPath, 'localhost-cert.pem');
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
    { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  fs.chmodSync(keyPath, 0o600);
} catch (error) {
  fs.rmSync(dataPath, { recursive: true, force: true });
  throw new Error('The local HTTPS test requires OpenSSL on PATH to generate a disposable certificate.', { cause: error });
}
const hosts = ['accounts.google.com', 'accounts.youtube.com', 'www.youtube.com', 'youtube.com', 'www.google.com', 'attacker.test'];
const origins = new Set(hosts.map(host => `https://${host}`));
const received = [];
const checks = [];
const shellErrors = [];
const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, (req, res) => {
  const host = (req.headers.host ?? '').split(':')[0];
  if (!hosts.includes(host)) { res.writeHead(400); res.end('Unknown fixture host'); return; }
  const url = new URL(req.url, `https://${host}`);
  received.push({ host, path: url.pathname, query: Object.fromEntries(url.searchParams), cookie: req.headers.cookie ?? '', origin: req.headers.origin ?? '', site: req.headers['sec-fetch-site'] ?? '' });
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (origins.has(req.headers.origin)) { headers['access-control-allow-origin'] = req.headers.origin; headers['access-control-allow-credentials'] = 'true'; }
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }
  if (url.pathname === '/echo' || url.pathname.startsWith('/accounts/')) {
    const name = url.searchParams.get('responseCookie');
    if (!name || !/^[a-zA-Z0-9_]+$/.test(name)) { res.writeHead(400); res.end('Bad test cookie'); return; }
    headers['content-type'] = 'application/json';
    headers['set-cookie'] = `${name}=accepted; Path=/; SameSite=None; Secure`;
    res.writeHead(200, headers);
    res.end(JSON.stringify({ host, cookie: req.headers.cookie ?? '', site: req.headers['sec-fetch-site'] ?? '' }));
    return;
  }
  res.writeHead(200, headers);
  if (url.pathname === '/bridge') {
    res.end(`<!doctype html><meta charset="utf-8"><title>Local auth frame</title><button id="storage-access">Request fixture storage access</button><output id="storage-result"></output><script>
      window.addEventListener('message', async (event) => {
        if (event.source !== parent || !${JSON.stringify([...origins])}.includes(event.origin) || event.data?.type !== 'fixture-probe') return;
        try { const response = await fetch(event.data.url, {credentials:'include'}); parent.postMessage({type:'fixture-reply',id:event.data.id,result:await response.json()},event.origin); }
        catch(error) { parent.postMessage({type:'fixture-reply',id:event.data.id,error:String(error)},event.origin); }
      });
      document.getElementById('storage-access').onclick = async () => {
        const output = document.getElementById('storage-result');
        try { if(typeof document.requestStorageAccess !== 'function') { output.textContent='unsupported'; return; } await document.requestStorageAccess(); output.textContent='granted'; }
        catch(error) { output.textContent='denied:'+error.name; }
      };
    </script>`);
  } else res.end('<!doctype html><meta charset="utf-8"><title>Local YouTube flow fixture</title><h1>Local HTTPS browser cookie fixture</h1>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
let app;
let shell;
let serial = 0;
const check = async (name, fn) => { await fn(); checks.push(name); console.log(`PASS ${name}`); };
const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
const snapshot = () => invoke('getSnapshot');
const nativeContents = (tabUrl, operation, argument) => app.evaluate(async ({ webContents }, { tabUrl, operation, argument }) => {
  const contents = webContents.getAllWebContents().find(contents => contents.getURL() === tabUrl);
  if (!contents) throw new Error(`No fixture tab: ${tabUrl}`);
  if (operation === 'script') return contents.executeJavaScript(argument, true);
  if (operation === 'set-cookie') return contents.session.cookies.set(argument);
  if (operation === 'cookies') return contents.session.cookies.get(argument);
  throw new Error('Unsupported test operation');
}, { tabUrl, operation, argument });
const createTab = async (host, isPrivate = false) => {
  const url = `https://${host}/top?run=${++serial}`;
  const tab = await invoke('createTab', { url, isPrivate });
  await expect.poll(async () => (await snapshot()).tabs.find(entry => entry.id === tab.id), { timeout: 15000 }).toMatchObject({ url, isLoading: false, title: 'Local YouTube flow fixture' });
  return { ...tab, url };
};
const seed = async (tab, host, token) => {
  const name = `seed_${token}`;
  await nativeContents(tab.url, 'set-cookie', { url: `https://${host}/`, name, value: 'fixture', path: '/', secure: true, sameSite: 'no_restriction' });
  return name;
};
const fetchProbe = async (tab, host, token, { nested = false, pathname = '/echo' } = {}) => {
  const responseCookie = `response_${token}`;
  const url = `https://${host}${pathname}?case=${token}&responseCookie=${responseCookie}`;
  let result;
  if (nested) {
    const bridge = `https://accounts.youtube.com/bridge?run=${++serial}`;
    result = await nativeContents(tab.url, 'script', `new Promise((resolve,reject)=>{
      const frame=document.createElement('iframe'); frame.src=${JSON.stringify(bridge)}; frame.style.cssText='width:480px;height:110px'; document.body.append(frame);
      const id=${JSON.stringify(token)}; const timer=setTimeout(()=>{frame.remove();reject(new Error('Nested cookie probe timeout'));},10000);
      const listener=event=>{if(event.source!==frame.contentWindow||event.origin!=='https://accounts.youtube.com'||event.data?.type!=='fixture-reply'||event.data.id!==id)return; clearTimeout(timer);window.removeEventListener('message',listener);frame.remove();event.data.error?reject(new Error(event.data.error)):resolve(event.data.result);};
      window.addEventListener('message',listener);frame.onload=()=>frame.contentWindow.postMessage({type:'fixture-probe',id,url:${JSON.stringify(url)}},'https://accounts.youtube.com');
    })`);
  } else result = await nativeContents(tab.url, 'script', `fetch(${JSON.stringify(url)}, {credentials:'include'}).then(response=>response.json())`);
  const saved = await nativeContents(tab.url, 'cookies', { url: `https://${host}/`, name: responseCookie });
  const request = received.find(entry => entry.query.case === token);
  assert(request, 'HTTPS fixture must actually receive the request');
  assert.equal(request.host, host);
  assert.equal(result.host, host);
  return { result, saved, request };
};
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, cwd: root, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--ignore-certificate-errors', '--no-proxy-server',
    `--host-resolver-rules=${hosts.map(host => `MAP ${host} 127.0.0.1:${port}`).join(', ')}, MAP * ~NOTFOUND`,
    `--user-data-dir=${dataPath}`, '.',
  ], timeout: 30000 });
  shell = await app.firstWindow();
  shell.on('pageerror', error => shellErrors.push(error.message));
  await shell.waitForSelector('.app-shell');
  assert.equal((await snapshot()).settings.googleSignInCompatibility, true, 'normal profile compatibility must be enabled by default');
  await invoke('updateSettings', { blockThirdPartyCookies: true, thirdPartyCookieExceptions: [], googleSignInCompatibility: true });
  const normal = await createTab('www.youtube.com');
  await check('real HTTPS Cookie and Set-Cookie exchange with accounts.google.com under YouTube', async () => {
    const token = `direct_${++serial}`;
    const name = await seed(normal, 'accounts.google.com', token);
    const probe = await fetchProbe(normal, 'accounts.google.com', token);
    assert(probe.result.cookie.includes(`${name}=fixture`), 'Google auth cookie should reach local fixture');
    assert.equal(probe.request.site, 'cross-site');
    assert.equal(probe.saved.length, 1, 'Google auth response cookie should persist');
    assert.equal(probe.saved[0].sameSite, 'no_restriction');
    assert.equal(probe.saved[0].secure, true);
    assert.equal(probe.saved[0].hostOnly, true);
  });
  await check('nested accounts.youtube.com frame uses actual YouTube top frame for Google auth cookie exchange', async () => {
    const token = `nested_${++serial}`;
    const name = await seed(normal, 'accounts.google.com', token);
    const probe = await fetchProbe(normal, 'accounts.google.com', token, { nested: true });
    assert(probe.result.cookie.includes(`${name}=fixture`));
    assert.equal(probe.saved.length, 1);
    assert.equal(probe.request.origin, 'https://accounts.youtube.com');
  });
  await check('unrelated third-party Cookie and Set-Cookie remain blocked with Google compatibility enabled', async () => {
    const token = `outsider_${++serial}`;
    const name = await seed(normal, 'attacker.test', token);
    const probe = await fetchProbe(normal, 'attacker.test', token);
    assert(!probe.result.cookie.includes(name));
    assert.equal(probe.saved.length, 0);
  });
  await check('disabling compatibility blocks Google cross-site Cookie and Set-Cookie without deleting first-party cookies', async () => {
    await invoke('updateSettings', { googleSignInCompatibility: false });
    const token = `disabled_${++serial}`;
    const name = await seed(normal, 'accounts.google.com', token);
    const probe = await fetchProbe(normal, 'accounts.google.com', token);
    assert(!probe.result.cookie.includes(name));
    assert.equal(probe.saved.length, 0);
    assert.equal((await nativeContents(normal.url, 'cookies', { url: 'https://accounts.google.com/', name })).length, 1);
    await invoke('updateSettings', { googleSignInCompatibility: true });
  });
  await check('private profile ignores normal compatibility and isolates Google cookies', async () => {
    const privateTab = await createTab('www.youtube.com', true);
    const normalCookies = await nativeContents(normal.url, 'cookies', { url: 'https://accounts.google.com/' });
    assert(normalCookies.length > 0);
    assert.equal((await nativeContents(privateTab.url, 'cookies', { url: 'https://accounts.google.com/' })).length, 0);
    const token = `private_${++serial}`;
    const name = await seed(privateTab, 'accounts.google.com', token);
    const probe = await fetchProbe(privateTab, 'accounts.google.com', token);
    assert(!probe.result.cookie.includes(name));
    assert.equal(probe.saved.length, 0);
    assert.equal((await nativeContents(normal.url, 'cookies', { url: 'https://accounts.google.com/', name })).length, 0);
    await invoke('closePrivateTabs');
  });
  const reverse = await createTab('www.google.com');
  await check('reverse Google-to-YouTube auth exchange permits only designated accounts endpoints', async () => {
    for (const [host, pathname] of [['accounts.youtube.com', '/echo'], ['www.youtube.com', '/accounts/SetSID'], ['youtube.com', '/accounts/CheckConnection']]) {
      const token = `reverse_${++serial}`;
      const name = await seed(reverse, host, token);
      const probe = await fetchProbe(reverse, host, token, { pathname });
      assert(probe.result.cookie.includes(`${name}=fixture`), `${host}${pathname}: request cookie missing`);
      assert.equal(probe.saved.length, 1, `${host}${pathname}: response cookie missing`);
    }
    const token = `unrelated_youtube_${++serial}`;
    const name = await seed(reverse, 'www.youtube.com', token);
    const probe = await fetchProbe(reverse, 'www.youtube.com', token);
    assert(!probe.result.cookie.includes(name), 'reverse YouTube requests outside /accounts/ must remain blocked');
    assert.equal(probe.saved.length, 0);
  });
  // Exercise the web API through a real trusted click when the Chromium backend
  // actually routes Storage Access through Electron's permission handlers.
  const storageAccessDiagnostics = [];
  await app.evaluate(({ dialog }) => {
    globalThis.__fixtureNativeDialog = dialog.showMessageBox;
    globalThis.__fixtureStoragePrompts = [];
    globalThis.__fixtureStorageResponse = 1;
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1);
      globalThis.__fixtureStoragePrompts.push({ title: options.title, message: options.message });
      return { response: globalThis.__fixtureStorageResponse, checkboxChecked: false };
    };
  });
  try {
    for (const [label, topHost, host, isPrivate, response] of [
      ['eligible-deny', 'www.google.com', 'accounts.youtube.com', false, 0],
      ['eligible-allow', 'www.youtube.com', 'accounts.google.com', false, 1],
      ['outsider-deny', 'www.youtube.com', 'attacker.test', false, 1],
      ['private-deny', 'www.youtube.com', 'accounts.google.com', true, 1],
    ]) {
      const tab = await createTab(topHost, isPrivate);
      await app.evaluate((_electron, response) => { globalThis.__fixtureStorageResponse = response; }, response);
      const promptCount = await app.evaluate(() => globalThis.__fixtureStoragePrompts.length);
      await nativeContents(tab.url, 'script', `new Promise(resolve=>{const frame=document.createElement('iframe');frame.dataset.storageFixture='true';frame.style.cssText='width:560px;height:120px';frame.onload=()=>resolve();frame.src=${JSON.stringify(`https://${host}/bridge?storage=${++serial}`)};document.body.append(frame);})`);
      await expect.poll(() => app.context().pages().some(page => page.url() === tab.url)).toBe(true);
      const page = app.context().pages().find(page => page.url() === tab.url);
      await page.frameLocator('iframe[data-storage-fixture]').locator('#storage-access').click();
      const output = page.frameLocator('iframe[data-storage-fixture]').locator('#storage-result');
      await expect.poll(() => output.textContent()).not.toBe('');
      const result = await output.textContent();
      const prompts = await app.evaluate(() => globalThis.__fixtureStoragePrompts.length);
      storageAccessDiagnostics.push({ label, result, promptCount: prompts - promptCount });
      if (isPrivate) await invoke('closePrivateTabs'); else await invoke('closeTab', tab.id);
    }
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = globalThis.__fixtureNativeDialog; });
  }
  const allowedStorage = storageAccessDiagnostics.find(entry => entry.label === 'eligible-allow');
  if (allowedStorage.promptCount > 0) {
    assert.equal(allowedStorage.result, 'granted', 'eligible trusted request should reach and honor native permission dialog');
    for (const diagnostic of storageAccessDiagnostics.filter(entry => entry.label !== 'eligible-allow')) {
      assert(diagnostic.result.startsWith('denied:'), `${diagnostic.label} Storage Access request must be denied`);
      assert.equal(diagnostic.promptCount, diagnostic.label === 'eligible-deny' ? 1 : 0, 'only eligible pairs should prompt; native denial must be honored');
    }
    checks.push('Storage Access trusted iframe clicks honor native allow/deny and reject outsider/private frames');
    console.log(`PASS ${checks.at(-1)}`);
  } else console.log('SKIP Storage Access native permission assertion: Chromium did not invoke the Electron permission dialog; actual cookie restrictions above still verified.');
  assert.deepEqual(shellErrors, []);
  console.log(JSON.stringify({ ok: true, checks, fixtureRequests: received.length, storageAccessDiagnostics, uncaughtShellErrors: shellErrors, network: 'Exact owned hostnames remapped to local HTTPS only; unmatched DNS fails; no live Google login or credentials tested.' }, null, 2));
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dataPath, { recursive: true, force: true });
}

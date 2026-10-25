import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

// Only disposable local HTTPS fixtures and fake credentials are used. The system
// keyring and native user decisions are stubbed; browser IPC, vault, origin guards,
// isolated-world DOM fill, navigation, form events and persistence are real.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-password-manager-e2e-'));
const keyPath = path.join(dataPath, 'localhost-key.pem');
const certPath = path.join(dataPath, 'localhost-cert.pem');
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  fs.chmodSync(keyPath, 0o600);
} catch (error) {
  fs.rmSync(dataPath, { recursive: true, force: true });
  throw new Error('The password-manager HTTPS test requires OpenSSL on PATH.', { cause: error });
}
const loginOrigin = 'https://login.fixture.test';
const otherOrigin = 'https://other.fixture.test';
const fakeUsername = 'fixture-user';
const fakePassword = 'only-a-disposable-fixture-password';
const filePath = path.join(dataPath, 'fake-passwords.csv');
fs.writeFileSync(filePath, `url,username,password\n${loginOrigin}/login,${fakeUsername},${fakePassword}\n${otherOrigin}/login,other-user,other-fake-password\n`);
const handle = (req, res) => {
  const url = new URL(req.url, loginOrigin);
  const title = 'Password manager fixture';
  const action = url.pathname === '/cross-action' ? `${otherOrigin}/session` : '/session';
  let form = `<form id="login-form" method="post" action="${action}"><label>Login <input id="login" name="username" autocomplete="username"></label><label>Password <input id="secret" type="password" name="password" autocomplete="current-password"></label><button type="submit">Sign in</button></form>`;
  if (url.pathname === '/iframe') form = '<iframe id="login-frame" src="/login" style="width:700px;height:220px"></iframe>';
  if (url.pathname === '/signup') form = '<form method="post" action="/session"><input autocomplete="username"><input type="password" autocomplete="new-password"><input type="password" autocomplete="new-password"></form>';
  if (url.pathname === '/hidden') form = '<form method="post" action="/session"><input name="username"><input type="password" style="display:none"></form>';
  const tamper = url.pathname === '/tampered' ? `const nativeValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');Object.defineProperty(HTMLInputElement.prototype,'value',{configurable:true,get:nativeValue.get,set(value){window.mainWorldSetterCalled=true;nativeValue.set.call(this,value);}});` : '';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{margin:30px;background:white;color:black}form{display:grid;gap:16px;width:440px}label{display:grid;gap:6px}input{height:30px;font:16px sans-serif}button{height:34px}</style><h1>Local login fixture</h1>${form}<script>window.fixtureSubmitCount=0;window.mainWorldSetterCalled=false;document.addEventListener('submit',event=>{event.preventDefault();window.fixtureSubmitCount++;});${tamper}</script>`);
};
const secure = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, handle);
const plain = http.createServer(handle);
secure.listen(0, '127.0.0.1'); plain.listen(0, '127.0.0.1');
await Promise.all([once(secure, 'listening'), once(plain, 'listening')]);
let app, shell;
const checks = [], errors = [];
const check = async (name, fn) => { await fn(); checks.push(name); console.log(`PASS ${name}`); };
const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
const snapshot = () => invoke('getSnapshot');
const pageScript = (url, code) => app.evaluate(({ webContents }, { url, code }) => {
  const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url);
  if (!contents) throw new Error('Fixture tab not found');
  return contents.executeJavaScript(code, true);
}, { url, code });
const create = async (pathname = '/login', options = {}) => {
  const url = options.url || `${loginOrigin}${pathname}?run=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tab = await invoke('createTab', { url, isPrivate: Boolean(options.isPrivate) });
  await expect.poll(async () => (await snapshot()).tabs.find(entry => entry.id === tab.id), { timeout: 15000 }).toMatchObject({ url, isLoading: false, title: 'Password manager fixture' });
  await invoke('setChromeBounds', { x: 180, y: 130, width: 1100, height: 700 });
  return { ...tab, url };
};
const values = tab => pageScript(tab.url, `({username:document.querySelector('#login')?.value||'',password:document.querySelector('#secret')?.value||'',submits:window.fixtureSubmitCount,mainSetter:window.mainWorldSetterCalled})`);
const mode = (value, url) => app.evaluate((_electron, {value,url}) => { globalThis.__passwordFixtureDecision = value; if(url) globalThis.__passwordFixtureTargetUrl=url; }, {value,url});
const safeRejection = async task => {
  let result;
  try { result = await task(); }
  catch (error) { assert(!String(error.message).includes(fakePassword)); return; }
  assert.equal(result.filled, false); assert(!JSON.stringify(result).includes(fakePassword));
};
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, cwd: root, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--ignore-certificate-errors', '--no-proxy-server', `--host-resolver-rules=MAP login.fixture.test 127.0.0.1:${secure.address().port}, MAP other.fixture.test 127.0.0.1:${secure.address().port}, MAP http.fixture.test 127.0.0.1:${plain.address().port}, MAP * ~NOTFOUND`, `--user-data-dir=${dataPath}`, '.',
  ] });
  shell = await app.firstWindow(); shell.on('pageerror', error => errors.push(error.message));
  await shell.waitForSelector('.app-shell');
  await app.evaluate(({ safeStorage, dialog, webContents }, filePath) => {
    const crypto = process.getBuiltinModule('node:crypto');
    const key = crypto.randomBytes(32);
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret';
    safeStorage.encryptString = value => { const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',key,iv); const bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return Buffer.concat([iv,cipher.getAuthTag(),bytes]); };
    safeStorage.decryptString = value => { const decipher=crypto.createDecipheriv('aes-256-gcm',key,value.subarray(0,12));decipher.setAuthTag(value.subarray(12,28));return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8'); };
    globalThis.__passwordFixtureDecision = 'allow'; globalThis.__passwordFixturePrompts = [];
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    dialog.showMessageBox = async (...args) => {
      const options=args.at(-1); globalThis.__passwordFixturePrompts.push({title:options.title,message:options.message,detail:options.detail});
      const decision=globalThis.__passwordFixtureDecision;
      if(options.title==='Заполнить сохранённый пароль'&&decision==='navigate') {
        const contents=webContents.getAllWebContents().find(contents=>contents.getURL()===globalThis.__passwordFixtureTargetUrl);
        await contents.loadURL('https://other.fixture.test/login?changed-during-confirmation');
      }
      return {response:decision==='cancel'?0:1,checkboxChecked:false};
    };
  }, filePath);
  const report = await invoke('importBrowserFile', 'passwords');
  assert.equal(report.imported, 2);
  const records = await invoke('getImportedPasswordSummaries');
  const saved = records.find(record => record.origin === loginOrigin);
  const other = records.find(record => record.origin === otherOrigin);
  assert(saved && other);
  await check('metadata and persisted vault do not expose passwords to the shell or plaintext files', async () => {
    assert(!JSON.stringify(records).includes(fakePassword));
    assert(!fs.readFileSync(path.join(dataPath, 'browser-data/passwords.enc'), 'utf8').includes(fakePassword));
    assert(!JSON.stringify(await snapshot()).includes(fakePassword));
  });
  await check('explicit exact-origin HTTPS fill uses native setters and never submits the form', async () => {
    const tab = await create('/tampered');
    assert.deepEqual(await values(tab), { username: '', password: '', submits: 0, mainSetter: false });
    const result = await invoke('fillSavedPassword', tab.id, saved.id);
    assert.deepEqual(result, { filled: true });
    const actual = await values(tab);
    assert.equal(actual.username, fakeUsername); assert.equal(actual.password, fakePassword);
    assert.equal(actual.submits, 0); assert.equal(actual.mainSetter, false, 'main-world overridden setters must not run');
    assert.equal(await pageScript(tab.url, 'typeof window.browserApi'), 'undefined');
    await app.evaluate(({ webContents }, url) => { const prefs=webContents.getAllWebContents().find(contents=>contents.getURL()===url).getLastWebPreferences();if(prefs.nodeIntegration||!prefs.contextIsolation||!prefs.sandbox)throw new Error('Unsafe web preferences'); }, tab.url);
  });
  await check('Settings password-manager UI returns to visible site, confirms, fills and reports without shell plaintext', async () => {
    const tab = await create();
    const before = await app.evaluate(() => globalThis.__passwordFixturePrompts.length);
    await shell.getByRole('button', {name:'Настройки',exact:true}).first().click();
    const manager = shell.locator('[data-password-manager]');
    await expect(manager).toBeVisible();
    const record = manager.locator('.password-record').filter({hasText:loginOrigin});
    await expect(record).toHaveCount(1);
    assert(!(await manager.textContent()).includes(fakePassword));
    await record.getByRole('button',{name:'Заполнить на сайте',exact:true}).click();
    await expect(shell.locator('[data-password-manager]')).toHaveCount(0);
    await expect.poll(async () => (await values(tab)).password).toBe(fakePassword);
    assert.equal((await values(tab)).submits,0);
    await expect(shell.locator('.app-toast')).toContainText('Поля заполнены. Браузер не нажимает кнопку входа.');
    assert(!(await shell.locator('body').textContent()).includes(fakePassword));
    const prompts = await app.evaluate(() => globalThis.__passwordFixturePrompts);
    assert(prompts.length > before, 'native confirmation must be part of the UI flow');
    assert.equal(prompts.at(-1).title,'Заполнить сохранённый пароль');
    assert(!JSON.stringify(prompts).includes(fakePassword));
  });
  await check('native value normalization rolls both fields back without input/change events or false success', async () => {
    const originalCsv=fs.readFileSync(filePath,'utf8');
    const csv=value=>`"${value.replaceAll('"','""')}"`;
    for(const [username,password,email] of [['newline-user','line one\nline two',false],['  mail@example.test  ','valid-password',true]]) {
      fs.writeFileSync(filePath,`url,username,password\n${loginOrigin},${csv(username)},${csv(password)}\n`);
      const report=await invoke('importBrowserFile','passwords'); assert.equal(report.imported,1);
      const record=(await invoke('getImportedPasswordSummaries')).find(record=>record.username===username);
      const tab=await create();
      await pageScript(tab.url,`document.querySelector('#login').type=${JSON.stringify(email?'email':'text')};document.querySelector('#login').value='before@example.test';document.querySelector('#secret').value='before-password';window.fixtureInputEvents=0;document.querySelector('form').addEventListener('input',()=>window.fixtureInputEvents++);document.querySelector('form').addEventListener('change',()=>window.fixtureInputEvents++);`);
      const result=await invoke('fillSavedPassword',tab.id,record.id);
      assert.equal(result.filled,false); assert(result.reason.includes('восстановлены'));
      const actual=await values(tab); assert.equal(actual.username,'before@example.test'); assert.equal(actual.password,'before-password');
      assert.equal(await pageScript(tab.url,'window.fixtureInputEvents'),0);
      assert.equal(await invoke('deleteSavedPassword',record.id),true);
    }
    fs.writeFileSync(filePath,originalCsv);
  });
  await check('submit-button formaction overrides, external buttons and image submitters cannot bypass exact-origin guard', async () => {
    const attacks=[
      `document.querySelector('button[type=submit]').setAttribute('formaction',${JSON.stringify(`${otherOrigin}/session`)})`,
      `document.querySelector('button[type=submit]').removeAttribute('type');document.querySelector('button').setAttribute('formaction',${JSON.stringify(`${otherOrigin}/session`)})`,
      `document.querySelector('form').insertAdjacentHTML('afterend','<button form="login-form" formaction="${otherOrigin}/session">External submit</button>')`,
      `document.querySelector('form').insertAdjacentHTML('afterend','<input type="image" form="login-form" formaction="${otherOrigin}/session">')`,
    ];
    for(const code of attacks) {
      const tab=await create(); await pageScript(tab.url,code);
      const result=await invoke('fillSavedPassword',tab.id,saved.id);
      assert.equal(result.filled,false); assert(result.reason.includes('другой адрес')); assert.equal((await values(tab)).password,'');
    }
    const normal=await create(); await pageScript(normal.url,`document.querySelector('button').setAttribute('formaction','/another-session')`);
    assert.equal((await invoke('fillSavedPassword',normal.id,saved.id)).filled,true);
  });
  await check('site input handlers may submit independently; fill does not promise that the site stayed idle', async () => {
    const tab=await create();
    await pageScript(tab.url,`document.querySelector('#secret').addEventListener('change',()=>document.querySelector('form').requestSubmit())`);
    assert.equal((await invoke('fillSavedPassword',tab.id,saved.id)).filled,true);
    assert.equal((await values(tab)).submits,1,'the site may react to normal input/change events, even without a browser submit call');
  });
  await check('native cancellation leaves fields empty and a different-origin credential ID is rejected', async () => {
    const tab = await create(); await mode('cancel');
    const result = await invoke('fillSavedPassword', tab.id, saved.id); assert.equal(result.filled, false);
    assert.equal((await values(tab)).password, '');
    await mode('allow');
    await safeRejection(() => invoke('fillSavedPassword', tab.id, other.id));
    assert.equal((await values(tab)).password, '');
  });
  await check('private, HTTP, iframe, hidden, signup and cross-origin-action forms receive no credential', async () => {
    for (const pathname of ['/iframe', '/hidden', '/signup', '/cross-action']) {
      const tab = await create(pathname);
      await safeRejection(() => invoke('fillSavedPassword', tab.id, saved.id));
      assert.equal(await pageScript(tab.url, `[...document.querySelectorAll('input[type=password]')].some(field=>field.value.length>0)`), false);
      if (pathname === '/iframe') assert.equal(await pageScript(tab.url, `document.querySelector('iframe').contentDocument.querySelector('input[type=password]').value`), '');
    }
    const privateTab = await create('/login', { isPrivate: true });
    await safeRejection(() => invoke('fillSavedPassword', privateTab.id, saved.id)); assert.equal((await values(privateTab)).password, '');
    const httpTab = await create('/login', { url: 'http://http.fixture.test/login' });
    await safeRejection(() => invoke('fillSavedPassword', httpTab.id, saved.id)); assert.equal((await values(httpTab)).password, '');
  });
  await check('navigation during native confirmation cancels fill before a password reaches another origin', async () => {
    const tab = await create(); await mode('navigate', tab.url);
    await safeRejection(() => invoke('fillSavedPassword', tab.id, saved.id));
    await expect.poll(async () => (await snapshot()).tabs.find(entry => entry.id === tab.id)?.url).toBe(`${otherOrigin}/login?changed-during-confirmation`);
    assert.equal(await pageScript(`${otherOrigin}/login?changed-during-confirmation`, `document.querySelector('#secret').value`), '');
    await mode('allow');
  });
  await check('native deletion confirmation is honored and deleted records cannot be filled', async () => {
    await mode('cancel'); assert.equal(await invoke('deleteSavedPassword', saved.id), false);
    assert((await invoke('getImportedPasswordSummaries')).some(record => record.id === saved.id));
    await mode('allow'); assert.equal(await invoke('deleteSavedPassword', saved.id), true);
    assert(!(await invoke('getImportedPasswordSummaries')).some(record => record.id === saved.id));
    const tab = await create(); await safeRejection(() => invoke('fillSavedPassword', tab.id, saved.id)); assert.equal((await values(tab)).password, '');
  });
  await check('locked or damaged vault shows an error instead of an empty list and refresh recovers without changing records', async () => {
    await shell.getByRole('button',{name:'Настройки',exact:true}).first().click();
    const manager=shell.locator('[data-password-manager]');
    await expect(manager.locator('.password-record')).toHaveCount(1);
    const vault=path.join(dataPath,'browser-data/passwords.enc'); const backup=fs.readFileSync(vault);
    const refresh=manager.getByRole('button',{name:'Обновить список паролей',exact:true});
    await app.evaluate(({safeStorage})=>{safeStorage.isEncryptionAvailable=()=>false;});
    await refresh.click();
    await expect(manager.getByRole('alert')).toContainText('Список паролей сейчас недоступен');
    await expect(manager.locator('.password-record')).toHaveCount(0);
    assert(!(await manager.innerText()).includes('Сохранённых записей пока нет'));
    assert(!(await manager.innerText()).includes('В хранилище: 0'));
    assert.deepEqual(fs.readFileSync(vault),backup);
    await app.evaluate(({safeStorage})=>{safeStorage.isEncryptionAvailable=()=>true;});
    fs.writeFileSync(vault,'damaged-local-fixture');
    await refresh.click();
    await expect(manager.getByRole('alert')).toContainText('Список паролей сейчас недоступен');
    assert.equal(fs.readFileSync(vault,'utf8'),'damaged-local-fixture');
    fs.writeFileSync(vault,backup); await refresh.click();
    await expect(manager.getByRole('alert')).toHaveCount(0);
    await expect(manager.locator('.password-record')).toHaveCount(1);
    assert((await invoke('getImportedPasswordSummaries')).some(record=>record.id===other.id));
    assert.deepEqual(fs.readFileSync(vault),backup);
  });
  const prompts = await app.evaluate(() => globalThis.__passwordFixturePrompts);
  assert(!JSON.stringify(prompts).includes(fakePassword)); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks, uncaughtShellErrors: errors, limitations: 'Local fake credentials; temporary test keyring and native confirmation decisions are stubbed. No Google/account login tested.' }, null, 2));
} finally {
  if (app) await app.close();
  secure.closeAllConnections(); plain.closeAllConnections();
  await Promise.all([new Promise(resolve => secure.close(resolve)), new Promise(resolve => plain.close(resolve))]);
  fs.rmSync(dataPath, { recursive: true, force: true });
}

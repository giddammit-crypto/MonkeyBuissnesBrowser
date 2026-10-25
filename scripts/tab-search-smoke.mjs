import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-tab-search-'));
const titles = new Map([
  ['/alpha', 'Alpha library'], ['/beta', 'Beta engineering'], ['/private', 'PRIVATE SECRET'],
  ['/left', 'Left ordinary'], ['/reference', 'Reference ordinary'], ['/pinned', 'Pinned ordinary'],
  ['/right', 'Right ordinary'], ['/other-workspace', 'Other workspace ordinary'], ['/private-peer', 'Private peer'],
]);
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://fixture.test').pathname;
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<title>${titles.get(pathname) || 'Local fixture'}</title><h1>${titles.get(pathname) || 'Local fixture'}</h1><p>needle needle needle galaxy galaxy</p><input aria-label="Draft">`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const primary = process.platform === 'darwin' ? 'meta' : 'control';
let app;
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    `--user-data-dir=${profile}`, '.',
  ] });
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  const snapshot = () => invoke('getSnapshot');
  const create = async (pathname, isPrivate = false) => {
    const tab = await invoke('createTab', { url: `${base}${pathname}`, isPrivate });
    await expect.poll(async () => (await snapshot()).tabs.find(entry => entry.id === tab.id)?.isLoading).toBe(false);
    return tab;
  };
  const nativeKey = (url, keyCode, modifiers) => app.evaluate(({ webContents }, { url, keyCode, modifiers }) => {
    const contents = webContents.getAllWebContents().find(entry => entry.getURL() === url);
    if (!contents) throw new Error('Missing active fixture');
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }, { url, keyCode, modifiers });
  const dialog = () => shell.getByRole('dialog', { name: 'Поиск по вкладкам', exact: true });
  const input = () => dialog().getByRole('searchbox', { name: 'Поиск по названию или адресу вкладки' });
  for(let index=0;index<8;index++)await create(`/overflow-${index}`);
  const alpha = await create('/alpha');
  await nativeKey(`${base}/alpha`, 'L', [primary]);
  await shell.getByRole('tab', { name:'Alpha library',exact:true }).focus();
  await shell.keyboard.press('Home');
  assert.equal((await snapshot()).activeTabId,alpha.id,'arrow navigation must not steal focus into a native page');
  await shell.keyboard.press('End');
  await expect(shell.getByRole('tab',{name:'Alpha library',exact:true})).toBeFocused();
  await shell.keyboard.press('ArrowLeft');
  assert.equal(await shell.evaluate(()=>document.activeElement?.getAttribute('role')),'tab');
  await shell.keyboard.press('Enter');
  await expect.poll(async()=>(await snapshot()).activeTabId).not.toBe(alpha.id);
  await invoke('activateTab',alpha.id);
  console.log('PASS tab-strip Home/End/arrows keep focus and Enter activates a native page');
  const secondWorkspace = await invoke('createWorkspace', 'Second workspace');
  await invoke('switchWorkspace', secondWorkspace.id);
  const longPath = `/beta?unique-only-url=${'complete-address-'.repeat(24)}end`;
  const beta = await create(longPath);
  const privateTab = await create('/private', true);
  await invoke('activateTab', alpha.id);

  await nativeKey(`${base}/alpha`, 'A', [primary, 'shift']);
  await expect(dialog()).toBeVisible();
  await expect(input()).toBeFocused();
  await expect.poll(()=>dialog().locator('.tab-search-row.is-current').evaluate(row=>{const bounds=row.getBoundingClientRect();const viewport=row.closest('.tab-search-results').getBoundingClientRect();return bounds.top>=viewport.top-1&&bounds.bottom<=viewport.bottom+1;})).toBe(true);
  assert((await dialog().innerText()).includes('Beta engineering'), 'search includes normal tabs in other workspaces');
  assert.equal((await dialog().innerText()).includes('PRIVATE SECRET'), false, 'normal search must not reveal private titles');
  const viewportWidth = await app.evaluate(({ BaseWindow }, url) => {
    const view = BaseWindow.getAllWindows()[0].contentView.children.find(entry => entry.webContents?.getURL() === url);
    return view?.getBounds().width;
  }, `${base}/alpha`);
  assert.equal(viewportWidth, 0, 'native website must not cover the modal');
  await input().fill('unique-only-url');
  await expect(dialog().locator('.tab-search-row')).toHaveCount(1);
  assert.equal(await dialog().locator('.tab-search-url').innerText(), `${base}${longPath}`, 'full URL remains available without application truncation');
  await input().press('ArrowDown');
  await expect(dialog().locator('.tab-search-activate')).toBeFocused();
  await dialog().locator('.tab-search-activate').press('Enter');
  await expect(dialog()).toHaveCount(0);
  await expect.poll(async () => (await snapshot()).activeTabId).toBe(beta.id);
  console.log('PASS native Ctrl+Shift+A, all-workspace mode filtering, full URL search and arrow/Enter activation');

  await shell.getByRole('button', { name: 'Поиск по вкладкам', exact: true }).click();
  await input().fill('Alpha library');
  await dialog().getByRole('button', { name: 'Закрыть вкладку Alpha library', exact: true }).click();
  await expect.poll(async () => (await snapshot()).tabs.some(entry => entry.id === alpha.id)).toBe(false);
  await expect(dialog().locator('.tab-search-empty')).toBeVisible();
  await input().press('Escape');
  await expect(dialog()).toHaveCount(0);
  await invoke('activateTab', privateTab.id);
  await nativeKey(`${base}/private`, 'A', [primary, 'shift']);
  await expect(dialog()).toBeVisible();
  assert((await dialog().innerText()).includes('PRIVATE SECRET'));
  assert.equal((await dialog().innerText()).includes('Beta engineering'), false);
  await input().fill('Beta engineering');
  await expect(dialog().locator('.tab-search-empty')).toBeVisible();
  await dialog().getByRole('button', { name: 'Закрыть поиск по вкладкам', exact: true }).focus();
  await shell.keyboard.press('Shift+Tab');
  assert.equal(await shell.evaluate(() => Boolean(document.activeElement?.closest('.tab-search-dialog'))), true, 'keyboard focus stays in modal');
  await shell.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  await nativeKey(`${base}/private`, 'Tab', [primary]);
  assert.equal((await snapshot()).activeTabId, privateTab.id, 'Ctrl+Tab does not cross normal/private modes');
  console.log('PASS close result, empty state, Escape/focus trap, private filtering and same-mode tab cycling');

  await invoke('activateTab', beta.id);
  const thirdWorkspace = await invoke('createWorkspace', 'Other workspace');
  await invoke('switchWorkspace', thirdWorkspace.id);
  const otherWorkspace = await create('/other-workspace');
  await invoke('switchWorkspace', 'personal');
  const left = await create('/left');
  const reference = await create('/reference');
  const pinned = await create('/pinned');
  await invoke('tabAction', pinned.id, 'pin');
  const right = await create('/right');
  const privatePeer = await create('/private-peer', true);
  await invoke('closeRelatedTabs', reference.id, 'right');
  let ids = new Set((await snapshot()).tabs.map(entry => entry.id));
  assert.equal(ids.has(right.id), false);
  for (const preserved of [left, reference, pinned, privatePeer, otherWorkspace]) assert(ids.has(preserved.id));
  await invoke('closeRelatedTabs', reference.id, 'others');
  ids = new Set((await snapshot()).tabs.map(entry => entry.id));
  assert.equal(ids.has(left.id), false);
  for (const preserved of [reference, pinned, privatePeer, otherWorkspace]) assert(ids.has(preserved.id));
  await invoke('activateTab', reference.id);
  console.log('PASS bulk close right/others stays in mode+workspace and preserves pinned/reference tabs');

  await app.evaluate(({Menu})=>{
    globalThis.__originalTabMenuBuilder=Menu.buildFromTemplate;
    Menu.buildFromTemplate=function(template){const menu=globalThis.__originalTabMenuBuilder.call(this,template);globalThis.__lastTabMenu=menu;return menu;};
  });
  await invoke('showTabMenu',reference.id);
  const menuItems=await app.evaluate(()=>{
    globalThis.__lastTabMenu.closePopup();
    return globalThis.__lastTabMenu.items.map(item=>({label:item.label,enabled:item.enabled,checked:item.checked}));
  });
  for(const label of ['Закрепить вкладку','Отключить звук','Дублировать вкладку','Закрыть вкладку','Закрыть вкладки справа','Закрыть другие вкладки','Открыть закрытую вкладку'])assert(menuItems.some(item=>item.label===label));
  await app.evaluate(()=>globalThis.__lastTabMenu.items.find(item=>item.label==='Отключить звук').click());
  await expect.poll(async()=>(await snapshot()).tabs.find(entry=>entry.id===reference.id)?.isMuted).toBe(true);
  await invoke('showTabMenu',privatePeer.id);
  assert.equal(await app.evaluate(()=>{globalThis.__lastTabMenu.closePopup();return globalThis.__lastTabMenu.items.find(item=>item.label==='Открыть закрытую вкладку').enabled;}),false);
  await app.evaluate(({Menu})=>{Menu.buildFromTemplate=globalThis.__originalTabMenuBuilder;delete globalThis.__lastTabMenu;});
  console.log('PASS native tab context menu fixed actions/callback and private reopen protection');


  await shell.evaluate(() => { window.__findEvents = []; window.__removeFindListener = window.browserApi.onTabEvent(event => { if (event.type === 'find-result') window.__findEvents.push(event.message); }); });
  await invoke('findInPage', reference.id, 'needle');
  await expect.poll(() => shell.evaluate(() => window.__findEvents.at(-1))).toBe('1 / 3');
  await invoke('findInPage', reference.id, 'needle');
  await expect.poll(() => shell.evaluate(() => window.__findEvents.at(-1))).toBe('2 / 3');
  await invoke('findInPage', reference.id, 'galaxy');
  await expect.poll(() => shell.evaluate(() => window.__findEvents.at(-1))).toBe('1 / 2');
  await invoke('stopFindInPage', reference.id);
  await shell.evaluate(() => window.__removeFindListener());
  const webSecurity = await app.evaluate(({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find(entry => entry.getURL() === url);
    return contents.executeJavaScript('({bridge:typeof window.browserApi,node:typeof require})');
  }, `${base}/reference`);
  assert.deepEqual(webSecurity, { bridge: 'undefined', node: 'undefined' });
  console.log('PASS new/repeated find query behavior and website cannot access renderer IPC bridge/Node');
  console.log(JSON.stringify({ ok: true, groups: 6 }));
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}

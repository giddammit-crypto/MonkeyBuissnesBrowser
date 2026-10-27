import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

// Self-contained integration suite: no running browser, CDP port or internet required.
const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-browser-e2e-'));
const receivedHeaders = [];
const server = http.createServer((req, res) => {
  receivedHeaders.push({ url: req.url, headers: req.headers });
  if (req.url.startsWith('/download')) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="fixture.txt"', 'content-length': '14' });
    res.end('SOUL download\n');
  } else if (req.url.startsWith('/slow')) {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="slow.bin"', 'content-length': 1024 * 1024 });
    const timer = setInterval(() => res.write(Buffer.alloc(1024)), 20);
    res.on('close', () => clearInterval(timer));
  } else {
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': `test=${req.url.startsWith('/private') ? 'private' : 'normal'}; Path=/; SameSite=Lax` });
    res.end(`<html><head><title>${req.url.startsWith('/second') ? 'Second fixture' : 'Browser fixture'}</title></head><body><h1>SOUL browser fixture</h1><p>Find this needle.</p><input aria-label="Draft"><a href="/second">Next</a><a href="/popup" target="_blank" rel="opener">Popup</a><a href="/download">Download</a></body></html>`);
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let app;
let shell;
const errors = [];
const passed = [];
const check = async (name, fn) => { await fn(); passed.push(name); console.log(`PASS ${name}`); };
const snapshot = () => shell.evaluate(() => window.browserApi.getSnapshot());
const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
const waitTab = async (id, predicate) => {
  await expect.poll(async () => (await snapshot()).tabs.find(t => t.id === id), { timeout: 15000 }).toMatchObject(predicate);
};
const content = async (urlPart, expression) => app.evaluate(({webContents}, {urlPart, expression}) => {
  const c = webContents.getAllWebContents().find(c => c.getURL().includes(urlPart));
  if (!c) throw new Error(`No contents: ${urlPart}`);
  return c.executeJavaScript(expression);
}, {urlPart, expression});
const getPage = async urlPart => {
  await expect.poll(()=>app.context().pages().some(p=>p.url().includes(urlPart))).toBe(true);
  return app.context().pages().find(p=>p.url().includes(urlPart));
};
const readStored = name => { const p = path.join(dataPath, 'browser-data', name); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : []; };
try {
  app = await electron.launch({executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    `--user-data-dir=${dataPath}`, '.',
  ], timeout: 30000});
  shell = await app.firstWindow();
  shell.on('pageerror', error => errors.push(error.message));
  await shell.waitForSelector('.app-shell');
  const normal = await invoke('createTab', {url: `${base}/first`});
  await check('navigation and history', async()=>{
    await waitTab(normal.id, {isLoading:false, title:'Browser fixture'});
    await expect(shell.locator('[data-newtab-wallpaper]')).toHaveCount(0);
    await expect.poll(() => app.evaluate(({ BaseWindow }, url) => {
      const window = BaseWindow.getAllWindows()[0];
      const page = window.contentView.children.find(view => view.webContents?.getURL() === url);
      if (!page) return false;
      const bounds = page.getBounds();
      return bounds.height > 100 && bounds.y + bounds.height === window.getContentSize()[1];
    }, `${base}/first`)).toBe(true);

    await invoke('navigate', normal.id, `${base}/second`);
    await waitTab(normal.id, {canGoBack:true, title:'Second fixture'});
    await invoke('goBack', normal.id);
    await waitTab(normal.id, {url:`${base}/first`});
    await invoke('goForward', normal.id);
    await waitTab(normal.id, {url:`${base}/second`});
  });
  await check('find, zoom, mute, pin and keyboard on website', async()=>{
    await invoke('findInPage', normal.id, 'needle');
    await invoke('stopFindInPage', normal.id);
    await invoke('tabAction', normal.id, 'zoom-in');
    assert((await snapshot()).tabs.find(t=>t.id===normal.id).zoomFactor > 1);
    await invoke('tabAction', normal.id, 'zoom-reset');
    await invoke('tabAction', normal.id, 'mute');
    await invoke('tabAction', normal.id, 'pin');
    await waitTab(normal.id, {isMuted:true,isPinned:true});
    // Electron's native input pipeline is required: CDP key dispatch bypasses
    // before-input-event on headless WebContentsView.
    await app.evaluate(({webContents}, url) => {
      const c = webContents.getAllWebContents().find(c => c.getURL() === url);
      c.focus();
      c.sendInputEvent({type:'keyDown',keyCode:'L',modifiers:[process.platform === 'darwin' ? 'meta' : 'control']});
      c.sendInputEvent({type:'keyUp',keyCode:'L',modifiers:[process.platform === 'darwin' ? 'meta' : 'control']});
    }, `${base}/second`);
    await expect(shell.locator('[data-omnibox]')).toBeFocused();
    await invoke('tabAction', normal.id, 'pin');
  });
  await check('safe hibernation and recovery', async()=>{
    await invoke('createTab');
    assert.equal(await invoke('hibernateTab', normal.id), true);
    await waitTab(normal.id, {lifecycle:'hibernated'});
    await invoke('activateTab', normal.id);
    await waitTab(normal.id, {lifecycle:'active',isLoading:false});
    await content('/second', `document.querySelector('input').focus()`);
    const page = await getPage('/second');
    await page.locator('input').fill('Unsaved draft');
    await invoke('createTab');
    assert.equal(await invoke('hibernateTab', normal.id), false, 'dirty form must not be discarded');
  });
  let privateTab;
  await check('private popup isolation, cookie sharing and no persistent history', async()=>{
    privateTab = await invoke('createTab', {url:`${base}/private`,isPrivate:true});
    await waitTab(privateTab.id, {isLoading:false});
    assert.equal(await content('/private', 'typeof window.browserApi'), 'undefined');
    const before = (await snapshot()).tabs.length;
    assert.equal(await content('/private', `window.open('${base}/private-popup','_blank')!==null`), true);
    await expect.poll(async()=>(await snapshot()).tabs.length).toBe(before+1);
    const popup=(await snapshot()).tabs.find(t=>t.url===`${base}/private-popup`);
    assert(popup?.isPrivate, 'popup must inherit privacy');
    await waitTab(popup.id,{isLoading:false});
    assert((await content('/private-popup','document.cookie')).includes('test=private'));
    assert.equal((await snapshot()).history.some(h=>h.url.includes('/private')),false);
    assert.equal(JSON.stringify(readStored('history.json')).includes('/private'),false);
    const flags=await app.evaluate(({webContents})=>webContents.getAllWebContents().filter(c=>c.getURL().includes('/private')).map(c=>c.session.isPersistent()));
    assert(flags.every(p=>p===false));
    const privateRequest=receivedHeaders.find(h=>h.url==='/private');
    assert.equal(privateRequest.headers.dnt,'1');
    assert.equal(privateRequest.headers['sec-gpc'],'1');
    await content('/private-popup', `document.cookie='privateOnly=secret; Path=/'`);
    await invoke('closeTab',popup.id);
    assert((await content('/private','document.cookie')).includes('privateOnly=secret'),'closing one private tab must not wipe others');
  });
  await check('native normal/private downloads complete and private records stay in memory',async()=>{
    for (const tab of [normal, privateTab]) {
      const filename=path.join(dataPath, `${tab.isPrivate ? 'private' : 'normal'}-fixture.txt`);
      await app.evaluate(({session,webContents}, {url,filename})=>{
        const c=webContents.getAllWebContents().find(c=>c.getURL()===url);
        c.session.once('will-download',(_event,item)=>item.setSavePath(filename));
        c.downloadURL(new URL('/download',url).href);
      },{url:tab.isPrivate?`${base}/private`:`${base}/second`,filename});
      await expect.poll(async()=>(await snapshot()).downloads.find(d=>d.path===filename)?.state,{timeout:15000}).toBe('completed');
      assert.equal(fs.readFileSync(filename,'utf8'),'SOUL download\n');
    }
    assert.equal(JSON.stringify(readStored('downloads.json')).includes('private'),false);
  });
  await check('pause, resume and cancel downloads',async()=>{
    const filename=path.join(dataPath,'slow.bin');
    await app.evaluate(({webContents}, {url,filename})=>{
      const c=webContents.getAllWebContents().find(c=>c.getURL()===url);
      c.session.once('will-download',(_event,item)=>item.setSavePath(filename));
      c.downloadURL(new URL('/slow',url).href);
    },{url:`${base}/second`,filename});
    await expect.poll(async()=>(await snapshot()).downloads.find(d=>d.path===filename)?.state).toBe('progressing');
    const download=(await snapshot()).downloads.find(d=>d.path===filename);
    await invoke('controlDownload',download.id,'pause');
    await expect.poll(async()=>(await snapshot()).downloads.find(d=>d.id===download.id)?.isPaused).toBe(true);
    await invoke('controlDownload',download.id,'resume');
    await invoke('controlDownload',download.id,'cancel');
    await expect.poll(async()=>(await snapshot()).downloads.find(d=>d.id===download.id)?.state).toBe('cancelled');
  });
  await check('private cleanup and closed-tab restore excludes private URLs',async()=>{
    await invoke('closePrivateTabs');
    assert.equal((await snapshot()).privacy.privateTabCount,0);
    const fresh=await invoke('createTab',{url:`${base}/fresh-private`,isPrivate:true});
    await waitTab(fresh.id,{isLoading:false});
    assert.equal((await content('/fresh-private','document.cookie')).includes('privateOnly'),false);
    await invoke('closePrivateTabs');
    await invoke('closeTab',normal.id);
    await invoke('reopenClosedTab');
    assert((await snapshot()).tabs.some(t=>t.url===`${base}/second`&&!t.isPrivate));
    assert.equal(JSON.stringify(readStored('session.json')).includes('private'),false);
  });
  await check('invalid proxy rejected; configured unavailable proxy fails without direct fallback',async()=>{
    await assert.rejects(()=>invoke('setPrivateProxy','javascript:alert(1)'));
    await invoke('setPrivateProxy','socks5://127.0.0.1:9');
    const before=receivedHeaders.filter(h=>h.url==='/proxy-check').length;
    const tab=await invoke('createTab',{url:`${base}/proxy-check`,isPrivate:true});
    await waitTab(tab.id,{isLoading:false});
    assert.equal(receivedHeaders.filter(h=>h.url==='/proxy-check').length,before);
    await invoke('closePrivateTabs');
    await invoke('setPrivateProxy','');
  });
  await check('renderer failure recovery',async()=>{
    const tab=await invoke('createTab',{url:`${base}/recover`,isPrivate:false});
    await waitTab(tab.id,{isLoading:false});
    await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(c=>c.getURL()===url).forcefullyCrashRenderer(),`${base}/recover`);
    await waitTab(tab.id,{lifecycle:'crashed'});
    await invoke('reload',tab.id);
    await waitTab(tab.id,{lifecycle:'active',isLoading:false,title:'Browser fixture'});
    await invoke('tabAction',tab.id,'pin');
    await invoke('updateSettings',{searchEngine:'https://www.google.com/search?q='});
  });
  // Headless Ozone has no window manager and ignores native setFullScreen.
  // Only run the OS fullscreen assertion when the backend supports it.
  await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].setFullScreen(true));
  await new Promise(resolve=>setTimeout(resolve,250));
  const supportsFullscreen=await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].isFullScreen());
  await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].setFullScreen(false));
  if(supportsFullscreen) {
  await check('desktop and page fullscreen restore browser controls',async()=>{
    const tab=(await snapshot()).tabs.find(t=>t.url===`${base}/recover`);
    await invoke('activateTab',tab.id);
    await app.evaluate(({webContents},url)=>{
      const c=webContents.getAllWebContents().find(c=>c.getURL()===url);
      c.sendInputEvent({type:'keyDown',keyCode:'F11'});
      c.sendInputEvent({type:'keyUp',keyCode:'F11'});
    },`${base}/recover`);
    await expect.poll(()=>app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].isFullScreen())).toBe(true);
    await app.evaluate(({webContents},url)=>{
      const c=webContents.getAllWebContents().find(c=>c.getURL()===url);
      c.sendInputEvent({type:'keyDown',keyCode:'F11'});
      c.sendInputEvent({type:'keyUp',keyCode:'F11'});
    },`${base}/recover`);
    await expect.poll(()=>app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].isFullScreen())).toBe(false);
    await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(c=>c.getURL()===url).executeJavaScript('document.documentElement.requestFullscreen()',true),`${base}/recover`);
    await expect.poll(()=>app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].isFullScreen())).toBe(true);
    await app.evaluate(({webContents},url)=>{
      const c=webContents.getAllWebContents().find(c=>c.getURL()===url);
      c.sendInputEvent({type:'keyDown',keyCode:'L',modifiers:[process.platform==='darwin'?'meta':'control']});
      c.sendInputEvent({type:'keyUp',keyCode:'L',modifiers:[process.platform==='darwin'?'meta':'control']});
    },`${base}/recover`);
    await expect.poll(()=>app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].isFullScreen())).toBe(false);
    await expect(shell.locator('[data-omnibox]')).toBeFocused();
  });
  } else console.log('SKIP native fullscreen: backend ignores BaseWindow.setFullScreen (manual desktop validation required)');
  const evidence=process.env.SOUL_EVIDENCE_DIR;
  if(evidence){
    fs.mkdirSync(evidence,{recursive:true});
    await invoke('createTab');
    await shell.screenshot({path:path.join(evidence,'e2e-home.png')});
    await shell.getByRole('button',{name:'Настройки',exact:true}).first().click();
    await shell.screenshot({path:path.join(evidence,'e2e-settings.png')});
  }
  await check('restart restores normal tabs and preferences, excluding private state',async()=>{
    const lastPrivate=await invoke('createTab',{url:`${base}/private-restart`,isPrivate:true});
    await waitTab(lastPrivate.id,{isLoading:false});
    await app.close();
    app=await electron.launch({executablePath:process.env.SOUL_EXECUTABLE,args:[...(process.platform==='linux'?['--ozone-platform=headless','--disable-gpu','--disable-dev-shm-usage']:[]),...(process.getuid?.()===0?['--no-sandbox']:[]),`--user-data-dir=${dataPath}`,'.']});
    shell=await app.firstWindow();
    await shell.waitForSelector('.app-shell');
    const next=await snapshot();
    assert.equal(next.settings.searchEngine,'https://www.google.com/search?q=');
    assert.equal(next.tabs.some(t=>t.isPrivate),false);
    assert(next.tabs.some(t=>t.url===`${base}/recover`&&t.isPinned));
    assert.equal(JSON.stringify(readStored('session.json')).includes('private-restart'),false);
    assert(next.tabs.some(t=>t.lifecycle==='hibernated'),'background restored tabs load lazily');
  });
  assert.deepEqual(errors,[], 'shell must not raise uncaught JavaScript errors');
  console.log(JSON.stringify({ok:true,checks:passed,uncaughtShellErrors:errors},null,2));
} finally {
  if(app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(dataPath,{recursive:true,force:true});
}

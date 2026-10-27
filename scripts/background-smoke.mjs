import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

// Local application assets only. All DNS destinations are disabled in this test;
// no profile from an installed browser and no remote wallpaper are accessed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-background-e2e-'));
fs.mkdirSync(path.join(dataPath, 'browser-data'));
fs.writeFileSync(path.join(dataPath, 'browser-data/settings.json'), JSON.stringify({ newTabBackground: 'mountain-lake', theme: 'light', restoreSession: true }));
const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const customWallpaperFile = Buffer.concat([validPng, Buffer.alloc(2_100_000)]);
const checks = [], shellErrors = [];
let app, shell;
const invoke = (method, ...args) => shell.evaluate(({method,args})=>window.browserApi[method](...args), {method,args});
const snapshot = () => invoke('getSnapshot');
const wallpaper = () => shell.locator('[data-newtab-wallpaper]');
const page = () => shell.locator('.new-tab-page');
const launch = async () => {
  app = await electron.launch({executablePath:process.env.SOUL_EXECUTABLE,cwd:root,args:[
    ...(process.platform==='linux'?['--ozone-platform=headless','--disable-gpu','--disable-dev-shm-usage']:[]),
    ...(process.getuid?.()===0?['--no-sandbox']:[]),
    '--host-resolver-rules=MAP * ~NOTFOUND',`--user-data-dir=${dataPath}`,'.',
  ]});
  shell = await app.firstWindow(); shell.on('pageerror',error=>shellErrors.push(error.message));
  await shell.waitForSelector('.app-shell');
  await expect(page()).toBeVisible();
  await expect.poll(() => shell.locator('.page-viewport').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.height > 100 && bounds.width > 100 && bounds.left >= 0 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1;
  })).toBe(true);
};
const check = async (name, operation) => {await operation();checks.push(name);console.log(`PASS ${name}`);};
const expectPortrait = async () => {
  await expect(page()).toHaveAttribute('data-new-tab-background','portrait');
  await expect(wallpaper()).toHaveCount(1);
  const image=wallpaper().locator('img'); await expect(image).toHaveCount(1);
  await expect.poll(()=>image.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  assert((await image.getAttribute('src')).includes('/assets/')||(await image.getAttribute('src')).startsWith('data:'),'portrait must be a bundled resource');
  assert.equal(await image.getAttribute('alt'),'','decorative wallpaper must not duplicate screen-reader content');
};
const selectBackground = async value => {
  await shell.getByRole('button',{name:'Настройки',exact:true}).first().click();
  const control=shell.getByRole('combobox',{name:'Фон новой вкладки',exact:true});
  await expect(control).toBeVisible(); await control.selectOption(value);
  await expect.poll(async()=>(await snapshot()).settings.newTabBackground).toBe(value);
  await shell.locator('.settings-heading').getByRole('button',{name:'Закрыть',exact:true}).click();
};
try {
  await launch();
  await check('legacy wallpaper setting migrates to the bundled portrait default',async()=>{
    assert.equal((await snapshot()).settings.newTabBackground,'portrait'); await expectPortrait();
  });
  await check('accepts a valid custom wallpaper above the former 2 MB limit and restores it after restart',async()=>{
    await shell.getByRole('button',{name:'Настройки',exact:true}).first().click();
    await shell.getByLabel('Загрузить собственные обои').setInputFiles({
      name: 'custom-wallpaper.png',
      buffer: customWallpaperFile,
    });
    await expect(shell.getByText('Собственные обои сохранены на этом устройстве.',{exact:true})).toBeVisible();
    await shell.locator('.settings-heading').getByRole('button',{name:'Закрыть',exact:true}).click();
    await expect(wallpaper()).toHaveCount(1);
    const customImage = wallpaper().locator('img');
    await expect.poll(()=>customImage.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
    assert((await customImage.getAttribute('src')).startsWith('data:image/'),'custom wallpaper must use a local image resource');
    await app.close(); app=undefined; await launch();
    await expect(wallpaper()).toHaveCount(1);
    const restoredImage = wallpaper().locator('img');
    await expect.poll(()=>restoredImage.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
    assert((await restoredImage.getAttribute('src')).startsWith('data:image/'),'custom wallpaper must survive restart in local profile storage');
  });
  await check('Settings plain choice removes the wallpaper layer and persists a closed local enum',async()=>{
    await selectBackground('plain');
    await expect(page()).toHaveAttribute('data-new-tab-background','plain'); await expect(wallpaper()).toHaveCount(0);
    const saved=JSON.parse(fs.readFileSync(path.join(dataPath,'browser-data/settings.json'),'utf8'));
    assert.equal(saved.newTabBackground,'plain');
    await invoke('updateSettings',{theme:'dark'}); assert.equal((await snapshot()).settings.newTabBackground,'plain');
  });
  await check('plain background survives a native application restart',async()=>{
    await app.close(); app=undefined; await launch();
    assert.equal((await snapshot()).settings.newTabBackground,'plain');
    await expect(page()).toHaveAttribute('data-new-tab-background','plain'); await expect(wallpaper()).toHaveCount(0);
  });
  await check('portrait can be re-enabled through Settings and survives restart',async()=>{
    await selectBackground('portrait'); await expectPortrait();
    await app.close(); app=undefined; await launch();
    assert.equal((await snapshot()).settings.newTabBackground,'portrait'); await expectPortrait();
  });
  await check('untrusted background URLs and CSS are normalized instead of being used as image resources',async()=>{
    for(const value of ['https://external.test/wallpaper.png','url(https://external.test/wallpaper.png)','file:///private','data:image/svg+xml,<svg/>']) {
      await invoke('updateSettings',{newTabBackground:value});
      assert.equal((await snapshot()).settings.newTabBackground,'portrait'); await expectPortrait();
      assert(!(await wallpaper().locator('img').getAttribute('src')).includes('external.test'));
    }
  });
  assert.deepEqual(shellErrors,[]);
  console.log(JSON.stringify({ok:true,checks,uncaughtShellErrors:shellErrors,network:'Bundled assets only; test DNS disabled.'},null,2));
} finally {
  if(app) await app.close();
  fs.rmSync(dataPath,{recursive:true,force:true});
}

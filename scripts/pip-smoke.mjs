import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'soul-pip-'));
const video=fs.readFileSync('tests/fixtures/pip-video.webm');
const server=http.createServer((req,res)=>{
  if(req.url==='/video.webm') {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), video.length - 1) : video.length - 1;
    res.writeHead(range ? 206 : 200, {'content-type':'video/webm','accept-ranges':'bytes','content-length':end-start+1,...(range ? {'content-range':`bytes ${start}-${end}/${video.length}`} : {})});
    res.end(video.subarray(start,end+1));return;
  }
  res.writeHead(200,{'content-type':'text/html'});
  res.end(`<title>PiP fixture ${req.url}</title><video width="320" height="180" muted loop controls preload="auto" src="/video.webm"></video>`);
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
let app;
try {
  app=await electron.launch({executablePath:process.env.SOUL_EXECUTABLE,args:[...(process.platform==='linux'?['--ozone-platform=headless','--disable-gpu','--disable-dev-shm-usage']:[]),...(process.getuid?.()===0?['--no-sandbox']:[]),'--autoplay-policy=no-user-gesture-required',`--user-data-dir=${profile}`,'.']});
  const shell=await app.firstWindow();await shell.waitForSelector('.app-shell');
  const invoke=(method,...args)=>shell.evaluate(({method,args})=>window.browserApi[method](...args),{method,args});
  const snapshot=()=>invoke('getSnapshot');
  const first=await invoke('createTab',{url:`${base}/first`});
  await expect.poll(async()=>(await snapshot()).tabs.find(t=>t.id===first.id)?.isLoading).toBe(false);
  const page=app.context().pages().find(p=>p.url()===`${base}/first`);
  await expect.poll(()=>page.locator('video').evaluate(v=>v.readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('video').evaluate(v=>v.play());
  assert.deepEqual(await invoke('togglePictureInPicture',first.id),{success:true,isPip:true});
  await invoke('createTab');
  const hud=page.locator('#soulm8te-mini-pip-hud');
  await expect(hud).toBeAttached();
  await expect.poll(()=>page.locator('video').evaluate(v=>v.controls)).toBe(false);
  await hud.getByRole('button',{name:'Пауза',exact:true}).click();
  assert.equal(await page.locator('video').evaluate(v=>v.paused),true);
  await hud.getByRole('button',{name:'Воспроизвести',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate(v=>v.paused)).toBe(false);
  await hud.getByRole('button',{name:'Пауза',exact:true}).click();
  await page.locator('video').evaluate(v=>{v.currentTime=2;});
  await expect.poll(()=>page.locator('video').evaluate(v=>Math.round(v.currentTime))).toBe(2);
  await hud.getByRole('button',{name:'Вперёд на 10 секунд',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate(v=>Math.round(v.currentTime))).toBe(12);
  await hud.getByRole('button',{name:'Назад на 10 секунд',exact:true}).click();
  await expect.poll(()=>page.locator('video').evaluate(v=>Math.round(v.currentTime))).toBe(2);
  await hud.getByRole('button',{name:'Включить звук',exact:true}).click();
  assert.equal(await page.locator('video').evaluate(v=>v.muted),false);
  await hud.getByRole('button',{name:'Выключить звук',exact:true}).click();
  assert.equal(await page.locator('video').evaluate(v=>v.muted),true);
  console.log('PASS mini player play/pause, mute/unmute and ±10s seek control the real video');
  const bounds=()=>app.evaluate(({BaseWindow},url)=>BaseWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents?.getURL()===url)?.getBounds(),`${base}/first`);
  const start=await bounds();
  const title=await page.locator('.soulm8te-mini-pip-title').boundingBox();
  await page.mouse.move(title.x+20,title.y+10);await page.mouse.down();await page.mouse.move(title.x-60,title.y-40,{steps:4});await page.mouse.up();
  await expect.poll(async()=>(await bounds()).x).toBeLessThan(start.x);
  const moved=await bounds();
  const handle=await page.locator('#soulm8te-mini-pip-resize').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2-60,handle.y+handle.height/2-35,{steps:4});await page.mouse.up();
  await expect.poll(async()=>(await bounds()).width).not.toBe(moved.width);
  await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].setSize(420,640));
  await expect.poll(async()=>{const b=await bounds();return b.x>=0&&b.y>=0&&b.x+b.width<=420&&b.y+b.height<=640;}).toBe(true);
  console.log('PASS mini player drag, resize and compact-window bounds');
  await page.locator('.soulm8te-mini-pip-title').hover();
  await expect(page.locator('#soulm8te-video-pip-btn')).not.toBeVisible();
  if (process.env.SOUL_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.SOUL_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SOUL_EVIDENCE_DIR, '05-pip-controls.png') });
  }
  await hud.getByRole('button',{name:'Вернуться к вкладке',exact:true}).click();
  await expect.poll(async()=>(await snapshot()).activeTabId).toBe(first.id);
  await expect(hud).toHaveCount(0);
  await expect.poll(()=>page.locator('video').evaluate(v=>v.controls)).toBe(true);
  const second=await invoke('createTab',{url:`${base}/second`});
  await expect.poll(async()=>(await snapshot()).tabs.find(t=>t.id===second.id)?.isLoading).toBe(false);
  assert.equal((await invoke('togglePictureInPicture',second.id)).success,true);
  await expect.poll(async()=>(await snapshot()).tabs.filter(t=>t.isPictureInPicture).map(t=>t.id)).toEqual([second.id]);
  await invoke('createTab');
  const secondPage=app.context().pages().find(p=>p.url()===`${base}/second`);
  await secondPage.locator('#soulm8te-mini-pip-hud').getByRole('button',{name:'Закрыть мини-плеер',exact:true}).click();
  await expect.poll(async()=>(await snapshot()).tabs.some(t=>t.isPictureInPicture)).toBe(false);
  console.log('PASS return-to-tab, only one active player and close resets state');
} finally {
  if(app)await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(profile,{recursive:true,force:true});
}

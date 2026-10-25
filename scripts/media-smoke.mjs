import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

const profile=fs.mkdtempSync(path.join(os.tmpdir(),'soul-media-'));
const png=fs.readFileSync(path.resolve('assets/icons/png/16x16.png'));
const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/image?')||req.url==='/linked.png'){
    res.writeHead(200,{'content-type':'image/png','content-length':png.length});res.end(png);return;
  }
  const mode=new URL(req.url,'http://fixture.test').searchParams.get('mode')||'normal';
  res.writeHead(200,{'content-type':'text/html'});
  res.end(`<title>Media fixture ${mode}</title><img id="actual-image" alt="Actual PNG endpoint" width="64" height="64" src="/image?id=${mode}"><a id="direct-link" href="/linked.png">Linked PNG</a><a id="generic-link" href="/generic?id=1">Generic link</a><img id="blob-image" alt="Blob PNG" width="64" height="64"><script>fetch('/image?id=blob').then(response=>response.blob()).then(blob=>document.querySelector('#blob-image').src=URL.createObjectURL(blob));</script>`);
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
let app;
try{
  app=await electron.launch({executablePath:process.env.SOUL_EXECUTABLE,args:[
    ...(process.platform==='linux'?['--ozone-platform=headless','--disable-gpu','--disable-dev-shm-usage']:[]),
    ...(process.getuid?.()===0?['--no-sandbox']:[]),'--no-proxy-server',`--user-data-dir=${profile}`,'.',
  ]});
  const shell=await app.firstWindow();await shell.waitForSelector('.app-shell');
  const invoke=(method,...args)=>shell.evaluate(({method,args})=>window.browserApi[method](...args),{method,args});
  const snapshot=()=>invoke('getSnapshot');
  await app.evaluate(({Menu})=>{
    globalThis.__mediaMenuBuilder=Menu.buildFromTemplate;
    Menu.buildFromTemplate=function(template){const menu=globalThis.__mediaMenuBuilder.call(this,template);globalThis.__mediaMenu=menu;return menu;};
  });
  for(const isPrivate of [false,true]){
    const mode=isPrivate?'private':'normal';
    const url=`${base}/page?mode=${mode}`;
    const imageUrl=`${base}/image?id=${mode}`;
    const tab=await invoke('createTab',{url,isPrivate});
    await expect.poll(async()=>(await snapshot()).tabs.find(entry=>entry.id===tab.id)?.isLoading).toBe(false);
    const page=app.context().pages().find(entry=>entry.url()===url);
    await expect.poll(()=>page.locator('#actual-image').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
    await app.evaluate(({webContents},url)=>{
      const contents=webContents.getAllWebContents().find(entry=>entry.getURL()===url);
      contents.on('context-menu',(_event,params)=>{globalThis.__mediaParams={mediaType:params.mediaType,srcURL:params.srcURL,linkURL:params.linkURL};});
    },url);
    await page.locator('#actual-image').click({button:'right'});
    await expect.poll(()=>app.evaluate(()=>globalThis.__mediaParams?.srcURL)).toBe(imageUrl);
    assert.deepEqual(await app.evaluate(()=>({mediaType:globalThis.__mediaParams.mediaType,save:globalThis.__mediaMenu.items.find(item=>item.label==='Сохранить изображение')?.enabled})),{mediaType:'image',save:true});
    const filename=path.join(profile,`${mode}-actual-image.png`);
    await app.evaluate(({webContents},{url,filename})=>{
      const contents=webContents.getAllWebContents().find(entry=>entry.getURL()===url);
      contents.session.once('will-download',(_event,item)=>item.setSavePath(filename));
      globalThis.__mediaMenu.closePopup();globalThis.__mediaMenu.items.find(item=>item.label==='Сохранить изображение').click();
    },{url,filename});
    await expect.poll(async()=>(await snapshot()).downloads.find(entry=>entry.path===filename)?.state).toBe('completed');
    const download=(await snapshot()).downloads.find(entry=>entry.path===filename);
    assert.equal(download.kind,'image');assert.equal(download.mimeType,'image/png');assert.equal(download.isPrivate,isPrivate);assert.equal(download.url,imageUrl);
    assert(fs.readFileSync(filename).equals(png),'native context save must preserve the original response bytes');

    await page.locator('#direct-link').click({button:'right'});
    await expect.poll(()=>app.evaluate(()=>globalThis.__mediaParams?.linkURL)).toBe(`${base}/linked.png`);
    assert.equal(await app.evaluate(()=>globalThis.__mediaMenu.items.find(item=>item.label==='Сохранить изображение')?.enabled),true,'extension link gets the correct image label');
    await app.evaluate(()=>globalThis.__mediaMenu.closePopup());
    await page.locator('#generic-link').click({button:'right'});
    await expect.poll(()=>app.evaluate(()=>globalThis.__mediaParams?.linkURL)).toBe(`${base}/generic?id=1`);
    assert.equal(await app.evaluate(()=>globalThis.__mediaMenu.items.some(item=>item.label.startsWith('Сохранить ')&&item.enabled)),false,'arbitrary links without a media extension are not promoted to media saves');
    await app.evaluate(()=>globalThis.__mediaMenu.closePopup());
    await expect.poll(()=>page.locator('#blob-image').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
    await page.locator('#blob-image').click({button:'right'});
    await expect.poll(()=>app.evaluate(()=>globalThis.__mediaParams?.srcURL?.startsWith('blob:'))).toBe(true);
    assert.equal(await app.evaluate(()=>globalThis.__mediaMenu.items.find(item=>item.label==='Изображение недоступно для сохранения')?.enabled),false);
    await app.evaluate(()=>globalThis.__mediaMenu.closePopup());
    await invoke('closeTab',tab.id);
    if(isPrivate){
      assert.equal(JSON.stringify(fs.readFileSync(path.join(profile,'browser-data/downloads.json'),'utf8')).includes('private-actual-image'),false);
      assert(fs.readFileSync(filename).equals(png),'explicitly saved private file remains on disk after closing its tab');
    }
    console.log(`PASS ${mode}: real PNG without extension, native context menu/save/MIME/bytes, typed links and unsupported blob/generic cases`);
  }
  await app.evaluate(({Menu})=>{Menu.buildFromTemplate=globalThis.__mediaMenuBuilder;});
  console.log(JSON.stringify({ok:true,groups:2}));
}finally{
  if(app)await app.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  fs.rmSync(profile,{recursive:true,force:true});
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {_electron as electron,expect} from '@playwright/test';

const profile=fs.mkdtempSync(path.join(os.tmpdir(),'soul-managers-'));
const server=http.createServer((req,res)=>{
  if(req.url.startsWith('/download')){res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="fixture.txt"'});res.end('local manager fixture');return;}
  res.writeHead(200,{'content-type':'text/html'});res.end('<title>Manager fixture</title><h1>Local fixture</h1>');
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
let app;
try{
  app=await electron.launch({executablePath:process.env.SOUL_EXECUTABLE,args:[...(process.platform==='linux'?['--ozone-platform=headless','--disable-gpu','--disable-dev-shm-usage']:[]),...(process.getuid?.()===0?['--no-sandbox']:[]),'--no-proxy-server',`--user-data-dir=${profile}`,'.']});
  const shell=await app.firstWindow();await shell.waitForSelector('.app-shell');
  const invoke=(method,...args)=>shell.evaluate(({method,args})=>window.browserApi[method](...args),{method,args});
  const snapshot=()=>invoke('getSnapshot');
  const tab=await invoke('createTab',{url:`${base}/normal`});
  await expect.poll(async()=>(await snapshot()).tabs.find(t=>t.id===tab.id)?.isLoading).toBe(false);
  await shell.getByRole('button',{name:'Закладки',exact:true}).click();
  await shell.getByRole('region',{name:'Менеджер закладок'}).getByRole('button',{name:'Добавить закладку',exact:true}).click();
  await shell.getByLabel('Название',{exact:true}).fill('My local bookmark');
  await shell.getByLabel('Адрес',{exact:true}).fill(`${base}/saved`);
  await shell.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect.poll(async()=>(await snapshot()).bookmarks.some(b=>b.title==='My local bookmark')).toBe(true);
  await shell.getByRole('button',{name:'Изменить закладку My local bookmark',exact:true}).click();
  await shell.getByLabel('Название',{exact:true}).fill('Edited bookmark');
  await shell.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(shell.getByRole('button',{name:'Удалить закладку Edited bookmark',exact:true})).toBeVisible();
  await shell.getByRole('button',{name:'Удалить закладку Edited bookmark',exact:true}).click();
  await expect.poll(async()=>(await snapshot()).bookmarks.some(b=>b.title==='Edited bookmark')).toBe(false);
  await shell.getByRole('button',{name:'Вернуть',exact:true}).click();
  await expect.poll(async()=>(await snapshot()).bookmarks.some(b=>b.title==='Edited bookmark')).toBe(true);
  await assert.rejects(()=>invoke('saveBookmark',{title:'bad',url:'javascript:alert(1)'}));
  console.log('PASS bookmark manager UI create/edit/remove/undo and unsafe URL rejection');

  await app.evaluate(async({webContents},base)=>{
    const c=webContents.getAllWebContents().find(c=>c.getURL()===`${base}/normal`);
    await c.session.cookies.set({url:base,name:'stay-signed-in',value:'local-fixture'});
  },base);
  await app.evaluate(({dialog})=>{globalThis.__managerDialog=dialog.showMessageBox;dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});});
  const count=(await snapshot()).history.length;assert(count>0);
  await invoke('clearBrowsingHistory');assert.equal((await snapshot()).history.length,count);
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  await invoke('clearBrowsingHistory');assert.equal((await snapshot()).history.length,0);
  assert((await snapshot()).bookmarks.some(b=>b.title==='Edited bookmark'));
  assert(await app.evaluate(async({webContents},base)=>(await webContents.getAllWebContents().find(c=>c.getURL()===`${base}/normal`).session.cookies.get({name:'stay-signed-in'})).length===1,base));
  await app.evaluate(({dialog})=>{dialog.showMessageBox=globalThis.__managerDialog;});
  console.log('PASS history-only clear honors native cancel/confirm and preserves cookies/bookmarks');

  const privateTab=await invoke('createTab',{url:`${base}/private`,isPrivate:true});
  await expect.poll(async()=>(await snapshot()).tabs.find(t=>t.id===privateTab.id)?.isLoading).toBe(false);
  for(const [isPrivate,url] of [[false,`${base}/normal`],[true,`${base}/private`]]){
    const filename=path.join(profile,isPrivate?'private.txt':'normal.txt');
    await app.evaluate(({webContents},{url,filename})=>{
      const c=webContents.getAllWebContents().find(c=>c.getURL()===url);
      c.session.once('will-download',(_event,item)=>item.setSavePath(filename));c.downloadURL(new URL('/download',url).href);
    },{url,filename});
    await expect.poll(async()=>(await snapshot()).downloads.find(d=>d.path===filename)?.state).toBe('completed');
  }
  await invoke('clearFinishedDownloads',false);
  assert((await snapshot()).downloads.every(d=>d.isPrivate));assert.equal((await snapshot()).downloads.length,1);
  assert.equal(fs.readFileSync(path.join(profile,'normal.txt'),'utf8'),'local manager fixture');
  await invoke('clearFinishedDownloads',true);assert.equal((await snapshot()).downloads.length,0);
  assert.equal(fs.readFileSync(path.join(profile,'private.txt'),'utf8'),'local manager fixture');
  console.log('PASS finished-download list clearing respects profile mode and preserves actual files');
  console.log(JSON.stringify({ok:true,groups:3}));
}finally{if(app)await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(profile,{recursive:true,force:true});}

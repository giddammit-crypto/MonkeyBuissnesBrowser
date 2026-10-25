import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {_electron as electron,expect} from '@playwright/test';

const profile=fs.mkdtempSync(path.join(os.tmpdir(),'soul-managers-'));
let releaseHistoryResponse;
const server=http.createServer((req,res)=>{
  if(req.url==='/history-delayed'){releaseHistoryResponse=()=>{if(res.writableEnded||res.destroyed)return;res.writeHead(200,{'content-type':'text/html'});res.end('<title>Delayed destination</title><h1>Delayed local document</h1>');};return;}
  if(req.url==='/history-alpha'||req.url==='/history-beta'){res.writeHead(200,{'content-type':'text/html'});res.end(`<title>${req.url==='/history-alpha'?'Alpha original':'Beta destination'}</title><h1>Local title fixture</h1>`);return;}
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

  const historyTab=await invoke('createTab',{url:`${base}/history-alpha`,isPrivate:false});
  await expect.poll(async()=>(await snapshot()).history.find(h=>h.url===`${base}/history-alpha`)?.title).toBe('Alpha original');
  const alphaVisit=(await snapshot()).history.find(h=>h.url===`${base}/history-alpha`);
  await invoke('navigate',historyTab.id,`${base}/history-beta`);
  await expect.poll(async()=>(await snapshot()).history.find(h=>h.url===`${base}/history-beta`)?.title).toBe('Beta destination');
  assert.deepEqual((await snapshot()).history.find(h=>h.url===alphaVisit.url),alphaVisit,'new document title must not change the prior visit');
  const betaVisit=(await snapshot()).history.find(h=>h.url===`${base}/history-beta`);
  await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(c=>c.getURL()===url).executeJavaScript("document.title='Beta revised';true"),betaVisit.url);
  await expect.poll(async()=>(await snapshot()).history.find(h=>h.id===betaVisit.id)?.title).toBe('Beta revised');
  assert.equal((await snapshot()).history.find(h=>h.id===betaVisit.id).visitedAt,betaVisit.visitedAt,'title updates preserve visit time and identity');
  const navigation=invoke('navigate',historyTab.id,`${base}/history-delayed`);
  await expect.poll(()=>typeof releaseHistoryResponse).toBe('function');
  // Dispatch a delayed main-process title notification while a real network
  // navigation is pending. Renderer execution itself is suspended by Chromium.
  await app.evaluate(({webContents},url)=>{
    const c=webContents.getAllWebContents().find(c=>c.getURL()===url);
    c.emit('page-title-updated',{preventDefault(){}},'Old document late title');
  },betaVisit.url);
  assert.equal((await snapshot()).history.find(h=>h.id===betaVisit.id).title,'Beta revised','old document title during pending navigation must be ignored');
  releaseHistoryResponse();await navigation;
  await expect.poll(async()=>(await snapshot()).history.find(h=>h.url===`${base}/history-delayed`)?.title).toBe('Delayed destination');
  const delayedVisit=(await snapshot()).history.find(h=>h.url===`${base}/history-delayed`);
  await invoke('removeHistoryEntry',delayedVisit.id);
  await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(c=>c.getURL()===url).executeJavaScript("document.title='Removed entry stays absent';true"),delayedVisit.url);
  await expect.poll(async()=>(await snapshot()).tabs.find(t=>t.id===historyTab.id)?.title).toBe('Removed entry stays absent');
  assert.equal((await snapshot()).history.some(h=>h.url===delayedVisit.url),false);
  await app.evaluate(({dialog})=>{globalThis.__historyTitleDialog=dialog.showMessageBox;dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  await invoke('clearBrowsingHistory');
  await app.evaluate(({dialog})=>{dialog.showMessageBox=globalThis.__historyTitleDialog;});
  await app.evaluate(({webContents},url)=>webContents.getAllWebContents().find(c=>c.getURL()===url).executeJavaScript("document.title='Cleared history stays empty';true"),delayedVisit.url);
  await expect.poll(async()=>(await snapshot()).tabs.find(t=>t.id===historyTab.id)?.title).toBe('Cleared history stays empty');
  assert.equal((await snapshot()).history.length,0);
  console.log('PASS real document titles update history metadata without recreating removed/cleared entries or accepting stale navigation titles');

  const reopenUrl=`${base}/reopen-intent`;
  const closedNormal=await invoke('createTab',{url:reopenUrl,isPrivate:false});
  await invoke('closeTab',closedNormal.id);
  const privateOne=await invoke('createTab',{url:`${base}/private-review-one`,isPrivate:true});
  await expect.poll(async()=>(await snapshot()).tabs.find(t=>t.id===privateOne.id)?.isLoading).toBe(false);
  const beforePrivateReopen=(await snapshot()).tabs.length;
  await invoke('reopenClosedTab');
  assert.equal((await snapshot()).tabs.length,beforePrivateReopen);
  assert.equal((await snapshot()).activeTabId,privateOne.id);
  await app.evaluate(({webContents},url)=>{
    const c=webContents.getAllWebContents().find(c=>c.getURL()===url);
    const modifiers=[process.platform==='darwin'?'meta':'control','shift'];
    c.sendInputEvent({type:'keyDown',keyCode:'T',modifiers});c.sendInputEvent({type:'keyUp',keyCode:'T',modifiers});
  },`${base}/private-review-one`);
  assert.equal((await snapshot()).tabs.length,beforePrivateReopen,'private reopen shortcut must not consume ordinary reopen history');
  const workspace=await invoke('createWorkspace','Review ordinary target');
  await invoke('activateTab',historyTab.id);
  await invoke('switchWorkspace',workspace.id);
  const normalTarget=await invoke('createTab',{url:`${base}/normal-review-target`,isPrivate:false});
  await invoke('activateTab',privateOne.id);
  await invoke('switchWorkspace',workspace.id);
  let current=await snapshot();let active=current.tabs.find(t=>t.id===current.activeTabId);
  assert.equal(active.isPrivate,true);assert.equal(active.workspaceId,workspace.id);assert.notEqual(active.id,normalTarget.id);
  const privateWorkspace=active;
  await invoke('navigate',privateWorkspace.id,`${base}/private-review-workspace`);
  await invoke('switchWorkspace','personal');
  current=await snapshot();assert.equal(current.tabs.find(t=>t.id===current.activeTabId).isPrivate,true);
  await invoke('activateTab',privateOne.id);
  await app.evaluate(async({webContents},url)=>{await webContents.getAllWebContents().find(c=>c.getURL()===url).session.cookies.set({url,name:'review-private-cookie',value:'private-only'});},`${base}/private-review-one`);
  const normalPeer=await invoke('createTab',{url:`${base}/normal-review-peer`,isPrivate:false});
  const privateTwo=await invoke('createTab',{url:`${base}/private-review-two`,isPrivate:true});
  await invoke('closeTab',privateTwo.id);
  assert.equal((await snapshot()).activeTabId,privateOne.id,'closing private tab prefers another private tab in the same workspace');
  await invoke('closeTab',privateTab.id);
  await invoke('closeTab',privateOne.id);
  assert.equal((await snapshot()).activeTabId,privateWorkspace.id,'same-mode tabs in another workspace take priority over ordinary tabs');
  assert(await app.evaluate(async({webContents},url)=>(await webContents.getAllWebContents().find(c=>c.getURL()===url).session.cookies.get({name:'review-private-cookie'})).length===1,`${base}/private-review-workspace`));
  await invoke('closePrivateTabs');
  await invoke('activateTab',normalPeer.id);
  assert.equal(await app.evaluate(async({webContents},url)=>(await webContents.getAllWebContents().find(c=>c.getURL()===url).session.cookies.get({name:'review-private-cookie'})).length,`${base}/normal-review-peer`),0);
  assert.equal((await snapshot()).history.some(h=>h.url.includes('/private-review')),false);
  const storedSession=JSON.parse(fs.readFileSync(path.join(profile,'browser-data/session.json'),'utf8'));
  assert.equal(JSON.stringify(storedSession).includes('/private-review'),false);
  await invoke('reopenClosedTab');
  assert((await snapshot()).tabs.some(t=>t.url===reopenUrl&&!t.isPrivate),'blocked private reopen preserves ordinary closed-tab history');
  console.log('PASS private close/workspace/reopen preserve profile mode, cookies, history and session isolation');
  console.log(JSON.stringify({ok:true,groups:5}));

}finally{releaseHistoryResponse?.();if(app)await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(profile,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

// Seed many metadata records, not 140 live page renderers. Real native startup,
// persistence and restart must preserve the selected page within the 100-tab cap.
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'soul-session-budget-'));
const requested=[];
const server=http.createServer((req,res)=>{
  requested.push(req.url);
  res.writeHead(200,{'content-type':'text/html'});res.end(`<title>Session fixture ${req.url}</title><h1>Local session fixture</h1>`);
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const metadata=Array.from({length:140},(_,index)=>({url:`${base}/ordinary-${index}`,title:`Stored ordinary ${index}`,workspaceId:'personal',isPinned:index===130,isMuted:index===130}));
const privateEntry={url:`${base}/private-secret`,title:'PRIVATE SECRET',workspaceId:'personal',isPrivate:true};
const unsafeEntry={url:'file:///private/unsafe-session-entry',title:'UNSAFE',workspaceId:'personal'};
const source=[privateEntry,unsafeEntry,...metadata];
fs.mkdirSync(path.join(profile,'browser-data'));
fs.writeFileSync(path.join(profile,'browser-data/session.json'),JSON.stringify({tabs:source,activeIndex:source.indexOf(metadata[130])}));
let app;
let shell;
const launch=async()=>{
  app=await electron.launch({executablePath:process.env.SOUL_EXECUTABLE,args:[
    ...(process.platform==='linux'?['--ozone-platform=headless','--disable-gpu','--disable-dev-shm-usage']:[]),
    ...(process.getuid?.()===0?['--no-sandbox']:[]),'--no-proxy-server',`--user-data-dir=${profile}`,'.',
  ]});
  shell=await app.firstWindow();await shell.waitForSelector('.app-shell');
};
const invoke=(method,...args)=>shell.evaluate(({method,args})=>window.browserApi[method](...args),{method,args});
const snapshot=()=>invoke('getSnapshot');
const stored=()=>JSON.parse(fs.readFileSync(path.join(profile,'browser-data/session.json'),'utf8'));
try{
  await launch();
  await expect.poll(async()=>{const state=await snapshot();return state.tabs.find(tab=>tab.id===state.activeTabId)?.url;}).toBe(metadata[130].url);
  await expect.poll(async()=>{const state=await snapshot();return state.tabs.find(tab=>tab.id===state.activeTabId)?.isLoading;}).toBe(false);
  const initial=await snapshot();
  assert.equal(initial.tabs.length,100);
  assert.deepEqual(initial.tabs.map(tab=>tab.url),[...metadata.slice(0,99).map(tab=>tab.url),metadata[130].url]);
  const active=initial.tabs.find(tab=>tab.id===initial.activeTabId);
  assert.equal(active.isPinned,true);assert.equal(active.isMuted,true);
  const nativePages=await app.evaluate(({webContents},base)=>webContents.getAllWebContents().filter(contents=>contents.getURL().startsWith(base)).map(contents=>contents.getURL()),base);
  assert.deepEqual(nativePages,[metadata[130].url],'metadata restore remains lazy and loads only the selected page');
  assert.equal(requested.some(url=>url.startsWith('/private-secret')),false);
  await expect.poll(()=>{const state=stored();return state.tabs[state.activeIndex]?.url;}).toBe(metadata[130].url);
  await expect.poll(()=>JSON.stringify(stored()).includes('private-secret')).toBe(false);
  assert.equal(JSON.stringify(stored()).includes('file:'),false);
  console.log('PASS native startup retains selected ordinary tab beyond raw budget, filters private/unsafe entries and loads lazily');

  for(const route of ['/runtime-extra-one','/runtime-extra-two']){
    const tab=await invoke('createTab',{url:`${base}${route}`,isPrivate:false});
    await expect.poll(async()=>(await snapshot()).tabs.find(entry=>entry.id===tab.id)?.isLoading).toBe(false);
  }
  assert.equal((await snapshot()).tabs.length,102);
  const selectedUrl=`${base}/runtime-extra-two`;
  await expect.poll(()=>{const state=stored();return state.tabs[state.activeIndex]?.url;}).toBe(selectedUrl);
  assert.equal(stored().tabs.length,100);
  await app.close();app=undefined;
  await launch();
  await expect.poll(async()=>{const state=await snapshot();return state.tabs.find(tab=>tab.id===state.activeTabId)?.url;}).toBe(selectedUrl);
  await expect.poll(async()=>{const state=await snapshot();return state.tabs.find(tab=>tab.id===state.activeTabId)?.isLoading;}).toBe(false);
  const restored=await snapshot();
  assert.equal(restored.tabs.length,100);
  assert.equal(restored.tabs.at(-1).url,selectedUrl);
  assert.equal(restored.history.some(entry=>entry.url.includes('private-secret')),false);
  assert.equal(requested.some(url=>url.startsWith('/private-secret')),false);
  console.log('PASS active runtime tab beyond budget survives persisted restart without promoting private or unsafe pages');
  console.log(JSON.stringify({ok:true,groups:2}));
}finally{
  if(app)await app.close();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  fs.rmSync(profile,{recursive:true,force:true});
}

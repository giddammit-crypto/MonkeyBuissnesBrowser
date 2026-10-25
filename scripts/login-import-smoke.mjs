import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

// Local fixtures exercise login cookies and import APIs; no account credentials
// are entered and this does not claim an end-to-end Google account sign-in.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-login-import-'));
const server = http.createServer((req,res)=>{
  const cors={'access-control-allow-origin':req.headers.origin||'*','access-control-allow-credentials':'true'};
  if(req.url==='/headers') {res.writeHead(200,{'content-type':'application/json',...cors});res.end(JSON.stringify(req.headers));return;}
  if(req.url==='/set-cookie') {res.writeHead(200,{'set-cookie':'flow=complete; Path=/; SameSite=Lax',...cors});res.end('saved');return;}
  res.writeHead(200,{'content-type':'text/html'});res.end('<title>Local login fixture</title><h1>Login cookie fixture</h1>');
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const port=server.address().port;
const home=`http://www.soul.test:${port}/`;
const auth=`http://auth.soul.test:${port}`;
let app;
try {
 app=await electron.launch({executablePath:process.env.SOUL_EXECUTABLE,args:[
  ...(process.platform==='linux'?['--ozone-platform=headless','--disable-gpu','--disable-dev-shm-usage']:[]),
  ...(process.getuid?.()===0?['--no-sandbox']:[]),
  '--no-proxy-server',
  '--host-resolver-rules=MAP *.soul.test 127.0.0.1, MAP *.other.test 127.0.0.1',
  `--user-data-dir=${profile}`,'.',
 ]});
 const shell=await app.firstWindow();await shell.waitForSelector('.app-shell');
 const invoke=(method,...args)=>shell.evaluate(({method,args})=>window.browserApi[method](...args),{method,args});
 const snapshot=()=>invoke('getSnapshot');
 const create=async(isPrivate=false)=>{
  const tab=await invoke('createTab',{url:home,isPrivate});
  await expect.poll(async()=>(await snapshot()).tabs.find(t=>t.id===tab.id)?.isLoading).toBe(false);
  const loaded=(await snapshot()).tabs.find(t=>t.id===tab.id);
  if(loaded.lifecycle==='crashed')throw new Error('Local fixture navigation failed: '+JSON.stringify(loaded));
  return tab;
 };
 const fetchInTab=(url,target)=>app.evaluate(({webContents},{url,target})=>webContents.getAllWebContents().find(c=>c.getURL()===url).executeJavaScript(`fetch(${JSON.stringify(target)},{credentials:'include'}).then(r=>r.text())`),{url,target});
 const tab=await create();
 await app.evaluate(async({webContents},{home,auth})=>{
  const c=webContents.getAllWebContents().find(c=>c.getURL()===home);
  await c.session.cookies.set({url:auth,name:'auth-test',value:'normal',path:'/',sameSite:'lax'});
 },{home,auth});
 const headers=JSON.parse(await fetchInTab(home,`${auth}/headers`));
 assert(headers.cookie?.includes('auth-test=normal'),'sibling login subdomain must receive first-party site cookies');
 await fetchInTab(home,`${auth}/set-cookie`);
 assert(await app.evaluate(async({webContents},home)=>(await webContents.getAllWebContents().find(c=>c.getURL()===home).session.cookies.get({name:'flow'})).length>0,home));
 console.log('PASS same-site login request and response cookies across subdomains');
 await invoke('setSiteCookieException',tab.id,true);
 assert((await snapshot()).settings.thirdPartyCookieExceptions.includes('http://soul.test'));
 await invoke('setSiteCookieException',tab.id,false);
 assert.equal((await snapshot()).settings.thirdPartyCookieExceptions.length,0);
 await invoke('closeTab',tab.id);
 const privateTab=await create(true);
 await assert.rejects(()=>invoke('setSiteCookieException',privateTab.id,true));
 await app.evaluate(async({webContents},{home,auth})=>{
  await webContents.getAllWebContents().find(c=>c.getURL()===home).session.cookies.set({url:auth,name:'auth-test',value:'private',path:'/',sameSite:'lax'});
 },{home,auth});
 assert(JSON.parse(await fetchInTab(home,`${auth}/headers`)).cookie?.includes('auth-test=private'));
 await invoke('closePrivateTabs');
 console.log('PASS site exceptions stay explicit, private protection and cookies remain isolated');

 // Intercept HTTPS only in the test process to display a local rejection fixture
 // at Google's known rejection URL. Never contact or authenticate a real account.
 await app.evaluate(({session,dialog,shell})=>{
  const target=session.fromPartition('persist:northstar-default');
  target.protocol.handle('https',()=>new Response('<title>Local Google rejection fixture</title><h1>Local fixture — no real Google sign-in</h1>',{headers:{'content-type':'text/html'}}));
  globalThis.__originalMessageBox=dialog.showMessageBox;globalThis.__originalExternal=shell.openExternal;
  globalThis.__openedUrls=[];
  dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});
  shell.openExternal=async url=>{globalThis.__openedUrls.push(url);};
 });
 const ordinary=await invoke('createTab',{url:'https://accounts.google.com/ServiceLogin?service=youtube',isPrivate:false});
 await expect.poll(async()=>(await snapshot()).tabs.find(t=>t.id===ordinary.id)?.isLoading).toBe(false);
 await expect(shell.getByRole('textbox',{name:'Адресная строка',exact:true})).toHaveValue('https://accounts.google.com/ServiceLogin?service=youtube');
 await expect(shell.locator('.auth-help-banner')).toHaveCount(0);
 assert.deepEqual(await app.evaluate(()=>globalThis.__openedUrls),[],'normal sign-in must stay inside the browser');
 const denied=await invoke('createTab',{url:'https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fwww.youtube.com%2F',isPrivate:false});
 await expect(shell.locator('.auth-help-banner')).toBeVisible();
 await expect(shell.locator('.auth-help-banner')).toContainText('не переносит');
 await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].setSize(920,640));
 await expect.poll(()=>shell.locator('.app-shell').evaluate(element=>Math.round(element.getBoundingClientRect().width))).toBe(920);
 assert(await shell.locator('.auth-help-banner').evaluate(element=>element.scrollWidth<=element.clientWidth),'rejection help controls must fit the compact window');
 await invoke('openCurrentPageExternally',denied.id);
 assert.deepEqual(await app.evaluate(()=>globalThis.__openedUrls),['https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.youtube.com%2F']);
 const beforeDismiss=await shell.locator('.page-viewport').evaluate(element=>element.getBoundingClientRect().top);
 await shell.getByRole('button',{name:'Скрыть помощь со входом Google',exact:true}).click();
 await expect(shell.locator('.auth-help-banner')).toHaveCount(0);
 await expect.poll(()=>shell.locator('.page-viewport').evaluate(element=>element.getBoundingClientRect().top)).toBeLessThan(beforeDismiss);
 const pageTop=await shell.locator('.page-viewport').evaluate(element=>element.getBoundingClientRect().top);
 await expect.poll(()=>app.evaluate(({BaseWindow})=>{
  const view=BaseWindow.getAllWindows()[0].contentView.children.find(view=>view.webContents?.getURL().includes('/signin/rejected'));
  return view?.getBounds().y;
 })).toBe(Math.round(pageTop));
 await invoke('navigate',denied.id,'https://accounts.google.com/v3/signin/identifier?service=youtube');
 await expect.poll(async()=>(await snapshot()).tabs.find(t=>t.id===denied.id)?.isLoading).toBe(false);
 await expect(shell.getByRole('textbox',{name:'Адресная строка',exact:true})).toHaveValue('https://accounts.google.com/v3/signin/identifier?service=youtube');
 await expect(shell.locator('.auth-help-banner')).toHaveCount(0);
 await invoke('navigate',denied.id,'https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fwww.youtube.com%2F');
 await expect(shell.locator('.auth-help-banner')).toBeVisible();
 await app.evaluate(({dialog,shell,session})=>{
  dialog.showMessageBox=globalThis.__originalMessageBox;shell.openExternal=globalThis.__originalExternal;
  session.fromPartition('persist:northstar-default').protocol.unhandle('https');
 });
 console.log('PASS normal Google sign-in has no premature warning; explicit rejection help can be dismissed and external navigation requires confirmation (local fixture)');

 const html=path.join(profile,'bookmarks.html');
 fs.writeFileSync(html,'<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><A HREF="https://example.test/book" ADD_DATE="1700000000">Imported &amp; safe</A></DL>');
 await app.evaluate(({dialog},html)=>{
  globalThis.__originalOpenDialog=dialog.showOpenDialog;
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[html]});
 },html);
 const imported=await invoke('importBrowserFile','bookmarks');
 assert.equal(imported.imported,1);assert.deepEqual(imported.errors,[]);
 const repeated=await invoke('importBrowserFile','bookmarks');
 assert.equal(repeated.imported,0);assert.equal(repeated.skipped,1);
 assert((await snapshot()).bookmarks.some(b=>b.title==='Imported & safe'));
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
 assert.equal(await invoke('importBrowserFile','bookmarks'),null);
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=globalThis.__originalOpenDialog;});
 console.log('PASS native HTML-file import, duplicate count and cancel path');
 console.log(JSON.stringify({ok:true,groups:4,googleAccountSignInTested:false}));
} finally {
 if(app)await app.close();
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 fs.rmSync(profile,{recursive:true,force:true});
}

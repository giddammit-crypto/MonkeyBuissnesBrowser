import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-memory-release-'));
const server = http.createServer((_req,res) => {
  res.writeHead(200, {'content-type':'text/html'});
  res.end('<title>Memory fixture</title><script>window.fixtureAllocation=new Uint8Array(8*1024*1024);window.fixtureAllocation.fill(7)</script><h1>Memory fixture</h1>');
});
server.listen(0,'127.0.0.1'); await once(server,'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let app;
try {
  app=await electron.launch({executablePath:process.env.SOUL_EXECUTABLE,args:[...(process.platform==='linux'?['--ozone-platform=headless','--disable-gpu','--disable-dev-shm-usage']:[]),...(process.getuid?.()===0?['--no-sandbox']:[]),`--user-data-dir=${profile}`,'.']});
  const shell=await app.firstWindow(); await shell.waitForSelector('.app-shell');
  const invoke=(method,...args)=>shell.evaluate(({method,args})=>window.browserApi[method](...args),{method,args});
  const ids=[];
  for(let index=0; index<6; index++) {
    const tab=await invoke('createTab',{url:`${base}/${index}`}); ids.push(tab.id);
    await expect.poll(async()=>(await invoke('getSnapshot')).tabs.find(t=>t.id===tab.id)?.isLoading).toBe(false);
  }
  const measure=async()=>{
    const metrics=await invoke('getTaskManagerMetrics');
    const pages=await app.evaluate(({webContents},base)=>webContents.getAllWebContents().filter(c=>c.getURL().startsWith(base)).length,base);
    let rssBytes = 0;
    let rssSamples = 0;
    if (process.platform === 'linux') for (const pid of new Set(metrics.processes.map(process => process.pid))) {
      try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const match = /^VmRSS:\s+(\d+) kB$/m.exec(status);
        if (match) { rssBytes += Number(match[1]) * 1024; rssSamples++; }
      } catch { /* Renderer may have exited between samples. */ }
    }
    return { nativePages: pages, processes: metrics.processes.length,
      sampledRssProcesses: rssSamples, summedRssMiB: rssSamples === new Set(metrics.processes.map(process => process.pid)).size ? Math.round(rssBytes / 1024 / 1024 * 10) / 10 : null };
  };
  const before=await measure(); assert.equal(before.nativePages,6);
  await invoke('createTab');
  for(const id of ids) assert.equal(await invoke('hibernateTab',id),true);
  await expect.poll(async()=>(await measure()).nativePages).toBe(0);
  // Sample after renderer exit; OS working set is observational, not a fixed threshold.
  await new Promise(resolve=>setTimeout(resolve,500));
  const after=await measure();
  assert.equal((await invoke('getSnapshot')).tabs.filter(t=>ids.includes(t.id)&&t.lifecycle==='hibernated').length,6);
  const report={scenario:'Six local pages each allocating 8 MiB, then explicit hibernation',before,after};
  console.log(JSON.stringify(report,null,2));
  if(process.env.SOUL_EVIDENCE_DIR){fs.mkdirSync(process.env.SOUL_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.SOUL_EVIDENCE_DIR,'memory-release.json'),JSON.stringify(report,null,2));}
  console.log('PASS all six native page contents released while tab metadata remains');
} finally {
  if(app)await app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(profile,{recursive:true,force:true});
}

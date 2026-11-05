import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { _electron as electron } from '@playwright/test';

// Opt-in live-site diagnostic, separate from deterministic local fixture tests.
// Uses a disposable profile and Chromium's ordinary CSP/CORS/TLS checks.
const target = process.argv[2] || 'https://biblioteka33.ru/?p=172';
const output = process.argv[3] || 'artifacts/site-font-diagnostics';
fs.mkdirSync(output, { recursive: true });
const seedServer = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<title>Font diagnostic starting</title>'); });
await new Promise(resolve => seedServer.listen(0, '127.0.0.1', resolve));
const seedUrl = `http://127.0.0.1:${seedServer.address().port}/`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-font-diagnostics-'));
let app;
const results = { target, sampledAt: new Date().toISOString(), cases: [] };
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    ...(process.env.SOUL_DIAGNOSTIC_ENV_PROXY === '1' && process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : []),
    `--user-data-dir=${profile}`, '.',
  ] });
  results.runtime = await app.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome }));
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  for (const isPrivate of [false, true]) {
    const before = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map(item => item.id));
    const tab = await invoke('createTab', { url: seedUrl, isPrivate });
    const contentId = await app.evaluate(async ({ webContents }, { before, proxy }) => {
      const contents = webContents.getAllWebContents().filter(item => !before.includes(item.id)).sort((a, b) => b.id - a.id)[0];
      if (!contents) throw new Error('Diagnostic tab missing');
      // An opt-in runner proxy is scoped to this disposable session only.
      if (proxy) await contents.session.setProxy({ mode: 'fixed_servers', proxyRules: proxy });
      globalThis.__fontDiagnostics ||= {};
      const evidence = globalThis.__fontDiagnostics[contents.id] = { resources: [], failures: [], console: [] };
      contents.on('console-message', (_event, details, message, line, sourceId) => {
        const entry = typeof details === 'object' ? { level: details.level, message: details.message } : { level: details, message, line, sourceId };
        if (evidence.console.length < 150) evidence.console.push(entry);
      });
      contents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
        evidence.failures.push({ code, description, url, mainFrame });
      });
      contents.debugger.attach('1.3');
      const requestUrls = new Map();
      contents.debugger.on('message', (_event, method, params) => {
        if (method === 'Network.requestWillBeSent') {
          if (requestUrls.size >= 1000) requestUrls.delete(requestUrls.keys().next().value);
          requestUrls.set(params.requestId, params.request.url);
        }
        if (method === 'Network.responseReceived' && evidence.resources.length < 400) {
          const { url, status, mimeType, headers } = params.response;
          if (['Document', 'Stylesheet', 'Font'].includes(params.type)) evidence.resources.push({ type: params.type, url, status, mimeType, headers: Object.fromEntries(Object.entries(headers).filter(([name]) => ['content-type', 'access-control-allow-origin', 'content-security-policy', 'location', 'x-content-type-options'].includes(name.toLowerCase()))) });
        }
        if (method === 'Network.loadingFailed' && evidence.failures.length < 150) evidence.failures.push({ ...params, url: requestUrls.get(params.requestId) });
      });
      void contents.debugger.sendCommand('Network.enable');
      return contents.id;
    }, { before, proxy: process.env.SOUL_DIAGNOSTIC_ENV_PROXY === '1' ? process.env.HTTPS_PROXY : undefined });
    let navigationError;
    let navigationTimer;
    try {
      await Promise.race([invoke('navigate', tab.id, target), new Promise((_resolve, reject) => { navigationTimer = setTimeout(() => reject(new Error('Navigation did not finish in 35 seconds')), 35000); })]);
    } catch (error) { navigationError = String(error); }
    finally { clearTimeout(navigationTimer); }
    const started = Date.now();
    while (Date.now() - started < 35000) {
      const item = (await invoke('getSnapshot')).tabs.find(item => item.id === tab.id);
      if (item && !item.isLoading) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const probe = await app.evaluate(async ({ webContents }, id) => {
      const contents = webContents.fromId(id);
      const document = await contents.executeJavaScript(`(async () => {
        const fontsReady = await Promise.race([document.fonts.ready.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 10000))]);
        const faces = [...document.fonts].map(font => ({family:font.family,status:font.status,style:font.style,weight:font.weight}));
        const samples = [...document.querySelectorAll('h1,h2,h3,.park-site')].slice(0,20).map(item => ({tag:item.tagName,selector:item.className,text:item.textContent.trim().slice(0,120),family:getComputedStyle(item).fontFamily}));
        let monomakh; try {monomakh = {count:(await Promise.race([document.fonts.load('24px Monomakh','Библиотека'), new Promise((_resolve,reject)=>setTimeout(()=>reject(new Error('Font loading exceeded 10 seconds')),10000))])).length}} catch(error) {monomakh={error:String(error)}}
        return {url:location.href,title:document.title,fontsReady,faces,samples,monomakh,stylesheets:[...document.styleSheets].map(sheet=>sheet.href)};
      })()`);
      let renderedFonts;
      try {
        await contents.debugger.sendCommand('DOM.enable');
        await contents.debugger.sendCommand('CSS.enable');
        const { root } = await contents.debugger.sendCommand('DOM.getDocument');
        const { nodeId } = await contents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '.park-heading, h1' });
        if (nodeId) renderedFonts = await contents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId });
      } catch (error) { renderedFonts = { error: String(error) }; }
      const image = await contents.capturePage();
      return { document, renderedFonts, evidence: globalThis.__fontDiagnostics[id], screenshot: image.toPNG().toString('base64') };
    }, contentId);
    const name = isPrivate ? 'private' : 'normal';
    const screenshot = Buffer.from(probe.screenshot, 'base64');
    if (screenshot.length) fs.writeFileSync(path.join(output, `${name}.png`), screenshot);
    else {
      fs.rmSync(path.join(output, `${name}.png`), { force: true });
      probe.screenshotUnavailable = 'The headless renderer returned an empty image';
    }
    delete probe.screenshot;
    results.cases.push({ name, navigationError, ...probe });
    console.log(JSON.stringify({ name, document: probe.document, failures: probe.evidence.failures }, null, 2));
    await invoke('closeTab', tab.id);
  }
} catch (error) {
  results.error = String(error);
  throw error;
} finally {
  fs.writeFileSync(path.join(output, 'diagnostics.json'), JSON.stringify(results, null, 2));
  if (app) await app.close();
  fs.rmSync(profile, { recursive: true, force: true });
  seedServer.closeAllConnections();
  await new Promise(resolve => seedServer.close(resolve));
}

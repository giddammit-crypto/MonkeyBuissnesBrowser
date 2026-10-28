import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { _electron as electron, expect } from '@playwright/test';

// A disposable, local-only YouTube-shaped resource fixture, not the live site.
// HTTPS host remapping and certificate bypass are restricted to this test process.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-youtube-icons-'));
const key = path.join(profile, 'localhost.key');
const cert = path.join(profile, 'localhost.crt');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
  '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
{ stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
fs.chmodSync(key, 0o600);
const hosts = ['www.youtube.com', 'www.gstatic.com', 'fonts.gstatic.com', 'ad.doubleclick.net'];
const received = [];
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M3 5h18v3H3zm0 6h18v3H3zm0 6h18v3H3z"/></svg>';
const fontPath = path.resolve('src/renderer/assets/fonts/inter-latin.woff2');
const font = fs.readFileSync(fontPath);
const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (request, response) => {
  const host = request.headers.host?.split(':')[0];
  if (!hosts.includes(host)) { response.writeHead(400); response.end(); return; }
  const url = new URL(request.url, `https://${host}`);
  received.push({ host, path: url.pathname, query: url.search });
  const headers = { 'cache-control': 'no-store', 'access-control-allow-origin': '*' };
  if (url.pathname.endsWith('.svg')) {
    response.writeHead(200, { ...headers, 'content-type': 'image/svg+xml' }); response.end(svg); return;
  }
  if (url.pathname.endsWith('.woff2')) {
    response.writeHead(200, { ...headers, 'content-type': 'font/woff2' }); response.end(font); return;
  }
  if (url.pathname.endsWith('.css')) {
    response.writeHead(200, { ...headers, 'content-type': 'text/css' });
    response.end('@font-face{font-family:FixtureIcon;src:url("https://fonts.gstatic.com/fonts/icons.woff2?redirect=/ads/controls") format("woff2")} yt-icon{display:inline-flex;width:24px;height:24px;color:rgb(13,71,161)} #font-icon{font-family:FixtureIcon;font-size:24px} #styled-icon{background:rgb(23,92,41);width:24px;height:24px;display:block}'); return;
  }
  if (url.pathname.endsWith('.js')) {
    response.writeHead(200, { ...headers, 'content-type': 'text/javascript' });
    response.end(`customElements.define('yt-icon', class extends HTMLElement {connectedCallback(){this.innerHTML=${JSON.stringify(svg)};this.dataset.hydrated='true'}});`); return;
  }
  if (host === 'ad.doubleclick.net') { response.writeHead(200, { ...headers, 'content-type': 'image/gif' }); response.end(); return; }
  response.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><meta charset="utf-8"><title>YouTube icon resources fixture</title>
    <style>@font-face{font-family:FixtureControl;src:url("https://fonts.gstatic.com/fonts/control.woff2")}@font-face{font-family:FixtureStandalone;src:url("https://fonts.gstatic.com/fonts/direct-icons.woff2?context=/ads/navigation")}</style>
    <link rel="stylesheet" href="https://www.gstatic.com/youtube/icons.css?redirect=/ads/navigation">
    <script defer src="https://www.gstatic.com/youtube/icon-runtime.js?context=/ads/navigation"></script>
    <h1>Local YouTube icon fixture</h1><ytd-ad-slot-renderer id="fixture-ad" style="display:inline-block;height:24px;width:120px">Local ad fixture</ytd-ad-slot-renderer>
    <button id="inline-button" aria-label="Menu"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 5h18v3H3zm0 6h18v3H3zm0 6h18v3H3z"/></svg></button>
    <yt-icon id="hydrated-icon" aria-label="Hydrated menu"></yt-icon>
    <img id="control-image" src="https://www.gstatic.com/youtube/menu.svg" width="24" height="24">
    <img id="query-image" src="https://www.gstatic.com/youtube/settings.svg?redirect=/ads/navigation" width="24" height="24">
    <span id="font-icon">A</span><span id="styled-icon"></span>
    <img id="ad-image" src="https://ad.doubleclick.net/activity/pixel.gif" width="1" height="1">`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let app;
try {
  const port = server.address().port;
  const resolver = [...hosts.map(host => `MAP ${host} 127.0.0.1:${port}`), 'MAP * ~NOTFOUND'].join(', ');
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--no-proxy-server', '--ignore-certificate-errors', `--host-resolver-rules=${resolver}`, `--user-data-dir=${profile}`, '.',
  ] });
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  const tab = await invoke('createTab', { url: 'https://www.youtube.com/watch?v=icon-fixture' });
  await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(entry => entry.id === tab.id)?.isLoading).toBe(false);
  const probe = await app.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find(entry => entry.getURL().startsWith('https://www.youtube.com/watch'));
    return contents.executeJavaScript(`(async()=>{
      let controlFontLoaded=false;try{controlFontLoaded=(await document.fonts.load('24px FixtureControl')).length>0}catch{}
      let fontLoaded=false;try{fontLoaded=(await document.fonts.load('24px FixtureStandalone')).length>0}catch{}
      const inline=document.querySelector('#inline-button svg');const hydrated=document.querySelector('#hydrated-icon');
      return {inlineVisible:!!inline&&inline.getBoundingClientRect().width===24&&getComputedStyle(inline).visibility==='visible',
        controlImageLoaded:document.querySelector('#control-image').naturalWidth>0,
        queryImageLoaded:document.querySelector('#query-image').naturalWidth>0,
        customElementHydrated:hydrated?.dataset.hydrated==='true'&&!!hydrated.querySelector('svg path'),
        stylesheetLoaded:getComputedStyle(document.querySelector('#styled-icon')).backgroundColor==='rgb(23, 92, 41)',
        fontLoaded,controlFontLoaded,ua:navigator.userAgent,adLoaded:document.querySelector('#ad-image').naturalWidth>0};})()`);
  });
  console.log(JSON.stringify({ probe, received }, null, 2));
  assert.equal(probe.controlImageLoaded, true, 'ordinary SVG must load');
  assert.equal(probe.controlFontLoaded, true, 'ordinary font must load');
  assert.equal(probe.inlineVisible, true, 'page preload must preserve native inline SVG controls');
  assert.equal(probe.queryImageLoaded, true, 'a benign redirect query containing /ads/ must not block SVG icons');
  assert.equal(probe.customElementHydrated, true, 'icon bootstrap JS with a benign /ads/ query must execute');
  assert.equal(probe.stylesheetLoaded, true, 'icon stylesheet with a benign /ads/ query must load');
  assert.equal(probe.fontLoaded, true, 'icon font with a benign /ads/ query must load');
  assert.equal(probe.adLoaded, false);
  assert.equal(received.some(request => request.host === 'ad.doubleclick.net'), false, 'actual ad host remains blocked');
  console.log('PASS inline SVG, external SVG, icon hydration, CSS and font assets survive benign ad-like query values; real advertising host stays blocked');
  const pagePolicy = () => app.evaluate(async ({ webContents }) => {
    const contents = webContents.getAllWebContents().find(entry => entry.getURL().startsWith('https://www.youtube.com/watch'));
    return contents.executeJavaScript(`({stylePresent:!!document.getElementById('soul-yt-adblock-styles'),adVisible:document.getElementById('fixture-ad').getBoundingClientRect().height>0,inlineVisible:document.querySelector('#inline-button svg').getBoundingClientRect().width===24,hydrated:document.querySelector('#hydrated-icon')?.dataset.hydrated==='true'})`);
  });
  const expectPolicy = async enabled => {
    await expect.poll(async () => {
      const state = await pagePolicy();
      return state.stylePresent === enabled && state.adVisible === !enabled && state.inlineVisible && state.hydrated;
    }).toBe(true);
  };
  await expectPolicy(true);
  await invoke('updateSettings', { adBlockEnabled: false });
  await expectPolicy(false);
  await invoke('updateSettings', { adBlockEnabled: true });
  await expectPolicy(true);
  await invoke('updateSettings', { adBlockExceptions: ['youtube.com'] });
  await expectPolicy(false);
  await invoke('updateSettings', { adBlockExceptions: [] });
  await expectPolicy(true);
  console.log('PASS global ad-block setting and site exceptions update real cosmetic styles without hiding ordinary SVG or hydrated controls');
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}

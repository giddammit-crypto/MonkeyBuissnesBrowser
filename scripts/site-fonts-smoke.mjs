import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

// Real Chromium networking and font decoding against two local origins. This
// deliberately verifies that compatibility fixes preserve the CORS boundary.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-site-fonts-'));
const font = fs.readFileSync(path.resolve('src/renderer/assets/fonts/inter-latin.woff2'));
const requests = [];
const fontServer = http.createServer((request, response) => {
  requests.push(request.url);
  const headers = { 'cache-control': 'no-store', 'access-control-allow-origin': '*' };
  if (request.url.startsWith('/redirect')) {
    response.writeHead(302, { ...headers, location: '/adserver/icons.woff2?context=/ads/typography' });
    response.end();
  } else if (request.url.startsWith('/pagead/theme.css')) {
    response.writeHead(200, { ...headers, 'content-type': 'text/css' });
    response.end('@font-face{font-family:SiteFont;src:url("/ads/icons.woff2?context=/ads/typography") format("woff2");font-display:swap} #font-sample{font-family:SiteFont,monospace}');
  } else if (request.url.startsWith('/ads/banner.gif')) {
    response.writeHead(200, { ...headers, 'content-type': 'image/gif' });
    response.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  } else {
    response.writeHead(200, {
      ...(request.url.startsWith('/denied') ? { 'cache-control': 'no-store' } : headers),
      'content-type': 'font/woff2', 'content-length': font.length,
    });
    response.end(font);
  }
});
fontServer.listen(0, '127.0.0.1');
await once(fontServer, 'listening');
const fonts = `http://127.0.0.1:${fontServer.address().port}`;
const siteServer = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(`<!doctype html><meta charset="utf-8"><title>Site font fixture</title>
    <link rel="stylesheet" href="${fonts}/pagead/theme.css">
    <img id="ad" src="${fonts}/ads/banner.gif"><p id="font-sample">Readable site typography 0123456789</p><a href="/next">Next page</a>`);
});
siteServer.listen(0, '127.0.0.1');
await once(siteServer, 'listening');
const site = `http://127.0.0.1:${siteServer.address().port}`;
let app;
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--no-proxy-server', `--user-data-dir=${profile}`, '.',
  ] });
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  for (const isPrivate of [false, true]) {
    const url = `${site}/${isPrivate ? 'private' : 'normal'}`;
    const tab = await invoke('createTab', { url, isPrivate });
    await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(item => item.id === tab.id)).toMatchObject({ title: 'Site font fixture', isLoading: false });
    const probe = await app.evaluate(async ({ webContents }, { url, fonts }) => {
      const contents = webContents.getAllWebContents().find(item => item.getURL() === url);
      return contents.executeJavaScript(`(async () => {
        await document.fonts.ready;
        const cssFaces = await document.fonts.load('16px SiteFont');
        const redirect = new FontFace('RedirectFont', 'url(${fonts}/redirect)');
        await redirect.load(); document.fonts.add(redirect);
        const bytes = await fetch('${fonts}/api.woff2').then(response => response.arrayBuffer());
        const dynamic = new FontFace('DynamicFont', bytes); await dynamic.load(); document.fonts.add(dynamic);
        let denied = false;
        try { await new FontFace('DeniedFont', 'url(${fonts}/denied.woff2)').load(); } catch { denied = true; }
        return { cssFaces: cssFaces.length, cssLoaded: document.fonts.check('16px SiteFont'),
          computedFamily: getComputedStyle(document.getElementById('font-sample')).fontFamily,
          redirected: redirect.status, dynamic: dynamic.status, denied,
          adLoaded: document.getElementById('ad').naturalWidth > 0, bridge: typeof window.browserApi };
      })()`);
    }, { url, fonts });
    assert.equal(probe.cssFaces, 1, 'cross-origin CSS font must decode');
    assert.equal(probe.cssLoaded, true);
    assert.match(probe.computedFamily, /SiteFont/);
    assert.equal(probe.redirected, 'loaded', 'redirected font must load');
    assert.equal(probe.dynamic, 'loaded', 'FontFace ArrayBuffer must load');
    assert.equal(probe.denied, true, 'cross-origin font without ACAO must remain blocked');
    assert.equal(probe.adLoaded, false, 'ad image remains blocked');
    assert.equal(probe.bridge, 'undefined', 'website cannot access browser IPC');
    await invoke('navigate', tab.id, `${site}/next`);
    await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(item => item.id === tab.id)).toMatchObject({ url: `${site}/next`, isLoading: false, canGoBack: true });
    await invoke('goBack', tab.id);
    await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(item => item.id === tab.id)).toMatchObject({ url, isLoading: false });
    console.log(`PASS ${isPrivate ? 'private' : 'normal'} site: CSS web font, redirect, FontFace API, CORS denial, IPC isolation and back navigation`);
  }
  assert.equal(requests.includes('/ads/banner.gif'), false, 'blocked ad never reaches server');
  assert(requests.some(url => url.includes('context=/ads/typography')));
} finally {
  if (app) await app.close();
  for (const server of [siteServer, fontServer]) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  fs.rmSync(profile, { recursive: true, force: true });
}

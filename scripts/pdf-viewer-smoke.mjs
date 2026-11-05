import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

// Chromium's PDF viewer is the only plugin the engine still ships. This checks
// that a PDF link opens inside the tab instead of leaving a blank page or
// silently becoming a download.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-pdf-'));
const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj\n'
  + '4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 20 100 Td (soulm8te) Tj ET\nendstream endobj\n'
  + 'trailer<</Root 1 0 R/Size 5>>\n%%EOF\n',
);
const server = http.createServer((request, response) => {
  if (request.url === '/report.pdf') {
    response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length, 'cache-control': 'no-store' });
    response.end(pdf);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>PDF fixture</title><a id="pdf" href="/report.pdf">open</a>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const site = `http://127.0.0.1:${server.address().port}`;
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
  const pdfUrl = `${site}/report.pdf`;
  const tab = await invoke('createTab', { url: pdfUrl });
  await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(item => item.id === tab.id)).toMatchObject({ url: pdfUrl, isLoading: false });
  const viewer = await app.evaluate(async ({ webContents }, { url }) => {
    const contents = webContents.getAllWebContents().find(item => item.getURL() === url);
    if (!contents) return { missing: true };
    const probe = await contents.executeJavaScript(`({
      contentType: document.contentType,
      embed: Boolean(document.querySelector('embed, object')),
      plugins: [...(navigator.mimeTypes ? [...navigator.mimeTypes].map(item => item.type) : [])].filter(type => type.includes('pdf')),
    })`).catch(() => ({ contentType: '', embed: false, plugins: [] }));
    return { url: contents.getURL(), ...probe, downloads: contents.session.listDownloads?.()?.length ?? 0 };
  }, { url: pdfUrl });
  assert.equal(viewer.url, pdfUrl, 'PDF navigation stays in the tab');
  assert(viewer.contentType === 'application/pdf' || viewer.embed || viewer.plugins.length > 0, 'built-in PDF plugin renders the document');
  assert.equal(viewer.downloads, 0, 'PDF viewer is not silently converted into a download');
  console.log('PASS PDF viewer: built-in Chromium plugin renders application/pdf inside the tab');
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-reader-security-'));
const sanitizer = stripTypeScriptTypes(fs.readFileSync('src/renderer/sanitizeReaderHtml.ts', 'utf8')).replace('export function', 'function');
const server = http.createServer((req, res) => {
  if (req.url === '/test.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(req.url === '/next' ? '<title>Next article</title><p>Navigation completed.</p>' : `<title>Reader fixture</title><article><h1>Reader fixture</h1><p>${'A readable paragraph with useful information. '.repeat(25)}</p><figure><img src="/test.png" alt="Test cat image"><figcaption>A wonderful cat</figcaption></figure><a href="/next">Continue reading</a></article>`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const fixtureUrl = `http://127.0.0.1:${server.address().port}/article`;
let app;
try {
  app = await electron.launch({
    executablePath: process.env.SOUL_EXECUTABLE,
    args: [
      ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      `--user-data-dir=${userData}`, '.',
    ],
  });
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const result = await shell.evaluate(({ sanitizer }) => {
    const sanitize = new Function(`${sanitizer}; return sanitizeReaderHtml;`)();
    const cleaned = sanitize(`<meta http-equiv="refresh" content="0;url=https://evil.test"><link rel="stylesheet" href="https://evil.test/style.css"><style>body{display:none}</style><script>alert(1)</script><svg><a href="javascript:alert(1)">bad</a></svg><p id="app" class="modal" onclick="alert(1)" style="position:fixed">Readable <strong>article</strong></p><a href="javascript:alert(1)">unsafe</a><a href="/article?q=1">safe</a><img src="https://image.test/photo.jpg" onerror="alert(1)" alt="Photo" title="Photo title"><iframe srcdoc="bad"></iframe><form><input name="password"></form><figure><picture><source srcset="/img300.webp 300w, /img800.webp 800w" type="image/webp"><img data-src="/highres.jpg" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="Lazy Cat"></picture><figcaption>A cat in high res</figcaption></figure><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="Inline base64">`, 'https://example.test/page');
    const fragment = document.createElement('template');
    fragment.innerHTML = cleaned;
    const imgs = [...fragment.content.querySelectorAll('img')];
    const source = fragment.content.querySelector('source');
    const figure = fragment.content.querySelector('figure');
    const figcaption = fragment.content.querySelector('figcaption');
    return {
      html: cleaned,
      dangerous: fragment.content.querySelectorAll('meta,link,style,script,svg,iframe,form,input,[id],[class],[onclick],[onerror],[style]').length,
      links: [...fragment.content.querySelectorAll('a')].map(link => link.getAttribute('href')),
      image: fragment.content.querySelector('img')?.outerHTML,
      text: fragment.content.textContent,
      imgs: imgs.map(img => ({
        src: img.getAttribute('src'),
        alt: img.getAttribute('alt'),
        title: img.getAttribute('title'),
        loading: img.getAttribute('loading'),
        decoding: img.getAttribute('decoding'),
        referrerpolicy: img.getAttribute('referrerpolicy'),
      })),
      source: source ? {
        srcset: source.getAttribute('srcset'),
        type: source.getAttribute('type'),
      } : null,
      hasFigure: Boolean(figure && figcaption && figcaption.textContent === 'A cat in high res'),
    };
  }, { sanitizer });
  assert.equal(result.dangerous, 0, result.html);
  assert.deepEqual(result.links, [null, 'https://example.test/article?q=1']);
  assert.match(result.image, /referrerpolicy="no-referrer"/);
  assert.match(result.text, /Readable article/);
  assert.equal(result.imgs.length, 3);
  assert.equal(result.imgs[0].src, 'https://image.test/photo.jpg');
  assert.equal(result.imgs[0].title, 'Photo title');
  assert.equal(result.imgs[0].decoding, 'async');
  // Second img should resolve lazy data-src over transparent placeholder
  assert.equal(result.imgs[1].src, 'https://example.test/highres.jpg');
  assert.equal(result.imgs[1].alt, 'Lazy Cat');
  // Third img should keep safe data:image base64
  assert.match(result.imgs[2].src, /^data:image\/png;base64,/);
  // Source should be preserved and resolved
  assert.ok(result.source);
  assert.equal(result.source.type, 'image/webp');
  assert.equal(result.source.srcset, 'https://example.test/img300.webp 300w, https://example.test/img800.webp 800w');
  // Figure & figcaption should be preserved
  assert.equal(result.hasFigure, true);
  const tab = await shell.evaluate(url => window.browserApi.createTab({ url }), fixtureUrl);
  await expect.poll(async () => (await shell.evaluate(() => window.browserApi.getSnapshot())).tabs.find(item => item.id === tab.id)?.isLoading).toBe(false);
  await shell.evaluate(id => window.browserApi.toggleReaderMode(id), tab.id);
  await expect(shell.locator('.reader-body')).toContainText('A readable paragraph');
  await expect(shell.locator('.reader-body img')).toBeVisible();
  await expect(shell.locator('.reader-body figcaption')).toContainText('A wonderful cat');
  // Click image to trigger lightbox
  await shell.locator('.reader-body img').click();
  await expect(shell.locator('.reader-lightbox-backdrop')).toBeVisible();
  await expect(shell.locator('.reader-lightbox-caption')).toContainText('A wonderful cat');
  // Press Escape to close lightbox
  await shell.keyboard.press('Escape');
  await expect(shell.locator('.reader-lightbox-backdrop')).toHaveCount(0);
  // Reader view is still active
  await expect(shell.locator('.reader-body')).toBeVisible();
  await shell.locator('.reader-body a').click();
  await expect.poll(async () => {
    const snapshot = await shell.evaluate(() => window.browserApi.getSnapshot());
    const current = snapshot.tabs.find(item => item.id === tab.id);
    return { url: current?.url, loading: current?.isLoading, reader: current?.isReaderActive };
  }).toEqual({ url: fixtureUrl.replace('/article', '/next'), loading: false, reader: false });
  await expect(shell.locator('.reader-body')).toHaveCount(0);
  console.log('PASS reader extracts from isolated preload; article link navigates without reopening reader');
  console.log('PASS reader HTML rejects active content and shell CSS attributes; preserves safe links/images/text');
  console.log('PASS reader image lightbox opens on click, shows caption, and closes on Escape');
} finally {
  await app?.close();
  server.close();
  fs.rmSync(userData, { recursive: true, force: true });
}

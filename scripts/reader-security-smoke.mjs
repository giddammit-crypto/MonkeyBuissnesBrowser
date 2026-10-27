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
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(req.url === '/next' ? '<title>Next article</title><p>Navigation completed.</p>' : `<title>Reader fixture</title><article><h1>Reader fixture</h1><p>${'A readable paragraph with useful information. '.repeat(25)}</p><a href="/next">Continue reading</a></article>`);
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
    const cleaned = sanitize(`<meta http-equiv="refresh" content="0;url=https://evil.test"><link rel="stylesheet" href="https://evil.test/style.css"><style>body{display:none}</style><script>alert(1)</script><svg><a href="javascript:alert(1)">bad</a></svg><p id="app" class="modal" onclick="alert(1)" style="position:fixed">Readable <strong>article</strong></p><a href="javascript:alert(1)">unsafe</a><a href="/article?q=1">safe</a><img src="https://image.test/photo.jpg" onerror="alert(1)" alt="Photo"><iframe srcdoc="bad"></iframe><form><input name="password"></form>`, 'https://example.test/page');
    const fragment = document.createElement('template');
    fragment.innerHTML = cleaned;
    return {
      html: cleaned,
      dangerous: fragment.content.querySelectorAll('meta,link,style,script,svg,iframe,form,input,[id],[class],[onclick],[onerror],[style]').length,
      links: [...fragment.content.querySelectorAll('a')].map(link => link.getAttribute('href')),
      image: fragment.content.querySelector('img')?.outerHTML,
      text: fragment.content.textContent,
    };
  }, { sanitizer });
  assert.equal(result.dangerous, 0, result.html);
  assert.deepEqual(result.links, [null, 'https://example.test/article?q=1']);
  assert.match(result.image, /referrerpolicy="no-referrer"/);
  assert.match(result.text, /Readable article/);
  const tab = await shell.evaluate(url => window.browserApi.createTab({ url }), fixtureUrl);
  await expect.poll(async () => (await shell.evaluate(() => window.browserApi.getSnapshot())).tabs.find(item => item.id === tab.id)?.isLoading).toBe(false);
  await shell.evaluate(id => window.browserApi.toggleReaderMode(id), tab.id);
  await expect(shell.locator('.reader-body')).toContainText('A readable paragraph');
  await shell.locator('.reader-body a').click();
  await expect.poll(async () => {
    const snapshot = await shell.evaluate(() => window.browserApi.getSnapshot());
    const current = snapshot.tabs.find(item => item.id === tab.id);
    return { url: current?.url, loading: current?.isLoading, reader: current?.isReaderActive };
  }).toEqual({ url: fixtureUrl.replace('/article', '/next'), loading: false, reader: false });
  await expect(shell.locator('.reader-body')).toHaveCount(0);
  console.log('PASS reader extracts from isolated preload; article link navigates without reopening reader');
  console.log('PASS reader HTML rejects active content and shell CSS attributes; preserves safe links/images/text');
} finally {
  await app?.close();
  server.close();
  fs.rmSync(userData, { recursive: true, force: true });
}

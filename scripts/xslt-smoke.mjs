import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

// Real Chromium + real HTTP: an XML page with an xml-stylesheet instruction
// must be rendered through the built-in XSLT 1.0 engine, exactly like Chromium
// did before XSLT was removed (Chrome 158).
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-xslt-'));
const XSL = 'http://www.w3.org/1999/XSL/Transform';
const stylesheet = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}">
  <xsl:output method="html" omit-xml-declaration="yes"/>
  <xsl:template match="/">
    <html><head><title><xsl:value-of select="/rss/channel/title"/></title></head>
      <body><h1 id="feed-title"><xsl:value-of select="/rss/channel/title"/></h1>
        <ul><xsl:apply-templates select="/rss/channel/item"/></ul></body></html>
  </xsl:template>
  <xsl:template match="item">
    <li class="entry"><a href="{link}"><xsl:value-of select="title"/></a></li>
  </xsl:template>
</xsl:stylesheet>`;
const feed = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/feed.xsl"?>
<rss><channel><title>Библиотека 33</title>
  <item><title>Первая</title><link>https://example.test/1</link></item>
  <item><title>Вторая</title><link>https://example.test/2</link></item>
</channel></rss>`;
const forbiddenStylesheet = `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="${XSL}">
  <xsl:template match="/"><xsl:value-of select="document('/etc/passwd')"/></xsl:template>
</xsl:stylesheet>`;
let stylesheetRequests = 0;
const server = http.createServer((request, response) => {
  const headers = { 'cache-control': 'no-store' };
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname === '/feed.xml') {
    response.writeHead(200, { ...headers, 'content-type': 'application/rss+xml; charset=utf-8' });
    response.end(feed);
    return;
  }
  if (pathname === '/plain.xml') {
    response.writeHead(200, { ...headers, 'content-type': 'application/xml; charset=utf-8' });
    response.end('<?xml version="1.0"?><note><to>Читатель</to></note>');
    return;
  }
  if (pathname === '/feed.xsl') {
    stylesheetRequests += 1;
    response.writeHead(200, { ...headers, 'content-type': 'text/xsl; charset=utf-8' });
    response.end(stylesheet);
    return;
  }
  if (pathname === '/forbidden.xsl') {
    response.writeHead(200, { ...headers, 'content-type': 'text/xsl; charset=utf-8' });
    response.end(forbiddenStylesheet);
    return;
  }
  if (pathname === '/forbidden.xml') {
    response.writeHead(200, { ...headers, 'content-type': 'application/xml; charset=utf-8' });
    response.end(`<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="/forbidden.xsl"?><secret/>`);
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const site = `http://127.0.0.1:${server.address().port}`;
let app;
const read = (url, script) => app.evaluate(async ({ webContents }, { url, script }) => {
  const contents = webContents.getAllWebContents().find(item => item.getURL() === url);
  if (!contents) return { error: 'tab not found' };
  return contents.executeJavaScript(script);
}, { url, script });
try {
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: [
    ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    '--no-proxy-server', `--user-data-dir=${profile}`, '.',
  ] });
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });

  const feedUrl = `${site}/feed.xml`;
  const tab = await invoke('createTab', { url: feedUrl });
  await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(item => item.id === tab.id)).toMatchObject({ isLoading: false });
  // The poll reports the page state on timeout, so a CI failure explains itself.
  await expect.poll(async () => {
    const state = await read(feedUrl, `({
      title: document.getElementById('feed-title')?.textContent || '',
      error: document.querySelector('[data-soul-xslt="error"]')?.textContent || '',
      root: document.documentElement?.tagName || '',
      type: document.contentType,
      text: (document.body?.innerText || '').slice(0, 120),
    })`);
    if (state?.title === 'Библиотека 33') return 'Библиотека 33';
    return JSON.stringify(state);
  }, { timeout: 20000 }).toBe('Библиотека 33');
  const rendered = await read(feedUrl, `({
    entries: [...document.querySelectorAll('li.entry a')].map(a => a.textContent + '|' + a.getAttribute('href')),
    badge: Boolean(document.querySelector('[data-soul-xslt="compat"]')),
    url: location.href,
    rawXml: document.documentElement.textContent.includes('<rss>'),
  })`);
  assert.deepEqual(rendered.entries, ['Первая|https://example.test/1', 'Вторая|https://example.test/2']);
  assert.equal(rendered.url, feedUrl, 'the address bar keeps the real URL after the transform');
  assert.equal(rendered.rawXml, false, 'raw XML markup is replaced by the transformed document');
  assert.equal(stylesheetRequests, 1, 'stylesheet fetched once');
  console.log('PASS XSLT: xml-stylesheet instruction rendered into HTML');

  // Stylesheet caching: reloading reuses the cached stylesheet.
  await invoke('reload', tab.id);
  await expect.poll(async () => read(feedUrl, `document.getElementById('feed-title')?.textContent || ''`), { timeout: 15000 }).toBe('Библиотека 33');
  assert.equal(stylesheetRequests, 1, 'cached stylesheet is reused');

  // XML without a stylesheet stays raw XML — the layer must not touch it.
  const plainUrl = `${site}/plain.xml`;
  const plainTab = await invoke('createTab', { url: plainUrl });
  await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(item => item.id === plainTab.id)).toMatchObject({ isLoading: false });
  // Chromium may show an XML response as a document or as plain text; either
  // way the layer must leave a stylesheet-less document untouched.
  const plain = await read(plainUrl, `({
    badge: Boolean(document.querySelector('[data-soul-xslt]')),
    text: document.body?.innerText || document.documentElement?.textContent || '',
  })`);
  assert.equal(plain.badge, false, 'plain XML is not rewritten');
  assert.match(plain.text, /<note>/, 'stylesheet-less XML keeps its raw markup');

  // A stylesheet calling document() is rejected; the failed transform is
  // explained in the page instead of failing silently.
  const forbiddenUrl = `${site}/forbidden.xml`;
  const forbiddenTab = await invoke('createTab', { url: forbiddenUrl });
  await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(item => item.id === forbiddenTab.id)).toMatchObject({ isLoading: false });
  // The reason is rendered either as its own error document or as an injected
  // bar; both must name the rejected function instead of failing silently.
  await expect.poll(async () => {
    const state = await read(forbiddenUrl, `({
      bar: document.querySelector('[data-soul-xslt="error"]')?.textContent || '',
      title: document.title || '',
      text: (document.body?.innerText || '').slice(0, 400),
    })`);
    const blob = `${state?.bar || ''} ${state?.title || ''} ${state?.text || ''}`;
    return blob.includes('document()') ? 'document()' : JSON.stringify(state);
  }, { timeout: 20000 }).toBe('document()');

  // The setting disables the whole layer.
  await invoke('updateSettings', { xsltSupport: false });
  const disabledUrl = `${site}/feed.xml?off=1`;
  const disabledTab = await invoke('createTab', { url: disabledUrl });
  await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(item => item.id === disabledTab.id)).toMatchObject({ isLoading: false });
  const disabled = await read(disabledUrl, `({ badge: Boolean(document.querySelector('[data-soul-xslt]')), hasHeading: Boolean(document.getElementById('feed-title')) })`);
  assert.equal(disabled.badge, false, 'disabled setting performs no transform');
  assert.equal(disabled.hasHeading, false);
  await invoke('updateSettings', { xsltSupport: true });
  console.log('PASS XSLT: caching, plain XML isolation, security policy and the settings switch');
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}

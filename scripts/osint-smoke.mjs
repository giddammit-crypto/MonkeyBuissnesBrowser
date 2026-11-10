import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-osint-'));
const server = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('X-Powered-By', 'Fixture platform');
  response.setHeader('Content-Security-Policy', "script-src 'nonce-cspsecret'");
  response.setHeader('Set-Cookie', 'hidden=cookiesecret');
  response.end('<html lang="ru"><title>OSINT fixture</title><meta name="generator" content="Fixture CMS"><a href="https://external.example.org/?key=linksecret">external</a><form action="http://forms.example.org/?key=formsecret"><input value="fieldsecret"></form></html>');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/?key=pagesecret`;
let app;
try {
  app = await electron.launch({
    executablePath: process.env.SOUL_EXECUTABLE,
    args: [
      ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '--no-proxy-server', `--user-data-dir=${profile}`, '.',
    ],
  });
  const shell = await app.firstWindow();
  const errors = [];
  shell.on('pageerror', error => errors.push(error.message));
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  await shell.waitForSelector('.app-shell');
  await app.evaluate(({ session }) => {
    globalThis.__dnsRequests = [];
    session.fromPartition('persist:northstar-default').protocol.handle('https', request => {
      const url = new URL(request.url);
      if (url.hostname !== 'dns.google' || url.pathname !== '/resolve') return new Response(null, { status: 404 });
      globalThis.__dnsRequests.push({ name: url.searchParams.get('name'), type: url.searchParams.get('type') });
      const Answer = url.searchParams.get('type') === 'A' ? [{ name: 'example.org.', type: 1, TTL: 60, data: '192.0.2.1' }] : [];
      return Response.json({ Status: 0, Answer });
    });
  });
  const tab = await invoke('createTab', { url });
  await expect.poll(async () => (await invoke('getSnapshot')).tabs.find(item => item.id === tab.id)).toMatchObject({ title: 'OSINT fixture', isLoading: false });
  await shell.getByRole('button', { name: 'Меню браузера', exact: true }).click();
  await shell.getByRole('button', { name: 'OSINT · Исследовать сайт', exact: true }).click();
  const panel = shell.getByRole('region', { name: 'OSINT', exact: true });
  await panel.getByRole('button', { name: 'Анализировать вкладку' }).click();
  await expect(panel.getByText('Fixture CMS')).toBeVisible();
  await expect(panel.getByText('Ответ HTTP · 200')).toBeVisible();
  const input = panel.getByRole('textbox', { name: 'Публичный домен или адрес сайта' });
  await input.fill('https://example.org/?key=dnssecret');
  assert.deepEqual(await app.evaluate(() => globalThis.__dnsRequests), []);
  await panel.getByRole('button', { name: 'Проверить DNS' }).click();
  await expect(panel.getByText('192.0.2.1', { exact: true })).toBeVisible();
  const requests = await app.evaluate(() => globalThis.__dnsRequests);
  assert.equal(requests.length, 7);
  assert(requests.every(request => request.name === 'example.org'));
  await panel.getByRole('button', { name: 'Скопировать отчёт JSON' }).click();
  await expect(panel.getByRole('status')).toHaveText('Отчёт скопирован');
  const report = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert(!/secret/.test(report));
  const parsed = JSON.parse(report);
  assert.deepEqual(parsed.page.evidence.linkOrigins, ['https://external.example.org']);
  assert.deepEqual(parsed.page.evidence.forms, { count: 1, external: 1, http: 1 });
  assert.equal(parsed.page.evidence.http.status, 200);
  assert.equal(parsed.publicSources.length, 5);
  await panel.getByRole('button', { name: /ICANN/ }).click();
  await expect.poll(async () => {
    const snapshot = await invoke('getSnapshot');
    return { source: snapshot.tabs.some(item => item.url === 'https://lookup.icann.org/en/lookup?name=example.org'), active: snapshot.activeTabId };
  }).toEqual({ source: true, active: tab.id });
  await expect(panel).toBeVisible();
  await invoke('navigate', tab.id, new URL('/next', url).href);
  await expect(panel.getByRole('button', { name: 'Скопировать отчёт JSON' })).toBeDisabled();
  await expect(panel.getByText('Fixture CMS')).toHaveCount(0);
  await invoke('createTab', { isPrivate: true });
  await assert.rejects(() => invoke('getOsintPage', tab.id), /обычной вкладке/);
  await assert.rejects(() => invoke('getOsintDns', 'example.org'), /обычной вкладке/);
  assert.deepEqual(errors, []);
  console.log('PASS passive page inspection, observed headers, consent-only DNS, redacted report and private isolation');
} finally {
  await app?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}

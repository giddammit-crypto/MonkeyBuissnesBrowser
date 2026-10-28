import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron } from '@playwright/test';

// Real Electron + IPC + DOM, with a deterministic local OpenAI-compatible server.
// Never sends real credentials or visits third-party pages.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voodoo-smoke-'));
let app;
let round = 0;
let cancelling = false;
let started;
let tabId;
const tool = (name, args) => ({ id: `call_${round}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Agent fixture</title><textarea id="draft"></textarea><button id="go" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#draft\').value">Apply</button><p id="result"></p>');
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (body.max_tokens === 3) { res.end(JSON.stringify({ choices: [{ message: { content: '1' } }] })); return; }
  if (cancelling) { started?.(); return; }
  round++;
  let message;
  if (round === 1) message = { tool_calls: [tool('fill_input', { tab_id: tabId, selector: '#draft', text: 'Многошаговый агент' })] };
  else if (round === 2) {
    assert.match(body.messages.at(-1).content, /"success":true/);
    message = { tool_calls: [tool('click_element', { tab_id: tabId, selector: '#go' })] };
  } else if (round === 3) message = { tool_calls: [tool('read_page', { tab_id: tabId })] };
  else {
    assert.match(body.messages.at(-1).content, /Многошаговый агент/);
    message = { content: 'Выполнено и проверено.' };
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message }] }));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
try {
  app = await electron.launch({ args: ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox', `--user-data-dir=${profile}`, '.'] });
  const shell = await app.firstWindow();
  await shell.waitForSelector('.app-shell');
  const invoke = (method, ...args) => shell.evaluate(({ method, args }) => window.browserApi[method](...args), { method, args });
  await invoke('updateSettings', { voodooKeys: ['smoke-fake-key-only'], voodooBaseUrl: `${base}/v1`, voodooModel: 'fixture' });
  await shell.evaluate(() => { window.__voodooProgress = []; window.browserApi.onTabEvent(event => { if (event.type === 'voodoo-agent-progress') window.__voodooProgress.push(event.message); }); });
  tabId = (await invoke('createTab', { url: base })).id;
  const result = await invoke('sendVoodooMessage', [{ role: 'user', content: 'Заполни поле, нажми Apply, проверь результат.' }]);
  assert.equal(result.error, undefined);
  assert.equal(result.executedActions.length, 3);
  assert.equal(round, 4);
  assert.ok(await shell.evaluate(() => window.__voodooProgress.some(message => message.includes('Шаг 3'))));
  const text = await app.evaluate(({ webContents }, base) => webContents.getAllWebContents().find(c => c.getURL() === `${base}/`).executeJavaScript('document.querySelector("#result").textContent'), base);
  assert.equal(text, 'Многошаговый агент');
  console.log('PASS real IPC → multi-round provider → textarea → click → read');
  cancelling = true;
  const observed = new Promise(resolve => { started = resolve; });
  const pending = invoke('sendVoodooMessage', [{ role: 'user', content: 'Долгая задача' }]);
  await Promise.race([observed, new Promise((_, reject) => setTimeout(() => reject(new Error('Provider did not start')), 10000))]);
  await invoke('cancelVoodooRequest');
  const cancelled = await pending;
  assert.equal(cancelled.error, 'cancelled');
  console.log('PASS cancellation aborts real pending provider request');
} finally {
  if (app) {
    await app.evaluate(({ BaseWindow }) => { for (const window of BaseWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    await app.close();
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
}

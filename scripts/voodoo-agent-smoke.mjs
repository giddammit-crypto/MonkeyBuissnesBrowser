import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { _electron as electron, expect } from '@playwright/test';

// Real Electron + IPC + DOM, with a deterministic local OpenAI-compatible server.
// Never sends real credentials or visits third-party pages.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voodoo-smoke-'));
let app;
let round = 0;
let cancelling = false;
let workflowRound = 0;
let workflow = false;
let started;
let tabId;
const tool = (name, args) => ({ id: `call_${round}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'fixture', context_length: 600000 }] })); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    if (req.url === '/source-a') { res.end('<title>Источник A</title><article>A=12; ' + 'Подтвержденные данные. '.repeat(30) + 'END_A</article>'); return; }
    if (req.url === '/source-b') { res.end('<title>Источник B</title><article>B=18; END_B</article>'); return; }
    res.end('<title>Agent fixture</title><textarea id="draft"></textarea><button id="go" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#draft\').value">Apply</button><p id="result"></p>');
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (body.max_tokens === 3) { res.end(JSON.stringify({ choices: [{ message: { content: '1' } }] })); return; }
  if (cancelling) { started?.(); return; }
  if (workflow) {
    workflowRound++;
    const steps = ['Прочитать два источника полностью', 'Сравнить и сохранить отчёт', 'Проверить сохранённый файл'];
    const plan = completed => tool('update_plan', { steps, completed_steps: completed });
    const output = (name, args = {}) => ({ tool_calls: [tool(name, args)] });
    let message;
    switch (workflowRound) {
      case 1: message = { tool_calls: [plan(0)] }; break;
      case 2: message = { content: 'Сейчас подготовлю сравнение.' }; break;
      case 3: message = output('open_url', { url: `${base}/source-a`, new_tab: true }); break;
      case 4: message = output('read_page', { max_length: 32 }); break;
      case 5: {
        const observation = [...body.messages].reverse().find(item => item.role === 'tool' && item.name === 'read_page');
        const page = JSON.parse(observation.content).result;
        assert.equal(page.next_start, 32);
        message = output('read_page', { start: page.next_start });
        break;
      }
      case 6:
        assert.match(JSON.stringify(body.messages), /END_A/);
        message = output('open_url', { url: `${base}/source-b`, new_tab: true }); break;
      case 7: message = output('read_page'); break;
      case 8:
        assert.match(JSON.stringify(body.messages), /END_B/);
        message = { tool_calls: [plan(1)] }; break;
      case 9: message = output('create_file', { filename: 'comparison.md', folder: 'documents', content: '# Сравнение\nA=12; B=18; разница=6\nИсточники: ' + base + '/source-a, ' + base + '/source-b' }); break;
      case 10: message = { tool_calls: [plan(2)] }; break;
      case 11: message = output('read_file', { filename: 'comparison.md', folder: 'documents' }); break;
      case 12:
        assert.match(JSON.stringify(body.messages), /разница=6/);
        message = output('list_tabs'); break;
      case 13: message = { tool_calls: [plan(3)] }; break;
      case 14: message = { content: 'Два источника сравнены. Отчёт сохранён и прочитан для проверки.' }; break;
      default: throw new Error('Workflow failed to finish within expected rounds');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
    return;
  }
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
  app = await electron.launch({ executablePath: process.env.SOUL_EXECUTABLE, args: ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox', `--user-data-dir=${profile}`, '.'] });
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
  const documentsPath = path.join(profile, 'documents');
  fs.mkdirSync(documentsPath);
  await app.evaluate(({ app }, folder) => app.setPath('documents', folder), documentsPath);
  workflow = true;
  const complex = await invoke('sendVoodooMessage', [{ role: 'user', content: 'Прочитай два источника, сравни числа и сохрани отчёт. Проверь файл.' }]);
  assert.equal(complex.error, undefined);
  assert.equal(complex.contextUsage.requestedWindowTokens, 250000);
  assert.equal(complex.contextUsage.effectiveWindowTokens, 250000);
  assert.equal(complex.contextUsage.providerLimitKnown, true);
  assert.equal(workflowRound, 14);
  assert.ok(complex.executedActions.some(action => action.tool === 'update_plan'));
  assert.match(fs.readFileSync(path.join(documentsPath, 'comparison.md'), 'utf8'), /A=12; B=18; разница=6/);
  assert.ok(complex.executedActions.some(action => action.tool === 'read_file' && !action.error));
  console.log('PASS 14-round plan → premature reply recovery → two sources → pagination → comparison file → read-back');
  workflow = false;
  await shell.locator('.sidebar').getByRole('button', { name: 'Настройки', exact: true }).click();
  const contextSelector = shell.locator('#voodoo-context-window');
  await contextSelector.scrollIntoViewIfNeeded();
  await expect(contextSelector).toHaveValue('250000');
  await contextSelector.selectOption('128000');
  await expect.poll(async () => (await invoke('getSnapshot')).settings.voodooContextWindowTokens).toBe(128000);
  console.log('PASS context settings UI → persisted budget → provider metadata integration');
  cancelling = true;
  const observed = new Promise(resolve => { started = resolve; });
  const pending = invoke('sendVoodooMessage', [{ role: 'user', content: 'Долгая задача' }]);
  await Promise.race([observed, new Promise((_, reject) => setTimeout(() => reject(new Error('Provider did not start')), 10000))]);
  await invoke('cancelVoodooRequest');
  const cancelled = await pending;
  assert.equal(cancelled.error, 'cancelled');
  assert.equal(cancelled.contextUsage.requestedWindowTokens, 128000);
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

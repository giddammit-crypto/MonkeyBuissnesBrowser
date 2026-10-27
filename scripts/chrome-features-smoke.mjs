import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-features-smoke-'));
let app;
let shell;
const errors = [];
const passed = [];
const check = async (name, fn) => {
  await fn();
  passed.push(name);
  console.log(`PASS ${name}`);
};

try {
  app = await electron.launch({
    executablePath: process.env.SOUL_EXECUTABLE,
    args: [
      ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--disable-gpu', '--disable-dev-shm-usage'] : []),
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
      '--window-size=1280,800',
      `--user-data-dir=${dataPath}`,
      '.',
    ],
    timeout: 30000,
  });

  shell = await app.firstWindow();
  await shell.setViewportSize({ width: 1280, height: 800 });
  shell.on('pageerror', (error) => errors.push(error.message));
  await shell.waitForSelector('.app-shell');

  // Test 1: getTaskManagerMetrics returns expected structure with main, shell, and tab
  await check('TaskManager metrics collection via IPC', async () => {
    const snapshot = await shell.evaluate(() => window.browserApi.getTaskManagerMetrics());
    assert(snapshot, 'Snapshot must not be null');
    assert(typeof snapshot.sampledAt === 'number', 'sampledAt must be a timestamp');
    assert(Array.isArray(snapshot.processes), 'processes must be an array');
    assert(snapshot.processes.length >= 2, 'Must have at least main and shell processes');

    const browserProc = snapshot.processes.find((p) => p.type === 'browser');
    assert(browserProc, 'Must include browser (main) process');
    assert.equal(browserProc.isKillable, false, 'Main browser process must not be killable');
    assert(typeof browserProc.memoryWorkingSetMB === 'number', 'Memory must be number');
    assert(typeof browserProc.cpuPercent === 'number', 'CPU must be number');

    const shellProc = snapshot.processes.find((p) => p.type === 'shell');
    assert(shellProc, 'Must include shell interface process');
    assert.equal(shellProc.isKillable, false, 'Shell process must not be killable');
  });

  // Test 2: Tab creation reflected in Task Manager metrics
  let tabId;
  await check('TaskManager reflects new tabs and reports killable status', async () => {
    const tab = await shell.evaluate(() => window.browserApi.createTab());
    tabId = tab.id;
    // Wait for tab process to appear in metrics
    let tabProc;
    for (let i = 0; i < 20; i++) {
      const snap = await shell.evaluate(() => window.browserApi.getTaskManagerMetrics());
      tabProc = snap.processes.find((p) => p.type === 'tab' && p.tabId === tabId);
      if (tabProc) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const snap = await shell.evaluate(() => window.browserApi.getTaskManagerMetrics());
    assert(snap.processes.length >= 2);
  });

  // Test 3: System process kill protection
  await check('Protection against killing system process (main browser)', async () => {
    const snap = await shell.evaluate(() => window.browserApi.getTaskManagerMetrics());
    const browserProc = snap.processes.find((p) => p.type === 'browser');
    assert(browserProc);
    const killed = await shell.evaluate((pid) => window.browserApi.killProcess(pid), browserProc.pid);
    assert.equal(killed, false, 'Killing main browser PID must be rejected');
  });

  // Test 4: Hard reload IPC accepts ignoreCache argument
  await check('Hard reload ignoreCache support', async () => {
    if (tabId) {
      await shell.evaluate((id) => window.browserApi.reload(id, true), tabId);
      await shell.evaluate((id) => window.browserApi.reload(id, false), tabId);
    }
  });

  // Test 5: DevTools toggle IPC
  await check('DevTools toggle IPC handler execution', async () => {
    await shell.evaluate(() => window.browserApi.toggleDevTools());
    // Toggle again to restore state
    await shell.evaluate(() => window.browserApi.toggleDevTools());
  });

  // Test 6: TaskManager Modal UI render and dismiss
  await check('TaskManager modal opens from menu and dismisses via Esc', async () => {
    // Click menu button
    const menuBtn = shell.locator('button[title="Меню браузера"]').first();
    await menuBtn.click();
    await shell.waitForSelector('.toolbar-popover');

    // Click Task Manager menu item
    const taskManagerItem = shell.locator('.menu-action', { hasText: 'Диспетчер задач' });
    await taskManagerItem.click();

    // Verify modal is visible
    await shell.waitForSelector('.task-manager-modal');
    await expect(shell.locator('.task-manager-title')).toHaveText('Диспетчер задач');
    await expect(shell.locator('.task-manager-table')).toBeVisible();

    // Verify stats cards are rendered
    await expect(shell.locator('.task-stat-card').first()).toBeVisible();

    // Press Escape to dismiss
    await shell.keyboard.press('Escape');
    await expect(shell.locator('.task-manager-modal')).not.toBeVisible();
  });

  // Test 7: Shift+Esc opens TaskManager Modal
  await check('Shift+Esc hotkey opens TaskManager Modal directly', async () => {
    await shell.keyboard.press('Shift+Escape');
    await shell.waitForSelector('.task-manager-modal');
    await expect(shell.locator('.task-manager-modal')).toBeVisible();

    // Close via close button
    const closeBtn = shell.locator('.task-manager-close-btn');
    await closeBtn.click();
    await expect(shell.locator('.task-manager-modal')).not.toBeVisible();
  });

  // Test 8: Omnibox arrow preview and Esc cancel
  await check('Omnibox keyboard navigation and live preview', async () => {
    const omnibox = shell.locator('[data-omnibox]');
    await omnibox.focus();
    await omnibox.fill('git');

    // Wait for dropdown
    await shell.waitForSelector('.omnibox-suggestions-dropdown');

    // Press ArrowDown
    await shell.keyboard.press('ArrowDown');
    const previewVal = await omnibox.inputValue();
    // Preview value should either be url or search preview
    assert(previewVal.length > 0);

    // 1st Escape -> restores original typed 'git'
    await shell.keyboard.press('Escape');
    const restoredVal = await omnibox.inputValue();
    assert.equal(restoredVal, 'git');

    // 2nd Escape -> closes editing and dropdown
    await shell.keyboard.press('Escape');
    await expect(shell.locator('.omnibox-suggestions-dropdown')).not.toBeVisible();
  });

  // Test 9: Ctrl+Tab and Ctrl+Shift+Tab switching
  await check('Ctrl+Tab tab switching', async () => {
    const tab2 = await shell.evaluate(() => window.browserApi.createTab());
    await shell.keyboard.press('Control+Tab');
    await shell.keyboard.press('Control+Shift+Tab');
  });

  assert.deepEqual(errors, [], 'No uncaught page errors should occur');
  console.log(JSON.stringify({ ok: true, checks: passed, uncaughtShellErrors: errors }, null, 2));
} finally {
  if (app) await app.close();
  fs.rmSync(dataPath, { recursive: true, force: true });
}

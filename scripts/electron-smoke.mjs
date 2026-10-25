import { chromium } from '@playwright/test';

const endpoint = process.env.NORTHSTAR_CDP ?? 'http://127.0.0.1:9333';
const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const shell = context.pages().find((page) => page.url().startsWith('app://shell/'));

if (!shell) throw new Error('Northstar shell target was not found over CDP.');

const created = await shell.evaluate(() => window.browserApi.createTab({ url: 'http://127.0.0.1:4174/index.html' }));
await new Promise((resolve) => setTimeout(resolve, 1500));
const remote = context.pages().find((page) => page.url().includes('127.0.0.1:4174'));
if (!remote) throw new Error('Remote WebContentsView target was not found.');

const firstTitle = await remote.title();
if (firstTitle !== 'Northstar Fixture') throw new Error(`Unexpected first title: ${firstTitle}`);

await shell.evaluate((tabId) => window.browserApi.navigate(tabId, 'http://127.0.0.1:4174/second.html'), created.id);
await remote.waitForURL('http://127.0.0.1:4174/second.html');
const secondTitle = await remote.title();
if (secondTitle !== 'Northstar Second') throw new Error(`Unexpected second title: ${secondTitle}`);

console.log(JSON.stringify({ ok: true, firstTitle, secondTitle, tabId: created.id }));
await browser.close();

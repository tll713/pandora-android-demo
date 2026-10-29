import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.PANDORA_RUNTIME_MODULES || path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const browser = await chromium.launch({ channel: process.env.PANDORA_BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai', locale: 'zh-CN', isMobile: true, hasTouch: true });
const page = await context.newPage();
const today = await page.evaluate(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});
const tasks = Array.from({ length: 5 }, (_, i) => ({
  id: `layout-${i}`, title: `密集任务 ${i + 1}`, detail: '', owners: ['lin'], priority: ['high', 'medium', 'low'][i % 3],
  dueAt: `${today}T${String(9 + i).padStart(2, '0')}:30`, status: 'todo', creator: 'manager', createdAt: `${today}T08:00:00Z`,
  revision: 1, deleted: false, history: []
}));
const db = { version: 2, members: [], requests: [], tasks, logs: [{ id: 'layout-log', author: 'lin', date: today, title: '个人日志', content: '仅首页显示', versions: [] }],
  announcements: [{ id: 'layout-news', title: '公司重要展示项', content: '首页信息', category: '通知' }], pins: { lin: ['layout-0'] }, allowedAssignees: [] };

try {
  await page.route('**/api/workspace', route => route.fulfill({ json: { user: { id: 'lin', name: '林予安', role: '员工', department: '产品设计部' }, db } }));
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await page.evaluate(() => localStorage.setItem('pandora.token', 'layout-test'));
  await page.reload();
  await page.locator('.dashboard-page').waitFor();
  assert.equal(await page.locator('.dashboard-tile').count(), 4);
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false, 'home should fit in one viewport');
  assert.equal(await page.locator('[data-route="tasks"]').count(), 0, 'standalone task navigation should be removed');
  await page.locator('.dashboard-tile').first().locator('.tile-open').click();
  assert.match(await page.locator('#modal').innerText(), /公司 10 大重要展示项/);
  await page.locator('[data-close]').click();

  await page.locator('[data-route="calendar"]').click();
  assert.equal(await page.locator('.calendar-event-bar').count(),6);
  await page.locator('.calendar-day.is-today .day-date').click();
  await page.locator('[data-mode=day]').click();
  assert.equal(await page.locator('.timeline-item').count(),6);
  assert.equal(await page.locator('.timeline-item.event--log').count(),1);
  await page.locator('[data-task-view="list"]').click();
  assert.equal(await page.locator('.task-table tbody tr').count(),5);
  await page.locator('[data-task-view="calendar"]').click();
  await page.locator('[data-action="calendar-back"]').click();
  await page.locator('.calendar-day.is-today .day-date').click();
  await page.locator('[data-mode=day]').click();
  assert.equal(await page.locator('.timeline-item').count(),6);
  for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.locator('[data-route="dashboard"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false, `${viewport.width}x${viewport.height} home should remain one screen`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${viewport.width}px home should not overflow horizontally`);
  }
  console.log('UI layout smoke passed: single-screen home, four tiles, task-and-log calendar, and task list in views.');
} finally {
  await browser.close();
}

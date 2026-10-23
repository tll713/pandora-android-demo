import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const runtime = process.env.PANDORA_RUNTIME_MODULES || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(runtime, 'playwright'));
const browser = await chromium.launch({ channel: process.env.PANDORA_BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', isMobile: true, hasTouch: true });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.clock.install({ time: new Date('2026-10-23T10:00:00+08:00') });

const member = { id: 'manager', name: '沈知夏', role: 'DEPT_MANAGER', roleName: '部门负责人', department: '产品设计部', avatar: '夏', color: 'green' };
const tasks = Array.from({ length: 10 }, (_, index) => ({
  id: `t${index + 1}`, title: `日程事项 ${index + 1}`, detail: '', owners: ['manager'], creator: 'manager',
  dueAt: `2026-10-23T${String(8 + index).padStart(2, '0')}:00`, status: index === 9 ? 'done' : 'doing', priority: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'medium' : 'low', history: []
}));
const db = { members: [member], logs: [], tasks, requests: [], announcements: [], pins: {} };
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  const body = url.pathname.endsWith('/auth/login') ? { token: 'calendar-ui-token', user: member } : { user: member, db };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await page.locator('[name="username"]').fill('manager');
  await page.locator('[name="password"]').fill('manager');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.nav .nav-item').first().waitFor();
  assert.deepEqual(await page.locator('.nav .nav-item').allTextContents(), ['⌂首页', '✎日志', '▦视图', '◯我的']);
  assert.equal(await page.locator('.nav [data-route="tasks"]').count(), 0);
  await page.locator('.nav [data-route="calendar"]').click();
  assert.equal(await page.locator('.calendar-panel--month .day-task').count(), 0);
  assert.equal(await page.locator('.calendar-panel--month [data-day="2026-10-23"].day-summary').textContent(), '+610 项');
  await page.locator('.calendar-panel--month [data-day="2026-10-23"].day-summary').click();
  await page.locator('.calendar-day-timeline').waitFor();
  assert.equal(await page.locator('.timeline-item').count(), 10);
  assert.deepEqual(await page.locator('.timeline-item time').allTextContents(), ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['四项底部导航且无任务入口', '月格隐藏任务标题并显示10项标记', '点击日期后时间线按截止时间排序'] }, null, 2));
} finally {
  await browser.close();
}

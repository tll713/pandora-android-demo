import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const runtime = process.env.PANDORA_RUNTIME_MODULES || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(runtime, 'playwright'));
const browser = await chromium.launch({ channel: process.env.PANDORA_BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const member = { id: 'admin', name: '系统管理员', role: 'ADMIN', department: '管理中心' };
const tags = [
  { id: 'design', name: '设计', color: '#1abc9c' },
  { id: 'meeting', name: '会议 <评审>', color: '#9b59b6' },
  { id: 'light', name: '浅色标签', color: '#ffffff' },
  { id: 'dark', name: '深色标签', color: '#000000' }
];
const tasks = [...tags.map(tag => ({ id: tag.id, tagId: tag.id })), { id: 'untagged' }, { id: 'removed', tagId: 'removed-tag' }]
  .map((task, index) => ({ title: `任务 ${task.id}`, owners: ['admin'], creator: 'admin', priority: 'high', status: index === 1 ? 'done' : 'doing',
    startAt: index === 0 ? '2026-11-02T09:00' : '2026-11-03T09:00', dueAt: '2026-11-03T18:00', createdAt: '2026-11-01T09:00', detail: '查看任务标签与颜色', history: [], ...task }));
const db = { members: [member], tasks, tags, logs: [], requests: [], announcements: [], highlights: [], pins: {} };
await page.clock.install({ time: new Date('2026-11-03T12:00:00+08:00') });
await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify(route.request().url().endsWith('/auth/login') ? { token: 'tag-ui-token', user: member } : { user: member, db }) }));
const computedColors = locator => locator.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, text: getComputedStyle(el).color }));
const expected = {
  design: { background: 'rgb(26, 188, 156)', text: 'rgb(0, 0, 0)' },
  meeting: { background: 'rgb(155, 89, 182)', text: 'rgb(255, 255, 255)' },
  light: { background: 'rgb(255, 255, 255)', text: 'rgb(0, 0, 0)' },
  dark: { background: 'rgb(0, 0, 0)', text: 'rgb(255, 255, 255)' }
};
try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await page.locator('[name=identifier]').fill('系统管理员');
  await page.locator('[name=password]').fill('admin');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('[data-route=calendar]').click();
  for (const tag of tags) {
    const card = page.locator(`.zoom-event[data-id=${tag.id}]`).first();
    assert.deepEqual(await computedColors(card), expected[tag.id], 'month cards use the exact tag color');
    await card.click();
    assert.equal(await page.locator('.task-tag').innerText(), tag.name);
    assert.deepEqual(await computedColors(page.locator('.task-tag')), expected[tag.id]);
    assert.equal(await page.locator('.task-tag > *').count(), 0, 'tag names render as text');
    await page.locator('[data-close]').click();
    assert.deepEqual(await computedColors(page.locator(`.calendar-selected-task[data-id=${tag.id}]`)), expected[tag.id]);
  }
  for (const id of ['untagged', 'removed']) {
    await page.locator(`.zoom-event[data-id=${id}]`).first().click();
    assert.equal(await page.locator('.task-tag').innerText(), '未设置标签');
    await page.locator('[data-close]').click();
  }
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#toast')).opacity === '0');
  await mkdir('deliverables/verification', { recursive: true });
  await page.screenshot({ path: 'deliverables/verification/task-tag-month.png', fullPage: true });
  await page.locator('.zoom-event[data-id=meeting]').first().click();
  await page.screenshot({ path: 'deliverables/verification/task-tag-detail.png', fullPage: true });
  await page.locator('[data-close]').click();
  await page.locator('[data-action=calendar-zoom-toggle]').click();
  const dots = await page.locator('.task-dot').evaluateAll(elements => elements.map(el => getComputedStyle(el).backgroundColor));
  // The collapsed view intentionally shows at most three markers per date.
  for (const id of ['design', 'dark', 'light']) assert.ok(dots.includes(expected[id].background));
  await page.locator('[data-action=calendar-zoom-toggle]').click();
  for (const tag of tags) assert.equal((await computedColors(page.locator(`.zoom-bar[data-id=${tag.id}]`).first())).background, expected[tag.id].background);
  await page.locator('[data-action=calendar-zoom-toggle]').click();
  await page.locator('.calendar-selected-agenda [data-mode=day]').click();
  for (const tag of tags) {
    const event = page.locator(`.timeline-item[data-id=${tag.id}]`);
    assert.deepEqual(await computedColors(event), expected[tag.id], 'day events keep tag colors, including completed and spanning tasks');
    await event.click();
    assert.equal(await page.locator('.task-tag').innerText(), tag.name);
    await page.locator('[data-close]').click();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['exact tag colors across three month zoom levels and day events', 'detail tags display from month and day events', 'light and dark labels remain readable', 'untagged and removed tags fall back safely', 'completed and cross-day tasks retain tag colors'] }, null, 2));
} finally {
  await browser.close();
}

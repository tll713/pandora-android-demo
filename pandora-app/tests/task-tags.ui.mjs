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
const expected = Object.fromEntries(tags.map(tag => {
  const rgb = [1,3,5].map(offset => parseInt(tag.color.slice(offset,offset+2),16));
  return [tag.id,{background:`rgb(${rgb.map(v => Math.round(v*0.12+255*0.88)).join(', ')})`,text:`rgb(${rgb.map(v => Math.round(v*0.44)).join(', ')})`}];
}));
const luminance = color => {
  const channels = color.match(/\d+/g).map(Number).map(v => v/255).map(v => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4);
  return channels[0]*0.2126 + channels[1]*0.7152 + channels[2]*0.0722;
};
try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await page.locator('[name=identifier]').fill(member.name);
  await page.locator('[name=password]').fill('admin');
  await page.locator('[data-form=login] button[type=submit]').click();
  await page.locator('[data-route=calendar]').click();
  assert.equal(await page.locator('.month-task-span').evaluateAll(els => els.filter(el => el.dataset.spanStart <= '2026-11-03' && el.dataset.spanEnd >= '2026-11-03').length),3);
  assert.equal(await page.locator('.month-task-span[data-id=design]').getAttribute('data-span-start'),'2026-11-02');
  assert.equal(await page.locator('.month-task-span[data-id=design]').getAttribute('data-span-end'),'2026-11-03');
  await page.locator('[data-event-day="2026-11-03"] .calendar-more').click();
  assert.equal(await page.locator('.overflow-task').count(),6);
  for (const tag of tags) {
    const badge = page.locator(`.overflow-task[data-id=${tag.id}] .task-tag`);
    const colors = await computedColors(badge);
    assert.deepEqual(colors,expected[tag.id]);
    const contrast = (luminance(colors.background)+0.05)/(luminance(colors.text)+0.05);
    assert.ok(contrast>=4.5,`readable label ${tag.id}: ${contrast}`);
    assert.equal(await badge.innerText(),tag.name);
    assert.equal(await badge.locator('> *').count(),0);
  }
  await page.locator('[data-close]').click();
  await page.locator('.calendar-selected-agenda [data-mode=day]').click();
  for (const tag of tags) {
    const event = page.locator(`.timeline-item[data-id=${tag.id}]`);
    assert.deepEqual(await computedColors(event),expected[tag.id]);
    await event.click();
    assert.equal(await page.locator('.task-tag').innerText(),tag.name);
    await page.locator('[data-close]').click();
  }
  const fallbackColors = await computedColors(page.locator('.timeline-item[data-id=untagged]'));
  assert.deepEqual(await computedColors(page.locator('.timeline-item[data-id=removed]')),fallbackColors);
  await page.locator('[data-task-view=list]').click();
  assert.equal(await page.locator('.task-table .task-tag').count(),6);
  await page.locator('[data-action=new-task]').click();
  const choice = page.locator('.tag-choice').filter({hasText:tags[1].name});
  await choice.click(); assert.equal(await choice.locator('input').isChecked(),true);
  assert.deepEqual(await computedColors(choice),expected.meeting);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['pastel labels with WCAG AA contrast including white and black source colors','three month items plus expandable overflow','escaped label names','cross-day and completed tasks retain colors','removed labels use safe fallback','task list labels and colored selection']},null,2));
} finally { await browser.close(); }

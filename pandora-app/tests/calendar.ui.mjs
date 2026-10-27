import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const runtime = process.env.PANDORA_RUNTIME_MODULES || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(runtime, 'playwright'));
const browser = await chromium.launch({ channel: process.env.PANDORA_BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', isMobile: true, hasTouch: true });
const page = await context.newPage(), errors = [];
const output=path.resolve('deliverables/verification'); await mkdir(output,{recursive:true});
page.on('pageerror', error => errors.push(error.message));
await page.clock.install({ time: new Date('2026-10-23T10:00:00+08:00') });

const member = { id: 'manager', name: '沈知夏', role: 'DEPT_MANAGER', roleName: '部门负责人', department: '产品设计部', avatar: '夏', color: 'green' };
const tasks = Array.from({ length: 10 }, (_, index) => ({
  id: `t${index + 1}`, title: `日程事项 ${index + 1}`, detail: '核对客户需求，准备具体方案与验收材料。', owners: ['manager'], creator: 'manager', createdAt:'2026-10-22T09:00:00',
  dueAt: `2026-10-23T${String(index === 1 ? 8 : 8 + index).padStart(2, '0')}:00`, status: index === 9 ? 'done' : 'doing', priority: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'medium' : 'low', history: [{at:'2026-10-23T09:00:00',actor:'manager',text:'已整理主要资料，待确认最终安排'}]
}));
const highlights=[
  {id:'h2',kind:'company',position:2,title:'第二项公司重点',content:'第二项详情',enabled:true,audience:''},
  {id:'h1',kind:'company',position:1,title:'第一项公司重点',content:'<script>不应执行</script>\n重要事项完整正文',enabled:true,audience:''},
  {id:'h3',kind:'personal',position:1,title:'我的重点',content:'个人事项完整正文',enabled:true,audience:'manager'},
  {id:'h4',kind:'personal',position:1,title:'他人的重点',content:'不应展示',enabled:true,audience:'other'},
  {id:'h5',kind:'company',position:3,title:'已停用的重点',content:'不应展示',enabled:false,audience:''},
  {id:'h6',kind:'dispatch',position:1,title:'本周重要派发',content:'查看关联任务',taskId:'t1',enabled:true,audience:''}
];
const db = { members: [member], logs: [], tasks, requests: [], announcements: [], pins: {}, highlights };
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  const body = url.pathname.endsWith('/auth/login') ? { token: 'calendar-ui-token', user: member } : { user: member, db };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await page.locator('[name="identifier"]').fill('沈知夏');
  await page.locator('[name="password"]').fill('manager');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.nav .nav-item').first().waitFor();
  await page.clock.runFor(3500);
  assert.equal(await page.locator('.dashboard-head [data-action="new-log"]').count(),0);
  assert.deepEqual(await page.locator('.nav .nav-item').allTextContents(), ['⌂首页', '✎日志', '▦视图', '◯我的']);
  assert.equal(await page.locator('.nav [data-route="tasks"]').count(), 0);
  assert.deepEqual(await page.locator('.dashboard-tile').first().locator('.tile-row-main b').allTextContents(),['第一项公司重点','第二项公司重点']);
  assert.equal(await page.getByText('他人的重点',{exact:true}).count(),0);
  assert.equal(await page.getByText('已停用的重点',{exact:true}).count(),0);
  await page.getByRole('button',{name:/第一项公司重点/}).click();
  assert.match(await page.locator('#modal').innerText(),/重要事项完整正文/);
  assert.equal(await page.locator('#modal script').count(),0);
  await page.locator('[data-close]').click();
  await page.getByRole('button',{name:/本周重要派发/}).click();
  await page.getByRole('button',{name:'查看关联任务',exact:true}).click();
  assert.equal(await page.locator('#modal-title').textContent(),'日程事项 1');
  await page.locator('[data-close]').click();
  await page.locator('.nav [data-route="calendar"]').click();
  await page.screenshot({path:path.join(output,'calendar-date-picker.png'),fullPage:true});
  await page.screenshot({path:path.join(output,'calendar-mobile.png')});
  assert.equal(await page.locator('.calendar-panel--month .day-task').count(), 0);
  assert.equal(await page.locator('.calendar-panel--month [data-day="2026-10-23"].day-summary').textContent(), '+610 项');
  await page.locator('.calendar-panel--month [data-day="2026-10-23"].day-summary').click();
  assert.equal(await page.locator('.calendar-panel--month').count(),1);
  await page.locator('.calendar-day-timeline').waitFor();
  assert.equal(await page.locator('.timeline-item').count(), 10);
  assert.deepEqual(await page.locator('.timeline-item time').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('datetime').slice(11,16))), ['08:00', '08:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']);
  assert.match(await page.locator('.timeline-item').first().innerText(),/负责人 · 沈知夏/);
  assert.match(await page.locator('.timeline-item').first().innerText(),/核对客户需求/);
  assert.match(await page.locator('.timeline-item').first().innerText(),/最新动态/);
  await page.locator('.timeline-item').first().click();
  assert.equal(await page.locator('#modal-title').textContent(),'日程事项 1');await page.locator('[data-close]').click();
  await page.locator('[data-action=next]').click();assert.equal(await page.locator('[data-calendar-date]').inputValue(),'2026-11-23');
  await page.locator('[data-action=prev]').click();assert.equal(await page.locator('[data-calendar-date]').inputValue(),'2026-10-23');
  await page.locator('[data-mode=week]').click();
  assert.equal(await page.locator('.calendar-panel--week .calendar-day').count(),7);
  await page.locator('[data-day="2026-10-22"].day-date').click();assert.equal(await page.locator('.timeline-item').count(),0);
  await page.locator('[data-action=today]').click();assert.equal(await page.locator('.timeline-item').count(),10);
  await page.screenshot({path:path.join(output,'calendar-week-agenda.png'),fullPage:true});
  await page.locator('[data-mode=day]').click();
  assert.equal(await page.locator('.calendar-hour').count(),24);
  assert.equal(await page.locator('.calendar-hour').nth(8).locator('.timeline-item').count(),2);
  assert.ok(await page.locator('.calendar-hour-timeline .timeline-list').evaluate(el=>el.scrollTop)>0,'日视图默认定位首项事务');
  await page.screenshot({path:path.join(output,'calendar-hour-agenda.png'),fullPage:true});
  await page.locator('[data-calendar-date]').fill('2026-12-25');
  await page.locator('.calendar-day-timeline').waitFor();
  assert.equal(await page.locator('[data-calendar-date]').inputValue(),'2026-12-25');
  assert.equal(await page.locator('.timeline-item').count(),0);
  await page.locator('[data-action="new-task"]').click();
  assert.equal(await page.locator('[name="dueAt"]').inputValue(),'2026-12-25T18:30');
  await page.locator('[data-close]').click();
  await page.locator('[data-action="today"]').click();
  assert.equal(await page.locator('.timeline-item').count(),10);
  await page.locator('[data-task-view="list"]').click();
  assert.equal(await page.locator('.task-table tbody tr').count(),10);
  await page.screenshot({path:path.join(output,'tasks-table-filters.png'),fullPage:true});
  await page.getByRole('searchbox',{name:'搜索任务'}).fill('日程事项 10');
  await page.locator('[data-form="task-filter"] [type="submit"]').click();
  assert.equal(await page.locator('.task-table tbody tr').count(),1);
  await page.locator('[data-action="clear-task-search"]').click();
  await page.locator('[name="priority"]').selectOption('high');
  await page.locator('[data-form="task-filter"] [type="submit"]').click();
  assert.equal(await page.locator('.task-table tbody tr').count(),4);
  for(const width of [360,390,412,1280]) {
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,`${width} task list`);
    await page.locator('[data-task-view="calendar"]').click();
    for(const mode of ['month','week','day']) {
      await page.locator(`[data-mode=${mode}]`).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,`${width} ${mode}`);
      assert.equal(await page.locator('.timeline-item').count(),10);
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,`${width} calendar`);
    await page.locator('[data-task-view="list"]').click();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['十大内容排序、详情、隐私与关联任务', '月周选日保留日期区并显示事务说明、负责人和动态', '日视图24小时与同时间多事务', '跨月、空日期、日期直接跳转和今天返回', '任务表格筛选', '360/390/412/1280月周日布局无溢出'] }, null, 2));
} finally {
  await browser.close();
}

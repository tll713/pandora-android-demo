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
  const mode = async value => {await page.getByRole('button',{name:'切换日历视图',exact:true}).click();await page.locator(`#modal [data-mode=${value}]`).click();};
  await page.screenshot({path:path.join(output,'calendar-iphone-month.png'),fullPage:true});
  assert.equal(await page.locator('body.calendar-active').count(),1);
  assert.deepEqual(await page.locator('.calendar-week span').allTextContents(),['日','一','二','三','四','五','六']);
  assert.ok(await page.locator('.day-date').first().evaluate(el=>el.querySelector('small').getBoundingClientRect().top >= el.querySelector('span').getBoundingClientRect().bottom),'lunar date sits below the day number');
  assert.equal(await page.locator('.calendar-day.is-today').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(247, 248, 244)');
  assert.equal(await page.locator('.calendar-event-bar').count(),10);
  assert.equal(await page.locator('.calendar-selected-task').count(),10);
  assert.equal(await page.locator('.ios-calendar').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(247, 248, 244)');
  await page.locator('.calendar-event-bar').first().click();
  assert.equal(await page.locator('#modal-title').innerText(),'日程事项 1');await page.locator('[data-close]').click();
  await page.locator('.day-date[data-day="2026-10-23"]').click();
  await page.locator('[data-mode=day]').click();
  assert.equal(await page.locator('.calendar-hour').count(),24);
  assert.equal(await page.locator('.calendar-hour').nth(8).locator('.timeline-item').count(),2);
  assert.ok(await page.locator('.timeline-list').evaluate(el=>el.scrollTop)>0);
  await page.screenshot({path:path.join(output,'calendar-iphone-day.png'),fullPage:true});
  assert.match(await page.locator('.timeline-header').innerText(),/2026年10月23日/);
  await page.locator('.timeline-item').first().click();
  assert.match(await page.locator('#modal').innerText(),/核对客户需求/);
  assert.match(await page.locator('#modal').innerText(),/已整理主要资料/);
  await page.locator('[data-close]').click();
  await page.locator('[data-calendar-date]').fill('2026-12-25');
  assert.equal(await page.locator('.calendar-hour').count(),24,'empty dates retain hourly grid');
  assert.equal(await page.locator('.timeline-item').count(),0);
  assert.ok(await page.locator('[data-hour="8"]').evaluate(el=>Math.abs(el.getBoundingClientRect().top - el.closest('.timeline-list').getBoundingClientRect().top)<15),'empty day opens at 08:00');
  await page.locator('[data-action=new-task]').click();
  assert.equal(await page.locator('[name=dueAt]').inputValue(),'2026-12-25T18:30');
  await page.locator('[data-close]').click();
  await page.locator('[data-action=today]').click();
  assert.equal(await page.locator('.timeline-item').count(),10);
  await page.locator('[data-action=calendar-back]').click();
  assert.equal(await page.locator('.ios-calendar--month').count(),1);
  await page.locator('[data-action=next]').click();assert.equal(await page.locator('[data-calendar-date]').inputValue(),'2026-11-23');
  await page.locator('[data-action=prev]').click();assert.equal(await page.locator('[data-calendar-date]').inputValue(),'2026-10-23');
  await page.locator('[data-action=calendar-back]').click();
  await page.locator('[data-calendar-month="2026-12-01"]').click();
  assert.equal(await page.locator('.ios-month-title').innerText(),'十二月');
  await page.locator('[data-action=today]').click();
  await page.locator('[data-action=calendar-search]').click();
  assert.equal(await page.locator('body.calendar-active').count(),0,'other pages retain normal appearance');
  assert.equal(await page.locator('.task-table tbody tr').count(),10);
  await page.getByRole('searchbox',{name:'搜索任务',exact:true}).fill('日程事项 10');
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
    for(const value of ['month','week','day']) {
      await mode(value);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false,`${width} ${value}`);
      assert.ok(await page.locator('.ios-calendar-footer').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight), 'footer must stay visible');
      if(value!=='month') assert.equal(await page.locator('.timeline-item').count(),10);
    }
    await page.locator('[data-task-view="list"]').click();
  }
  await page.setViewportSize({width:390,height:844});
  await page.clock.setFixedTime(new Date('2026-10-28T17:41:00+08:00'));
  await page.locator('[data-task-view="calendar"]').click();
  await mode('month');
  await page.locator('[data-calendar-date]').fill('2026-10-28');
  await mode('month');
  await page.screenshot({path:path.join(output,'calendar-iphone-month-final.png'),fullPage:true});
  await page.locator('[data-day="2026-10-10"]').click();
  await page.locator('[data-mode=day]').click();
  await page.screenshot({path:path.join(output,'calendar-iphone-day-final.png'),fullPage:true});
  await page.setViewportSize({width:360,height:640});
  await page.locator('[data-calendar-date]').fill('2026-08-31');
  await mode('month');
  assert.equal(await page.locator('.calendar-day').count(),42,'six-row months are complete');
  await page.locator('[data-day="2026-08-31"]').scrollIntoViewIfNeeded();
  assert.ok(await page.locator('.ios-calendar-footer').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),'short screen retains today and date controls');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('[data-day="2026-08-31"]').click();
  await page.locator('[data-mode=day]').click();
  assert.match(await page.locator('.timeline-header').innerText(),/2026年8月31日/);
  tasks.push({id:'week-long',title:'持续一周的客户方案',startAt:'2026-10-26T09:00',dueAt:'2026-11-01T18:00',owners:['manager'],creator:'manager',priority:'medium',status:'doing',history:[]});
  tasks.push({id:'overlap-span',title:'同步准备评审材料',startAt:'2026-10-28T10:00',dueAt:'2026-10-30T17:00',owners:['manager'],creator:'manager',priority:'low',status:'todo',history:[]});
  tasks.push({id:'private-span',title:'无权限的跨天任务',startAt:'2026-10-26T09:00',dueAt:'2026-11-01T18:00',owners:['other'],creator:'other',priority:'low',status:'todo',history:[]});
  await page.reload();await page.locator('.nav [data-route=calendar]').click();
  await page.locator('[data-calendar-date]').fill('2026-10-28');await mode('month');
  const bar = page.locator('.calendar-event-bar[data-id=week-long]');
  assert.equal(await bar.count(),1);
  assert.equal(await bar.getAttribute('data-span-start'),'2026-10-26');
  assert.equal(await bar.getAttribute('data-span-end'),'2026-10-31');
  assert.equal(await bar.evaluate(el=>el.style.gridColumn),'2 / span 6');
  assert.notEqual(await bar.evaluate(el=>el.style.gridRow),await page.locator('.calendar-event-bar[data-id=overlap-span]').evaluate(el=>el.style.gridRow),'overlapping intervals use separate rows');
  assert.equal(await page.locator('[data-id=private-span]').count(),0);
  for(const day of ['2026-10-26','2026-10-28','2026-10-31']) {
    await page.locator(`[data-day="${day}"]`).click();
    assert.equal(await page.locator('.calendar-selected-task[data-id=week-long]').count(),1,day);
  }
  await page.locator('[data-day="2026-10-25"]').click();
  assert.equal(await page.locator('.calendar-selected-task[data-id=week-long]').count(),0);
  await page.locator('[data-day="2026-10-28"]').click();
  await page.screenshot({path:path.join(output,'calendar-light-spanning-month.png'),fullPage:true});
  await page.locator('.calendar-selected-task[data-id=week-long]').click();
  assert.match(await page.locator('#modal').innerText(),/开始 · 10月26日 09:00/);
  assert.match(await page.locator('#modal').innerText(),/结束 · 11月01日 18:00/);
  await page.locator('[data-close]').click();await mode('day');
  assert.equal(await page.locator('.timeline-all-day [data-id=week-long]').count(),1);
  await page.screenshot({path:path.join(output,'calendar-light-spanning-day.png'),fullPage:true});
  await page.locator('[data-calendar-date]').fill('2026-11-01');await mode('month');
  assert.equal(await page.locator('.calendar-event-bar[data-id=week-long]').getAttribute('data-span-end'),'2026-11-01');
  assert.equal(await page.locator('.calendar-selected-task[data-id=week-long]').count(),1);
  await page.locator('[data-day="2026-11-02"]').click();
  assert.equal(await page.locator('.calendar-selected-task[data-id=week-long]').count(),0);
  tasks.find(t=>t.id==='week-long').startAt='2026-10-23T09:00';
  await page.reload();await page.locator('.nav [data-route=calendar]').click();
  await page.locator('[data-calendar-date]').fill('2026-10-26');await mode('month');
  assert.equal(await page.locator('.calendar-event-bar[data-id=week-long]').count(),2,'cross-week interval continues on next row');
  for (const size of [{width:360,height:640},{width:390,height:844},{width:412,height:844},{width:1280,height:900}]) {
    await page.setViewportSize(size);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('.calendar-selected-task[data-id=week-long]').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.ios-calendar-footer').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({passed:true,checks:['首页重点隐私与详情','原配色、农历与起止日期连续任务条','月日切换与日期跳转','全天日志与24小时时间线、同小时多任务','任务搜索、筛选及新建日期','跨周跨月、重叠任务、包含起止日与隐私、多种尺寸']},null,2));
} finally {await browser.close();}

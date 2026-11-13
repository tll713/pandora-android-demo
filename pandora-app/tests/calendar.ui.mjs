import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium, browserChannel } from '../../scripts/browser-test.mjs';
const browser = await chromium.launch({ channel: browserChannel, headless: true });
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
  const calendarUrl = new URL(route.request().url());
  if (calendarUrl.pathname === '/api/calendar/metadata') return route.fulfill({json:{year:Number(calendarUrl.searchParams.get('year')),published:false,source:'',holidays:{},solarTerms:{}}});
  const url = new URL(route.request().url());
  if(url.pathname.endsWith('/tags')) return route.fulfill({json:[]});
  const body = url.pathname.endsWith('/auth/login') ? { token: 'calendar-ui-token', user: member } : { user: member, db };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

const close = () => page.locator('[data-close]').click();
const mode = value => page.locator(`.calendar-mode-tabs [data-mode="${value}"]`).click();
async function jump(date) {
  await mode('month');
  await page.locator('[data-action=calendar-back]').click();
  await page.locator('[data-form=calendar-jump] [name=date]').fill(date);
  await page.locator('[data-form=calendar-jump] button[type=submit]').click();
}
try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await page.locator('[name=identifier]').fill(member.name);
  await page.locator('[name=password]').fill('fixture-password');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.locator('.dashboard-page').waitFor();
  assert.match((await page.locator('.nav [data-route=calendar]').innerText()),/公司/);
  assert.deepEqual(await page.locator('.dashboard-tile').first().locator('.tile-row-main b').allTextContents(),['第一项公司重点','第二项公司重点']);
  assert.equal(await page.getByText('他人的重点',{exact:true}).count(),0);
  assert.equal(await page.getByText('已停用的重点',{exact:true}).count(),0);
  await page.locator('[data-action=highlight][data-id=h1]').click();
  assert.match(await page.locator('#modal').innerText(),/重要事项完整正文/);
  assert.equal(await page.locator('#modal script').count(),0);await close();
  await page.locator('.dashboard-tile [data-action=task][data-id=t1]').click();
  assert.equal(await page.locator('#modal-title').innerText(),'日程事项 1');await close();
  await page.locator('.nav [data-route=calendar]').click();
  assert.deepEqual(await page.locator('.calendar-week span').allTextContents(),['日','一','二','三','四','五','六']);
  assert.ok(await page.locator('.day-date').first().evaluate(el=>el.querySelector('small').getBoundingClientRect().top >= el.querySelector('span').getBoundingClientRect().bottom));
  assert.equal(await page.locator('.month-task-span').count(),3);
  assert.equal(await page.locator('.calendar-selected-task').count(),3);
  await page.locator('.calendar-selected-agenda [data-action=calendar-overflow]').click();
  assert.equal(await page.locator('.overflow-task').count(),10,'overflow retains all tasks');
  await page.locator('.overflow-task[data-id=t10]').click();
  assert.equal(await page.locator('#modal-title').innerText(),'日程事项 10');await close();
  await page.screenshot({path:path.join(output,'calendar-iphone-month.png'),fullPage:true});
  await mode('week');
  assert.equal(await page.locator('.calendar-hour').count(),24);
  assert.equal(await page.locator('[data-hour="8"] .timeline-item').count(),2);
  assert.equal(await page.locator('.timeline-item').count(),10);
  await page.locator('.timeline-item').first().click();
  assert.match(await page.locator('#modal').innerText(),/核对客户需求/);
  assert.match(await page.locator('#modal').innerText(),/已整理主要资料/);await close();
  await jump('2026-12-25');
  assert.equal(await page.locator('.calendar-hour').count(),24);
  assert.equal(await page.locator('.timeline-item').count(),0);
  await page.locator('[data-hour="8"]').scrollIntoViewIfNeeded();
  assert.ok(await page.locator('[data-hour="8"]').isVisible(),'working hours remain reachable');
  await page.locator('[data-action=new-task]').click();
  assert.equal(await page.locator('[name=dueAt]').inputValue(),'2026-12-25T18:30');await close();
  await page.locator('[data-action=today]').click();
  assert.equal(await page.locator('.timeline-item').count(),10);
  await mode('month');await page.locator('[data-action=calendar-back]').click();
  await page.locator('[data-calendar-month="2026-12-01"]').click();
  assert.equal(await page.locator('.ios-month-title').innerText(),'十二月');
  await page.locator('[data-action=today]').click();
  await page.locator('[data-task-view=list]').click();
  assert.equal(await page.locator('.task-table tbody tr').count(),10);
  await page.getByRole('searchbox',{name:'搜索任务',exact:true}).fill('日程事项 10');
  await page.getByRole('searchbox',{name:'搜索任务',exact:true}).press('Enter');
  assert.equal(await page.locator('.task-table tbody tr:visible').count(),1);
  await page.locator('[data-action=clear-task-search]').click();
  await page.locator('[name=priority]').selectOption('high');
  assert.equal(await page.locator('.task-table tbody tr').count(),4);
  await page.locator('[data-action=clear-task-search]').click();
  await page.locator('[data-task-view=calendar]').click();
  for(const size of [{width:360,height:640},{width:390,height:844},{width:412,height:844},{width:1280,height:900}]) {
    await page.setViewportSize(size);
    for(const value of ['month','week']) {
      await mode(value);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${size.width} ${value}`);
      assert.ok(await page.locator('.calendar-view-row').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight));
      if(value!=='month') assert.equal(await page.locator('.timeline-item').count(),10);
    }
  }
  await jump('2026-08-31');await mode('month');
  assert.equal(await page.locator('.calendar-day').count(),42,'six-row month is complete');
  await page.locator('[data-day="2026-08-31"]').click();await mode('week');
  assert.match(await page.locator('.timeline-header').innerText(),/2026年8月31日/);
  tasks.push({id:'week-long',title:'持续一周的客户方案',startAt:'2026-10-26T09:00',dueAt:'2026-11-01T18:00',owners:['manager'],creator:'manager',priority:'medium',status:'doing',history:[]});
  tasks.push({id:'overlap-span',title:'同步准备评审材料',startAt:'2026-10-28T10:00',dueAt:'2026-10-30T17:00',owners:['manager'],creator:'manager',priority:'low',status:'todo',history:[]});
  tasks.push({id:'private-span',title:'无权限的跨天任务',startAt:'2026-10-26T09:00',dueAt:'2026-11-01T18:00',owners:['other'],creator:'other',priority:'low',status:'todo',history:[]});
  await page.reload();await page.locator('.nav [data-route=calendar]').click();
  await jump('2026-10-28');await mode('month');
  const bar=page.locator('.month-task-span[data-id=week-long]');
  assert.equal(await bar.count(),1);
  assert.equal(await bar.getAttribute('data-span-start'),'2026-10-26');
  assert.equal(await bar.getAttribute('data-span-end'),'2026-10-31');
  assert.equal(await bar.evaluate(el=>el.style.gridColumn),'2 / span 6');
  assert.notEqual(await bar.getAttribute('data-lane'),await page.locator('.month-task-span[data-id=overlap-span]').getAttribute('data-lane'));
  assert.equal(await page.locator('[data-id=private-span]').count(),0);
  for(const day of ['2026-10-26','2026-10-28','2026-10-31']) {
    await page.locator(`[data-day="${day}"]`).click();
    assert.equal(await page.locator('.calendar-selected-task[data-id=week-long]').count(),1,day);
  }
  await page.locator('[data-day="2026-10-25"]').click();
  assert.equal(await page.locator('.calendar-selected-task[data-id=week-long]').count(),0);
  await page.locator('[data-day="2026-10-28"]').click();
  await page.screenshot({path:path.join(output,'calendar-light-spanning-month.png'),fullPage:true});
  await mode('week');
  assert.equal(await page.locator('.timed-agenda [data-id=week-long]').count(),1);
  await jump('2026-11-01');await mode('month');
  assert.equal(await page.locator('.month-task-span[data-id=week-long]').getAttribute('data-span-end'),'2026-11-01');
  assert.equal(await page.locator('.calendar-selected-task[data-id=week-long]').count(),1);
  await page.locator('[data-day="2026-11-02"]').click();
  assert.equal(await page.locator('.calendar-selected-task[data-id=week-long]').count(),0);
  tasks.find(t=>t.id==='week-long').startAt='2026-10-23T09:00';
  await page.reload();await page.locator('.nav [data-route=calendar]').click();
  await jump('2026-10-26');await mode('month');
  assert.equal(await page.locator('.month-task-span[data-id=week-long]').count(),2,'interval continues across weeks');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['重点隐私与转义','密集任务溢出仍可访问全部任务','日期跳转与24小时时间线','任务搜索与即时筛选','跨周跨月重叠任务、起止日及隐私','四种屏幕尺寸']},null,2));
} finally {await browser.close();}

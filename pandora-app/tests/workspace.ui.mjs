import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium, browserChannel } from '../../scripts/browser-test.mjs';
const browser = await chromium.launch({channel:browserChannel,headless:true});
const context = await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',locale:'zh-CN',hasTouch:true});
const page = await context.newPage(), errors = [], moves = [];
page.on('pageerror',e => errors.push(e.message));
await page.clock.install({time:new Date('2026-11-11T12:00:00+08:00')});
const members = [
  {id:'admin',name:'系统管理员',role:'ADMIN',roleName:'管理员',department:'管理中心'},
  {id:'lin',name:'林予安',role:'EMPLOYEE',roleName:'员工',department:'产品设计部'},
  {id:'zhou',name:'周一鸣',role:'TEAM_LEAD',roleName:'团队长',department:'产品设计部'},
  {id:'chen',name:'陈嘉宁',role:'EMPLOYEE',roleName:'员工',department:'市场运营部'}
];
let current = members[0], failMove = false, failHistory = false, historyCalls = 0;
const tags = [{id:'design',name:'设计 <评审>',color:'#1abc9c'},{id:'urgent',name:'紧急',color:'#e74c3c'}];
const tasks = Array.from({length:6},(_,i) => ({id:`t${i}`,title:`任务 ${i}`,detail:'工作内容',owners:['admin'],creator:'admin',startAt:i===0?'2026-11-09T09:00':'2026-11-11T09:00',dueAt:'2026-11-12T18:00',priority:'medium',status:i===5?'done':'doing',tagId:i%2?'urgent':'design',createdAt:'2026-11-01T09:00',history:[]}));
const request = {id:'r1',kind:'create',proposer:'lin',status:'pending',createdAt:'2026-11-11T09:00',after:{title:'新建任务申请',owners:['lin'],startAt:'2026-11-11T09:00',dueAt:'2026-11-12T18:00',priority:'medium',detail:'申请内容'}};
const own = {...request,id:'r2',proposer:'admin',status:'approved',reviewedAt:'2026-11-11T10:00',after:{...request.after,title:'我的申请结果'}};
const db = {members,tags,tasks,requests:[request,own],todos:[{id:'todo1',date:'2026-11-11',title:'保留完成状态的事项',done:true}],logs:[{id:'l1',author:'lin',date:'2026-11-11',title:'产品交付',content:'今日完成设计',tagId:'design',taskId:'t0',versions:[]}],pins:{},highlights:[],allowedAssignees:members,announcements:[]};
await page.route('**/api/**',async route => {
  const calendarUrl = new URL(route.request().url());
  if (calendarUrl.pathname === '/api/calendar/metadata') return route.fulfill({json:{year:Number(calendarUrl.searchParams.get('year')),published:false,source:'',holidays:{},solarTerms:{}}});
  const req = route.request(), url = new URL(req.url());
  const respond = (body,status=200) => route.fulfill({status,json:body});
  if(url.pathname.endsWith('/workspace')) return respond({user:current,db});
  if(url.pathname.endsWith('/directory')) return respond(members);
  if(url.pathname.endsWith('/tags')) return respond(tags);
  if(url.pathname.endsWith('/logs/history')) { historyCalls++; return failHistory ? respond({error:'历史日志加载失败，请重试'},500) : respond([{id:'old-log',author:'lin',date:'2026-11-01',title:'历史日报',content:'完成历史工作',versions:[]}]); }
  if(url.pathname.endsWith('/logs') && req.method()==='POST') {
    const values = req.postDataJSON().values;
    db.logs.push({id:'saved',author:current.id,...values,versions:[]}); return respond({ok:true});
  }
  if(url.pathname.endsWith('/todos/todo1/date')) {
    if(failMove) return respond({error:'移动失败'},400);
    const date = req.postDataJSON().date; moves.push(date); db.todos[0].date=date; return respond(db.todos[0]);
  }
  if(url.pathname.endsWith('/tasks/requests/r1/review')) { request.status='approved';request.reviewedAt='2026-11-11T12:00';return respond({ok:true}); }
  if(url.pathname.endsWith('/logs/l1/comments')) return respond([]);
  return respond({error:`Unexpected API ${url.pathname}`},404);
});
const go = route => page.locator(`.nav [data-route="${route}"]`).click();
const close = () => page.locator('[data-close]').click();
const openMessages = async () => { await go('dashboard'); await page.locator('[data-action="messages-open"]').click(); };
try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await page.evaluate(() => localStorage.setItem('pandora.token','workspace-ui')); await page.reload();
  await page.locator('.dashboard-page').waitFor();
  assert.deepEqual(await page.locator('.nav [data-route]').evaluateAll(els => els.map(el => el.dataset.route)),['dashboard','logs','calendar','mine']);
  assert.equal(await page.locator('[data-route="messages"]').count(),0);
  assert.equal(await page.getByRole('button',{name:'公司公告',exact:true}).count(),0);
  assert.doesNotMatch(await page.locator('.dashboard-page').innerText(),/公司公告/);
  assert.equal(await page.locator('.dashboard-head [data-action="messages-open"]').count(),1);
  assert.equal(await page.locator('.dashboard-tile:nth-child(2) [data-id="t5"]').count(),0);
  assert.equal(await page.locator('.dashboard-tile:nth-child(2) [data-action="task"]').count(),5);
  assert.equal(await page.locator('.todo-month-cell').count(),7);
  await page.locator('[data-action=todo-calendar]').click();
  assert.equal(await page.locator('.todo-month-cell').count(),35);
  await page.locator('[data-todo-drag="todo1"]').first().dragTo(page.locator('[data-todo-drop="2026-11-12"]').first());
  await page.waitForFunction(() => document.querySelector('[data-todo-drop="2026-11-12"] [data-todo-drag="todo1"]'));
  assert.deepEqual(moves,['2026-11-12']); assert.equal(db.todos[0].done,true);
  await page.reload(); await page.locator('[data-action=todo-calendar]').click(); await page.locator('[data-todo-drop="2026-11-12"] [data-todo-drag="todo1"]').waitFor();
  const source = page.locator('[data-todo-drop="2026-11-12"] [data-todo-drag="todo1"]');
  await source.scrollIntoViewIfNeeded();
  const start = await source.boundingBox(), target = await page.locator('[data-todo-drop="2026-11-13"]').first().boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start.x+start.width/2,y:start.y+start.height/2}]});
  await page.clock.runFor(400);
  const liveTarget = await page.locator('[data-todo-drop="2026-11-13"]').boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:liveTarget.x+liveTarget.width/2,y:liveTarget.y+20}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(() => document.querySelector('[data-todo-drop="2026-11-13"] [data-todo-drag="todo1"]'));
  assert.equal(moves.at(-1),'2026-11-13');
  failMove=true;
  await page.locator('[data-todo-drag="todo1"]').first().dragTo(page.locator('[data-todo-drop="2026-11-14"]').first());
  await page.getByText('移动失败',{exact:true}).waitFor();
  assert.equal(db.todos[0].date,'2026-11-13'); failMove=false;
  await page.clock.runFor(700);
  await page.locator('[data-action="todo-select"][data-id="2026-11-13"]').first().click();
  await page.locator('.todo-day [data-action="todo-reschedule"]').first().click();
  await page.locator('[data-form="todo-move"] [name="date"]').fill('2026-12-01');
  await page.getByRole('button',{name:'确认改期',exact:true}).click();
  await page.locator('#modal').waitFor({state:'hidden'});
  assert.match(await page.locator('.todo-day-head').innerText(),/11月13日/);
  await go('calendar');
  const day = page.locator('[data-event-day="2026-11-11"]');
  assert.equal(await page.locator('.month-task-span').evaluateAll(els => els.filter(el => el.dataset.spanStart <= '2026-11-11' && el.dataset.spanEnd >= '2026-11-11').length),3);
  const span = page.locator('.month-task-span[data-id="t0"]');
  assert.equal(await span.count(),1);
  assert.equal(await span.getAttribute('data-span-start'),'2026-11-09');
  assert.equal(await span.getAttribute('data-span-end'),'2026-11-12');
  for (const width of [390,768,1280]) {
    await page.setViewportSize({width,height:844});
    const geometry = await span.evaluate(el => {
      const box = el.getBoundingClientRect(), grid = el.parentElement.getBoundingClientRect();
      return {width:box.width, gridWidth:grid.width, top:box.top, bottom:box.bottom};
    });
    assert.ok(geometry.width > geometry.gridWidth * 0.5, `continuous four-day bar at ${width}`);
    const others = await page.locator('.month-task-span').evaluateAll(els => els.filter(el => el.dataset.spanStart <= '2026-11-11' && el.dataset.spanEnd >= '2026-11-11').map(el => el.getBoundingClientRect().top));
    assert.equal(new Set(others).size,3);
  }
  await page.setViewportSize({width:390,height:844});
  await span.click({position:{x:(await span.boundingBox()).width-6,y:15}});
  await page.locator('#modal').getByText('任务 0',{exact:true}).waitFor(); await close();
  assert.equal(await day.locator('.calendar-more').innerText(),'+3');
  await day.locator('.calendar-more').click(); assert.equal(await page.locator('.overflow-task').count(),6); await close();
  const originalRange = {startAt:tasks[0].startAt,dueAt:tasks[0].dueAt};
  tasks[0].startAt='2026-10-29T09:00'; tasks[0].dueAt='2026-11-16T18:00';
  await page.reload(); await go('calendar');
  const pieces = page.locator('.month-task-span[data-id="t0"]');
  assert.deepEqual(await pieces.evaluateAll(els => els.map(el => [el.dataset.spanStart,el.dataset.spanEnd])),[['2026-11-01','2026-11-07'],['2026-11-08','2026-11-14'],['2026-11-15','2026-11-16']]);
  assert.match(await pieces.nth(0).getAttribute('class'),/continues-before.*continues-after/);
  assert.match(await pieces.nth(1).getAttribute('class'),/continues-before.*continues-after/);
  assert.match(await pieces.nth(2).getAttribute('class'),/continues-before/);
  assert.doesNotMatch(await pieces.nth(2).getAttribute('class'),/continues-after/);
  await mkdir('output/playwright',{recursive:true});
  await page.screenshot({path:'output/playwright/calendar-connected-spans.png',fullPage:true});
  await page.evaluate(() => {
    const el = document.querySelector('.ios-calendar');
    for (const [type,distance] of [['touchstart',100],['touchmove',50]]) {
      const event = new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperty(event,'touches',{value:[{clientX:30,clientY:180},{clientX:30+distance,clientY:180}]});
      el.dispatchEvent(event);
    }
    const end = new Event('touchend',{bubbles:true}); Object.defineProperty(end,'touches',{value:[]}); document.dispatchEvent(end);
  });
  assert.equal(await page.locator('.ios-calendar.zoom-2 .month-task-span.zoom-event[data-id="t0"]').count(),3);
  assert.ok((await pieces.nth(1).boundingBox()).width > 370);
  Object.assign(tasks[0],originalRange); await page.reload(); await go('calendar');
  await page.locator('[data-task-view="list"]').click();
  assert.equal(await page.locator('.task-table .task-tag').count(),6);
  assert.ok((await page.locator('.task-table .task-tag').allTextContents()).includes('设计 <评审>'));
  assert.equal(await page.locator('.task-requests').count(),0);
  await page.locator('[data-action="new-task"]').click();
  const choice = page.locator('.tag-choice').filter({hasText:'设计 <评审>'});
  await choice.click(); assert.equal(await choice.locator('input').isChecked(),true);
  const colors = await choice.evaluate(el => ({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color}));
  assert.notEqual(colors.bg,'rgb(26, 188, 156)'); assert.notEqual(colors.bg,colors.fg); await close();
  await openMessages();
  await page.locator('[data-message-filter="review"]').click(); assert.equal(await page.locator('.message-item').count(),1);
  await page.locator('[data-action="request"]').click();
  await page.locator('[data-action="messages-return"]').click();
  assert.equal(await page.locator('[data-message-filter="review"]').getAttribute('class'),'segment is-active');
  await page.locator('[data-action="request"]').click();
  await page.keyboard.press('Escape');
  await page.locator('.messages-dialog').waitFor();
  await page.locator('[data-action="request"]').click();
  assert.equal(await page.evaluate(() => window.pandoraBack()),true);
  await page.locator('.messages-dialog').waitFor();
  await page.locator('[data-action="request"]').click();
  await page.locator('[name="decision"][value="approve"]').click();
  await page.locator('.message-list .empty-state').waitFor(); assert.equal(request.status,'approved');
  assert.equal(await page.locator('#modal').evaluate(el => el.open),true);
  await page.locator('[data-message-filter="results"]').click();
  assert.equal(await page.locator('.message-item').count(),2,'reviewers see completed requests from other applicants');
  await page.locator('[data-action="request"][data-id="r1"]').click();
  assert.match(await page.locator('#modal').innerText(),/审核结果：已通过/);
  await page.locator('[data-action="messages-return"]').click();
  await page.locator('[data-action="messages-read"]').click(); assert.equal(await page.locator('.message-badge').count(),0);
  await close();
  assert.equal(await page.locator('.dashboard-head [data-action="messages-open"]').evaluate(el => el === document.activeElement),true);
  db.notifications = [
    {id:'n1',kind:'events',targetId:'h1',title:'公司事项更新',summary:'首页事件纪已更新',createdAt:'2026-11-11T12:00'},
    {id:'n2',kind:'tasks',targetId:'t0',title:'任务进展消息',summary:'任务进展已更新',createdAt:'2026-11-11T12:01'}
  ];
  await page.reload(); await openMessages();
  assert.equal(await page.locator('.message-badge').innerText(),'2');
  await page.locator('[data-message-filter="events"]').click(); assert.equal(await page.locator('.message-item').count(),1);
  await page.locator('[data-action="notification"]').click();
  assert.match(await page.locator('#modal').innerText(),/首页事件纪已更新/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.message-badge').innerText(),'1');
  await page.locator('[data-message-filter="tasks"]').click(); assert.equal(await page.locator('.message-item').count(),1);
  await page.locator('[data-action="notification"]').click();
  assert.equal(await page.locator('#modal [data-action="task"]').count(),1);
  await page.locator('[data-action="messages-return"]').click();
  await page.locator('[data-action="messages-read"]').click(); await close();
  await page.reload(); await page.locator('.dashboard-page').waitFor();
  assert.equal(await page.locator('.message-badge').count(),0,'read state survives reload');
  own.status='rejected'; own.reviewedAt='2026-11-11T13:00'; own.reason='需补充信息';
  await page.reload(); await openMessages(); assert.equal(await page.locator('.message-badge').innerText(),'1');
  await close();
  await go('logs');
  assert.equal(await page.locator('.log-results .log-card').count(),0,'admin logs page excludes others');
  assert.equal(await page.locator('[name=department],[name=role],[name=author],[name=submission]').count(),0);
  failHistory=true; await page.locator('[data-log-range="all"]').click();
  await page.locator('[data-action="retry-log-history"]').waitFor(); failHistory=false;
  await page.locator('[data-action="retry-log-history"]').click();
  await page.locator('[data-action="retry-log-history"]').waitFor({state:'detached'}); assert.equal(historyCalls,2);
  assert.equal(await page.locator('.log-results .log-card').count(),0,'loading history keeps the page personal');
  await go('calendar'); await page.locator('[data-task-view=directory]').click();
  await page.locator('[data-action=directory-member][data-id=lin]').click();
  await page.locator('[data-action=directory-tab][data-id=logs]').click();
  await page.getByRole('button',{name:'历史日报',exact:true}).waitFor();
  await page.locator('[data-action=log][data-id=l1]').click();
  assert.equal(await page.locator('[data-form=log-comment]').count(),1);
  await close(); await go('logs');
  await page.locator('[data-action="new-log"]').click(); await page.locator('[data-action="new-log-date"]').first().click();
  await page.locator('[name="content"]').fill('完成需求评审'); await page.locator('[name="plan"]').fill('推进设计'); await page.locator('[name="issues"]').fill('需要资源支持');
  await page.getByRole('button',{name:'保存日志',exact:true}).click();
  await page.locator('#modal').waitFor({state:'hidden'}); assert.match(db.logs.at(-1).content,/【今日完成】\n完成需求评审[\s\S]*【下一步计划】\n推进设计[\s\S]*【问题与协助】\n需要资源支持/);
  await page.clock.runFor(3500);
  await mkdir('output/playwright',{recursive:true});
  for(const width of [390,768,1280]) {
    await page.setViewportSize({width,height:900});
    for(const route of ['dashboard','calendar','logs','mine']) {
      await go(route);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,`${width} ${route} must fit horizontally`);
      await page.screenshot({path:`output/playwright/workspace-${route}-${width}.png`,fullPage:true});
    }
    await openMessages();
    assert.equal(await page.locator('#modal').evaluate(el => el.scrollWidth > el.clientWidth),false,`${width} message dialog fits horizontally`);
    await page.screenshot({path:`output/playwright/workspace-messages-${width}.png`,fullPage:true});
    await close();
  }
  const departmentManager={id:'manager',name:'部门负责人',role:'DEPT_MANAGER',roleName:'部门负责人',department:'产品设计部'};
  members.push(departmentManager); current=departmentManager;
  await page.reload(); await go('logs');
  assert.equal(await page.locator('.log-filter [name="department"]').count(),0);
  assert.equal(await page.locator('.log-filter [name="role"],.log-filter [name="author"]').count(),0);
  assert.equal(await page.locator('h1').innerText(),'我的日志');
  assert.equal(await page.locator('.log-results .log-card').count(),0);
  await page.screenshot({path:'output/playwright/log-department-manager.png',fullPage:true});

  current=members[1]; await page.reload(); await go('logs');
  assert.equal(await page.locator('[name="department"]').count(),0);
  assert.equal(await page.locator('.log-results .log-card').count(),1);
  await openMessages(); assert.equal(await page.locator('[data-message-filter="review"]').count(),1);
  await page.locator('[data-action="messages-read"]').click();
  await page.locator('[data-message-filter="unread"]').click();
  assert.equal(await page.locator('.message-item').count(),0);
  assert.match(await page.locator('.message-list .empty-state').innerText(),/暂无此类消息/);
  assert.equal(await page.evaluate(() => window.pandoraBack()),true);
  assert.equal(await page.locator('#modal').evaluate(el => el.open),false);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['four navigation tabs and home message button','message dialog, return, Escape and Android back','completed board tasks hidden','todo month drag and persisted rescheduling','three calendar tasks with +N expansion','task tags and colored picker','message review, unread counts and empty state','personal logs and directory comments','history failure and retry','structured reports','employee visibility','responsive layout at 390/768/1280'],moves},null,2));
} finally { await browser.close(); }

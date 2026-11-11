import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.PANDORA_RUNTIME_MODULES || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const browser = await chromium.launch({channel:process.env.PANDORA_BROWSER_CHANNEL || 'msedge',headless:true});
const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,
  userAgent:'Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 PandoraAndroid/0.5.4',locale:'zh-CN',timezoneId:'Asia/Shanghai'});
const page = await context.newPage(), errors = [];
page.on('pageerror',error => errors.push(error.message));
const today = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
const member = {id:'admin',name:'系统管理员',role:'ADMIN',department:'管理中心'};
const colleague = {id:'lin',name:'林予安',role:'EMPLOYEE',department:'产品设计部'};
const longText = Array.from({length:35},(_,i) => `${i+1}. 完成客户需求核对、跨部门交付沟通及验收记录，明确下一步负责人和交付时间。`).join('\n');
const adjacent = offset => { const date = new Date(`${today}T12:00:00`); date.setDate(date.getDate()+offset); return date.toLocaleDateString('en-CA'); };
const tasks = Array.from({length:14},(_,i) => ({id:`task${i}`,title:`交付任务 ${i+1}`,detail:longText,owners:['admin'],creator:'admin',startAt:`${i<8?adjacent(-1):today}T09:00`,dueAt:`${i<8?adjacent(1):today}T18:00`,priority:'medium',status:i===13?'done':'doing',createdAt:`${today}T09:00`,history:[{actor:'admin',at:`${today}T10:00`,text:longText}]}));
const db = {members:[member,colleague],tasks,tags:[],todos:Array.from({length:6},(_,i) => ({id:`todo${i}`,date:today,title:`每日事项 ${i+1}：核对交付安排并记录负责人及后续沟通结果`,done:false})),requests:[],pins:{},announcements:[],
  highlights:Array.from({length:10},(_,i) => ({id:`h${i}`,kind:'company',position:i+1,title:`公司事件 ${i+1}`,content:longText,enabled:true})),
  logs:[{id:'log1',author:'lin',date:today,title:'交付与协作日报',content:longText,taskId:'task0',versions:[{title:'初稿',content:longText,at:`${today}T09:00`}]}]};
await page.route('**/api/**',route => {
  const url = route.request().url();
  if (url.endsWith('/toggle')) { const todo = db.todos.find(t => url.endsWith(`/todos/${t.id}/toggle`)); todo.done=!todo.done; return route.fulfill({json:todo}); }
  return route.fulfill({status:200,json:url.endsWith('/comments') ? [{authorName:'系统管理员',createdAt:`${today}T11:00`,content:longText}] : {user:member,db}});
});
const cdp = await context.newCDPSession(page);
const swipeUp = async locator => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const x = box.x+box.width/2, y = box.y+Math.min(box.height-12,150);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for (let step=1;step<=10;step++) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*12}]});
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(250);
};
const checkDialog = async (selectors, shouldScroll = true) => {
  const layout = await page.locator('#modal').evaluate((dialog,selectors) => {
    const box = dialog.getBoundingClientRect();
    return {outerLeft:box.left,outerRight:innerWidth-box.right,overflow:dialog.scrollWidth>dialog.clientWidth,
      insets:selectors.map(selector => {
        const el = dialog.querySelector(selector), rect = el.getBoundingClientRect(), css = getComputedStyle(el);
        return {selector,left:rect.left-box.left+parseFloat(css.paddingLeft),right:box.right-rect.right+parseFloat(css.paddingRight)};
      })};
  },selectors);
  assert.ok(layout.outerLeft>=15 && layout.outerRight>=15);
  assert.equal(layout.overflow,false);
  for (const inset of layout.insets) {
    assert.ok(inset.left>=22 && inset.right>=22,JSON.stringify(inset));
    assert.ok(Math.abs(inset.left-inset.right)<1,JSON.stringify(inset));
  }
  if (shouldScroll) {
    await page.locator('#modal').evaluate(el => { el.scrollTop=0; });
    const headerBefore = await page.locator('#modal .modal-head').boundingBox();
    const closeBefore = await page.locator('#modal [data-close]').boundingBox();
    await swipeUp(page.locator('#modal'));
    assert.ok(await page.locator('#modal').evaluate(el => el.scrollTop)>20,'detail scrolls with touch');
    for (const position of ['middle','bottom']) {
      if (position === 'bottom') await page.locator('#modal').evaluate(el => {el.scrollTop=el.scrollHeight;});
      const headerAfter = await page.locator('#modal .modal-head').boundingBox();
      const closeAfter = await page.locator('#modal [data-close]').boundingBox();
      assert.ok(Math.abs(headerAfter.y-headerBefore.y)<1,`title remains fixed at ${position}`);
      assert.ok(Math.abs(closeAfter.y-closeBefore.y)<1,`close button remains fixed at ${position}`);
      assert.equal(await page.locator('#modal [data-close]').evaluate(el => {
        const box=el.getBoundingClientRect(); return document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.closest('[data-close]')===el;
      }),true,'close stays reachable above the scrolling content');
    }
  }
};
const close = () => page.locator('[data-close]').tap();
try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await page.evaluate(() => localStorage.setItem('pandora.token','mobile-details')); await page.reload();
  await page.locator('.dashboard-page').waitFor();
  await mkdir('output/playwright',{recursive:true});
  for (const width of [360,390,412]) {
    await page.setViewportSize({width,height:width===360?740:844});
    await page.locator('.nav [data-route=dashboard]').tap();
    assert.equal(await page.locator('.dashboard-tile:nth-child(2) .tile-row').count(),13);
    for (const index of [1,2]) {
      const list = page.locator(`.dashboard-tile:nth-child(${index}) .tile-scroll`);
      const sizes = await list.evaluate(el => ({height:el.clientHeight,total:el.scrollHeight}));
      assert.ok(sizes.total>sizes.height,`list ${index} has a bounded scroll area`);
      await list.evaluate(el => {el.scrollTop=0;});
      const pageScroll = await page.evaluate(() => scrollY);
      await swipeUp(list);
      assert.ok(await list.evaluate(el => el.scrollTop)>20,`list ${index} scrolls with a finger at ${width}`);
      assert.ok(Math.abs((await page.evaluate(() => scrollY))-pageScroll)<3,'swipe stays within the list');
      assert.equal(await page.locator('#modal').evaluate(el => el.open),false,'swipe does not open an item');
    }
    await page.screenshot({path:`output/playwright/mobile-home-${width}.png`,fullPage:true});
    await page.locator(`[data-todo-drop="${today}"] .calendar-more`).tap();
    assert.equal(await page.locator('#modal .todo-calendar').count(),0);
    assert.equal(await page.locator('#modal .todo-item').count(),6);
    await checkDialog(['.modal-head','.todo-day-details'],false);
    assert.ok((await page.locator('#modal .todo-day-head').boundingBox()).y<300,'+N opens the day list immediately');
    await page.locator('#modal [data-action=todo-toggle]').first().tap();
    await page.waitForFunction(() => document.querySelector('#modal .todo-item.is-done'));
    assert.equal(await page.locator('#modal').getAttribute('data-todo'),'day');
    await page.screenshot({path:`output/playwright/mobile-todo-day-${width}.png`}); await close();
    await page.locator('[data-action=todo-calendar]').tap();
    await checkDialog(['.modal-head','.todo-calendar']);
    await page.screenshot({path:`output/playwright/mobile-todo-month-${width}.png`}); await close();
    await page.locator('[data-action=company-highlights]').tap();
    await checkDialog(['.modal-head','.highlight-dialog-list']);
    await page.screenshot({path:`output/playwright/mobile-events-${width}.png`}); await close();
    await page.locator('.dashboard-tile:nth-child(2) [data-id=task12]').tap();
    assert.equal(await page.locator('#modal-title').innerText(),'交付任务 13');
    await checkDialog(['.modal-head','.detail-copy','.detail-owner','.detail-actions','.detail-history']);
    await page.screenshot({path:`output/playwright/mobile-task-${width}.png`}); await close();
    await page.locator('[data-action=all-tasks]').tap();
    assert.equal(await page.locator('.task-table tbody tr').count(),14);
    const gutters = await page.locator('.company-panel').evaluate(el => ({left:getComputedStyle(el).paddingLeft,right:getComputedStyle(el).paddingRight}));
    assert.deepEqual(gutters,{left:'20px',right:'20px'});
    await page.locator('.nav [data-route=logs]').tap();
    await page.locator('[data-action=log][data-id=log1]').tap();
    await page.locator('#modal .comment-item').waitFor();
    await checkDialog(['.modal-head','.detail-copy','.log-linked-task','.detail-actions','.detail-history']);
    await page.screenshot({path:`output/playwright/mobile-log-${width}.png`}); await close();
    await page.locator('.nav [data-route=calendar]').tap();
    await page.locator('[data-task-view=calendar]').tap();
    await page.locator(`[data-event-day="${today}"] .calendar-more`).tap();
    assert.equal(await page.locator('#modal .overflow-task').count(),14);
    await checkDialog(['.modal-head','.overflow-task-list']);
    await page.screenshot({path:`output/playwright/mobile-calendar-overflow-${width}.png`}); await close();
    for (const mode of ['week','day']) {
      await page.locator(`.calendar-mode-tabs [data-mode=${mode}]`).tap();
      assert.equal(await page.locator('.calendar-agenda-scroll [data-action=task]').count(),14);
      const first = page.locator('.timeline-all-day [data-id=task0]');
      assert.ok((await first.boundingBox()).width>width/2,'spanning title uses the full card width');
      assert.ok(await page.locator('.calendar-agenda-scroll').evaluate(el=>el.clientHeight)>100);
      const last = page.locator('.hour-events [data-id=task13]');
      await last.scrollIntoViewIfNeeded();
      const rect = await last.boundingBox();
      assert.ok(rect.y>=0 && rect.y+rect.height<= (await page.viewportSize()).height-65,'hourly tasks remain reachable below all-day items');
      await page.screenshot({path:`output/playwright/mobile-calendar-${mode}-${width}.png`});
    }
    await page.locator('.calendar-mode-tabs [data-mode=month]').tap();
    await page.evaluate(() => {
      const el=document.querySelector('.ios-calendar');
      for (const points of [[{clientX:40,clientY:200}],[{clientX:40,clientY:200}],[{clientX:40,clientY:200},{clientX:140,clientY:200}]]) {
        const event=new Event('touchstart',{bubbles:true}); Object.defineProperty(event,'touches',{value:points}); el.dispatchEvent(event);
      }
      const event=new Event('touchmove',{bubbles:true}); Object.defineProperty(event,'touches',{value:[{clientX:40,clientY:200},{clientX:80,clientY:200}]}); el.dispatchEvent(event);
    });
    assert.equal(await page.locator('.ios-calendar.zoom-2').count(),1);
    assert.equal(await page.locator('.zoom-bar,.ios-calendar.zoom-0,.ios-calendar.zoom-1').count(),0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.locator('[data-action=calendar-back]').tap();
  await page.locator('[data-form=calendar-jump] [name=date]').fill('2026-11-30');
  await page.locator('[data-form=calendar-jump] button[type=submit]').tap();
  await page.locator('.calendar-mode-tabs [data-mode=week]').tap();
  assert.equal(await page.locator('[data-day="2026-12-01"]').count(),1,'week strip keeps dates from the adjacent month');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['Android WebView user agent and touch input','independent event and task scrolling at 360/390/412','all unfinished tasks reachable beyond first ten','event, task and log detail gutters and touch scrolling','linked task and comment alignment','task board arrow and task list gutters','todo +N opens all day items immediately and retains the list after toggling','todo month and day detail gutters','week and day tasks remain reachable with many all-day items','month stays at level three after double tap and pinch','week strip includes dates from the adjacent month','calendar overflow, events, todos, tasks and logs keep title and close button fixed through the middle and bottom of scrolling']},null,2));
} finally { await browser.close(); }

import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium,browserChannel} from '../../scripts/browser-test.mjs';

const browser=await chromium.launch({channel:browserChannel,headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,locale:'zh-CN',timezoneId:'Asia/Shanghai'});
const page=await context.newPage(), errors=[], moves=[];
page.on('pageerror',e=>errors.push(e.message));
await page.clock.install({time:new Date('2026-11-13T12:00:00+08:00')});
const members=[{id:'admin',name:'管理员',role:'ADMIN',department:'管理部'},
  {id:'lin',name:'林予安',role:'EMPLOYEE',department:'研发部'},
  {id:'zhou',name:'周一鸣',role:'EMPLOYEE',department:'研发部'}];
const db={members,tags:[],requests:[],pins:{},announcements:[],highlights:[],
  tasks:[{id:'own',title:'我的待办任务',detail:'发布检查',owners:['admin'],creator:'admin',startAt:'2026-11-13T09:00',dueAt:'2026-11-13T18:00',priority:'medium',status:'doing',history:[]},
    {id:'done',title:'已完成任务',detail:'',owners:['admin'],creator:'admin',startAt:'2026-11-13T09:00',dueAt:'2026-11-13T18:00',priority:'medium',status:'done',history:[]},
    {id:'other',title:'其他成员任务',detail:'',owners:['lin'],creator:'admin',startAt:'2026-11-13T09:00',dueAt:'2026-11-13T18:00',priority:'medium',status:'doing',history:[]}],
  todos:Array.from({length:12},(_,i)=>({id:'todo'+i,date:'2026-11-13',title:'事项 '+i,done:i===11})),
  logs:[{id:'real',author:'lin',date:'2026-11-13',title:'实际日报',content:'完成发布',versions:[]},
    {id:'demo-log-zhou',author:'zhou',date:'2026-11-13',demo:true,title:'演示日报',content:'示例内容',versions:[]},
    {id:'previous',author:'zhou',date:'2026-11-12',title:'昨日实际日报',content:'完成设计',versions:[]}]};
let commentFailure=true, historyCalls=0;
await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),send=(json,status=200)=>route.fulfill({json,status});
  if(url.pathname.endsWith('/calendar/metadata')) return send({year:Number(url.searchParams.get('year')),published:false,holidays:{},solarTerms:{}});
  if(url.pathname.endsWith('/workspace')) return send({user:members[0],db});
  if(url.pathname.endsWith('/tags')) return send([]);
  if(url.pathname.endsWith('/logs/history')) {historyCalls++;return send(db.logs);}
  if(url.pathname.endsWith('/comments')) return commentFailure ? send({error:'offline'},503) : send([]);
  const match=url.pathname.match(/\/todos\/([^/]+)\/date(\/undo)?$/);
  if(match) {
    const todo=db.todos.find(t=>t.id===match[1]);
    if(match[2]) {
      assert.equal(req.postDataJSON().token,todo.moveToken);
      todo.date=todo.previousDate;todo.moveToken=null;
    } else {
      const date=req.postDataJSON().date;assert.ok(date>='2026-11-13');moves.push(date);
      todo.previousDate=todo.date;todo.date=date;todo.moveToken='move-'+moves.length;
    }
    return send(todo);
  }
  return send({error:'Unexpected '+url.pathname},404);
});
const go=route=>page.locator(`.nav [data-route=${route}]`).click();
const cdp=await context.newCDPSession(page);
async function longPress(locator) {
  await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2}]});
  await page.clock.runFor(400);
  await page.locator('body.todo-touch-drag').waitFor();
}
async function release(date,type='touchEnd') {
  if(date) {
    const box=await page.locator(`[data-todo-drop="${date}"]`).boundingBox();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width/2,y:box.y+20}]});
  }
  await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[]});
}
try {
  await page.goto(process.env.PANDORA_URL||'http://127.0.0.1:5173');
  await page.evaluate(()=>localStorage.setItem('pandora.token','scheduling-test'));await page.reload();
  await page.locator('.todo-calendar--week').waitFor();
  assert.equal(await page.locator('.todo-month-cell').count(),7);
  assert.equal(await page.locator('[data-action=todo-calendar] svg').innerHTML(),await page.locator('[data-action=all-tasks] svg').innerHTML(),'home tiles share the same arrow');
  await page.locator('[data-action=todo-calendar]').click();
  assert.equal(await page.locator('[data-todo-drop="2026-11-13"] .todo-drag-item').count(),3);
  assert.equal(await page.locator('[data-action=todo-overflow]').innerText(),'+9');
  await page.locator('[data-action=todo-overflow]').click();
  assert.equal(await page.locator('#modal .todo-item').count(),12);
  await mkdir('output/playwright',{recursive:true});
  for(const width of [390,1280]) {
    await page.setViewportSize({width,height:844});
    const box=await page.locator('#modal').boundingBox();
    assert.ok(Math.abs(box.x+box.width/2-width/2)<1 && Math.abs(box.y+box.height/2-422)<1,'all items dialog stays centered in the viewport');
    await page.screenshot({path:`output/playwright/todo-centered-${width}.png`});
  }
  await page.setViewportSize({width:390,height:844});
  const overflowItem=page.locator('#modal [data-todo-drag=todo11]');
  await overflowItem.scrollIntoViewIfNeeded();
  const scrollBefore=await page.locator('#modal .todo-list').evaluate(el=>el.scrollTop);
  await longPress(overflowItem);
  assert.equal(await page.locator('#modal').evaluate(el=>el.open),false);
  await release(null,'touchCancel');
  await page.locator('#modal[open] .todo-list').waitFor();
  assert.equal(await page.locator('#modal .todo-list').evaluate(el=>el.scrollTop),scrollBefore,'cancel restores list position');
  await longPress(overflowItem);await release('2026-11-12');
  await page.locator('#modal[open]').waitFor();assert.equal(moves.length,0,'past dates never reach server');
  await longPress(overflowItem);
  await mkdir('output/playwright',{recursive:true});
  await page.screenshot({path:'output/playwright/todo-overflow-drag.png'});
  await release('2026-11-14');
  await page.getByRole('button',{name:'撤销',exact:true}).waitFor();
  assert.equal(db.todos[11].date,'2026-11-14');assert.equal(db.todos[11].done,true);
  assert.match(await page.locator('.todo-calendar .todo-day-head').innerText(),/11月13日/);
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-todo-drop="2026-11-13"] .calendar-more')?.textContent==='+9');
  assert.equal(db.todos[11].date,'2026-11-13');
  await page.clock.runFor(700);
  await page.locator('[data-action=todo-overflow]').click();
  const mouseItem=page.locator('#modal [data-todo-drag=todo11]');
  await mouseItem.scrollIntoViewIfNeeded();
  const mouseBox=await mouseItem.boundingBox(),mouseX=mouseBox.x+mouseBox.width/2,mouseY=mouseBox.y+mouseBox.height/2;
  await page.mouse.move(mouseX,mouseY);await page.mouse.down();
  await page.mouse.move(mouseX+12,mouseY,{steps:4});
  await page.locator('body.todo-dragging').waitFor();
  await page.locator('[data-todo-drop="2026-11-14"]').scrollIntoViewIfNeeded();
  const mouseTarget=await page.locator('[data-todo-drop="2026-11-14"]').boundingBox();
  await page.mouse.move(mouseTarget.x+mouseTarget.width/2,mouseTarget.y+20,{steps:8});
  await page.mouse.up();
  await page.getByRole('button',{name:'撤销',exact:true}).waitFor();
  assert.equal(db.todos[11].date,'2026-11-14','mouse drag also works from the overflow sheet');
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-todo-drop="2026-11-13"] .calendar-more')?.textContent==='+9');
  await page.clock.runFor(700);
  await page.locator('[data-action=todo-calendar]').click();
  await longPress(page.locator('.todo-calendar .todo-item[data-todo-drag=todo11]'));
  assert.equal(await page.locator('.todo-month-cell').count(),7,'week drag keeps its date strip');
  await release('2026-11-14');
  await page.getByRole('button',{name:'撤销',exact:true}).waitFor();
  assert.equal(db.todos[11].date,'2026-11-14','week selected-day items can be dragged to another date');
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.todo-calendar [data-todo-drag=todo11]'));
  await page.locator('[data-action=all-tasks]').click();
  assert.equal(await page.locator('.task-table tbody tr').count(),1);
  assert.match(await page.locator('.task-table').innerText(),/我的待办任务/);
  await page.locator('[data-task-query]').evaluate(input=>{
    input.focus();input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    input.value='发布';input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
    assertSameInput();
    function assertSameInput() { if(document.querySelector('[data-task-query]')!==input) throw new Error('Chinese composition replaced the active input'); }
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'发布'}));
  });
  await page.locator('[data-task-select][name=priority]').selectOption('medium');
  assert.equal(await page.locator('[data-task-query]').inputValue(),'发布');
  assert.equal(await page.locator('.task-table tbody tr').count(),1);
  await go('calendar');await page.locator('[data-task-view=calendar]').click();
  assert.deepEqual(await page.locator('.calendar-mode-tabs [data-mode]').evaluateAll(els=>els.map(el=>el.dataset.mode)),['month','week']);
  assert.equal(await page.locator('.day-todo-dot').count(),0);
  await go('logs');await page.locator('[name=department]').selectOption('研发部');
  assert.match(await page.locator('.log-submission strong').innerText(),/1 \/ 2/);
  await page.locator('[name=submission]').selectOption('missing');
  assert.match(await page.locator('.log-results').innerText(),/周一鸣/);
  assert.doesNotMatch(await page.locator('.log-results').innerText(),/昨日实际日报|演示日报|实际日报|林予安/);
  assert.equal(await page.locator('.submission-person').count(),1);
  await page.locator('[data-log-member=zhou]').click();
  assert.equal(await page.locator('[name=submission]').inputValue(),'missing');
  await page.locator('[data-action=log-member-history]').click();
  assert.ok(historyCalls>0);assert.match(await page.locator('.log-results').innerText(),/昨日实际日报/);
  await page.locator('[data-action=clear-log-filters]').click();
  await page.locator('[name=department]').selectOption('研发部');
  await page.locator('[name=submission]').selectOption('submitted');
  assert.equal(await page.locator('.log-results .log-card').count(),1);
  assert.match(await page.locator('.log-results').innerText(),/实际日报/);
  await page.locator('[data-action=log][data-id=real]').click();
  await page.locator('#modal [role=alert]').filter({hasText:'评论加载失败，请重试'}).waitFor();
  assert.doesNotMatch(await page.locator('#modal').innerText(),/评论（0）/);
  commentFailure=false;await page.locator('[data-action=retry-log-comments]').click();
  await page.getByText('评论（0）',{exact:true}).waitFor();
  await page.locator('[data-close]').click();
  await page.screenshot({path:'output/playwright/log-submission-filter.png',fullPage:true});
  await go('dashboard');
  for(const width of [360,390,768,1280]) {
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`output/playwright/todo-week-${width}.png`,fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('Scheduling passed: overflow long press, cancel/invalid restore, future-only move, undo, matching task scopes, submission filters, demo exclusion and comment retry.');
} finally {await browser.close();}

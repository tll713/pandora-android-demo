import {selectPickerYear} from './date-picker-helpers.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {USERS,userById,seedDatabase,visibleTasks,visibleRequests,allowedAssignees,allowedReviewers,requestTaskChange,reviewTaskChange} from '../src/domain.js';
import {chromium,browserChannel} from '../../scripts/browser-test.mjs';

USERS.push({id:'other',name:'李审核',role:'ADMIN',roleName:'管理员',department:'运营中心'},
  {id:'disabled',name:'已停用',role:'ADMIN',department:'运营中心',enabled:false});
const now = new Date('2026-11-13T12:00:00+08:00'), db = seedDatabase(now);
let actor = userById('manager');
const errors = [], sent = [];
const browser = await chromium.launch({channel:browserChannel,headless:true});
const context = await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
const page = await context.newPage();
page.on('pageerror',error => errors.push(error.message));
await page.clock.install({time:now});
await page.route('**/api/**',async route => {
  const req = route.request(), url = new URL(req.url()), body = req.postData() ? req.postDataJSON() : {};
  const path = url.pathname.slice(4), send = (json,status=200) => route.fulfill({json,status});
  try {
    if (path === '/auth/login') { actor = USERS.find(u => u.name === body.identifier); return send({token:actor.id,user:actor}); }
    if (path === '/workspace') return send({user:actor,db:{...db,members:USERS,tasks:visibleTasks(db,actor),logs:[],allowedAssignees:allowedAssignees(actor),allowedReviewers:allowedReviewers(actor),requests:visibleRequests(db,actor)}});
    if (path === '/tags') return send([]);
    if (path === '/calendar/metadata') return send({year:Number(url.searchParams.get('year')),published:false,holidays:{},solarTerms:{}});
    if (path === '/tasks/requests') { sent.push(body); return send(requestTaskChange(db,actor,body.kind,body.values,body.taskId,now,body.reviewers)); }
    if (path.endsWith('/review')) return send(reviewTaskChange(db,actor,path.split('/')[3],body.approve,body.reason,now));
    return send({error:`Unexpected ${path}`},404);
  } catch (error) { return send({error:error.message},400); }
});
const action = (name,id) => page.locator(`[data-action="${name}"]${id ? `[data-id="${id}"]` : ''}`).first().click();
const go = route => page.locator(`.nav [data-route="${route}"]`).click();
const closed = () => page.locator('#modal').waitFor({state:'hidden'});
async function login(id) {
  await page.evaluate(() => {localStorage.removeItem('pandora.token');});
  await page.reload();
  await page.locator('[name=identifier]').fill(userById(id).name);
  await page.locator('[name=password]').fill('fixture');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.locator('.dashboard-page').waitFor();
}
async function openRequest(id) { await action('messages-open'); await action('request',id); }
try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173'); await login('manager');
  await go('calendar'); await action('new-task');
  await page.locator('[name=title]').fill('多级审核人选择验收');
  assert.equal(await page.locator('[data-reviewer-department]').count(),4);
  assert.equal(await page.locator('[data-reviewer-department]').first().getAttribute('data-reviewer-department'),'管理中心');
  await page.locator('[data-reviewer-department="管理中心"]').click();
  assert.deepEqual(await page.locator('[data-reviewer-role]').evaluateAll(els => els.map(el => el.dataset.reviewerRole)),['创始人','管理员']);
  await page.locator('[data-reviewer-department="管理中心"]').click();
  await page.locator('[data-reviewer-query]').fill('不存在');
  await page.locator('[data-reviewer-query]').fill('');
  assert.equal(await page.locator('[data-reviewer-role]').count(),0,'positions open only after choosing a department');
  assert.equal(await page.locator('[data-reviewer-person]').count(),0,'people open only after choosing a position');
  await page.getByRole('button',{name:'提交创建申请',exact:true}).click();
  assert.equal(sent.length,0,'at least one explicit reviewer is required');
  const query = page.locator('[data-reviewer-query]');
  await page.locator('[data-reviewer-department="产品设计部"]').click();
  assert.equal(await page.locator('[data-reviewer-role]').count(),2);
  assert.deepEqual(await page.locator('[data-reviewer-role]').evaluateAll(els => els.map(el => el.dataset.reviewerRole)),['团队长','员工']);
  assert.equal(await page.locator('[data-reviewer-person]').count(),0);
  await page.locator('[data-reviewer-role="员工"]').click();
  assert.equal(await page.locator('[data-reviewer-person]').count(),1);
  const columns = await page.locator('.reviewer-column').evaluateAll(els => els.map(el => el.getBoundingClientRect().left));
  assert.ok(columns[0] < columns[1] && columns[1] < columns[2],'three cascade levels appear from left to right');
  await page.locator('[data-reviewer-person][value=lin]').check();
  await page.locator('[data-reviewer-department="市场运营部"]').click();
  assert.equal(await page.locator('[data-reviewer-person]').count(),0,'switching departments clears the old position');
  await page.locator('[data-reviewer-role="员工"]').click();
  await page.locator('[data-reviewer-person][value=chen]').check();
  assert.deepEqual(await page.locator('[name=reviewers]').evaluateAll(inputs => inputs.map(v => v.value)),['lin','chen']);
  await query.fill('管理员');
  assert.equal(await page.locator('[data-reviewer-department]').count(),2);
  assert.equal(await page.locator('[data-reviewer-person]').count(),1,'search opens the first matching department and position');
  await query.fill('陈嘉宁');
  assert.equal(await page.locator('[data-reviewer-person][value=chen]').isChecked(),true);
  await query.fill('不存在'); assert.equal(await page.locator('[data-reviewer-person]').count(),0);
  assert.equal(await page.locator('[name=reviewers]').count(),2,'filtering never drops selected people');
  await page.locator('[data-reviewer-remove=lin]').click();
  assert.equal(await page.locator('[name=reviewers]').count(),1);
  await query.fill('产品设计部 员工'); await page.locator('[data-reviewer-person][value=lin]').check();
  await query.fill('');
  await query.evaluate(el => { window.reviewerQuery=el;el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='陈';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true})); });
  assert.equal(await page.locator('[data-reviewer-department]').count(),4);
  await query.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  assert.equal(await page.locator('[data-reviewer-department]').count(),1);
  assert.equal(await page.locator('[data-reviewer-person][value=chen]').count(),1);
  assert.equal(await query.evaluate(el => el === window.reviewerQuery && document.activeElement === el),true);
  assert.equal(await page.locator('[name=title]').inputValue(),'多级审核人选择验收');
  await query.fill('');

  await page.locator('[name=startAt]').click();
  assert.equal(await page.locator('[data-picker-input]').count(),0);
  assert.equal(await page.locator('[data-picker-year-choice] option').count(),12);
  await selectPickerYear(page,2080);
  await page.locator('[data-picker-month]').selectOption('1');
  await page.locator('[data-picker-day="2080-02-29"]').click();
  await page.locator('[data-picker-hour]').selectOption('16');
  await page.locator('[data-picker-minute]').selectOption('45');
  await mkdir('output/playwright',{recursive:true});
  await page.screenshot({path:'output/playwright/year-dropdown-date-picker.png'});
  await page.locator('[data-picker-apply]').click();
  assert.equal(await page.locator('[name=startAt]').inputValue(),'2080-02-29T16:45');
  await page.locator('[name=dueAt]').click();
  await selectPickerYear(page,2080);
  await page.locator('[data-picker-month]').selectOption('2');
  await page.locator('[data-picker-day="2080-03-01"]').click();
  await page.locator('[data-picker-hour]').selectOption('18');
  await page.locator('[data-picker-minute]').selectOption('00');
  await page.locator('[data-picker-apply]').click();
  for (const width of [320,390,768]) {
    await page.setViewportSize({width,height:844});
    assert.equal(await page.locator('#modal').evaluate(el => el.scrollWidth > el.clientWidth),false);
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('.reviewer-picker').scrollIntoViewIfNeeded();
  await page.screenshot({path:'output/playwright/reviewer-tree.png'});
  await page.getByRole('button',{name:'提交创建申请',exact:true}).click(); await closed();
  assert.deepEqual([...sent[0].reviewers].sort(),['chen','lin']);
  assert.equal(Object.hasOwn(sent[0].values,'reviewers'),false);
  const request = db.requests[0];

  await login('other'); await openRequest(request.id);
  assert.equal(await page.locator('[data-form=review]').count(),0);
  assert.match(await page.locator('#modal').innerText(),/未被指定/);
  await login('lin'); await action('messages-open');
  await page.locator('[data-message-filter=review]').click();
  await action('request',request.id);
  await page.locator('[name=reason]').fill('资料齐全');
  await page.getByRole('button',{name:'审核通过',exact:true}).click();
  await page.locator('.messages-dialog').waitFor();
  assert.equal(request.status,'pending'); assert.equal(db.tasks.some(t => t.id === request.taskId),false);
  await page.locator('[data-message-filter=all]').click();
  await action('request',request.id);
  assert.equal(await page.locator('[data-form=review]').count(),0);
  assert.match(await page.locator('.review-progress').innerText(),/1 \/ 2/);
  await page.screenshot({path:'output/playwright/review-partial-progress.png'});
  await login('chen'); await openRequest(request.id);
  await page.getByRole('button',{name:'审核通过',exact:true}).click();
  await page.locator('.messages-dialog').waitFor();
  assert.equal(request.status,'approved'); assert.equal(db.tasks.some(t => t.id === request.taskId),true);
  assert.deepEqual(errors,[]);
  console.log('Reviewer and date picker UI passed: horizontal department-position-person cascade, any enabled member including employees, name/role search, IME, cross-filter multi-selection, required selection, 12-year dropdown and calendar/time selection, permissions and unanimous approval.');
} finally { await browser.close(); }

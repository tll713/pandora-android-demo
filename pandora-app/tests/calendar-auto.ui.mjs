import assert from 'node:assert/strict';
import { chromium, browserChannel } from '../../scripts/browser-test.mjs';

const browser = await chromium.launch({channel:browserChannel,headless:true});
const context = await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
const page = await context.newPage(), errors = [], metadataCalls = [], savedTodos = [];
page.on('pageerror', e => errors.push(e.message));
await page.clock.install({time:new Date('2026-12-31T23:59:50+08:00')});
const member = {id:'lin',name:'林予安',role:'EMPLOYEE',department:'研发部'};
const db = {members:[member],tasks:[],logs:[],todos:[],requests:[],pins:{},announcements:[],highlights:[]};
let fail = false, gate = null, marker = '元旦';
await page.route('**/api/**', async route => {
  const req = route.request(), url = new URL(req.url()), send = (json,status=200) => route.fulfill({status,json});
  if (url.pathname.endsWith('/calendar/metadata')) {
    const year = Number(url.searchParams.get('year')); metadataCalls.push(year);
    if (gate) await gate;
    if (fail) return send({error:'offline'},503);
    return send({year,published:year===2027,source:year===2027?'https://www.gov.cn/example.htm':'',syncStatus:'current',
      holidays:year===2027?{'2027-01-01':{label:marker,type:'holiday'}}:{},solarTerms:{}});
  }
  if (url.pathname.endsWith('/todos') && req.method()==='POST') {
    const todo = {...req.postDataJSON(),id:'todo-'+savedTodos.length}; savedTodos.push(todo); db.todos.push(todo); return send(todo);
  }
  if (url.pathname.endsWith('/auth/login')) return send({token:'auto-calendar-test',user:member});
  if (url.pathname.endsWith('/tags')) return send([]);
  return send({user:member,db});
});
const nav = route => page.locator(`.nav [data-route=${route}]`).click();
const close = () => page.locator('#modal [data-close]').click();
async function jump(date) {
  await page.locator('.calendar-mode-tabs [data-mode=month]').click();
  await page.locator('[data-action=calendar-back]').click();
  await page.locator('[data-form=calendar-jump] [name=date]').fill(date);
  await page.locator('[data-form=calendar-jump] button[type=submit]').click();
  await page.locator('.calendar-mode-tabs [data-mode=month]').click();
}
try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await page.locator('[name=identifier]').fill(member.name); await page.locator('[name=password]').fill('test-pass');
  await page.getByRole('button',{name:'登录',exact:true}).click(); await nav('calendar');
  await page.locator('[data-day="2026-12-31"][aria-current=date]').waitFor();
  await page.clock.runFor(11000);
  await page.locator('[data-day="2027-01-01"][aria-current=date][aria-pressed=true]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-day="2027-01-01"]')?.textContent.includes('元旦'));
  assert.ok(metadataCalls.includes(2026) && metadataCalls.includes(2027),'cross-year automatically fetches new-year metadata');

  await jump('2026-12-20');
  await page.clock.setSystemTime(new Date('2027-01-03T09:00:00+08:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  assert.equal(await page.locator('[data-day="2026-12-20"]').getAttribute('aria-pressed'),'true','historical selection stays selected after resume');
  await page.locator('[data-action=today]').click();
  await page.locator('[data-day="2027-01-03"][aria-current=date][aria-pressed=true]').waitFor();

  // A metadata response arriving while a modal form is open must leave its draft intact.
  await page.clock.setSystemTime(new Date('2027-01-03T23:59:50+08:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('[data-action=new-task]').click();
  await page.locator('[data-form=task] [name=title]').fill('保留正在编辑的任务');
  await page.clock.runFor(11000);
  assert.equal(await page.locator('[data-form=task] [name=title]').inputValue(),'保留正在编辑的任务');
  assert.equal((await page.locator('[data-form=task] [name=dueAt]').inputValue()).slice(0,10),'2027-01-03','draft date is not silently rewritten');
  await close();
  await page.locator('[data-day="2027-01-04"][aria-current=date][aria-pressed=true]').waitFor();

  // Successful metadata, then outage: markers survive refresh and a page reload.
  fail = true; await page.clock.runFor(31000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText(/日历信息暂时无法更新/).waitFor();
  assert.match(await page.locator('[data-day="2027-01-01"]').innerText(),/元旦/);
  const callsAfterFailure = metadataCalls.length;
  for (let i=0;i<4;i++) await page.locator('[data-action=today]').click();
  assert.equal(metadataCalls.length,callsAfterFailure,'failed refresh is throttled and does not create a retry loop');
  await page.reload(); await nav('calendar');
  assert.match(await page.locator('[data-day="2027-01-01"]').innerText(),/元旦/,'last good cache survives reload');

  // Retry while composing a todo across midnight; preserve both text and target date.
  await nav('dashboard');
  await page.locator('[data-action=todo-select][data-id="2027-01-04"]').first().click();
  await page.locator('#modal [name=title]').fill('零点前开始填写的事项');
  await page.clock.setSystemTime(new Date('2027-01-04T23:59:59+08:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.runFor(2000);
  await page.locator('#modal [data-form=todo] button[type=submit]').click();
  await page.waitForFunction(() => document.querySelector('#modal')?.textContent.includes('零点前开始填写的事项'));
  assert.equal(savedTodos[0].date,'2027-01-04');
  await close(); await nav('calendar');
  await page.locator('[data-day="2027-01-05"][aria-current=date][aria-pressed=true]').waitFor();

  fail=false; marker='<img src=x onerror="window.calendarXss=true">';
  // Let the refresh start, then open an editor before the response arrives.
  let release; gate=new Promise(resolve=>{release=resolve;});
  await page.locator('[data-action=calendar-metadata-retry]').click();
  await page.locator('[data-action=new-task]').click();
  await page.locator('[data-form=task] [name=title]').fill('异步同步期间的草稿');
  const updated = page.waitForResponse(r=>r.url().includes('/calendar/metadata')&&r.status()===200);
  release();gate=null;
  await updated;
  assert.equal(await page.locator('[data-form=task] [name=title]').inputValue(),'异步同步期间的草稿');
  await close();
  assert.match(await page.locator('[data-day="2027-01-01"]').innerText(),/<img/);
  assert.equal(await page.locator('[data-day="2027-01-01"] img').count(),0);
  assert.equal(await page.evaluate(()=>Boolean(window.calendarXss)),false);
  assert.deepEqual(errors,[]);
  console.log('Automatic calendar passed: midnight/year rollover, background resume, historical selection, offline cache, throttled retry, drafts, target dates and escaping.');
} finally { await browser.close(); }

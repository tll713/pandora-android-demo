import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, browserChannel } from '../../scripts/browser-test.mjs';
import { serveAndroid } from './android-assets.mjs';

const api = process.env.PANDORA_TEST_API_BASE, password = process.env.PANDORA_TEST_PASSWORD;
assert.ok(api && password, 'Run with PANDORA_E2E=true through Maven against an isolated database');
const browser = await chromium.launch({channel:browserChannel,headless:true,
  args:['--allow-running-insecure-content','--disable-features=LocalNetworkAccessChecks']});
const errors=[], contexts=[];
const artifacts=process.env.PANDORA_E2E_ARTIFACTS || path.resolve('../tmp/e2e');
await mkdir(artifacts,{recursive:true});
async function app(role) {
  const context=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  contexts.push(context);await serveAndroid(context,api);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://appassets.androidplatform.net/index.html');
  await page.locator('[name=identifier]').fill('e2e-'+role);
  await page.locator('[name=password]').fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.locator('.dashboard-page').waitFor();return page;
}
async function mutation(page, suffix, action, method='POST') {
  const response=page.waitForResponse(r=>r.url().endsWith(suffix)&&r.request().method()===method);
  await action();const result=await response;
  assert.equal(result.status(),200,await result.text());return result.json();
}
const action=(page,name,id)=>page.locator(`[data-action="${name}"]${id?`[data-id="${id}"]`:''}`).first().click();
const close=page=>page.locator('#modal').waitFor({state:'hidden'});
async function workspace(page) {
  const token=await page.evaluate(()=>localStorage.getItem('pandora.token'));
  const result=await page.request.get(api+'/workspace',{headers:{Authorization:'Bearer '+token}});
  assert.equal(result.status(),200);return result.json();
}
try {
  const employee=await app('EMPLOYEE');
  await employee.locator('.nav [data-route=calendar]').click();await action(employee,'new-task');
  await employee.locator('[name=title]').fill('真实接口任务闭环');
  await employee.locator('[name=detail]').fill('浏览器操作，真实服务及数据库持久化');
  const request=await mutation(employee,'/tasks/requests',()=>employee.getByRole('button',{name:'提交创建申请',exact:true}).click());
  await close(employee);
  assert.equal((await workspace(employee)).db.tasks.length,0,'pending task must remain inactive');
  const founder=await app('FOUNDER');await action(founder,'messages-open');await action(founder,'request',request.id);
  await mutation(founder,`/tasks/requests/${request.id}/review`,()=>founder.getByRole('button',{name:'审核通过',exact:true}).click());
  await founder.locator('.messages-dialog').waitFor();
  await employee.reload();await employee.locator('.dashboard-page').waitFor();
  await action(employee,'task',request.taskId);
  await employee.locator('[name=note]').fill('核心功能已验收');
  await mutation(employee,`/tasks/${request.taskId}/progress`,()=>employee.getByRole('button',{name:'保存进展',exact:true}).click());await close(employee);
  await action(employee,'task',request.taskId);await action(employee,'complete',request.taskId);
  await mutation(employee,`/tasks/${request.taskId}/complete`,()=>action(employee,'confirm-complete',request.taskId));await close(employee);
  let saved=(await workspace(employee)).db.tasks.find(t=>t.id===request.taskId);
  assert.equal(saved.status,'done');assert.ok(saved.completedAt);assert.ok(saved.history.some(h=>h.text.includes('核心功能已验收')));

  await employee.locator('.nav [data-route=logs]').click();await action(employee,'new-log');
  await employee.locator('[data-action=new-log-date]').first().click();
  await employee.locator('[data-form=log] [name=content]').fill('第一版工作记录');
  const log=await mutation(employee,'/logs',()=>employee.getByRole('button',{name:'保存日志',exact:true}).click());await close(employee);
  await action(employee,'log',log.id);await action(employee,'edit-log',log.id);
  await employee.locator('[data-form=log] [name=content]').fill('第二版工作记录');
  await mutation(employee,'/logs',()=>employee.getByRole('button',{name:'保存日志',exact:true}).click());await close(employee);
  const savedLog=(await workspace(employee)).db.logs.find(l=>l.id===log.id);
  assert.match(savedLog.content,/第二版/);assert.equal(savedLog.versions.length,1);assert.match(savedLog.versions[0].content,/第一版/);

  const adminContext=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});contexts.push(adminContext);
  const admin=await adminContext.newPage();admin.on('pageerror',e=>errors.push(e.message));
  await admin.goto(new URL('/',api).href);
  await admin.locator('#login-form [name=identifier]').fill('e2e-ADMIN');await admin.locator('#login-form [name=password]').fill(password);
  await admin.getByRole('button',{name:'登录管理端'}).click();
  assert.equal(await admin.locator('#navigation').getByRole('link',{name:/^公司公告/}).count(),0);
  assert.equal(await admin.locator('#filter-form button[type=submit]').count(),0);
  await admin.locator('#filter-form [name=q]').fill('e2e-EMPLOYEE');
  assert.equal(await admin.locator('tbody tr').count(),1);
  await admin.locator('#navigation').getByRole('link',{name:/^十大内容/}).click();
  await admin.getByRole('button',{name:'录入十大内容',exact:true}).click();
  await admin.locator('#highlight-form [name=title]').fill('真实发布事项');
  await admin.locator('#highlight-form [name=content]').fill('<script>throw new Error("XSS")</script>事项正文\n'+('请各部门核对具体工作安排与责任人。\n'.repeat(45)));
  const highlight=await mutation(admin,'/admin/highlights',()=>admin.locator('#highlight-form button[type=submit]').click());
  await admin.locator('#detail-dialog').waitFor({state:'hidden'});
  await employee.reload();await employee.locator('.dashboard-page').waitFor();
  assert.equal(await employee.locator('[data-action=announcements-open]').count(),0);
  await action(employee,'highlight',highlight.id);
  assert.match(await employee.locator('#modal').innerText(),/真实发布事项/);
  assert.equal(await employee.locator('#modal script').count(),0);
  for (const width of [360,390]) {
    await employee.setViewportSize({width,height:844});
    const dialog=employee.locator('#modal');
    assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    assert.ok(await employee.locator('.highlight-dialog-list').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft))>=22);
    await dialog.evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.ok(await employee.locator('#modal [data-close]').isVisible());
  }
  await employee.locator('#modal').evaluate(el=>el.scrollTop=0);
  await employee.screenshot({path:path.join(artifacts,'mobile-highlight.png'),fullPage:true});
  await admin.screenshot({path:path.join(artifacts,'admin-highlight.png'),fullPage:true});
  await admin.locator(`[data-action=delete-highlight][data-id="${highlight.id}"]`).click();
  await mutation(admin,`/admin/highlights/${highlight.id}`,()=>admin.locator('#confirm-submit').click(),'DELETE');
  assert.equal((await workspace(employee)).db.highlights.length,0);

  const token=await employee.evaluate(()=>localStorage.getItem('pandora.token'));
  const headers={Authorization:'Bearer '+token};
  const calendarResponse=await employee.request.get(api+'/calendar/metadata?year=2026',{headers});
  assert.equal(calendarResponse.status(),200);
  const calendar=await calendarResponse.json();
  assert.equal(calendar.holidays['2026-01-04'].type,'workday');
  assert.equal(calendar.holidays['2026-02-28'].type,'workday');
  assert.equal(calendar.holidays['2026-04-11'],undefined);
  assert.equal(Object.keys(calendar.solarTerms).length,24);
  await employee.locator('#modal [data-close]').click();
  await employee.locator('.nav [data-route=calendar]').click();
  await employee.locator('.calendar-mode-tabs [data-mode=month]').click();
  await action(employee,'calendar-back');
  await employee.locator('[data-form=calendar-jump] [name=date]').fill('2026-01-04');
  await employee.locator('[data-form=calendar-jump] button[type=submit]').click();
  await employee.locator('.calendar-mode-tabs [data-mode=month]').click();
  await employee.waitForFunction(()=>document.querySelector('[data-day="2026-01-04"]')?.textContent.includes('班'));
  assert.match(await employee.locator('[data-day="2026-01-01"]').innerText(),/休.*元旦/);
  assert.equal((await employee.request.put(api+'/auth/profile',{headers,data:{department:'管理中心',role:'ADMIN'}})).status(),403);
  assert.equal((await employee.request.get(api+'/admin/users',{headers})).status(),403);
  assert.equal((await employee.request.post(api+'/auth/register',{data:{phone:'13999999999',password}})).status(),403);
  assert.deepEqual(errors,[]);
  console.log('Real backend E2E passed: task approval/progress/completion, log versions, account live search and home highlight lifecycle, Android CSP and API authorization.');
} finally {await Promise.all(contexts.map(c=>c.close()));await browser.close();}

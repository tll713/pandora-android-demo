import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { USERS, userById, seedDatabase, visibleTasks, visibleLogs, visibleRequests, allowedAssignees,
  requestTaskChange, reviewTaskChange, updateTaskDetail, completeTask } from '../src/domain.js';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.PANDORA_RUNTIME_MODULES || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), 'playwright'));
const browser = await chromium.launch({channel:process.env.PANDORA_BROWSER_CHANNEL || 'msedge',headless:true});
const context = await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai',locale:'zh-CN',isMobile:true,hasTouch:true});
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror',e=>errors.push(e.message));
const now = new Date('2026-10-23T10:00:00+08:00'), db = seedDatabase(now);
await page.clock.install({time:now});
let actor = userById('lin');
await page.route('**/api/**',async route=>{
  const req=route.request(), endpoint=new URL(req.url()).pathname.slice(4), body=req.postData()?req.postDataJSON():{};
  const send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  try {
    if(endpoint==='/auth/login') {actor=USERS.find(u=>u.name===body.identifier);assert.ok(actor);return send({token:'test-'+actor.id,user:actor});}
    if(endpoint==='/workspace') return send({user:actor,db:{...db,tasks:visibleTasks(db,actor),logs:visibleLogs(db,actor),members:USERS,
      requests:visibleRequests(db,actor),allowedAssignees:allowedAssignees(actor)}});
    if(endpoint==='/tasks/requests') return send(requestTaskChange(db,actor,body.kind,body.values,body.taskId,now));
    if(endpoint.endsWith('/review')) return send(reviewTaskChange(db,actor,endpoint.split('/')[3],body.approve,body.reason,now));
    if(endpoint.endsWith('/progress')) return send(updateTaskDetail(db,actor,endpoint.split('/')[2],body.text,now));
    if(endpoint.endsWith('/complete')) return send(completeTask(db,actor,endpoint.split('/')[2],now));
    return send({error:'Unexpected test endpoint: '+endpoint},404);
  } catch(error) {return send({error:error.message},400);}
});
const go=route=>page.locator(`.nav [data-route="${route}"]`).click();
const action=(name,id)=>page.locator(`[data-action="${name}"]${id?`[data-id="${id}"]`:''}`).first().click();
async function login(id) {
  if(await page.locator('.nav').count()) {await go('mine');await action('confirm-logout');await action('logout');}
  await page.locator('[name="identifier"]').fill(userById(id).name);
  await page.locator('[name="password"]').fill('fixture-password');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.locator('.dashboard-page').waitFor();
}
async function list() {await go('calendar');await page.locator('[data-task-view="list"]').click();}
async function requests() {await list();await page.locator('.task-requests > summary').click();}
async function modalClosed() {await page.locator('#modal').waitFor({state:'hidden'});}
try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await login('lin');
  assert.equal(await page.locator('.dashboard-head button').count(),0);
  await go('calendar'); await action('new-task');
  assert.equal(await page.locator('[name="owners"][type="checkbox"]').count(),0);
  assert.equal(await page.locator('[name="owners"]').inputValue(),'lin');
  await page.locator('[name="title"]').fill('员工自行创建任务');
  await page.locator('[name="detail"]').fill('独立审核、记录进展与直接完成');
  await page.getByRole('button',{name:'提交创建申请',exact:true}).click();await modalClosed();
  const req=db.requests.find(r=>r.after?.title==='员工自行创建任务'), taskId=req.taskId;
  assert.equal(db.tasks.some(t=>t.id===taskId),false);
  await page.locator('[data-task-view="list"]').click();await page.locator('.task-requests > summary').click();
  await action('request',req.id);assert.equal(await page.locator('[data-form="review"]').count(),0);
  await page.locator('[data-close]').click();
  checks.push('员工从视图提交本人任务申请，待审核任务未生效且不能自审');
  await login('founder');await requests();await action('request',req.id);
  await page.getByRole('button',{name:'审核通过',exact:true}).click();await modalClosed();
  assert.equal(db.tasks.find(t=>t.id===taskId).status,'todo');
  await login('lin');await list();await action('task',taskId);
  assert.equal(await page.locator('[data-action="edit-task"]').count(),0);
  await page.locator('[name="note"]').fill('初稿已完成');
  await page.getByRole('button',{name:'保存进展',exact:true}).click();await modalClosed();
  await action('task',taskId);await action('complete',taskId);await action('confirm-complete',taskId);await modalClosed();
  assert.equal(db.tasks.find(t=>t.id===taskId).status,'done');assert.equal(db.requests.length,1);
  checks.push('管理员在 app 审核；本人可记录进展、直接完成，无管理权限按钮');
  await login('manager');await list();await action('task',taskId);await action('edit-task',taskId);
  await page.locator('[name="title"]').fill('修改后的员工任务');
  await page.getByRole('button',{name:'提交修改申请',exact:true}).click();await modalClosed();
  assert.equal(db.tasks.find(t=>t.id===taskId).title,'员工自行创建任务');
  const edit=db.requests.find(r=>r.kind==='edit');
  await login('founder');await requests();await action('request',edit.id);
  await page.getByRole('button',{name:'审核通过',exact:true}).click();await modalClosed();
  assert.equal(db.tasks.find(t=>t.id===taskId).title,'修改后的员工任务');assert.equal(db.tasks.find(t=>t.id===taskId).status,'done');
  checks.push('管理范围内编辑申请独立审核后生效，完成状态保留');
  await login('manager');await list();await action('task',taskId);await action('delete-task',taskId);await action('confirm-delete',taskId);await modalClosed();
  const deletion=db.requests.find(r=>r.kind==='delete');assert.equal(db.tasks.find(t=>t.id===taskId).deleted,false);
  await login('founder');await requests();await action('request',deletion.id);
  await page.getByRole('button',{name:'审核通过',exact:true}).click();await modalClosed();
  assert.equal(db.tasks.find(t=>t.id===taskId).deleted,true);
  checks.push('删除申请审核后归档');
  for(const width of [360,390,412,1280]) {
    await page.setViewportSize({width,height:844});
    for(const route of ['dashboard','calendar','logs','mine']) {
      await go(route);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${width}px ${route}`);
    }
  }
  assert.deepEqual(errors,[]);checks.push('四个路由无横向页面溢出且无运行错误');
  console.log(JSON.stringify({passed:true,checks},null,2));
} finally {await browser.close();}

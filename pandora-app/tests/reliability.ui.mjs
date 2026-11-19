import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {chromium,browserChannel} from '../../scripts/browser-test.mjs';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const server=http.createServer(async (req,res)=>{
  try {
    const name=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
    if(!file.startsWith(root+path.sep)) return res.writeHead(403).end();
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}).end(body);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:browserChannel,headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
const page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
await page.clock.setFixedTime(new Date('2026-11-13T12:00:00+08:00'));
const members=[{id:'admin',name:'管理员',role:'ADMIN',department:'管理部'},
  {id:'lin',name:'林予安',role:'EMPLOYEE',department:'研发部'}];
const recent={id:'recent',author:'lin',date:'2026-11-13',title:'今日日报',content:'今日工作',versions:[{title:'原版',content:'修改前内容',at:'2026-11-13T09:00'}]};
const history={id:'old',author:'admin',date:'2026-11-01',title:'历史日报',content:'历史工作',versions:[]};
const tasks=[{id:'one',title:'发布甲',detail:'核对版本',owners:['admin'],creator:'admin',status:'doing',priority:'medium',startAt:'2026-11-13T09:00',dueAt:'2026-11-13T18:00',history:[]},
  {id:'two',title:'设计乙',detail:'补充说明',owners:['lin','admin'],creator:'admin',status:'todo',priority:'low',startAt:'2026-11-13T09:00',dueAt:'2026-11-13T18:00',history:[]}];
const db={allowedReviewers:[{id:"reviewer",name:"审核人",department:"管理中心",role:"FOUNDER",roleName:"创始人"}],members,allowedAssignees:members,tasks,tags:[],todos:[],logs:[recent,{...recent,id:'personal',author:'admin'}],requests:[],highlights:[],notifications:[],pins:{}};
let holdWorkspace=false,workspaceReply,historyReply,commentReply,submitReply,historyCalls=0,submissions=0;
await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),send=(json,status=200)=>route.fulfill({json,status});
  if(url.pathname.endsWith('/workspace')) {
    const snapshot=structuredClone({user:members[0],db});
    if(holdWorkspace) {holdWorkspace=false;workspaceReply=()=>send(snapshot);return;}
    return send(snapshot);
  }
  if(url.pathname.endsWith('/logs/history')) {historyCalls++;historyReply=()=>send([history]);return;}
  if(url.pathname.endsWith('/logs/recent/comments')) {commentReply=(status=200)=>send(status===200?[]:{error:'加载失败'},status);return;}
  if(url.pathname.endsWith('/tasks/requests')&&req.method()==='POST') {
    submissions++;submitReply=(status=200)=>send(status===200?{id:'request'}:{error:'请重试'},status);return;
  }
  if(url.pathname.endsWith('/directory')) return send(members);
  if(url.pathname.endsWith('/tags')) return send([]);
  if(url.pathname.endsWith('/calendar/metadata')) return send({year:Number(url.searchParams.get('year')),published:false,holidays:{},solarTerms:{}});
  return send({error:'Unexpected '+url.pathname},404);
});
const go=route=>page.locator(`.nav [data-route=${route}]`).click();
async function until(predicate) {
  const deadline=Date.now()+5000;
  while(!predicate()) {
    if(Date.now()>deadline) throw new Error('Expected request was not sent');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(()=>localStorage.setItem('pandora.token','reliability'));
  await page.reload();await page.locator('.dashboard-page').waitFor();await go('logs');

  // A background request starts with recent logs, then completes after history.
  holdWorkspace=true;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await until(()=>workspaceReply);
  await page.locator('[data-log-range=all]').click();await until(()=>historyReply);
  await historyReply();await page.getByRole('button',{name:'历史日报',exact:true}).waitFor();
  await workspaceReply();workspaceReply=null;historyReply=null;
  await page.locator('[data-log-range="7"]').click();await page.locator('[data-log-range=all]').click();
  await page.getByRole('button',{name:'历史日报',exact:true}).waitFor();
  assert.equal(historyCalls,1,'history remains loaded and does not require another request');

  // Also cover the reverse completion order.
  await page.reload();await page.locator('.dashboard-page').waitFor();await go('logs');
  await page.locator('[data-log-range=all]').click();await until(()=>historyReply);
  const refreshed=page.waitForResponse(response=>response.url().endsWith('/workspace'));
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await refreshed;
  await historyReply();await page.getByRole('button',{name:'历史日报',exact:true}).waitFor();historyReply=null;
  checks.push('首次历史加载与后台刷新按两种完成顺序交错，历史日志均保留');

  await go('calendar'); await page.locator('[data-task-view=directory]').click();
  await page.locator('[data-action=directory-member][data-id=lin]').click();
  await page.locator('[data-action=directory-tab][data-id=logs]').click();
  await page.locator('[data-action=log][data-id=recent]').click();await until(()=>commentReply);
  const field=page.locator('[data-form=log-comment] textarea');
  await field.fill('评论草稿');await field.evaluate(el=>{window.commentField=el;el.focus();el.setSelectionRange(1,3);});
  await page.locator('.version-item').evaluate(el=>{el.open=true;});
  await commentReply(503);commentReply=null;
  await page.getByText('评论加载失败，请重试',{exact:false}).waitFor();
  assert.equal(await field.inputValue(),'评论草稿');
  assert.equal(await field.evaluate(el=>el===window.commentField&&el===document.activeElement&&el.selectionStart===1&&el.selectionEnd===3),true);
  assert.equal(await page.locator('.version-item').evaluate(el=>el.open),true);
  await page.locator('[data-action=retry-log-comments]').click();await until(()=>commentReply);
  await field.fill('重试时继续输入的草稿');
  await field.evaluate(el=>{el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));});
  await commentReply();commentReply=null;
  await page.getByText('评论（0）',{exact:true}).waitFor();
  assert.equal(await field.inputValue(),'重试时继续输入的草稿');
  assert.equal(await field.evaluate(el=>el===window.commentField&&el===document.activeElement),true);
  await field.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  await page.locator('[data-close]').click();
  checks.push('评论失败和重试只更新列表，保留草稿、输入框节点、焦点、选区及展开的版本');

  await go('calendar');await page.locator('[data-task-view=list]').click();
  const query=page.locator('[data-task-query]');
  await query.fill('发布');assert.equal(await page.locator('.task-table tbody tr').count(),1);
  await page.locator('[data-filter=doing]').click();assert.equal(await query.inputValue(),'发布');
  await page.locator('[data-filter=todo]').click();assert.equal(await query.inputValue(),'发布');
  assert.equal(await page.locator('.task-table tbody tr').count(),0);
  await query.fill('');assert.equal(await page.locator('.task-table tbody tr').count(),1);
  await page.locator('[data-filter=all]').click();assert.equal(await page.locator('.task-table tbody tr').count(),2);
  checks.push('搜索清空恢复任务，切换任务状态保留关键词（原有修复验证通过）');

  await page.locator('[data-action=new-task]').click();
  await page.locator('[data-form=task] [name=title]').fill('防止重复申请');
  await page.locator('[data-form=task] [name=owners]').first().check();
  await page.locator('[data-form=task]').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
  await until(()=>submitReply);
  assert.equal(submissions,1);
  assert.equal(await page.locator('[data-form=task] [type=submit]').isDisabled(),true);
  await submitReply(500);submitReply=null;
  await page.locator('[data-form=task] [type=submit]:not([disabled])').waitFor();
  assert.equal(await page.locator('[data-form=task] [name=title]').inputValue(),'防止重复申请');
  await page.locator('[data-form=task] [type=submit]').click();await until(()=>submitReply);
  assert.equal(submissions,2,'a failed request can be retried');
  await submitReply();await page.locator('#modal').waitFor({state:'hidden'});
  checks.push('双击及重复提交事件仅发送一次申请；失败后保留草稿并恢复重试');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:checks},null,2));
} finally {
  await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));
}

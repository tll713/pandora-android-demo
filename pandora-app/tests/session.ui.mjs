import assert from 'node:assert/strict';
import {chromium,browserChannel} from '../../scripts/browser-test.mjs';

const browser=await chromium.launch({channel:browserChannel,headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const member={id:'lin',name:'林予安',role:'EMPLOYEE',department:'研发部'};
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
const task={id:'task',title:'可正常查看的任务',detail:'工作说明',owners:['lin'],creator:'lin',startAt:today+'T09:00',dueAt:today+'T18:00',priority:'medium',status:'doing',history:[]};
const db={members:[member],tasks:[task],logs:[],todos:[],requests:[],pins:{},tags:[],highlights:[],announcements:[]};
let metadataStatus=401,sessionStatus=200,sessionChecks=0;
await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/calendar/metadata')) return route.fulfill({status:metadataStatus,json:{error:'登录已过期，请重新登录'}});
  if(path.endsWith('/auth/me')) {
    sessionChecks++;
    if(sessionStatus===0) return route.abort('failed');
    return route.fulfill({status:sessionStatus,json:sessionStatus===200?member:{error:'登录已过期，请重新登录'}});
  }
  if(path.endsWith('/workspace')) return route.fulfill({json:{user:member,db}});
  if(path.endsWith('/tags')) return route.fulfill({json:[]});
  return route.fulfill({status:404,json:{error:'Unexpected '+path}});
});
async function openCompany() {
  await page.locator('.nav [data-route=calendar]').click();
  await page.locator('.calendar-metadata-note').filter({hasText:'日历信息暂时无法更新'}).waitFor();
}
async function openTask() {
  await page.locator('[data-task-view=list]').click();
  await page.locator('[data-action=task][data-id=task]').click();
  assert.equal(await page.locator('#modal-title').innerText(),task.title);
  await page.locator('[data-close]').click();
}
try {
  await page.goto(process.env.PANDORA_URL||'http://127.0.0.1:5173');
  await page.evaluate(()=>localStorage.setItem('pandora.token','valid-session'));await page.reload();
  await page.locator('.dashboard-page').waitFor();
  assert.deepEqual(await page.locator('.nav-item').allTextContents(),['⌂首页','✎日志','▦公司','◯我的']);
  await openCompany();assert.equal(sessionChecks,1);
  assert.equal(await page.evaluate(()=>localStorage.getItem('pandora.token')),'valid-session');
  await openTask();
  // A normal server failure must not trigger an authentication check or logout.
  metadataStatus=500;await page.reload();await openCompany();await openTask();
  assert.equal(sessionChecks,1);
  // A failed verification request is not proof that credentials have expired.
  metadataStatus=401;sessionStatus=0;await page.reload();await openCompany();await openTask();
  assert.equal(await page.evaluate(()=>localStorage.getItem('pandora.token')),'valid-session');
  // A genuine invalid session still returns the user to login.
  sessionStatus=401;await page.reload();
  await page.locator('.nav [data-route=calendar]').click();
  await page.locator('[data-form=login]').waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('pandora.token')),null);
  assert.deepEqual(errors,[]);
  console.log('Session passed: company navigation, failed calendar endpoint preserves valid login and task access, network failure keeps credentials, expired credentials still log out.');
} finally {await browser.close();}

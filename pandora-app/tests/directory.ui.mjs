import {selectPickerYear} from './date-picker-helpers.mjs';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, browserChannel } from '../../scripts/browser-test.mjs';

const browser = await chromium.launch({channel:browserChannel,headless:true});
const context = await browser.newContext({viewport:{width:Number(process.env.PANDORA_UI_WIDTH) || 390,height:844},locale:'zh-CN',timezoneId:'Asia/Shanghai',isMobile:true,hasTouch:true});
const page = await context.newPage(), errors = [];
page.on('pageerror',error => errors.push(error.message));
await page.clock.install({time:new Date('2026-11-13T12:00:00+08:00')});
const members = [
  {id:'admin',name:'系统管理员',department:'管理中心',role:'ADMIN',roleName:'管理员'},
  {id:'manager',name:'沈知夏',department:'产品设计部',role:'DEPT_MANAGER',roleName:'部门负责人'},
  {id:'lin',name:'林予安',department:'产品设计部',role:'EMPLOYEE',roleName:'员工',phone:'13800138001'},
  {id:'chen',name:'陈嘉宁',department:'市场运营部',role:'EMPLOYEE',roleName:'员工'},
  {id:'disabled',name:'停用成员',department:'产品设计部',role:'EMPLOYEE',roleName:'员工',enabled:false}
];
const comments = [];
let current = members[0], failDirectory = false, failHistory = false, directoryContacts;
const tasks = Array.from({length:6},(_,i) => ({id:`task${i}`,title:`客户交付 ${i+1}`,detail:'核对交付记录与验收安排',owners:['lin'],creator:'manager',startAt:'2026-11-12T09:00',dueAt:'2026-11-15T18:00',priority:'medium',status:'doing',tagId:'design',createdAt:'2026-11-10T08:00',history:[]}));
tasks.push({...tasks[0],id:'own-task',title:'本人交付任务',owners:['admin','lin'],creator:'admin'});
tasks.push({...tasks[0],id:'private-task',title:'市场内部任务',owners:['chen'],creator:'chen'});
tasks[2].priority='high'; tasks[5].status='done';
const db = {allowedReviewers:[{id:"reviewer",name:"审核人",department:"管理中心",role:"FOUNDER",roleName:"创始人"}],members,tasks,tags:[{id:'design',name:'产品交付',color:'#5c7fa3'}],requests:[],pins:{},announcements:[],highlights:[],allowedAssignees:members,
  todos:[{id:'todo1',date:'2026-11-13',title:'完成需求复核',done:true,color:'#567c73'},{id:'todo2',date:'2026-11-13',title:'准备客户会议',done:false,color:'#5c7fa3'},{id:'yesterday',date:'2026-11-12',title:'昨天的事项',done:true,color:'#b38b4d'}],
  logs:[{id:'my-log',author:'admin',date:'2026-11-13',title:'工作日志',content:'【今日完成】\n已有的工作成果\n\n【下一步计划】\n保留原计划\n\n【问题与协助】\n等待协作',versions:[]},
    {id:'lin-log',author:'lin',date:'2026-11-13',title:'交付日报',content:'核对交付进展',versions:[]},
    {id:'private-log',author:'chen',date:'2026-11-13',title:'市场内部日报',content:'市场内部记录',versions:[]}]};
db.todos.push(...Array.from({length:6},(_,index) => ({id:`legacy-${index}`,date:'2026-11-13',title:`原有事项 ${index+1}`,done:false,color:'#567c73'})));
await page.route('**/api/**',async route => {
  const request = route.request(), url = new URL(request.url());
  const respond = (json,status = 200) => route.fulfill({json,status});
  if (url.pathname === '/api/calendar/metadata') return respond({year:Number(url.searchParams.get('year')),published:false,holidays:{},solarTerms:{}});
  if (url.pathname === '/api/auth/login') return respond({token:`directory-${current.id}`,user:current});
  if (url.pathname === '/api/workspace') return respond({user:current,db});
  if (url.pathname === '/api/directory') return failDirectory ? respond({error:'联系人暂不可用'},500) : respond(directoryContacts ?? members.filter(u => u.enabled !== false));
  if (url.pathname === '/api/tags') return respond(db.tags);
  if (url.pathname === '/api/logs/history') return failHistory ? respond({error:'历史日志暂不可用'},500) : respond([{id:'old-log',author:'lin',date:'2026-09-03',title:'九月工作记录',content:'历史交付记录',versions:[]}]);
  if (url.pathname.endsWith('/comments')) {
    const logId = url.pathname.split('/')[3];
    if (request.method() === 'POST') {
      const log = db.logs.find(l => l.id === logId);
      assert.notEqual(log.author,current.id,'self comments remain forbidden');
      const comment = {id:`comment-${comments.length}`,logId,author:current.id,authorName:current.name,content:request.postDataJSON().content,createdAt:'2026-11-13T12:00'};
      comments.push(comment); return respond(comment);
    }
    return respond(comments.filter(c => c.logId === logId));
  }
  if (url.pathname === '/api/tasks/requests' && request.method() === 'POST') {
    const body = request.postDataJSON();
    assert.ok(['ADMIN','FOUNDER','DEPT_MANAGER','TEAM_LEAD'].includes(current.role));
    const change = {...body,id:`request-${db.requests.length}`,proposer:current.id,status:'pending'};
    db.requests.push(change); return respond(change);
  }
  if (/\/tasks\/[^/]+\/progress$/.test(url.pathname)) {
    const task = tasks.find(t => t.id === url.pathname.split('/')[3]);
    assert.ok(task.owners.includes(current.id));
    task.history.push({actor:current.id,at:'2026-11-13T12:00',text:request.postDataJSON().text});
    return respond(task);
  }
  if (url.pathname === '/api/todos' && request.method() === 'POST') {
    const todo = {...request.postDataJSON(),id:'new-todo',done:false}; db.todos.push(todo); return respond(todo);
  }
  if (/\/todos\/[^/]+\/color$/.test(url.pathname)) {
    const todo = db.todos.find(t => t.id === url.pathname.split('/')[3]); todo.color = request.postDataJSON().color; return respond(todo);
  }
  if (/\/todos\/[^/]+\/date$/.test(url.pathname)) {
    const todo = db.todos.find(t => t.id === url.pathname.split('/')[3]); todo.date = request.postDataJSON().date; return respond(todo);
  }
  return respond({error:`Unexpected ${url.pathname}`},404);
});
const go = route => page.locator(`.nav [data-route="${route}"]`).click();
const close = () => page.locator('#modal [data-close]').click();
const company = async view => { await go('calendar'); await page.locator(`[data-task-view="${view}"]`).click(); };
const shot = name => page.screenshot({path:`output/playwright/${name}.png`,fullPage:true});
const checks = [];
try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await page.locator('[name=identifier]').fill(current.name); await page.locator('[name=password]').fill('fixture-password');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.locator('.dashboard-page').waitFor();
  assert.equal(await page.locator('.dashboard-tile:last-child > header > div > span').count(),0);
  const initialColors = await page.locator('.todo-item').evaluateAll(items => items.map(item => item.style.getPropertyValue('--todo-accent')));
  assert.equal(new Set(initialColors).size,initialColors.length,'old default items receive distinct automatic colors');
  assert.equal(await page.locator('[data-form=todo] [name=color], [data-form=todo] .todo-colors').count(),0);
  assert.doesNotMatch(await page.locator('[data-action=todo-jump]').innerText(),/[⌄▾]/);
  await page.locator('[data-form=todo] [name=title]').fill('同步验收结果');
  await page.locator('[data-form=todo] button[type=submit]').click();
  await page.locator('.todo-item[data-todo-drag=new-todo]').waitFor();
  assert.equal(initialColors.includes(db.todos.at(-1).color),false,'new item automatically receives an unused color');
  await page.locator('.todo-item[data-todo-drag=todo1] [data-action=todo-color]').click();
  await page.locator('[data-form=todo-color] [name=color][value="#b38b4d"]').check();
  await page.getByRole('button',{name:'保存颜色',exact:true}).click();
  await page.locator('#modal').waitFor({state:'hidden'});
  await page.reload(); await page.locator('.todo-item[data-todo-drag=todo1]').waitFor();
  assert.match(await page.locator('.todo-item[data-todo-drag=todo1]').getAttribute('style'),/#b38b4d/);
  await page.locator('[data-action=todo-calendar]').click();
  assert.match(await page.locator('.todo-drag-item[data-todo-drag=todo1]').getAttribute('style'),/#b38b4d/);
  await mkdir('output/playwright',{recursive:true}); await shot('todo-colors');
  checks.push('首页移除00/06；新增、修改颜色持久保存，完成事项及月视图保留配色');
  await go('mine'); await page.locator('.journal-day').first().click();
  assert.match(await page.locator('.log-todo-reference').innerText(),/完成需求复核[\s\S]*准备客户会议/);
  assert.doesNotMatch(await page.locator('.log-todo-reference').innerText(),/昨天的事项/);
  assert.equal(await page.locator('[name=content]').inputValue(),'已有的工作成果');
  await page.locator('[data-action=log-insert-todos]').click();
  const draft = await page.locator('[name=content]').inputValue();
  assert.match(draft,/已有的工作成果[\s\S]*完成需求复核/);
  await page.locator('[data-action=log-insert-todos]').click();
  assert.equal(await page.locator('[name=content]').inputValue(),draft);
  assert.equal(await page.locator('[name=plan]').inputValue(),'保留原计划'); await close();
  await page.locator('.journal-day').nth(1).click();
  assert.match(await page.locator('.log-todo-reference').innerText(),/昨天的事项/);
  assert.equal(await page.locator('[name=content]').inputValue(),''); await close();
  checks.push('日志按所选日期自动列事项；带入不覆盖正文、计划或协助，重复点击不重复插入');
  await company('list');
  assert.deepEqual(await page.locator('.task-table tbody tr').evaluateAll(rows => rows.map(row => row.dataset.id)),['own-task']);
  assert.equal(await page.locator('[name=scope]').count(),0);
  await page.locator('.task-table tr[data-id=own-task] td').nth(1).click();
  assert.equal(await page.locator('#modal-title').innerText(),'本人交付任务'); await close();
  await page.locator('.task-table tr[data-id=own-task]').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#modal-title').innerText(),'本人交付任务'); await close();
  await page.locator('[data-action=new-task]').click();
  await page.locator('[name=title]').fill('选择日期时保留草稿');
  await page.locator('[name=startAt]').click();
  const yearField = page.locator('[data-picker-year]');
  const yearChoices = page.locator('[data-picker-year-choice]');
  assert.equal(await page.locator('[data-picker-input],.picker-manual').count(),0);
  assert.equal(await yearField.evaluate(el => el.tagName),'INPUT');
  assert.deepEqual(await yearChoices.locator('option').evaluateAll(options => options.map(option => Number(option.value))),Array.from({length:12},(_,i) => 2020+i));
  await yearField.evaluate(input => { window.yearInput = input; input.focus(); });
  await yearField.fill('20');
  assert.equal(await page.locator('[data-picker-apply]').isDisabled(),true,'incomplete year cannot submit a stale date');
  assert.equal(await page.locator('[data-picker-month]').isDisabled(),true);
  assert.equal(await page.locator('#picker-year-error').isVisible(),true);
  await yearField.pressSequentially('80');
  assert.equal(await yearField.inputValue(),'2080');
  assert.equal(await yearChoices.inputValue(),'2080','opening the dropdown after typing highlights the entered year');
  assert.equal(await yearField.evaluate(input => input === window.yearInput && input === document.activeElement && input.selectionStart === 4),true,'typing retains the input and caret');
  assert.deepEqual(await yearChoices.locator('option').evaluateAll(options => options.map(option => Number(option.value))),Array.from({length:12},(_,i) => 2074+i));
  await yearField.fill('abcd');
  assert.equal(await page.locator('[data-picker-apply]').isDisabled(),true);
  await yearChoices.selectOption('2080');
  assert.equal(await yearField.inputValue(),'2080','choosing the same year can recover an invalid draft');
  await page.locator('[data-picker-month]').selectOption('1');
  await page.locator('[data-picker-day="2080-02-29"]').click();
  await selectPickerYear(page,2100);
  assert.equal(await page.locator('[data-picker-day="2100-02-29"]').count(),0,'century non-leap years have 28 days');
  assert.match(await page.locator('.picker-footer').innerText(),/2100 \/ 02 \/ 28/);
  await yearField.fill('1000');
  assert.deepEqual(await yearChoices.locator('option').evaluateAll(options => options.map(option => Number(option.value))),Array.from({length:12},(_,i) => 1000+i));
  await yearField.fill('9999');
  assert.deepEqual(await yearChoices.locator('option').evaluateAll(options => options.map(option => Number(option.value))),Array.from({length:12},(_,i) => 9988+i));
  await yearField.fill('2077');
  assert.equal(await page.locator('[data-picker-apply]').isDisabled(),false);
  assert.equal(await yearField.evaluate(input => input === document.activeElement),true);
  await yearField.press('Enter');
  assert.equal(await page.locator('[data-picker-month]').evaluate(input => input === document.activeElement),true);
  await page.locator('[data-picker-day="2077-02-28"]').click();
  await page.locator('[data-picker-hour]').selectOption('17'); await page.locator('[data-picker-minute]').selectOption('45');
  await shot('task-date-picker');
  await page.locator('[data-picker-apply]').click();
  assert.equal(await page.locator('[name=startAt]').inputValue(),'2077-02-28T17:45');
  assert.equal(await page.locator('[name=title]').inputValue(),'选择日期时保留草稿');
  await page.locator('[name=dueAt]').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-form=task]').count(),1); await close();
  checks.push('任务整行和键盘均可打开；年份可手动输入或选择12年，输入保留焦点与光标，无效年份阻止确认，可选1000–9999年，闰年日期自动校正、分钟可选，取消日期选择保留任务草稿');
  await go('dashboard');
  await page.locator('.todo-item[data-todo-drag=todo2] [data-action=todo-reschedule]').first().click();
  const bottomGap = await page.locator('#modal').evaluate(dialog => {
    dialog.scrollTop = dialog.scrollHeight;
    return dialog.getBoundingClientRect().bottom - dialog.querySelector('[type=submit]').getBoundingClientRect().bottom;
  });
  assert.ok(bottomGap >= 28,`dialog leaves room below its last control: ${bottomGap}`);
  await shot('todo-reschedule-spacing');
  await page.locator('[data-form=todo-move] [name=date]').click();
  await selectPickerYear(page,2077);
  assert.equal(await page.locator('[data-picker-year-choice] option').count(),12);
  await selectPickerYear(page,2026);
  await yearField.fill('20');
  await page.locator('[data-picker-quick]').click();
  assert.equal(await yearField.inputValue(),'2026','today recovers an incomplete year');
  assert.equal(await page.locator('[data-picker-shift]').count(),0);
  assert.deepEqual(await page.locator('.picker-quick button').allTextContents(),['今天']);
  assert.equal(await page.locator('[data-picker-day="2026-11-12"]').isDisabled(),true);
  await page.locator('[data-picker-day="2026-11-14"]').click(); await page.locator('[data-picker-apply]').click();
  assert.equal(await page.locator('[data-form=todo-move] [name=date]').inputValue(),'2026-11-14'); await close();
  await go('logs'); await page.locator('[name=to]').click();
  await yearField.fill('2027');
  assert.equal(await page.locator('[data-picker-apply]').isDisabled(),true,'year selection obeys the maximum date');
  await selectPickerYear(page,2026);
  assert.equal(await page.locator('[data-picker-day="2026-11-14"]').isDisabled(),true);
  await page.locator('[data-picker-day="2026-11-13"]').click(); await page.locator('[data-picker-apply]').click();
  assert.equal(await page.locator('[name=to]').inputValue(),'2026-11-13');
  assert.equal(await page.locator('[data-form=log-filter] button[type=submit]').count(),0);
  const search = page.getByRole('searchbox',{name:'搜索日志',exact:true});
  await search.evaluate(input => {
    window.logSearchInput=input;
    input.focus();
    input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    input.value='交'; input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
  });
  assert.equal(await page.locator('.log-results .log-card').count(),1,'composition does not filter unfinished input');
  await search.evaluate(input => {
    input.value='已有'; input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'已有'}));
  });
  assert.equal(await page.locator('.log-results .log-card').count(),1);
  assert.equal(await search.evaluate(input => input===window.logSearchInput && document.activeElement===input),true);
  await search.fill('不存在的内容'); assert.equal(await page.locator('.log-results .log-card').count(),0);
  await search.fill(''); assert.equal(await page.locator('.log-results .log-card').count(),1);
  assert.equal(await page.locator('[name=department],[name=author],[name=submission]').count(),0);
  assert.doesNotMatch(await page.locator('.log-results').innerText(),/交付日报|市场内部日报/);
  await search.fill('已有');
  assert.equal(await page.locator('.log-results .log-card').count(),1);
  await shot('logs-live-filter');
  await page.locator('[data-action=clear-log-filters]').click();
  checks.push('事项改期禁止过去日期，日志筛选禁止未来日期，快捷日期即时更新');
  checks.push('详情底部留白；日期选择器仅保留今天并移除箭头；日志搜索即时筛选、清空恢复、中文输入和个人日期筛选');
  await company('calendar');
  assert.match(await page.locator('[data-action=calendar-back]').innerText(),/选择日期/);
  await page.locator('.calendar-mode-tabs [data-mode=week]').click();
  await page.locator('[data-action=calendar-week-prev]').click();
  assert.match(await page.locator('.timeline-header h2').innerText(),/2026年11月6日/);
  await page.locator('[data-action=calendar-week-next]').click();
  assert.match(await page.locator('.timeline-header h2').innerText(),/2026年11月13日/);
  await page.locator('[data-action=calendar-back]').click();
  await selectPickerYear(page,2026);
  await page.locator('[data-picker-month]').selectOption('11');
  await page.locator('[data-picker-day="2026-12-31"]').click();
  await page.locator('[data-picker-apply]').click();
  await page.locator('[data-action=calendar-week-next]').click();
  assert.match(await page.locator('.timeline-header h2').innerText(),/2027年1月7日/);
  await page.locator('[data-action=calendar-week-prev]').click();
  assert.match(await page.locator('.timeline-header h2').innerText(),/2026年12月31日/);
  await page.locator('[data-action=calendar-back]').click();
  await selectPickerYear(page,2077);
  await page.locator('[data-picker-month]').selectOption('10');
  await page.locator('[data-picker-day="2077-11-13"]').click();
  await page.locator('[data-picker-apply]').click();
  assert.match(await page.locator('.timeline-header h2').innerText(),/2077年11月13日/);
  await page.locator('[data-action=today]').click();
  await shot('calendar-week-navigation');
  checks.push('周视图箭头按七天切换并支持跨年；月、周均可从有文字提示的日期入口直接选日期');
  failDirectory = true; await company('directory');
  await page.locator('[data-action=directory-reload]').waitFor(); failDirectory = false;
  await page.locator('[data-action=directory-reload]').click();
  await page.waitForFunction(() => !document.querySelector('[data-action=directory-reload]'));
  assert.equal(await page.locator('.directory-person').count(),4);
  assert.equal(await page.locator('.directory-department').count(),3);
  assert.equal(await page.locator('.directory-department > summary > b').first().innerText(),'管理中心');
  const productRoles = page.locator('.directory-department').filter({has:page.locator('summary > b',{hasText:'产品设计部'})}).locator('.directory-role > summary');
  assert.deepEqual(await productRoles.evaluateAll(els => els.map(el => el.firstChild.textContent)),['部门负责人','员工']);
  await page.locator('[data-directory-query]').fill('13800138001');
  assert.equal(await page.locator('.directory-person').count(),1);
  await page.locator('[data-directory-query]').fill('');
  await mkdir('output/playwright',{recursive:true}); await shot('company-directory');
  await page.locator('[data-action=directory-member][data-id=lin]').click();
  assert.match(await page.locator('.directory-profile').innerText(),/13800138001/);
  assert.equal(await page.locator('.task-table tbody tr').count(),7);
  await page.locator('.task-table tr[data-id=task0] td').nth(2).click();
  assert.equal(await page.locator('.directory-readonly').count(),0);
  assert.equal(await page.locator('#modal [data-action=edit-task],#modal [data-action=delete-task]').count(),2);
  assert.equal(await page.locator('#modal [data-action=complete],#modal [data-form=note]').count(),0);
  await page.locator('[data-action=edit-task]').click();
  await page.locator('[data-form=task] [name=title]').fill('调整客户交付安排');
  await page.locator('[data-form=task] button[type=submit]').click();
  await page.locator('#modal').waitFor({state:'hidden'});
  assert.equal(db.requests.at(-1).kind,'edit'); assert.equal(tasks[0].title,'客户交付 1');
  await page.locator('.task-table tr[data-id=task0]').click();
  assert.equal(await page.locator('#modal [data-action=edit-task]').count(),0,'pending edits still require review'); await close();
  await page.locator('.task-table tr[data-id=task1]').click();
  await page.locator('[data-action=delete-task]').click();
  await page.locator('[data-action=confirm-delete]').click(); await page.locator('#modal').waitFor({state:'hidden'});
  assert.equal(db.requests.at(-1).kind,'delete'); assert.equal(tasks.length,8,'deletion waits for approval');
  await page.locator('[data-task-query]').fill('客户交付 3');
  assert.equal(await page.locator('.task-table tbody tr').count(),1);
  await page.locator('[data-task-select]').selectOption('high');
  assert.equal(await page.locator('.task-table tr[data-id=task2]').count(),1);
  await page.locator('[data-filter=done]').click(); assert.equal(await page.locator('.task-table tbody tr').count(),0);
  await page.locator('[data-action=clear-task-search]').click();
  await page.locator('[data-filter=done]').click(); assert.equal(await page.locator('.task-table tr[data-id=task5]').count(),1);
  await shot('directory-task-filters');
  await company('list'); assert.equal(await page.locator('[data-filter=all]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-task-query]').inputValue(),'');
  await company('directory'); assert.equal(await page.locator('[data-filter=done]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-action=clear-task-search]').click();
  await page.locator('[data-action=directory-tab][data-id=month]').click();
  await page.locator('.directory-month .month-task-span').first().waitFor();
  await page.locator('.directory-month [data-action=directory-day][data-id="2026-11-13"]').last().click();
  assert.equal(await page.locator('.directory-day-tasks .task-card').count(),7);
  assert.equal(await page.locator('[data-todo-drag],.directory-month [data-action=new-task]').count(),0);
  await shot('directory-member-month');
  await page.locator('[data-action=directory-jump]').click();
  await selectPickerYear(page,2027); await page.locator('[data-picker-month]').selectOption('0');
  await page.locator('[data-picker-day="2027-01-02"]').click(); await page.locator('[data-picker-apply]').click();
  assert.match(await page.locator('.directory-month-head').innerText(),/2027 年 1 月/);
  assert.equal(await page.locator('[data-action=directory-prev],[data-action=directory-next]').count(),0);
  assert.doesNotMatch(await page.locator('[data-action=directory-jump]').innerText(),/[⌄▾]/);
  assert.match(await page.locator('[data-action=directory-today]').getAttribute('title'),/回到今天/);
  await page.locator('[data-action=directory-today]').click();
  assert.match(await page.locator('.directory-month-head').innerText(),/2026 年 11 月/);
  await page.locator('.directory-day-tasks [data-action=task][data-id=own-task]').click();
  assert.equal(await page.locator('[data-form=note]').count(),1);
  await page.locator('[data-form=note] [name=note]').fill('已核对本次交付安排');
  await page.locator('[data-form=note] button[type=submit]').click(); await page.locator('#modal').waitFor({state:'hidden'});
  assert.equal(tasks.find(t => t.id === 'own-task').history.at(-1).text,'已核对本次交付安排');
  failHistory = true; await page.reload(); await company('directory');
  await page.locator('[data-action=directory-member][data-id=lin]').click();
  await page.locator('[data-action=directory-tab][data-id=logs]').click();
  await page.locator('[data-action=directory-retry]').waitFor(); failHistory = false;
  await page.locator('[data-action=directory-retry]').click();
  await page.getByRole('button',{name:'九月工作记录',exact:true}).waitFor();
  await page.getByRole('button',{name:'交付日报',exact:true}).click();
  assert.equal(await page.locator('#modal [data-action=edit-log]').count(),0);
  await page.locator('[data-form=log-comment] [name=content]').fill('交付记录已核对，请继续跟进');
  await page.locator('[data-form=log-comment] button[type=submit]').click();
  await page.locator('#modal').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'交付日报',exact:true}).click();
  await page.locator('.comment-item').filter({hasText:'交付记录已核对，请继续跟进'}).waitFor(); await close();
  assert.equal(comments.length,1);
  await page.locator('[data-action=directory-back]').click();
  await page.locator('[data-action=directory-member][data-id=admin]').click();
  await page.locator('[data-action=directory-tab][data-id=logs]').click();
  await page.locator('[data-action=log][data-id=my-log]').click();
  assert.equal(await page.locator('#modal [data-action=edit-log]').count(),1);
  assert.equal(await page.locator('[data-form=log-comment]').count(),0); await close();
  await page.locator('[data-action=directory-back]').click();
  await page.locator('[data-action=directory-member][data-id=lin]').click();
  await page.locator('[data-action=directory-tab][data-id=logs]').click();
  checks.push('通讯录分部门岗位展开、手机号搜索、加载失败重试；任务清单可筛选，任务详情按权限申请编辑、删除和记录进展；月视图简化导航；日志可评论，本人近期日志可编辑且不能自评');
  for (const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:844});
    for (const tab of ['tasks','month','logs']) {
      await page.locator(`[data-action=directory-tab][data-id=${tab}]`).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,`${width} ${tab} overflow`);
    }
  }
  members[0].role='FOUNDER'; current=members[0];
  await page.reload(); await company('list');
  assert.deepEqual(await page.locator('.task-table tbody tr').evaluateAll(rows => rows.map(row => row.dataset.id)),['own-task']);
  await go('logs'); assert.equal(await page.locator('.log-results .log-card').count(),1);
  await company('directory'); await page.locator('[data-action=directory-member][data-id=chen]').click();
  await page.locator('[data-action=directory-tab][data-id=logs]').click();
  await page.locator('[data-action=log][data-id=private-log]').click();
  assert.equal(await page.locator('[data-form=log-comment]').count(),1); await close();
  members[0].role='ADMIN';
  // The same loaded directory must respect each viewer's original role permissions.
  for (const role of ['DEPT_MANAGER','TEAM_LEAD']) {
    members[1].role=role; current=members[1];
    await page.reload(); await company('list');
    assert.equal(await page.locator('.task-table tbody tr').count(),0,'creating or supervising a task does not make it my task');
    await go('logs'); assert.equal(await page.locator('.log-results .log-card').count(),0);
    await company('directory'); await page.locator('[data-action=directory-member][data-id=lin]').click();
    await page.locator('[data-action=directory-tab][data-id=logs]').click();
    await page.locator('[data-action=log][data-id=lin-log]').click();
    assert.equal(await page.locator('[data-form=log-comment]').count(),1);
    assert.equal(await page.locator('[data-action=edit-log]').count(),0); await close();
    await page.locator('[data-action=directory-back]').click();
    await page.locator('[data-action=directory-member][data-id=chen]').click();
    await page.locator('[data-action=directory-tab][data-id=logs]').click();
    assert.match(await page.locator('.directory-page').innerText(),/日志不在你的查看范围/);
    await page.locator('[data-action=directory-back]').click();
    if (role === 'TEAM_LEAD') {
      members[0].department=members[1].department;
      await page.reload(); await company('directory');
    }
    await page.locator('[data-action=directory-member][data-id=admin]').click();
    await page.locator('[data-action=directory-tab][data-id=logs]').click();
    assert.match(await page.locator('.directory-page').innerText(),/日志不在你的查看范围/);
  }
  members[0].department='管理中心';
  current=members[2]; await page.evaluate(() => localStorage.setItem('pandora.token','employee')); await page.reload();
  await company('list'); assert.equal(await page.locator('.task-table tbody tr').count(),7);
  await go('logs'); assert.equal(await page.locator('.log-results .log-card').count(),1);
  await page.locator('[data-action=log][data-id=lin-log]').click();
  assert.equal(await page.locator('[data-form=log-comment]').count(),0);
  assert.equal(await page.locator('[data-action=edit-log]').count(),1); await close();
  await company('directory'); await page.locator('[data-action=directory-member][data-id=chen]').click();
  assert.match(await page.locator('.directory-page').innerText(),/任务不在你的查看范围/);
  await page.locator('[data-action=directory-tab][data-id=logs]').click();
  assert.match(await page.locator('.directory-page').innerText(),/日志不在你的查看范围/);
  assert.doesNotMatch(await page.locator('.directory-page').innerText(),/市场内部任务|市场内部日报/);
  checks.push('320/390/768/1280无页面横向溢出；员工可查联系人，不能访问其他成员的受限任务和日志');

  directoryContacts = members.filter(u => u.enabled !== false).map(u => ({...u}));
  const updated = members.find(u => u.id === 'chen');
  const contact = directoryContacts.find(u => u.id === updated.id);
  updated.name = '陈嘉宁（新）';
  updated.department = '客户服务部';
  contact.phone = '13800138200';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => document.querySelector('.directory-profile')?.textContent.includes('13800138200'));
  assert.match(await page.locator('.directory-profile').innerText(), /陈嘉宁（新）/);
  assert.match(await page.locator('.directory-profile').innerText(), /客户服务部/);
  checks.push('在线同步刷新通讯录手机号，旧联系人响应不会覆盖工作区最新姓名和部门');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks},null,2));
} finally { await browser.close(); }

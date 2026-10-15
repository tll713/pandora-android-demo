import test from 'node:test';
import assert from 'node:assert/strict';
import { USERS, userById, seedDatabase, validateDatabase, createTask, requestTaskChange, reviewTaskChange,
  canSeeTask, visibleTasks, updateTaskDetail, completeTask, saveLog, canEditLog, recentLogs,
  calendarDays, shiftCalendar, togglePin, createDemoAccount, isOverdue, isValidMinute } from '../src/domain.js';
const manager=userById('manager'), lin=userById('lin'), zhou=userById('zhou'), founder=userById('founder'), admin=userById('admin');
const now=new Date('2026-10-14T10:30:00'), db=()=>seedDatabase(now);
const values={title:'验收任务',owners:['lin','zhou'],priority:'high',dueAt:'2026-10-15T16:45',detail:'交付可评审初稿'};

test('seed is valid and stores time to minute with multiple owners, without numeric progress',()=>{
  const data=db(); assert.equal(validateDatabase(data),true); assert.deepEqual(data.tasks[0].owners,['lin','zhou']);
  assert.equal(data.tasks[0].dueAt,'2026-10-14T18:30'); assert.equal('progress' in data.tasks[0],false);
});
test('creation becomes visible to both owners only after independent review',()=>{
  const data=db(), r=createTask(data,manager,values,now);
  assert.equal(data.tasks.some(t=>t.id===r.taskId),false);
  assert.throws(()=>reviewTaskChange(data,manager,r.id,true),/另一位/);
  assert.throws(()=>reviewTaskChange(data,lin,r.id,true),/另一位/);
  reviewTaskChange(data,founder,r.id,true,'',now);
  const task=data.tasks.find(t=>t.id===r.taskId);
  assert.equal(canSeeTask(lin,task),true); assert.equal(canSeeTask(zhou,task),true);
  assert.equal(canSeeTask(userById('chen'),task),false); assert.equal(task.createdAt,r.createdAt);
  assert.throws(()=>reviewTaskChange(data,founder,r.id,true),/待处理/);
});
test('task creation rejects missing owners, cross-department owners, malformed dates and employee requests',()=>{
  for (const v of [{...values,owners:[]},{...values,owners:['lin','chen']},{...values,dueAt:'2026-02-30T12:00'},{...values,dueAt:'2026-10-15T24:00'},{...values,dueAt:'2026-10-15'}]) {
    const data=db(); assert.throws(()=>createTask(data,manager,v)); assert.equal(data.requests.length,0);
  }
  assert.throws(()=>createTask(db(),lin,values),/不能提交/);
  assert.equal(isValidMinute('2026-10-15T23:59'),true);
});
test('either assigned owner can record text progress and complete immediately without approval',()=>{
  const data=db(); updateTaskDetail(data,zhou,'t1','原型已校对',now); completeTask(data,lin,'t1',now);
  assert.equal(data.tasks[0].status,'done'); assert.equal(data.requests.length,0);
  assert.match(data.tasks[0].history.at(-2).text,/原型已校对/);
  assert.throws(()=>completeTask(data,zhou,'t1'),/已经完成/);
  assert.throws(()=>updateTaskDetail(data,zhou,'t1','补写'),/已完成/);
});
test('nonowners cannot execute work; denied operations leave data untouched',()=>{
  const data=db(), before=structuredClone(data);
  assert.throws(()=>updateTaskDetail(data,manager,'t1','代写'),/负责人/);
  assert.throws(()=>completeTask(data,manager,'t1'),/负责人/);
  assert.throws(()=>requestTaskChange(data,lin,'edit',values,'t1'),/不能提交/);
  assert.deepEqual(data,before);
});
test('pending edit preserves original; approval preserves progress recorded while awaiting review',()=>{
  const data=db(), original=structuredClone(data.tasks[0]);
  const r=requestTaskChange(data,manager,'edit',{...values,title:'修改后的任务'},'t1',now);
  assert.deepEqual(data.tasks[0],original);
  assert.throws(()=>requestTaskChange(data,manager,'delete',{},'t1'),/已有待审核/);
  updateTaskDetail(data,lin,'t1','审核期间继续执行',now); completeTask(data,zhou,'t1',now);
  reviewTaskChange(data,founder,r.id,true,'',now);
  assert.equal(data.tasks[0].title,'修改后的任务'); assert.equal(data.tasks[0].status,'done');
  assert.ok(data.tasks[0].history.some(h=>h.text.includes('审核期间'))); assert.equal(data.tasks[0].revision,2);
});
test('rejection requires a reason and retains original task; approved delete is archived, not erased',()=>{
  const data=db(), r=requestTaskChange(data,manager,'delete',{},'t1',now);
  assert.throws(()=>reviewTaskChange(data,founder,r.id,false,'  '),/驳回原因/);
  assert.equal(r.status,'pending'); reviewTaskChange(data,founder,r.id,false,'仍需继续执行',now);
  assert.equal(canSeeTask(lin,data.tasks[0]),true);
  const second=requestTaskChange(data,manager,'delete',{},'t1',now); reviewTaskChange(data,founder,second.id,true,'',now);
  assert.equal(visibleTasks(data,lin).some(t=>t.id==='t1'),false);
  assert.equal(data.tasks[0].deleted,true); assert.ok(data.tasks[0].history.length>0);
  assert.equal(data.requests.length,2);
});
test('changed task revision prevents stale approval',()=>{
  const data=db(), r=requestTaskChange(data,manager,'edit',values,'t1',now); data.tasks[0].revision++;
  assert.throws(()=>reviewTaskChange(data,founder,r.id,true),/发生变化/); assert.equal(r.status,'pending');
});
test('daily log is one per author per day, task linking optional, old content retained',()=>{
  const data=db(); const count=data.logs.length;
  const first=saveLog(data,lin,{content:'上午内容'},null,now);
  assert.equal(data.logs.length,count); assert.equal(first.taskId,'');
  saveLog(data,lin,{content:'下午补充'},first.id,now);
  assert.equal(first.content,'下午补充'); assert.equal(first.versions.at(-1).content,'上午内容');
  assert.equal(first.versions.length,2); assert.equal(data.logs.length,count);
});
test('log can only be edited today by its author, cannot be moved to today or backdated',()=>{
  const data=db(), l=data.logs[0], past=data.logs.find(l=>l.author==='lin' && l.date!=='2026-10-14');
  const before=structuredClone(data);
  assert.throws(()=>saveLog(data,manager,{content:'改写'},l.id,now),/本人当天/);
  assert.throws(()=>saveLog(data,lin,{content:'移到今天',date:'2026-10-14'},past.id,now),/本人当天/);
  assert.throws(()=>saveLog(data,lin,{content:'补写',date:'2026-10-13'},null,now),/当天/);
  assert.throws(()=>saveLog(data,lin,{content:'越权关联',taskId:'t7'},l.id,now),/无权查看/);
  assert.deepEqual(data,before);
  assert.equal(canEditLog(lin,l,new Date('2026-10-15T00:01:00')),false);
});
test('seven-day view excludes day eight and future, keeps archive data',()=>{
  const data=db(); data.logs.push({...data.logs[0],id:'future',date:'2026-10-15'});
  const logs=recentLogs(data,lin,'2026-10-14');
  assert.ok(logs.every(l=>l.date>='2026-10-08' && l.date<='2026-10-14' && l.author==='lin'));
  assert.ok(data.logs.some(l=>l.date==='2026-10-06'));
});
test('calendar handles leap month, Monday alignment, month-end and year transitions',()=>{
  const month=calendarDays('2024-02-20'); assert.equal(month[0],'2024-01-29'); assert.equal(month.at(-1),'2024-03-03'); assert.ok(month.includes('2024-02-29'));
  assert.deepEqual(calendarDays('2026-10-14','week'),['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18']);
  assert.equal(shiftCalendar('2026-01-31','month',1),'2026-02-28'); assert.equal(shiftCalendar('2026-12-31','day',1),'2027-01-01');
});
test('overdue calculation uses hours and minutes, completed tasks are not overdue',()=>{
  const t=db().tasks[0]; assert.equal(isOverdue(t,'2026-10-14T18:29'),false); assert.equal(isOverdue(t,'2026-10-14T18:31'),true);
  t.status='done'; assert.equal(isOverdue(t,'2026-10-15T10:00'),false);
});
test('focus permissions prevent following outside department',()=>{
  const data=db(); assert.throws(()=>togglePin(data,lin,'t7'),/无权查看/);
  togglePin(data,lin,'t4'); assert.ok(data.pins.lin.includes('t4')); togglePin(data,lin,'t4'); assert.ok(!data.pins.lin.includes('t4'));
});
test('only admin creates demo accounts, duplicate identifiers and privileged roles rejected',()=>{
  const data=db(), v={name:'新同事',login:'demo_new',department:'产品设计部',role:'员工'};
  assert.throws(()=>createDemoAccount(data,manager,v),/管理员/);
  assert.throws(()=>createDemoAccount(data,admin,{...v,role:'管理员'}),/有效角色/);
  const u=createDemoAccount(data,admin,v); assert.equal(u.id,'demo_new'); assert.equal(data.members.length,1);
  assert.throws(()=>createDemoAccount(data,admin,v),/已存在/); assert.equal(validateDatabase(data),true);
  USERS.splice(USERS.findIndex(u=>u.id==='demo_new'),1);
});

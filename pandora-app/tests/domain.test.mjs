import test from 'node:test';
import assert from 'node:assert/strict';
import { USERS, userById, seedDatabase, validateDatabase, createTask, requestTaskChange, reviewTaskChange,
  canSeeTask, visibleTasks, visibleLogs, updateTaskDetail, completeTask, saveLog, canEditLog, recentLogs,
  calendarDays, shiftCalendar, togglePin, createDemoAccount, isOverdue, isValidMinute, taskOccursOn, taskStartAt } from '../src/domain.js';
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
test('task creation rejects invalid owners and dates while employees can only request themselves',()=>{
  for (const v of [{...values,owners:[]},{...values,owners:['lin','chen']},{...values,dueAt:'2026-02-30T12:00'},{...values,dueAt:'2026-10-15T24:00'},{...values,dueAt:'2026-10-15'}]) {
    const data=db(); assert.throws(()=>createTask(data,manager,v)); assert.equal(data.requests.length,0);
  }
  const employeeDb=db(), employeeRequest=createTask(employeeDb,lin,{...values,owners:['lin']},now);
  assert.equal(employeeRequest.status,'pending'); assert.deepEqual(employeeRequest.after.owners,['lin']);
  assert.throws(()=>createTask(db(),lin,values),/负责人/);
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
  assert.throws(()=>requestTaskChange(data,lin,'edit',values,'t1'),/不能编辑或删除/);
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
test('logs can be written and edited for the latest three days without moving their date',()=>{
  const data=db(), l=data.logs[0], past=data.logs.find(l=>l.author==='lin' && l.date!=='2026-10-14');
  assert.throws(()=>saveLog(data,manager,{content:'改写',date:l.date},l.id,now),/本人最近三天/);
  assert.throws(()=>saveLog(data,lin,{content:'移到今天',date:'2026-10-14'},past.id,now),/修改日志日期/);
  const yesterday=data.logs.find(v=>v.author==='zhou' && v.date==='2026-10-13');
  const backfilled=saveLog(data,lin,{content:'补写昨天',date:'2026-10-13'},null,now);
  assert.equal(backfilled.date,'2026-10-13');
  saveLog(data,zhou,{content:'修改昨天',date:'2026-10-13'},yesterday.id,now);
  assert.equal(yesterday.content,'修改昨天');
  assert.throws(()=>saveLog(data,lin,{content:'补写过期',date:'2026-10-11'},null,now),/最近三天/);
  assert.throws(()=>saveLog(data,lin,{content:'未来日志',date:'2026-10-15'},null,now),/最近三天/);
  const before=structuredClone(data);
  assert.throws(()=>saveLog(data,lin,{content:'越权关联',taskId:'t7'},l.id,now),/无权查看/);
  assert.deepEqual(data,before);
  assert.equal(canEditLog(lin,l,new Date('2026-10-16T00:01:00')),true);
  assert.equal(canEditLog(lin,l,new Date('2026-10-17T00:01:00')),false);
});
test('seven-day view excludes day eight and future, keeps archive data',()=>{
  const data=db(); data.logs.push({...data.logs[0],id:'future',date:'2026-10-15'});
  const logs=recentLogs(data,lin,'2026-10-14');
  assert.ok(logs.every(l=>l.date>='2026-10-08' && l.date<='2026-10-14' && l.author==='lin'));
  assert.ok(data.logs.some(l=>l.date==='2026-10-06'));
});
test('mobile logs belong only to the signed-in user, including managers and global roles',()=>{
  const data=db();
  for (const u of [lin,zhou,manager,founder,admin]) {
    data.logs.push({...data.logs[0],id:`personal-${u.id}`,author:u.id});
    const logs=visibleLogs(data,u);
    assert.ok(logs.some(l=>l.id===`personal-${u.id}`));
    assert.ok(logs.every(l=>l.author===u.id));
  }
  assert.deepEqual(visibleLogs(data,null),[]);
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

test('task intervals survive approval and edits, include boundaries, and reject reversed dates',()=>{
  const data=db();
  const interval={...values,startAt:'2026-10-12T09:00',dueAt:'2026-10-18T18:00'};
  const req=createTask(data,manager,interval,now);
  reviewTaskChange(data,founder,req.id,true,'',now);
  const task=data.tasks.find(t=>t.id===req.taskId);
  assert.equal(task.startAt,interval.startAt);
  for(const date of ['2026-10-12','2026-10-15','2026-10-18']) assert.equal(taskOccursOn(task,date),true);
  for(const date of ['2026-10-11','2026-10-19']) assert.equal(taskOccursOn(task,date),false);
  assert.equal(taskStartAt({dueAt:values.dueAt}),values.dueAt,'legacy tasks stay on due date');
  assert.throws(()=>createTask(data,manager,{...interval,startAt:'2026-10-19T09:00'},now),/结束时间/);
  assert.throws(()=>createTask(data,manager,{...interval,startAt:'2026-02-30T09:00'},now),/开始时间/);
  const edit=requestTaskChange(data,manager,'edit',{...values,dueAt:'2026-10-20T18:00'},task.id,now);
  reviewTaskChange(data,founder,edit.id,true,'',now);
  assert.equal(task.startAt,interval.startAt,'older clients preserve an existing start time');
});

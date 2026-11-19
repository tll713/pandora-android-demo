import test from 'node:test';
import assert from 'node:assert/strict';
import {userById,seedDatabase,requestTaskChange,reviewTaskChange,canReviewRequest,visibleRequests,allowedReviewers} from '../src/domain.js';
const now = new Date('2026-11-13T12:00:00');
const manager = userById('manager'), admin = userById('admin'), founder = userById('founder');
const values = {title:'联合审核',owners:['lin'],dueAt:'2026-11-14T18:00',priority:'medium'};

test('all selected reviewers must approve, each only once', () => {
  const db = seedDatabase(now);
  const request = requestTaskChange(db,manager,'create',values,null,now,['founder','admin','admin']);
  assert.deepEqual(request.reviewers,['admin','founder']);
  reviewTaskChange(db,admin,request.id,true,'已核对',now);
  assert.equal(request.status,'pending');
  assert.equal(db.tasks.some(t => t.id === request.taskId),false);
  assert.equal(canReviewRequest(admin,request),false);
  assert.equal(canReviewRequest(founder,request),true);
  assert.throws(() => reviewTaskChange(db,admin,request.id,true));
  reviewTaskChange(db,founder,request.id,true,'同意',now);
  assert.equal(request.status,'approved');
  assert.equal(request.reviews.length,2);
  assert.equal(db.tasks.filter(t => t.id === request.taskId).length,1);
});

test('selected reviewer permission and input validation apply before mutation', () => {
  const db = seedDatabase(now);
  for (const selected of [[],null,['manager'],['missing'],[123],'admin']) {
    assert.throws(() => requestTaskChange(db,manager,'create',values,null,now,selected));
    assert.equal(db.requests.length,0);
  }
  const request = requestTaskChange(db,manager,'create',values,null,now,['admin']);
  assert.equal(canReviewRequest(founder,request),false);
  assert.throws(() => reviewTaskChange(db,founder,request.id,true));
  assert.deepEqual(request.reviews,[]);
});

test('one rejection ends the whole request and preserves the original task', () => {
  const db = seedDatabase(now), before = structuredClone(db.tasks[0]);
  const request = requestTaskChange(db,manager,'delete',{},before.id,now,['admin','founder']);
  reviewTaskChange(db,admin,request.id,true,'',now);
  reviewTaskChange(db,founder,request.id,false,'仍需执行',now);
  assert.equal(request.status,'rejected');
  assert.deepEqual(db.tasks[0],before);
  assert.equal(request.reviews.length,2);
  assert.equal(canReviewRequest(admin,request),false);
});

test('stale final approval preserves previous approvals and can be rejected', () => {
  const db = seedDatabase(now), task = db.tasks[0];
  const request = requestTaskChange(db,manager,'edit',values,task.id,now,['admin','founder']);
  reviewTaskChange(db,admin,request.id,true,'',now);
  task.revision++;
  assert.throws(() => reviewTaskChange(db,founder,request.id,true),/发生变化/);
  assert.equal(request.status,'pending');
  assert.equal(request.reviews.length,1);
  reviewTaskChange(db,founder,request.id,false,'任务已调整',now);
  assert.equal(request.status,'rejected');
});


test('employees from any department can review only their explicitly assigned requests', () => {
  const db = seedDatabase(now), lin = userById('lin'), chen = userById('chen');
  assert.ok(allowedReviewers(manager).some(v => v.id === chen.id));
  const request = requestTaskChange(db,manager,'create',values,null,now,['lin','chen']);
  const unrelated = requestTaskChange(db,manager,'create',{...values,title:'其他申请'},null,now,['admin']);
  assert.deepEqual(visibleRequests(db,lin).map(r => r.id),[request.id]);
  assert.equal(canReviewRequest(lin,unrelated),false);
  reviewTaskChange(db,lin,request.id,true,'同意',now);
  assert.equal(request.status,'pending');
  reviewTaskChange(db,chen,request.id,true,'核对完成',now);
  assert.equal(request.status,'approved');
  assert.deepEqual(visibleRequests(db,chen).map(r => r.id),[request.id]);
  const legacy = requestTaskChange(db,manager,'create',values,null,now);
  assert.equal(canReviewRequest(lin,legacy),false,'legacy unassigned requests still require the original global role');
});

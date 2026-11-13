import test from 'node:test';
import assert from 'node:assert/strict';
import {taskDayInterval,taskDayLayout,taskMatchesQuery,isDemoLog} from '../src/domain.js';

test('timed layout clips cross-day work and shares columns only for overlaps', () => {
  const task = (id,start,end) => ({id,startAt:start,dueAt:end});
  const items = [task('overnight','2026-11-12T22:00','2026-11-13T02:00'),task('morning','2026-11-13T09:00','2026-11-13T10:00'),
    task('overlap','2026-11-13T09:30','2026-11-13T11:00'),task('later','2026-11-13T14:00','2026-11-13T18:00')];
  assert.deepEqual(taskDayInterval(items[0],'2026-11-13'),{start:0,end:120});
  assert.equal(taskDayInterval(items[0],'2026-11-14'),null);
  const result = taskDayLayout(items,'2026-11-13');
  assert.equal(result.find(t=>t.task.id==='morning').columns,2);
  assert.notEqual(result.find(t=>t.task.id==='morning').lane,result.find(t=>t.task.id==='overlap').lane);
  assert.equal(result.find(t=>t.task.id==='later').columns,1);
  assert.equal(result.find(t=>t.task.id==='later').start,840);
  assert.equal(result.find(t=>t.task.id==='later').end,1080);
});

test('task search uses title, details and owners while demo status respects explicit conversion', () => {
  const task = {title:'需求评审',detail:'Release notes',owners:['lin']};
  assert.equal(taskMatchesQuery(task,'  release '),true);
  assert.equal(taskMatchesQuery(task,'林予安'),true);
  assert.equal(taskMatchesQuery(task,'已完成'),false);
  assert.equal(isDemoLog({id:'demo-log-lin-2026-11-13'}),true);
  assert.equal(isDemoLog({id:'demo-log-lin-2026-11-13',demo:false}),false);
  assert.equal(isDemoLog({id:'normal',demo:true}),true);
});

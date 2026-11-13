import assert from 'node:assert/strict';
import { chromium, browserChannel } from '../../scripts/browser-test.mjs';

const browser = await chromium.launch({ channel: browserChannel, headless: true });
const today = '2026-11-13', tomorrow = '2026-11-14';

function gate() {
  let release, entered;
  return {
    wait: new Promise(resolve => { release = resolve; }),
    started: new Promise(resolve => { entered = resolve; }),
    release: () => release(), enter: () => entered()
  };
}

// Control both response orders through real UI actions, without exposing app state.
async function scenario(operation, workspaceFirst, failMove = false) {
  const page = await browser.newPage({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const errors = [], gates = [];
  page.on('pageerror', error => errors.push(error.message));
  const user = { id: 'worker', name: '改期测试员工', role: 'EMPLOYEE', department: '研发部' };
  const todo = { id: 'todo-1', date: today, title: '已完成事项', done: true };
  const db = { members: [user], allowedAssignees: [user], tasks: [], logs: [], tags: [],
    requests: [], announcements: [], highlights: [], notifications: [], todos: [todo], pins: {} };
  let writeGate, workspaceGate, previousDate;
  const hold = () => { const pending = gate(); gates.push(pending); return pending; };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  await page.clock.install({ time: new Date(`${today}T12:00:00+08:00`) });
  await page.addInitScript(() => localStorage.setItem('pandora.token', 'todo-sync-test'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/workspace')) {
      const snapshot = structuredClone({ user, db });
      const pending = workspaceGate; workspaceGate = null;
      if (pending) { pending.enter(); await pending.wait; }
      return route.fulfill({ json: snapshot });
    }
    if (path.endsWith('/todos/todo-1/date') || path.endsWith('/todos/todo-1/date/undo')) {
      const pending = writeGate; writeGate = null;
      if (pending) { pending.enter(); await pending.wait; }
      if (failMove) return route.fulfill({ status: 503, json: { error: '改期暂时失败' } });
      if (path.endsWith('/undo')) {
        assert.equal(route.request().postDataJSON().token, todo.moveToken);
        todo.date = previousDate; todo.moveToken = null;
      } else {
        previousDate = todo.date;
        todo.date = route.request().postDataJSON().date;
        todo.moveToken = 'undo-token';
      }
      return route.fulfill({ json: { ...todo } });
    }
    return route.fulfill({ status: 404, json: { error: `Unexpected ${path}` } });
  });

  async function submitMove() {
    await page.locator('.todo-day [data-action=todo-reschedule]').first().click();
    await page.locator('[data-form=todo-move] [name=date]').fill(tomorrow);
    await page.locator('[data-form=todo-move] button[type=submit]').click();
  }
  async function refresh() {
    const response = page.waitForResponse(res => res.url().endsWith('/workspace'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    return async () => { await response; await settle(); };
  }
  async function assertDate(date) {
    for (const day of [today, tomorrow]) {
      assert.equal(await page.locator(`[data-todo-drop="${day}"] .todo-date-count`).innerText(), day === date ? '1 项' : '',
        `${operation}: item must appear only on the saved date (${date}), workspaceFirst=${workspaceFirst}`);
      await page.locator(`[data-action=todo-select][data-id="${day}"]`).click();
      assert.equal(await page.locator('.todo-day [data-todo-drag="todo-1"]').count(), day === date ? 1 : 0);
    }
    await page.locator(`[data-action=todo-select][data-id="${date}"]`).click();
    assert.equal(await page.locator('.todo-day .todo-item.is-done').count(), 1, 'Rescheduling preserves completion');
  }

  try {
    await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
    await page.locator('.todo-day .todo-item').waitFor();
    if (operation === 'undo') {
      await submitMove();
      await page.getByRole('button', { name: '撤销', exact: true }).waitFor();
      await page.locator('#modal').waitFor({ state: 'hidden' });
    }
    const pendingWrite = writeGate = hold();
    if (operation === 'undo') await page.getByRole('button', { name: '撤销', exact: true }).click();
    else await submitMove();
    await pendingWrite.started;

    user.name = '后台已更新的姓名';
    const pendingWorkspace = workspaceGate = hold();
    const finishRefresh = await refresh();
    await pendingWorkspace.started;
    if (workspaceFirst) { pendingWorkspace.release(); await finishRefresh(); }
    pendingWrite.release();
    const message = failMove ? '改期暂时失败' : operation === 'undo' ? '已撤销改期' : '已移至 11月14日';
    await page.locator('#toast').filter({ hasText: message }).waitFor();
    if (failMove) await page.locator('[data-close]').click();
    await page.locator('#modal').waitFor({ state: 'hidden' });
    if (!workspaceFirst) { pendingWorkspace.release(); await finishRefresh(); }
    await settle();

    await assertDate(failMove || operation === 'undo' ? today : tomorrow);
    assert.match(await page.locator('.dashboard-head h1').innerText(), /后台已更新的姓名/, 'Other workspace fields still refresh');

    // Protection against an older snapshot must not block later legitimate updates.
    todo.date = todo.date === today ? tomorrow : today;
    todo.title = '其他设备更新后的事项';
    const finishLatest = await refresh(); await finishLatest();
    await assertDate(todo.date);
    assert.equal(await page.locator('.todo-day .todo-item-title').innerText(), todo.title);
    assert.deepEqual(errors, []);
    console.log(`Todo sync passed: ${operation}, workspace ${workspaceFirst ? 'before' : 'after'} write response${failMove ? ', failed write' : ''}.`);
  } finally {
    for (const pending of gates) pending.release();
    await page.close();
  }
}

try {
  for (const operation of ['move', 'undo']) {
    for (const workspaceFirst of [true, false]) await scenario(operation, workspaceFirst);
  }
  await scenario('move', false, true);
} finally { await browser.close(); }

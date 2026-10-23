import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const runtime = process.env.PANDORA_RUNTIME_MODULES || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(runtime, 'playwright'));
const browser = await chromium.launch({ channel: process.env.PANDORA_BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', isMobile: true, hasTouch: true });
const page = await context.newPage(), errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.clock.install({ time: new Date('2026-10-23T10:00:00+08:00') });
const members = [{ id: 'manager', name: '沈知夏', role: 'DEPT_MANAGER', roleName: '部门负责人', department: '产品设计部', avatar: '夏', color: 'green' },
  { id: 'lin', name: '林予安', role: 'EMPLOYEE', roleName: '员工', department: '产品设计部' }];
const makeLog = (id, date, author = 'manager') => ({ id, date, author, title: `${date} 工作日志`, content: `${date} 完成客户需求整理`, versions: [], updatedAt: `${date}T18:00:00`, taskId: '' });
const logs = [makeLog('today', '2026-10-23'), makeLog('before', '2026-10-21'), makeLog('month', '2026-10-05'), makeLog('other', '2026-10-23', 'lin')];
const history = [makeLog('old', '2026-09-05'), makeLog('other-old', '2026-09-05', 'lin')];
const db = { logs, members, tasks: [
  { id: 't1', title: '需求整理', detail: '', owners: ['manager'], creator: 'manager', dueAt: '2026-10-24T18:00', status: 'doing', priority: 'medium', history: [] },
  { id: 't2', title: '客户会议', detail: '', owners: ['manager'], creator: 'manager', dueAt: '2026-10-20T18:00', status: 'done', completedAt: '2026-10-20T17:00:00', priority: 'medium', history: [] }
], requests: [], announcements: [], pins: {} };
let historyRequests = 0, failHistory = false, releaseHistory;
let historyGate = null, passwordCalls = 0;
await page.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url());
  const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname.endsWith('/auth/login')) return respond({ token: 'personal-ui-token', user: members[0] });
  if (url.pathname.endsWith('/workspace')) return respond({ user: members[0], db });
  if (url.pathname.endsWith('/logs/history')) {
    historyRequests++;
    if (historyGate) await historyGate;
    return failHistory ? respond({ error: '测试加载失败' }, 500) : respond(history);
  }
  if (url.pathname.endsWith('/auth/password')) {
    passwordCalls++;
    return request.postDataJSON().currentPassword === 'incorrect' ? respond({ error: '原密码不正确' }, 400) : respond({ message: '密码已修改' });
  }
  if (url.pathname.endsWith('/logs') && request.method() === 'POST') {
    const body = request.postDataJSON();
    const log = makeLog('saved', body.values.date);
    log.content = body.values.content;
    logs.push(log);
    return respond(log);
  }
  return respond({ error: 'unexpected request' }, 404);
});
const checks = [];
const go = route => page.locator(`.nav [data-route="${route}"]`).click();
const close = () => page.getByRole('button', { name: '关闭', exact: true }).click();
const range = async (value, count) => {
  await page.locator(`[data-log-range="${value}"]`).click();
  await page.waitForFunction(({ value, count }) => document.querySelector(`[data-log-range="${value}"]`)?.getAttribute('aria-pressed') === 'true'
    && document.querySelectorAll('.log-results .log-card').length === count, { value, count });
};
try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await page.locator('[name="username"]').fill('manager');
  await page.locator('[name="password"]').fill('manager');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await go('logs');
  assert.equal(await page.locator('[data-log-author]').count(), 0);
  assert.equal(await page.locator('.log-results .log-card').count(), 2);
  checks.push('管理角色也仅展示本人日志，已移除人员筛选');
  historyGate = new Promise(resolve => { releaseHistory = resolve; });
  await page.locator('[data-log-range="30"]').click();
  await page.getByText('正在加载历史日志…', { exact: true }).waitFor();
  await page.locator('[data-log-range="all"]').click();
  releaseHistory(); historyGate = null;
  await page.waitForFunction(() => document.querySelectorAll('.log-results .log-card').length === 4);
  await range('7', 2); await range('30', 3); await range('all', 4); await range('30', 3); await range('all', 4);
  assert.equal(historyRequests, 1);
  checks.push('加载中切换及加载后反复切换7天、30天、全部均高亮并更新结果');
  await page.getByRole('searchbox').fill('2026-09-05');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  assert.equal(await page.locator('.log-results .log-card').count(), 1);
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await page.reload(); await go('logs'); failHistory = true;
  await page.locator('[data-log-range="all"]').click();
  await page.getByText('历史日志加载失败，请重试', { exact: true }).waitFor();
  failHistory = false;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.log-results .log-card').length === 4);
  checks.push('关键词搜索、清除搜索、历史加载失败提示及重试通过');
  await go('mine');
  assert.equal(await page.locator('.mine-page [data-route]').count(), 0);
  assert.deepEqual(await page.locator('.profile-stats dd').allTextContents(), ['1', '1', '3']);
  assert.equal(await page.locator('.journal-day.is-written').count(), 2);
  await page.locator('.journal-day:not(.is-written)').click();
  assert.equal(await page.locator('[name="date"]').inputValue(), '2026-10-22');
  await page.locator('[name="content"]').fill('补写昨天的工作记录');
  await page.getByRole('button', { name: '保存日志', exact: true }).click();
  await page.locator('.journal-day.is-written').nth(2).waitFor();
  await page.locator('.journal-day').first().click();
  assert.equal(await page.locator('[name="content"]').inputValue(), logs[0].content);
  await close();
  checks.push('本月统计准确、无重复导航、最近三天可直接补写及编辑');
  for (const action of ['profile-details','help','about']) {
    await page.locator(`.settings-list [data-action="${action}"]`).click();
    assert.equal(await page.locator('#modal').evaluate(el => el.open), true);
    await close();
  }
  await page.locator('[data-action="password-form"]').click();
  await page.locator('[name="currentPassword"]').fill('incorrect');
  await page.locator('[name="newPassword"]').fill('new-password-123');
  await page.locator('[name="confirmPassword"]').fill('mismatched-password');
  await page.getByRole('button', { name: '确认修改', exact: true }).click();
  assert.equal(passwordCalls, 0);
  await page.locator('[name="confirmPassword"]').fill('new-password-123');
  await page.getByRole('button', { name: '确认修改', exact: true }).click();
  await page.getByText('原密码不正确', { exact: true }).waitFor();
  await page.locator('[name="currentPassword"]').fill('correct-password');
  await page.getByRole('button', { name: '确认修改', exact: true }).click();
  await page.locator('[data-form="login"]').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('pandora.token')), null);
  checks.push('个人资料、帮助、版本可查看；密码确认、原密码错误和修改后退出通过');
  await page.locator('[name="username"]').fill('manager'); await page.locator('[name="password"]').fill('manager');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  for (const width of [360,390,412,1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ['logs','mine']) {
      await go(route);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} ${route}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.fastForward(3500);
  const output = path.resolve('deliverables/verification'); await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'mine-personal.png'), fullPage: true });
  await go('logs'); await page.screenshot({ path: path.join(output, 'logs-personal.png'), fullPage: true });
  checks.push('360/390/412/1280宽度无横向溢出');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks, errors }, null, 2));
} finally { await browser.close(); }

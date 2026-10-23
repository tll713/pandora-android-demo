import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const runtime = process.env.PANDORA_RUNTIME_MODULES || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(runtime, 'playwright'));
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(webRoot, 'tests/artifacts');
await mkdir(artifacts, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(webRoot, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(webRoot + path.sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: process.env.PANDORA_BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const page = await context.newPage(), errors = [], checks = [], mutations = [];
page.on('pageerror', error => errors.push(error.message));
await page.clock.setFixedTime(new Date('2026-10-23T10:00:00+08:00'));
const users = [
  { id: 'admin', name: '系统管理员', role: 'ADMIN', department: '管理中心', enabled: true },
  { id: 'founder', name: '许文清', role: 'FOUNDER', department: '管理中心', enabled: true },
  { id: 'lin', name: '林予安', role: 'EMPLOYEE', department: '产品设计部', enabled: true },
  { id: 'zhou', name: '周一鸣', role: 'TEAM_LEAD', department: '产品设计部', enabled: true },
  { id: 'chen', name: '陈嘉宁', role: 'EMPLOYEE', department: '市场运营部', enabled: false }
];
const tasks = Array.from({ length: 14 }, (_, i) => ({
  id: 't' + i, title: ['完成客户方案初稿', '整理本周产品需求', '检查移动端交互原型', '整理用户访谈记录'][i % 4] + (i > 3 ? ' · ' + i : ''),
  detail: '明确设计目标，与团队同步关键交付内容。\n验收标准：完成需求确认与核心页面设计。',
  priority: ['high', 'medium', 'low'][i % 3], dueAt: (i % 4 === 0 ? '2026-01-10' : '2027-01-10') + 'T18:00',
  status: ['todo', 'doing', 'done'][i % 3], owners: ['lin', 'zhou'], ownerNames: ['林予安', '周一鸣'],
  creator: 'founder', creatorName: '许文清', revision: 1, createdAt: '2026-10-20T10:00',
  history: [{ at: '2026-10-21T10:00', actor: 'lin', text: '工作进展：已完成需求梳理。' }]
}));
const requests = [
  { id: 'r1', taskId: 't1', taskTitle: '整理本周产品需求', kind: 'edit', proposer: 'founder', proposerName: '许文清', status: 'pending', createdAt: '2026-10-23T10:00', before: { title: '旧任务名称', owners: ['lin'], dueAt: '2027-01-10T18:00', priority: 'medium', detail: '旧说明' }, after: { title: '新任务名称', owners: ['lin', 'zhou'], dueAt: '2027-01-11T18:00', priority: 'high', detail: '新的交付要求' } },
  { id: 'r2', taskId: 'new-task', taskTitle: '本人提交的新任务', kind: 'create', proposer: 'admin', proposerName: '系统管理员', status: 'pending', createdAt: '2026-10-22T10:00', before: null, after: { title: '本人提交的新任务', owners: ['lin'], dueAt: '2027-01-10T18:00', priority: 'medium', detail: '待审核' } },
  { id: 'r3', taskId: 't2', taskTitle: '历史申请记录', kind: 'edit', proposer: 'founder', proposerName: '许文清', status: 'approved', createdAt: '2026-10-21T10:00', reviewedAt: '2026-10-21T12:00', reviewer: 'admin', reviewerName: '系统管理员', reason: '确认目标无误', before: { title: '原名称' }, after: { title: '新名称' } }
];
const logs = [
  { id: 'l1', title: '今日需求梳理与协作记录', author: 'lin', authorName: '林予安', date: '2026-10-23', content: '完成需求梳理。\n<script>window.__unsafe=true</script>\n下一步：与研发确认。', updatedAt: '2026-10-23T18:00', versions: [{ title: '修改前标题', content: '这是原始版本正文', at: '2026-10-23T16:00', actor: 'lin' }] },
  { id: 'l2', title: '周例会准备', author: 'zhou', authorName: '周一鸣', date: '2026-10-22', content: '整理本周成果、风险和下一步安排。', updatedAt: '2026-10-22T18:00', versions: [] }
];
const announcements = [
  { id: 'a1', title: '关于本周团队工作安排', category: '通知', content: '请各位成员按时更新工作日志，及时同步任务进展。\n让协作更加高效有序。', date: '2026-10-23', pinned: true },
  { id: 'a2', title: '团队协作规范更新', category: '制度', content: '任务变更需审核通过后生效，请提前提交申请。', date: '2026-10-22', pinned: false }
];
let currentUser = users[0], failLoad = false, unauthorized = false;
await page.route('**/api/**', async route => {
  const req = route.request(), p = new URL(req.url()).pathname.slice(4), method = req.method();
  const body = req.postData() ? req.postDataJSON() : null;
  const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (p === '/auth/login') {
    currentUser = users.find(u => u.id === body.username) || users[2];
    return send({ token: 'test-token', user: currentUser });
  }
  if (unauthorized) return send({ error: '登录已过期' }, 401);
  if (p === '/auth/me') return send(currentUser);
  if (method === 'GET') {
    if (failLoad && p === '/admin/tasks') return send({ error: '测试数据加载失败' }, 500);
    const data = { '/admin/users': users, '/admin/tasks': tasks, '/admin/requests': requests, '/admin/logs': logs, '/announcements': announcements }[p];
    return data ? send(data) : send({ error: '未知请求' }, 404);
  }
  mutations.push({ p, method, body });
  if (p === '/tasks/requests') {
    requests.push({ id: 'request-' + requests.length, taskId: body.taskId || 'new-' + requests.length, taskTitle: body.values?.title || tasks.find(t => t.id === body.taskId)?.title, kind: body.kind, proposer: currentUser.id, proposerName: currentUser.name, status: 'pending', createdAt: '2026-10-24T10:00', after: body.values, before: null });
    return send(requests.at(-1));
  }
  if (/\/tasks\/requests\/[^/]+\/review/.test(p)) {
    const r = requests.find(r => r.id === p.split('/')[3]);
    Object.assign(r, { status: body.approve ? 'approved' : 'rejected', reason: body.reason, reviewer: currentUser.id, reviewerName: currentUser.name, reviewedAt: '2026-10-24T12:00' });
    return send(r);
  }
  if (p === '/admin/users' && method === 'POST') {
    users.push({ ...body, id: body.login, enabled: true }); return send(users.at(-1));
  }
  if (/\/admin\/users\/[^/]+$/.test(p) && method === 'PUT') {
    const u = users.find(u => u.id === decodeURIComponent(p.split('/').at(-1))); Object.assign(u, body); return send(u);
  }
  if (p.endsWith('/password')) return send({ message: '密码已重置' });
  if (p === '/admin/announcements' && method === 'POST') {
    announcements.push({ ...body, id: 'a' + (announcements.length + 1), date: '2026-10-24', pinned: false }); return send(announcements.at(-1));
  }
  if (p.startsWith('/admin/announcements/')) {
    const i = announcements.findIndex(a => a.id === p.split('/').at(-1));
    if (method === 'DELETE') { announcements.splice(i, 1); return send({ ok: true }); }
    Object.assign(announcements[i], body); return send(announcements[i]);
  }
  return send({ error: '未实现的测试请求' }, 404);
});
const go = async name => { await page.locator('#navigation').getByRole('link', { name: new RegExp('^' + name) }).click(); await page.locator('#page-title').getByText(name, { exact: true }).waitFor(); };
const close = () => page.locator('#detail-dialog').getByRole('button', { name: '关闭', exact: true }).click();
const waitReload = async () => { await page.locator('.loading-state').waitFor({ state: 'hidden' }); await page.locator('#refresh-btn:not([disabled])').waitFor(); };
const login = async name => {
  await page.locator('#login-form [name=username]').fill(name);
  await page.locator('#login-form [name=password]').fill(name);
  await page.getByRole('button', { name: '登录工作台' }).click();
};
try {
  await page.goto(url);
  await page.locator('#login-view').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(artifacts, 'login.png'), fullPage: true });
  await login('lin');
  await page.locator('#login-error').getByText('仅管理员和创始人可登录管理后台').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('pandora.admin.token')), null);
  await login('admin'); await waitReload();
  assert.equal(await page.locator('.stat-card').count(), 4);
  await page.screenshot({ path: path.join(artifacts, 'dashboard.png'), fullPage: true });
  checks.push('员工不能进入管理后台；管理员登录与工作台数据展示');
  await page.locator('.stat-card').nth(2).click();
  assert.ok((await page.locator('tbody tr').count()) > 0);
  assert.ok((await page.locator('tbody tr').count()) < 10);
  await page.getByRole('button', { name: '重置', exact: true }).click();
  assert.equal(await page.locator('tbody tr').count(), 10);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  assert.equal(await page.locator('tbody tr').count(), 4);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.getByRole('searchbox', { name: '关键词' }).fill('完成客户方案初稿');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  assert.equal(await page.locator('tbody tr').count(), 4);
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await page.locator('tbody tr').first().getByRole('button', { name: '详情', exact: true }).click();
  await page.locator('#dialog-content').getByText('工作进展：已完成需求梳理。').waitFor();
  await page.screenshot({ path: path.join(artifacts, 'task-detail.png'), fullPage: true });
  await close();
  checks.push('逾期入口、任务分页、搜索和任务进展时间线');

  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await page.locator('#task-form [name=title]').fill('新建验收任务');
  await page.locator('#task-form [name=dueAt]').fill('2027-02-10T18:30');
  await page.locator('#task-form [name=owners][value=lin]').check();
  await page.locator('#task-form [name=detail]').fill('验收交付内容');
  await page.getByRole('button', { name: '提交创建申请' }).click();
  await page.locator('#detail-dialog').waitFor({ state: 'hidden' }); await waitReload();
  assert.equal(mutations.at(-1).body.kind, 'create');
  assert.deepEqual(mutations.at(-1).body.values.owners, ['lin']);
  await page.locator('tbody tr').first().getByRole('button', { name: '编辑', exact: true }).click();
  await page.locator('#task-form [name=title]').fill('编辑验收任务');
  await page.getByRole('button', { name: '提交编辑申请' }).click();
  await page.locator('#detail-dialog').waitFor({ state: 'hidden' }); await waitReload();
  assert.equal(mutations.at(-1).body.kind, 'edit');
  checks.push('任务创建与编辑均提交审核申请');

  await go('审核中心');
  await page.locator('[data-action=request-detail][data-id=r2]').first().click();
  assert.equal(await page.locator('[data-action=approve-request]').count(), 0);
  await page.getByText('这是你提交的申请，需要由另一位管理员或创始人审核。').waitFor();
  await close();
  await page.locator('[data-action=request-detail][data-id=r1]').first().click();
  await page.getByText('旧任务名称', { exact: true }).waitFor();
  await page.getByText('新任务名称', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(artifacts, 'review-detail.png'), fullPage: true });
  await page.getByRole('button', { name: '驳回申请', exact: true }).click();
  await page.locator('#form-error').getByText('驳回申请时必须填写原因').waitFor();
  await page.locator('#review-form [name=reason]').fill('请补充交付标准');
  await page.getByRole('button', { name: '驳回申请', exact: true }).click();
  await page.locator('#confirm-submit').click();
  await page.locator('#detail-dialog').waitFor({ state: 'hidden' }); await waitReload();
  assert.equal(requests[0].status, 'rejected');
  await page.getByRole('button', { name: /^已驳回/ }).click();
  await page.locator('[data-action=request-detail][data-id=r1]').first().click();
  await page.getByText('请补充交付标准', { exact: true }).waitFor(); await close();
  checks.push('审核前后对比、自审限制、必填驳回原因、审核历史');

  await go('组织与账号');
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  await page.locator('#user-form [name=name]').fill('测试成员');
  await page.locator('#user-form [name=login]').fill('test-member');
  await page.locator('#user-form [name=department]').fill('研发部');
  await page.getByRole('button', { name: '创建成员', exact: true }).click();
  await page.locator('#detail-dialog').waitFor({ state: 'hidden' }); await waitReload();
  await page.locator('[data-action=edit-user][data-id=test-member]').click();
  await page.locator('#user-form [name=enabled]').uncheck();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.locator('#detail-dialog').waitFor({ state: 'hidden' }); await waitReload();
  assert.equal(users.at(-1).enabled, false);
  await page.locator('[data-action=reset-password][data-id=lin]').click();
  await page.locator('#password-form [name=password]').fill('new-password-123');
  await page.locator('#password-form [name=confirmPassword]').fill('wrong-password');
  await page.getByRole('button', { name: '确认重置密码', exact: true }).click();
  await page.locator('#form-error').getByText('两次输入的密码不一致').waitFor();
  await page.locator('#password-form [name=confirmPassword]').fill('new-password-123');
  await page.getByRole('button', { name: '确认重置密码', exact: true }).click();
  await page.locator('#detail-dialog').waitFor({ state: 'hidden' }); await waitReload();
  assert.equal(mutations.at(-1).body.password, 'new-password-123');
  checks.push('账号创建、编辑停用、密码确认与重置');

  await go('工作日志');
  await page.locator('#filter-form [name=author]').selectOption('lin');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.locator('[data-action=log-detail][data-id=l1]').first().click();
  await page.locator('summary').click();
  await page.getByText('这是原始版本正文', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.__unsafe), undefined);
  await close();
  await page.locator('#filter-form [name=from]').fill('2026-10-24');
  assert.equal(await page.locator('tbody tr').count(), 0);
  checks.push('人员与日期筛选、日志全文和历史版本、文本注入防护');

  await go('公司公告');
  await page.getByRole('button', { name: '发布公告', exact: true }).click();
  await page.locator('#announcement-form [name=title]').fill('验收公告');
  await page.locator('#announcement-form [name=content]').fill('发布测试正文');
  await page.locator('#announcement-form button[type=submit]').click();
  await page.locator('#detail-dialog').waitFor({ state: 'hidden' }); await waitReload();
  await page.locator('[data-action=edit-announcement][data-id=a3]').click();
  await page.locator('#announcement-form [name=content]').fill('更新后的正文');
  await page.locator('#announcement-form [name=pinned]').check();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.locator('#detail-dialog').waitFor({ state: 'hidden' }); await waitReload();
  assert.equal(announcements.at(-1).pinned, true);
  await page.locator('[data-action=delete-announcement][data-id=a3]').click();
  await page.locator('#confirm-submit').click();
  await waitReload();
  assert.equal(announcements.length, 2);
  checks.push('公告发布、编辑、置顶、删除确认');

  failLoad = true; await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByText('数据加载失败', { exact: true }).waitFor();
  failLoad = false; await page.getByRole('button', { name: '重新加载', exact: true }).click(); await waitReload();
  await page.locator('[data-action=logout]').click(); await login('founder'); await waitReload();
  await go('组织与账号');
  assert.equal(await page.getByRole('button', { name: '添加成员', exact: true }).count(), 0);
  assert.equal(await page.locator('[data-action=edit-user]').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action=menu]').click();
  await go('工作台');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('[data-action=menu]').click();
  await go('工作台');
  assert.equal(await page.locator('#app-view').evaluate(el => el.classList.contains('menu-open')), false);
  await page.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().right <= 1);
  await page.screenshot({ path: path.join(artifacts, 'mobile-dashboard.png'), fullPage: true });
  await page.locator('[data-action=menu]').click(); await go('任务管理');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  assert.equal(await page.evaluate(() => document.querySelector('#detail-dialog').getBoundingClientRect().width <= innerWidth), true);
  await close();
  unauthorized = true; await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.locator('#login-view').waitFor({ state: 'visible' });
  checks.push('加载失败与重试、创始人只读账号权限、移动适配、登录失效');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks, screenshots: artifacts }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
  console.error('Completed checks:', checks);
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}

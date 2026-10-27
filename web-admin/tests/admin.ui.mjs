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
const page = await context.newPage(), errors = [], checks = [], requests = [], mutations = [];
page.on('pageerror', error => errors.push(error.message));
await page.clock.setFixedTime(new Date('2026-10-23T10:00:00+08:00'));
const users = [
  { id: 'admin', name: '系统管理员', role: 'ADMIN', department: '管理中心', enabled: true },
  { id: 'founder', name: '许文清', role: 'FOUNDER', department: '管理中心', enabled: true },
  { id: 'lin', name: '林予安', role: 'EMPLOYEE', department: '产品设计部', enabled: true },
  { id: 'zhou', name: '周一鸣', role: 'TEAM_LEAD', department: '产品设计部', enabled: true },
  { id: 'chen', name: '陈嘉宁', role: 'EMPLOYEE', department: '市场运营部', enabled: false }
];
const announcements = [
  { id: 'a1', title: '关于本周团队工作安排', category: '通知', content: '请各位成员按时查看公司通知。', date: '2026-10-23', pinned: true },
  { id: 'a2', title: '团队协作规范更新', category: '制度', content: '最新制度请以本公告为准。', date: '2026-10-22', pinned: false }
];
const highlights = [];
const tasks = [{id:'task-1', title:'客户方案评审', detail:'确认方案与验收标准', dueAt:'2026-10-27T15:00', owners:['lin'], ownerNames:['林予安']}];
let currentUser = users[0], failLoad = false, unauthorized = false;
await page.route('**/api/**', async route => {
  const req = route.request(), p = new URL(req.url()).pathname.slice(4), method = req.method();
  const body = req.postData() ? req.postDataJSON() : null;
  const send = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (p === '/auth/login') {
    currentUser = users.find(u => u.name === body.identifier || u.phone === body.identifier) || users[2];
    return send({ token: 'test-token', user: currentUser });
  }
  if (unauthorized) return send({ error: '登录已过期' }, 401);
  if (p === '/auth/me') return send(currentUser);
  if (method === 'GET') {
    requests.push(p);
    if (failLoad && p === '/admin/users') return send({ error: '测试数据加载失败' }, 500);
    const data = { '/admin/users': users, '/announcements': announcements, '/admin/highlights':highlights, '/admin/tasks':tasks }[p];
    return data ? send(data) : send({ error: '未知请求' }, 404);
  }
  mutations.push({ p, method, body });
  if(p==='/admin/highlights'&&method==='POST') {
    if(highlights.some(h=>h.kind===body.kind&&h.audience===body.audience&&h.position===body.position)) return send({error:'该展示位置已被占用'},400);
    highlights.push({...body,id:'h'+(highlights.length+1)});return send(highlights.at(-1));
  }
  if(p.startsWith('/admin/highlights/')) {
    const index=highlights.findIndex(h=>h.id===p.split('/').at(-1));
    if(method==='DELETE') {highlights.splice(index,1);return send({ok:true});}
    Object.assign(highlights[index],body);return send(highlights[index]);
  }
  if (p === '/admin/users' && method === 'POST') {
    assert.equal(Object.hasOwn(body, 'login'), false);
    users.push({ ...body, id: 'test-member', enabled: true }); return send({...users.at(-1),temporaryPassword:'Ab2!GeneratedPass78'});
  }
  if (/\/admin\/users\/[^/]+$/.test(p) && method === 'PUT') {
    const user = users.find(user => user.id === decodeURIComponent(p.split('/').at(-1))); Object.assign(user, body); return send(user);
  }
  if (p.endsWith('/password')) return send({ message: '密码已重置' });
  if (p === '/admin/announcements' && method === 'POST') {
    announcements.push({ ...body, id: 'a' + (announcements.length + 1), date: '2026-10-24', pinned: false }); return send(announcements.at(-1));
  }
  if (p.startsWith('/admin/announcements/')) {
    const index = announcements.findIndex(a => a.id === p.split('/').at(-1));
    if (method === 'DELETE') { announcements.splice(index, 1); return send({ ok: true }); }
    Object.assign(announcements[index], body); return send(announcements[index]);
  }
  return send({ error: '未实现的测试请求' }, 404);
});
const go = async name => {
  await page.locator('#navigation').getByRole('link', { name: new RegExp('^' + name) }).click();
  await page.locator('#page-title').getByText(name, { exact: true }).waitFor();
};
const close = () => page.locator('#detail-dialog').getByRole('button', { name: '关闭', exact: true }).click();
const waitReload = async () => { await page.locator('.loading-state').waitFor({ state: 'hidden' }); await page.locator('#refresh-btn:not([disabled])').waitFor(); };
const login = async name => {
  await page.locator('#login-form [name=identifier]').fill(name);
  await page.locator('#login-form [name=password]').fill(name);
  await page.getByRole('button', { name: '登录管理端' }).click();
};
try {
  await page.goto(url);
  await page.locator('#login-view').waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(artifacts, 'login.png'), fullPage: true });
  await login('林予安');
  await page.locator('#login-error').getByText('仅管理员和创始人可登录管理后台').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('pandora.admin.token')), null);
  await login('系统管理员'); await waitReload();
  assert.deepEqual([...new Set(requests)].sort(), ['/admin/highlights','/admin/tasks','/admin/users', '/announcements']);
  assert.equal(await page.locator('#navigation a').count(), 3);
  assert.equal(await page.locator('#page-title').textContent(), '组织与账号');
  await page.screenshot({ path: path.join(artifacts, 'organization.png'), fullPage: true });
  checks.push('默认进入组织与账号，支持十大内容管理');

  await page.locator('#filter-form [name=department]').selectOption('产品设计部');
  assert.equal(await page.locator('tbody tr').count(), 2);
  await page.locator('#filter-form [name=department]').selectOption('');
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  await page.locator('#user-form [name=name]').fill('测试成员');
  assert.equal(await page.locator('#user-form [name=login]').count(), 0);
  await page.locator('#user-form [name=phone]').fill('13800138001');
  await page.locator('#user-form [name=gender]').selectOption('女');
  await page.locator('#user-form [name=idNumber]').fill('11010119900101001X');
  await page.locator('#user-form [name=department]').fill('研发部');
  await page.getByRole('button', { name: '创建成员', exact: true }).click();
  await page.locator('#temporary-password').waitFor();
  assert.equal(await page.locator('#temporary-password').inputValue(), 'Ab2!GeneratedPass78');
  assert.equal(users.at(-1).gender,'女'); assert.equal(users.at(-1).phone,'13800138001');
  await page.getByRole('button', { name: '已保存密码', exact: true }).click();
  await page.locator('#detail-dialog').waitFor({ state: 'hidden' }); await waitReload();
  assert.equal(await page.locator('#temporary-password').count(),0);
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
  checks.push('组织成员筛选、账号创建停用与密码重置');

  await go('公司公告');
  await page.screenshot({ path: path.join(artifacts, 'announcements.png'), fullPage: true });
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
  await page.locator('#confirm-submit').click(); await waitReload();
  assert.equal(announcements.length, 2);
  checks.push('公告发布、编辑、置顶与删除确认');

  await go('十大内容');
  for(const [kind,title] of [['company','公司年度重点'],['dispatch','重点派发任务'],['personal','个人重点计划']]) {
    await page.getByRole('button',{name:'录入十大内容',exact:true}).click();
    await page.locator('#highlight-form [name=kind]').selectOption(kind);
    if(kind==='personal') await page.locator('#highlight-form [name=audience]').selectOption('lin');
    if(kind==='dispatch') {
      await page.locator('#highlight-form [name=taskId]').selectOption('task-1');
      assert.equal(await page.locator('#highlight-form [name=title]').inputValue(),tasks[0].title);
    }
    await page.locator('#highlight-form [name=title]').fill(title);
    await page.locator('#highlight-form [name=content]').fill('具体事务与详细工作安排');
    await page.getByRole('button',{name:'保存内容',exact:true}).click();
    await page.locator('#detail-dialog').waitFor({state:'hidden'});await waitReload();
    assert.equal(highlights.at(-1).kind,kind);
    if(kind==='personal') assert.equal(highlights.at(-1).audience,'lin');
    else assert.equal(highlights.at(-1).audience,'');
  }
  await page.locator('#filter-form [name=kind]').selectOption('personal');
  assert.equal(await page.locator('tbody tr').count(),1);
  await page.locator('[data-action=edit-highlight][data-id=h3]').click();
  await page.locator('#highlight-form [name=position]').selectOption('3');
  await page.locator('#highlight-form [name=content]').fill('已修改的个人事务详情');
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.locator('#detail-dialog').waitFor({state:'hidden'});await waitReload();
  assert.equal(highlights[2].position,3);
  await page.locator('[data-action=toggle-highlight][data-id=h3]').click();await waitReload();
  assert.equal(highlights[2].enabled,false);
  await page.locator('[data-action=toggle-highlight][data-id=h3]').click();await waitReload();
  await page.locator('[data-action=highlight-detail][data-id=h3]').click();
  await page.locator('#dialog-content').getByText('已修改的个人事务详情',{exact:true}).waitFor();await close();
  await page.locator('[data-action=reset-filters]').click();
  await page.screenshot({path:path.join(artifacts,'highlights.png'),fullPage:true});
  await page.locator('[data-action=delete-highlight][data-id=h3]').click();
  await page.locator('#confirm-submit').click();await waitReload();assert.equal(highlights.length,2);
  checks.push('三类十大内容录入、关联任务、个人对象、筛选、排序、详情、发布停用和删除');

  failLoad = true; await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByText('数据加载失败', { exact: true }).waitFor();
  failLoad = false; await page.getByRole('button', { name: '重新加载', exact: true }).click(); await waitReload();
  await page.locator('[data-action=logout]').click(); await login('许文清'); await waitReload();
  await go('组织与账号');
  assert.equal(await page.getByRole('button', { name: '添加成员', exact: true }).count(), 0);
  assert.equal(await page.locator('[data-action=edit-user]').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => document.querySelector('#sidebar').getBoundingClientRect().right <= 0), true);
  await page.screenshot({ path: path.join(artifacts, 'mobile-organization.png'), fullPage: true });
  await page.locator('[data-action=menu]').click();
  assert.equal(await page.locator('#app-view').evaluate(el => el.classList.contains('menu-open')), true);
  await go('公司公告');
  assert.equal(await page.locator('#app-view').evaluate(el => el.classList.contains('menu-open')), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('[data-action=menu]').click();await go('十大内容');
  await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().right<=0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({path:path.join(artifacts,'mobile-highlights.png'),fullPage:true});
  unauthorized = true; await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.locator('#login-view').waitFor({ state: 'visible' });
  checks.push('加载失败重试、创始人只读权限、移动布局与登录失效');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks, screenshots: artifacts }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
  console.error('Completed checks:', checks);
  throw error;
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}

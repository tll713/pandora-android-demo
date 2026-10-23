export const USERS = [
  { id: 'manager', name: '沈知夏', role: '部门负责人', department: '产品设计部', avatar: '夏', color: 'green' },
  { id: 'lin', name: '林予安', role: '员工', department: '产品设计部', avatar: '安', color: 'blue' },
  { id: 'zhou', name: '周一鸣', role: '团队长', department: '产品设计部', avatar: '鸣', color: 'orange' },
  { id: 'chen', name: '陈嘉宁', role: '员工', department: '市场运营部', avatar: '宁', color: 'purple' },
  { id: 'founder', name: '许文清', role: '创始人', department: '管理中心', avatar: '清', color: 'green' },
  { id: 'admin', name: '系统管理员', role: '管理员', department: '管理中心', avatar: '管', color: 'gray' }
];
export const STATUS = { todo: '待开始', doing: '进行中', done: '已完成' };
export const PRIORITY = { high: '高优先级', medium: '中优先级', low: '低优先级' };
export const STORAGE_KEY = 'pandora.workspace.v2';
export const userById = id => USERS.find(u => u.id === id);
export const isManager = u => Boolean(u && u.role !== '员工' && u.role !== 'EMPLOYEE');
export const isGlobal = u => ['管理员', '创始人', 'ADMIN', 'FOUNDER'].includes(u?.role);
export function hydrateUsers(db) {
  for (const u of db.members || []) if (!userById(u.id)) USERS.push(u);
}
export function dateKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function minuteKey(date = new Date()) {
  const d = new Date(date);
  return `${dateKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function dayOffset(offset, from = new Date()) {
  const d = typeof from === 'string' ? new Date(`${from}T12:00:00`) : new Date(from);
  d.setDate(d.getDate() + offset); return dateKey(d);
}
export function isValidDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '') && Number.isFinite(new Date(`${v}T12:00:00`).getTime()) && dateKey(`${v}T12:00:00`) === v;
}
export function isValidMinute(v) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v || '') && isValidDate(v.slice(0, 10)) && Number(v.slice(11, 13)) < 24 && Number(v.slice(14)) < 60;
}
export function canSeeUser(u, ownerId) {
  const owner = userById(ownerId);
  if (!u || !owner) return false;
  if (isGlobal(u) || u.id === ownerId) return true;
  return isManager(u) && owner.department === u.department;
}
export const canSeeTask = (u, t) => Boolean(t && !t.deleted && (t.owners.includes(u?.id) || t.creator === u?.id || (isManager(u) && t.owners.some(id => canSeeUser(u, id)))));
export const canWorkOnTask = (u, t) => Boolean(canSeeTask(u, t) && t.owners.includes(u.id));
export const canManageTask = (u, t) => Boolean(isManager(u) && canSeeTask(u, t) && t.owners.every(id => canSeeUser(u, id)));
export const visibleTasks = (db, u) => db.tasks.filter(t => canSeeTask(u, t));
export const visibleLogs = (db, u) => db.logs.filter(l => l.author === u?.id);
export const recentLogs = (db, u, today = dateKey()) => visibleLogs(db, u).filter(l => l.date >= dayOffset(-6, today) && l.date <= today);
export const allowedAssignees = u => USERS.filter(v => v.role !== '管理员' && v.role !== 'ADMIN' && canSeeUser(u, v.id));
export const isOverdue = (t, now = minuteKey()) => t.dueAt < now && t.status !== 'done';
const id = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function cleaned(value, name, max) {
  const text = String(value ?? '').trim();
  requireValue(text.length > 0, `请填写${name}`);
  requireValue(text.length <= max, `${name}不能超过 ${max} 个字`); return text;
}
function taskValues(u, v) {
  const owners = [...new Set(v.owners || [])];
  requireValue(owners.length > 0 && owners.every(o => allowedAssignees(u).some(a => a.id === o)), '请选择管理范围内的负责人');
  requireValue(isValidMinute(v.dueAt), '截止时间需精确到分钟');
  requireValue(Object.hasOwn(PRIORITY, v.priority), '请选择优先级');
  const detail = String(v.detail || '').trim();
  requireValue(detail.length <= 2000, '任务说明不能超过 2000 个字');
  return { title: cleaned(v.title, '任务名称', 80), owners, dueAt: v.dueAt, priority: v.priority, detail };
}
export function requestTaskChange(db, u, kind, values = {}, taskId = null, now = new Date()) {
  requireValue(isManager(u), '当前身份不能提交任务变更');
  requireValue(['create', 'edit', 'delete'].includes(kind), '未知变更类型');
  const task = kind === 'create' ? null : db.tasks.find(t => t.id === taskId);
  if (kind !== 'create') {
    requireValue(canManageTask(u, task), '没有修改这项任务的权限');
    requireValue(!db.requests.some(r => r.taskId === taskId && r.status === 'pending'), '这项任务已有待审核变更');
  }
  const after = kind === 'delete' ? null : taskValues(u, values);
  const request = { id: id('request'), kind, taskId: task?.id || id('task'), proposer: u.id, status: 'pending',
    after, before: task ? structuredClone(task) : null, expectedRevision: task?.revision || 0, createdAt: new Date(now).toISOString() };
  db.requests.unshift(request); return request;
}
export const createTask = (db, u, values, now) => requestTaskChange(db, u, 'create', values, null, now);
export function canReviewRequest(u, r) {
  return Boolean(isGlobal(u) && r && r.proposer !== u.id && r.status === 'pending');
}
export const visibleRequests = (db, u) => db.requests.filter(r => isGlobal(u) || r.proposer === u?.id);
export function reviewTaskChange(db, u, requestId, approve, reason = '', now = new Date()) {
  const r = db.requests.find(v => v.id === requestId);
  requireValue(canReviewRequest(u, r), '需由另一位管理员或创始人审核待处理申请');
  const note = approve ? String(reason).trim() : cleaned(reason, '驳回原因', 500);
  requireValue(note.length <= 500, '审核备注不能超过 500 个字');
  const at = new Date(now).toISOString();
  if (approve) {
    if (r.kind === 'create') {
      requireValue(!db.tasks.some(t => t.id === r.taskId), '任务已存在，请勿重复审核');
      db.tasks.unshift({ ...structuredClone(r.after), id: r.taskId, creator: r.proposer, createdAt: r.createdAt,
        status: 'todo', revision: 1, deleted: false, history: [{ at, actor: u.id, text: '审核通过，任务创建生效' }] });
    } else {
      const task = db.tasks.find(t => t.id === r.taskId);
      requireValue(task && !task.deleted && task.revision === r.expectedRevision, '任务已发生变化，请驳回并重新申请');
      if (r.kind === 'edit') Object.assign(task, structuredClone(r.after)); else task.deleted = true;
      task.revision++; task.history.push({ at, actor: u.id, text: r.kind === 'edit' ? '任务编辑审核通过' : '任务删除审核通过，记录归档' });
    }
  }
  Object.assign(r, { status: approve ? 'approved' : 'rejected', reviewer: u.id, reviewedAt: at, reason: note });
  return r;
}
export function updateTaskDetail(db, u, taskId, note, now = new Date()) {
  const task = db.tasks.find(t => t.id === taskId);
  requireValue(canWorkOnTask(u, task), '只有任务负责人可以记录进展');
  requireValue(task.status !== 'done', '已完成任务不能继续记录进展');
  const text = cleaned(note, '进展内容', 1000);
  task.status = 'doing'; task.history.push({ at: new Date(now).toISOString(), actor: u.id, text: `工作进展：${text}` }); return task;
}
export function completeTask(db, u, taskId, now = new Date()) {
  const task = db.tasks.find(t => t.id === taskId);
  requireValue(canWorkOnTask(u, task), '只有任务负责人可以完成任务');
  requireValue(task.status !== 'done', '任务已经完成');
  task.status = 'done'; task.completedAt = new Date(now).toISOString();
  task.history.push({ at: task.completedAt, actor: u.id, text: '标记任务完成，无需审核' }); return task;
}
export const canEditLog = (u, l, now = new Date()) => Boolean(l && l.author === u?.id && l.date >= dayOffset(-2, now) && l.date <= dateKey(now));
export function saveLog(db, u, v, logId = null, now = new Date()) {
  requireValue(userById(u?.id), '请选择有效身份');
  const logDate = v.date || dateKey(now);
  requireValue(isValidDate(logDate) && logDate >= dayOffset(-2, now) && logDate <= dateKey(now), '只能补写或编辑最近三天的日志');
  const existing = logId ? db.logs.find(l => l.id === logId) : db.logs.find(l => l.author === u.id && l.date === logDate);
  if (logId) {
    requireValue(canEditLog(u, existing, now), '只能编辑本人最近三天的日志');
    requireValue(existing.date === logDate, '不能修改日志日期');
  }
  const content = cleaned(v.content, '工作内容', 3000);
  const title = String(v.title || `${logDate} 工作日志`).trim();
  requireValue(title.length <= 80, '日志标题不能超过 80 个字');
  const taskId = v.taskId || '';
  if (taskId) requireValue(canSeeTask(u, db.tasks.find(t => t.id === taskId)), '不能关联无权查看的任务');
  const at = new Date(now).toISOString();
  if (existing) {
    existing.versions.push({ title: existing.title, content: existing.content, taskId: existing.taskId, at: existing.updatedAt, actor: existing.author });
    Object.assign(existing, { title, content, taskId, updatedAt: at }); return existing;
  }
  const log = { id: id('log'), author: u.id, date: logDate, title, content, taskId, createdAt: at, updatedAt: at, versions: [] };
  db.logs.unshift(log); return log;
}
export function createDemoAccount(db, u, values) {
  requireValue(u?.role === '管理员', '只有管理员可以创建演示账号');
  const name = cleaned(values.name, '姓名', 30), login = cleaned(values.login, '账号', 30), department = cleaned(values.department, '部门', 40);
  requireValue(/^[a-zA-Z0-9_-]{3,30}$/.test(login), '账号需为 3 到 30 位字母、数字、下划线或短横线');
  requireValue(!USERS.some(v => v.id === login), '账号已存在');
  requireValue(['员工', '团队长', '部门负责人'].includes(values.role), '请选择有效角色');
  const member = { id: login, name, department, role: values.role, avatar: name.slice(-1), color: 'blue' };
  db.members.push(member); USERS.push(member); return member;
}
export function togglePin(db, u, taskId) {
  requireValue(canSeeTask(u, db.tasks.find(t => t.id === taskId)), '不能关注无权查看的任务');
  const pins = db.pins[u.id] || [];
  requireValue(pins.includes(taskId) || pins.length < 10, '个人重点最多保留 10 项');
  db.pins[u.id] = pins.includes(taskId) ? pins.filter(v => v !== taskId) : [...pins, taskId];
}
export function calendarDays(anchor, mode = 'month') {
  requireValue(isValidDate(anchor), '无效的视图日期');
  const date = new Date(`${anchor}T12:00:00`);
  if (mode === 'day') return [anchor];
  if (mode === 'week') {
    const monday = dayOffset(-((date.getDay() + 6) % 7), anchor);
    return Array.from({ length: 7 }, (_, i) => dayOffset(i, monday));
  }
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12), offset = (first.getDay() + 6) % 7;
  const length = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(), monday = dayOffset(-offset, first);
  return Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, (_, i) => dayOffset(i, monday));
}
export function shiftCalendar(anchor, mode, direction) {
  if (mode !== 'month') return dayOffset(direction * (mode === 'week' ? 7 : 1), anchor);
  const date = new Date(`${anchor}T12:00:00`), target = new Date(date.getFullYear(), date.getMonth() + direction, 1, 12);
  target.setDate(Math.min(date.getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate())); return dateKey(target);
}
export function weeklyCompletion(tasks, today = dateKey()) {
  const days = calendarDays(today, 'week'), due = tasks.filter(t => t.dueAt.slice(0, 10) >= days[0] && t.dueAt.slice(0, 10) <= days[6]);
  const done = due.filter(t => t.status === 'done').length;
  return { total: due.length, done, rate: due.length ? Math.round(done / due.length * 100) : 0 };
}
export function seedDatabase(now = new Date()) {
  const today = dateKey(now), at = new Date(now).toISOString();
  const rows = [
    ['t1', '完成客户方案初稿', ['lin', 'zhou'], 'high', 0, 'doing', '梳理客户需求，完成方案结构、核心页面和报价说明。'],
    ['t2', '整理本周产品需求', ['manager'], 'high', 1, 'doing', '汇总团队反馈，明确需求优先级和验收条件。'],
    ['t3', '检查移动端交互原型', ['zhou'], 'medium', 2, 'todo', '检查任务详情、日志和日历在手机上的操作路径。'],
    ['t4', '整理用户访谈记录', ['lin'], 'medium', -1, 'done', '按使用场景分类，保留原始记录引用。'],
    ['t5', '准备周例会材料', ['manager', 'lin'], 'medium', 2, 'todo', '整理本周成果、风险和下一步安排。'],
    ['t6', '完成任务模块测试清单', ['zhou'], 'high', -1, 'doing', '覆盖多人负责、变更审核和直接完成流程。'],
    ['t7', '整理活动投放计划', ['chen'], 'high', 3, 'todo', '汇总活动渠道和预算。']
  ];
  return { version: 2, members: [], requests: [],
    tasks: rows.map(([taskId, title, owners, priority, offset, status, detail]) => ({ id: taskId, title, owners, priority,
      dueAt: `${dayOffset(offset, today)}T18:30`, status, detail, creator: owners.includes('chen') ? 'founder' : 'manager',
      createdAt: at, revision: 1, deleted: false, history: [{ at, actor: 'founder', text: '演示任务已审核通过' },
      ...(status === 'doing' ? [{ at, actor: owners[0], text: '工作进展：主要框架已整理，正在补充细节。' }] : []),
      ...(status === 'done' ? [{ at, actor: owners[0], text: '标记任务完成，无需审核' }] : [])] })),
    logs: Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, author: i === 1 ? 'zhou' : 'lin', date: dayOffset(-i, today),
      title: `${dayOffset(-i, today)} 工作日志`, content: i === 0 ? '完成客户需求梳理，整理了方案主要框架。\n报价细节待进一步确认，明天继续补充。' : '整理需求和工作资料，记录问题并同步团队。',
      taskId: '', createdAt: at, updatedAt: at, versions: [] })),
    announcements: [
      { id: 'a1', title: '本周工作安排', content: '请各部门准备周例会材料，及时在任务详情记录进展。', category: '工作安排', date: today },
      { id: 'a2', title: '移动端初版体验', content: '重点检查多人负责、任务审核和每日工作日志的操作体验。', category: '产品动态', date: today }
    ], pins: { lin: ['t1', 't5'], manager: ['t2', 't5'], zhou: ['t1', 't3'] } };
}
export function validateDatabase(v) {
  if (v?.version !== 2 || !Array.isArray(v.members) || !Array.isArray(v.requests) || !Array.isArray(v.tasks) || !Array.isArray(v.logs) || !Array.isArray(v.announcements) || !v.pins) return false;
  const ids = new Set([...USERS, ...v.members].map(u => u.id));
  return v.tasks.every(t => typeof t.id === 'string' && typeof t.title === 'string' && typeof t.detail === 'string' && Array.isArray(t.owners) && t.owners.length > 0 && t.owners.every(id => ids.has(id)) && isValidMinute(t.dueAt) && Object.hasOwn(STATUS, t.status) && Object.hasOwn(PRIORITY, t.priority) && Array.isArray(t.history) && Number.isInteger(t.revision)) &&
    v.logs.every(l => typeof l.content === 'string' && typeof l.title === 'string' && ids.has(l.author) && isValidDate(l.date) && Array.isArray(l.versions));
}

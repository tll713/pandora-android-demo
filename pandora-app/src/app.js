import {
  USERS, STATUS, PRIORITY, dateKey, dayOffset, minuteKey, userById, isManager, isSupervisor, isGlobal, isDeptManager, isTeamLead,
  visibleTasks, visibleLogs, recentLogs, canSeeTask, canManageTask, canWorkOnTask, canEditLog, canViewLog,
  requestTaskChange, reviewTaskChange, visibleRequests, canReviewRequest,
  updateTaskDetail, completeTask, saveLog, togglePin, allowedAssignees,
  calendarDays, shiftCalendar, isOverdue, taskStartAt, taskOccursOn, calendarWeekLayout, logSections, composeLogSections
} from './domain.js';

const root = document.querySelector('#app'), modal = document.querySelector('#modal'), toast = document.querySelector('#toast');
const API = window.__PANDORA_API_BASE__ || (location.port === '5173' ? `${location.protocol}//${location.hostname}:8080/api` : '/api');

const state = { token: localStorage.getItem('pandora.token'), user: null, route: 'dashboard', filter: 'all',
  calendarMode: 'month', calendarDate: dateKey(), todoDate: dateKey(), logRange: '7', logQuery: '', logComments: {},
  logDepartment: '', logRole: '', logAuthor: '', logFrom: '', logTo: '', logSubmission: 'all', logCheckDate: dateKey(), messageFilter: 'all',
  taskQuery: '', taskPriority: '', taskScope: '', logHistoryLoaded: false, logLoading: false, logError: '', taskView: 'calendar', logArchive: false, db: null,
  calendarMetadata: { years: readCalendarCache(), loading: {}, errors: {} } };
const APP_VERSION = '0.5.8';
let observedToday = dateKey(), midnightTimer, deferredRender = false, deferredTodoDate = '';

function validCalendarMetadata(data, year) {
  return data?.year === Number(year) && typeof data.published === 'boolean'
    && data.holidays && !Array.isArray(data.holidays) && data.solarTerms && !Array.isArray(data.solarTerms)
    && Object.entries(data.holidays).every(([day,h]) => day.startsWith(`${year}-`) && h
      && typeof h.label === 'string' && ['holiday','workday'].includes(h.type))
    && Object.values(data.solarTerms).every(term => typeof term === 'string');
}
function readCalendarCache() {
  try {
    const entries = JSON.parse(localStorage.getItem('pandora.calendar') || '{}');
    return Object.fromEntries(Object.entries(entries).filter(([year,entry]) => validCalendarMetadata(entry?.data,year) && Number.isFinite(entry.updatedAt)));
  } catch { return {}; }
}
function refreshView() {
  if (modal.open || (root.contains(document.activeElement) && document.activeElement.closest('form'))) {
    deferredRender = true; return;
  }
  render(true);
}

// Use local midnight (including timezone/DST changes); resume/focus checks cover suspended WebViews.
function checkSystemDate() {
  const today = dateKey();
  if (today !== observedToday) {
    if (state.calendarDate === observedToday) state.calendarDate = today;
    if (state.todoDate === observedToday) {
      if (modal.open) deferredTodoDate ||= observedToday;
      else state.todoDate = today;
    }
    if (state.logCheckDate === observedToday) state.logCheckDate = today;
    observedToday = today;
    if (state.user) refreshView();
  }
  clearTimeout(midnightTimer);
  const next = new Date(); next.setHours(24,0,0,0);
  midnightTimer = setTimeout(checkSystemDate, Math.max(1,next.getTime() - Date.now()));
}

// ============ API 客户端 ============
async function api(path, options = {}) {
  let res;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    res = await fetch(API + path, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) }
    });
  } catch {
    throw new Error('暂时无法连接服务，请检查网络连接后重试');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) { logout(); throw new Error('登录已过期，请重新登录'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

async function loadWorkspace() {
  const token = state.token;
  const cachedLogs = state.logHistoryLoaded ? state.db?.logs || [] : [];
  const data = await api('/workspace');
  if (state.token !== token) return;
  state.user = data.user;
  state.db = data.db;
  if (state.logHistoryLoaded) {
    const logs = new Map(cachedLogs.map(log => [log.id, log]));
    for (const log of state.db.logs || []) logs.set(log.id, log);
    state.db.logs = [...logs.values()];
  }
  USERS.length = 0;
  USERS.push(...(state.db.members || []));
}

// Statutory holidays and make-up workdays are announced year by year in China,
// so they are served by the backend instead of being compiled into the app.
async function loadCalendarMetadata(year, force = false) {
  const cache = state.calendarMetadata, token = state.token;
  const updatedAt = Math.max(cache.years[year]?.updatedAt || 0, cache.errors[year]?.at || 0);
  const age = Date.now() - updatedAt;
  if (cache.loading[year] || (!force && age >= 0 && age < 30000)) return;
  cache.loading[year] = true;
  delete cache.errors[year];
  try {
    const data = await api(`/calendar/metadata?year=${encodeURIComponent(year)}`);
    if (!validCalendarMetadata(data,year))
      throw new Error('日历安排数据格式无效');
    if (state.token !== token) return;
    cache.years[year] = { data, updatedAt: Date.now() };
    try { localStorage.setItem('pandora.calendar', JSON.stringify(cache.years)); } catch { /* Storage may be full or disabled. */ }
  } catch {
    if (state.token === token) cache.errors[year] = { at: Date.now() };
  } finally {
    delete cache.loading[year];
    if (state.token === token && state.route === 'calendar' && state.taskView === 'calendar') refreshView();
  }
}

async function loadLogHistory() {
  if (state.logHistoryLoaded || state.logLoading) return;
  const token = state.token;
  state.logLoading = true; state.logError = ''; render();
  try {
    const history = await api(`/logs/history?before=${dayOffset(-6)}`);
    if (state.token !== token || !state.db) return;
    const logs = new Map((state.db.logs || []).map(log => [log.id, log]));
    for (const log of history) logs.set(log.id, log);
    state.db.logs = [...logs.values()];
    state.logHistoryLoaded = true;
  } catch (e) {
    if (state.token === token) { state.logError = '历史日志加载失败，请重试'; notify(e.message, true); }
  } finally {
    if (state.token === token) { state.logLoading = false; render(); }
  }
}

async function save(action, message) {
  const returnToMessages = modal.open && modal.dataset.messages === 'request';
  try { await action(); await loadWorkspace(); close(); render(); if (returnToMessages) openMessages(); notify(message); }
  catch (e) { notify(e.message, true); }
}

function logout() {
  localStorage.removeItem('pandora.token');
  state.token = null; state.user = null; state.db = null; state.route = 'dashboard';
  state.logHistoryLoaded = false; state.logLoading = false; state.logError = ''; state.logRange = '7'; state.logQuery = '';
  state.taskQuery = ''; state.taskPriority = ''; state.taskScope = ''; state.filter = 'all';
  resetLogFilters(); state.messageFilter = 'all'; state.logComments = {};
  state.calendarMetadata = { years: {}, loading: {}, errors: {} };
  close(); render();
}

const user = () => state.user || USERS.find(u => u.id === 'lin') || USERS[0];
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const names = owners => owners.map(id => userById(id)?.name || id).join('、');
const stamp = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const shortDate = value => `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日`;
const dueText = value => `${value.slice(5, 10).replace('-', '月')}日 ${value.slice(11)}`;
const statusPill = s => `<span class="status status--${s}"><i></i>${STATUS[s]}</span>`;
const priorityPill = p => `<span class="priority priority--${p}">${PRIORITY[p]}</span>`;
const taskTag = task => (state.db?.tags || []).find(tag => tag.id === task.tagId);
// 每个标签用自己的颜色；没有选标签的任务按「长期任务」处理，用更淡的颜色。
const LONG_TERM_COLOR = '#edf1f7';
const LONG_TERM_FG = '#526078';
function taskPalette(task) {
  const tag = taskTag(task);
  if (!tag) return { bg: LONG_TERM_COLOR, fg: LONG_TERM_FG };
  const accent = /^#[0-9a-f]{6}$/i.test(tag.color || '') ? tag.color : '#64748b';
  const rgb = [1, 3, 5].map(offset => parseInt(accent.slice(offset, offset + 2), 16));
  const hex = values => '#' + values.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  return { bg: hex(rgb.map(v => v * 0.12 + 255 * 0.88)), fg: hex(rgb.map(v => v * 0.44)), accent };
}
const tagBadge = task => `<span class="task-tag" style="${taskColorStyle(task)}">${esc(taskTag(task)?.name || '长期任务')}</span>`;
function tagChoices(name, selected = '') {
  const tags = state.db.tags || [];
  const tools = isGlobal(user()) ? `<div class="tag-tools">${button('＋ 新建', 'tag-new', '', 'soft-button')}<details><summary>编辑已有标签</summary><div class="tag-management">${tags.map(tag => `<div><span class="task-tag" style="${taskColorStyle({tagId:tag.id})}">${esc(tag.name)}</span>${button('编辑','tag-edit',tag.id,'text-button')}</div>`).join('')}</div></details></div><div class="tag-editor" hidden></div>` : '';
  return `<fieldset class="tag-choices"><legend>标签</legend><label class="tag-choice"><input type="radio" name="${name}" value="" ${!selected ? 'checked' : ''}>不选标签</label>${tags.map(tag => `<label class="tag-choice" style="${taskColorStyle({tagId: tag.id})}"><input type="radio" name="${name}" value="${esc(tag.id)}" ${selected === tag.id ? 'checked' : ''}><i style="background:${taskPalette({tagId: tag.id}).accent}"></i>${esc(tag.name)}</label>`).join('')}${tools}</fieldset>`;
}
const taskColorStyle = task => {
  const { bg, fg } = taskPalette(task);
  return `background:${bg};color:${fg};border-color:${bg}`;
};
const button = (label, action, id = '', cls = 'ghost-button') => `<button type="button" class="${cls}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
function notify(text, error = false) {
  toast.textContent = text; toast.dataset.type = error ? 'error' : 'success'; toast.classList.add('toast--show');
  clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('toast--show'), 3000);
}
function open(title, body) {
  modal.dataset.log = '';
  modal.dataset.todo = '';
  modal.dataset.messages = '';
  modal.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" aria-label="关闭" data-close>×</button></div>${body}`;
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
}
function close() {
  const fromMessages = Boolean(modal.dataset.messages);
  modal.close(); modal.innerHTML = ''; modal.dataset.messages = '';
  if (deferredTodoDate && state.todoDate === deferredTodoDate) state.todoDate = dateKey();
  deferredTodoDate = '';
  checkSystemDate();
  if (deferredRender) render(true);
  if (fromMessages) root.querySelector('[data-action="messages-open"]')?.focus();
}
function avatar(u, className = 'avatar') { return u.avatarData ? `<span class="${className}"><img src="${esc(u.avatarData)}" alt=""></span>` : `<span class="${className}">${esc(u.avatar || u.name?.slice(-1) || '?')}</span>`; }
function person(u) { return `<span class="person">${avatar(u, `avatar avatar--${u.color || 'blue'}`)}<span><b>${esc(u.name)}</b><small>${esc(u.roleName || u.role)}</small></span></span>`; }
function head(title, detail, action = '', className = '') { return `<section class="page-head ${esc(className)}"><div><span class="eyebrow">${dateKey()}</span><h1>${title}</h1><p class="lede">${detail}</p></div>${action}</section>`; }
function panel(title, content, action = '') { return `<section class="panel"><div class="panel-head"><h2>${title}</h2>${action}</div>${content}</section>`; }
const empty = text => `<div class="empty-state"><span class="empty-icon">✓</span><p>${text}</p></div>`;

// ============ 页面组件 ============
function taskCard(t) {
  return `<article class="task-card"><button class="task-open" data-action="task" data-id="${esc(t.id)}"><div class="task-card-top">${statusPill(t.status)}${priorityPill(t.priority)}</div><h3>${esc(t.title)}</h3><p>${esc(t.detail)}</p><div class="task-meta"><span>负责人 · ${esc(names(t.owners))}</span><span class="due ${isOverdue(t) ? 'due--late' : ''}">${isOverdue(t) ? '已逾期 · ' : '截止 · '}${dueText(t.dueAt)}</span></div></button></article>`;
}
function reportContent(content) {
  const sections = logSections(content);
  if (sections.content === content) return `<p class="log-content">${esc(content)}</p>`;
  return `<div class="report-sections">${[['今日完成',sections.content],['下一步计划',sections.plan],['问题与协助',sections.issues]].map(([title,text]) => `<section><h4>${title}</h4><p class="log-content">${esc(text || '未填写')}</p></section>`).join('')}</div>`;
}
function logCard(l) { const author = userById(l.author); return `<article class="log-card"><div class="log-card-top"><b>${esc(author?.name)}</b><span>${l.date}${l.date === dateKey() ? ' · 今天' : ''}</span></div><small class="log-author-info">${esc(author?.department || '')} · ${esc(author?.roleName || author?.role || '')}</small><h3>${button(esc(l.title), 'log', l.id, 'log-title-button')}</h3>${l.tagId ? tagBadge(l) : ''}${reportContent(l.content)}${l.versions?.length ? `<small>保留 ${l.versions.length} 次修改记录</small>` : ''}</article>`; }

function loginPage() {
  return `<div class="login-page"><div class="login-card"><div class="brand login-brand"><span class="brand-mark">P</span><strong>潘多拉</strong></div><h1>欢迎回来</h1><p class="login-sub">登录你的工作账号</p><form data-form="login"><label>手机号或姓名<input name="identifier" required autocomplete="username" placeholder="请输入手机号或姓名"></label><label>密码<input type="password" name="password" required autocomplete="current-password" placeholder="请输入密码"></label><button class="primary-button login-button" type="submit">登录</button></form><p class="help-note">账号由公司管理员创建，无法登录时请联系管理员。</p></div></div>`;
}

function profileCompletePage() {
  const u = user();
  return `<div class="login-page"><div class="login-card profile-card"><div class="brand login-brand"><span class="brand-mark">P</span><strong>潘多拉</strong></div><div class="profile-warning"><span class="warning-icon">⚠</span><div><h2>请完善个人信息</h2><p>请补充个人资料；部门和手机号由管理员维护</p></div></div><form class="modal-form" data-form="profile"><label>姓名<input name="name" value="${esc(u.name || '')}" maxlength="30" required></label><label>手机号<input name="phone" value="${esc(u.phone || '')}" readonly></label><label>性别<select name="gender" required><option value="">请选择</option><option value="男" ${u.gender === '男' ? 'selected' : ''}>男</option><option value="女" ${u.gender === '女' ? 'selected' : ''}>女</option><option value="其他" ${u.gender === '其他' ? 'selected' : ''}>其他</option></select></label><label>身份证号<input name="idNumber" value="${esc(u.idNumber || '')}" maxlength="18" required placeholder="请输入 18 位身份证号"></label><label>部门<input value="${esc(u.department || '待管理员分配')}" readonly></label><button class="primary-button login-button" type="submit">提交并进入</button></form><button class="text-button" data-action="logout">退出登录</button></div></div>`;
}

function dashboard() {
  const tasks = visibleTasks(state.db, user());
  const myTasks = tasks.filter(t => t.owners.includes(user().id) && t.status !== 'done');
  const highlights = state.db.highlights || [];
  const company = highlights.filter(h => h.kind === 'company' && h.enabled !== false).sort((a, b) => a.position - b.position).slice(0, 10);
  const today = dateKey();
  const todos = (state.db.todos || []).filter(t => t.date === today);
  const highlightRows = list => list.map(h => `<button class="tile-row" data-action="highlight" data-id="${esc(h.id)}"><span class="tile-rank">${String(h.position).padStart(2,'0')}</span><span class="tile-row-main"><b>${esc(h.title)}</b><small>${esc(h.content)}</small></span></button>`).join('');
  const chevron = '<svg class="tile-arrow" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const tile = (title, action, content, count) => `<section class="dashboard-tile"><header><div><span>${count}</span><h2>${title}</h2></div><button class="tile-open" data-action="${action}" aria-label="打开${title}">${chevron}</button></header><div class="tile-content${action === 'todo-calendar' ? '' : ' tile-scroll'}"${action === 'todo-calendar' ? '' : ` role="region" aria-label="${title}列表，可上下滑动" tabindex="0"`}>${content}</div></section>`;
  const taskRows = (list, emptyText) => list.length ? list.map(t => `<button class="tile-row" data-action="task" data-id="${esc(t.id)}"><span class="tile-marker tile-marker--${t.priority}"></span><span class="tile-row-main"><b>${esc(t.title)}</b><small>${STATUS[t.status]} · ${dueText(t.dueAt)}</small></span></button>`).join('') : `<p class="tile-empty">${emptyText}</p>`;
  const doneToday = todos.filter(t => t.done).length;
  const unread = unreadMessages();
  const messageButton = `<button class="dashboard-messages" data-action="messages-open" aria-label="消息${unread ? `，${unread} 条未读` : ''}" aria-haspopup="dialog"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span>消息</span>${unread ? `<em class="message-badge" aria-hidden="true">${unread > 99 ? '99+' : unread}</em>` : ''}</button>`;
  return `<section class="dashboard-page"><header class="dashboard-head"><div><span class="eyebrow">${dateKey()}</span><h1>你好，${esc(user().name)}</h1></div>${messageButton}</header><div class="dashboard-grid">` +
    tile('事件纪', 'company-highlights', (highlightRows(company) || '<p class="tile-empty">暂无重要事项</p>') + button('公司公告', 'announcements-open', '', 'text-button'), String(company.length).padStart(2, '0')) +
    tile('任务看板', 'all-tasks', taskRows(myTasks, '暂无派发给你的任务'), String(myTasks.length).padStart(2, '0')) +
    tile('每日事项', 'todo-calendar', todoCalendarHtml(true), `${String(doneToday).padStart(2, '0')}/${String(todos.length).padStart(2, '0')}`) +
    `</div></section>`;
}

// ============ 每日事项 ============
const todoDayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function todoCalendarHtml(compact = false) {
  const [year, month] = state.todoDate.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const start = new Date(year, month - 1, 1 - first.getDay());
  const todos = state.db.todos || [];
  const daysInMonth = new Date(year,month,0).getDate();
  const cells = Array.from({ length: Math.ceil((first.getDay()+daysInMonth)/7)*7 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = todoDayKey(d);
    const items = todos.filter(t => t.date === key);
    return `<article class="todo-month-cell ${d.getMonth() === month - 1 ? '' : 'is-out'} ${key === state.todoDate ? 'is-selected' : ''} ${key === dateKey() ? 'is-today' : ''}" data-todo-drop="${key}"><button class="todo-date" data-action="todo-select" data-id="${key}" aria-label="查看 ${key} 事项">${d.getDate()}</button>${items.slice(0, 3).map(t => `<button class="todo-drag-item ${t.done ? 'is-done' : ''}" draggable="true" data-todo-drag="${esc(t.id)}" data-action="todo-select" data-id="${key}" title="${esc(t.title)}；长按拖动可改期">${esc(t.title)}</button>`).join('')}${items.length > 3 ? button(`+${items.length - 3}`, 'todo-select', key, 'calendar-more') : ''}</article>`;
  }).join('');
  return `<div class="todo-calendar">
    <header class="todo-cal-head"><button class="icon-button" data-action="todo-month-prev" aria-label="上个月">‹</button><b>${year} 年 ${month} 月</b><button class="icon-button" data-action="todo-month-next" aria-label="下个月">›</button></header>
    <div class="todo-week">${['日', '一', '二', '三', '四', '五', '六'].map(w => `<span>${w}</span>`).join('')}</div>
    <div class="todo-grid">${cells}</div>
    ${todoDayHtml()}<p class="todo-drag-tip">${compact ? '长按事项拖到其他日期，或点开事项改期' : '拖动事项到其他日期，也可使用“改期”'}</p>
  </div>`;
}

function todoDayHtml() {
  const dayTodos = (state.db.todos || []).filter(t => t.date === state.todoDate).sort((a, b) => Number(a.done) - Number(b.done));
  const done = dayTodos.filter(t => t.done).length;
  return `<section class="todo-day">
      <div class="todo-day-head"><b>${shortDate(state.todoDate)} 事项</b><span>${dayTodos.length ? `${done}/${dayTodos.length} 已完成` : '暂无事项'}</span></div>
      <div class="todo-list">${dayTodos.map(t => `<div class="todo-item ${t.done ? 'is-done' : ''}" draggable="true" data-todo-drag="${esc(t.id)}"><button class="todo-check" data-action="todo-toggle" data-id="${esc(t.id)}" aria-label="切换完成">${t.done ? '✓' : ''}</button><b>${esc(t.title)}</b>${button('改期', 'todo-reschedule', t.id, 'text-button')}<button class="todo-remove" data-action="todo-delete" data-id="${esc(t.id)}" aria-label="删除事项">×</button></div>`).join('') || '<p class="panel-note">这一天还没有事项</p>'}</div>
      <form class="todo-form" data-form="todo"><input name="title" maxlength="120" required placeholder="添加事项，例如：提交周报"><button class="soft-button" type="submit">添加</button></form>
    </section>`;
}

function openTodoCalendar(date = state.todoDate) {
  state.todoDate = date;
  open('每日事项', todoCalendarHtml());
  modal.dataset.todo = '1';
}

function openTodoDay(date = state.todoDate) {
  state.todoDate = date;
  open(`${shortDate(date)} · 每日事项`, `<div class="todo-day-details">${todoDayHtml()}${button('查看月历', 'todo-calendar', '', 'ghost-button')}</div>`);
  modal.dataset.todo = 'day';
}

function refreshTodoDialog() {
  if (modal.open && modal.dataset.todo) {
    if (modal.dataset.todo === 'day') openTodoDay(); else openTodoCalendar();
  }
}

function shiftTodoMonth(delta) {
  const [year, month] = state.todoDate.split('-').map(Number);
  state.todoDate = todoDayKey(new Date(year, month - 1 + delta, 1));
  if (modal.open) openTodoCalendar(); else render();
}

async function todoAction(path, message, method = 'POST') {
  try {
    await api(path, { method });
    await loadWorkspace();
    render();
    refreshTodoDialog();
    notify(message);
  } catch (e) { notify(e.message, true); }
}

function taskListView() {
  const tasks = visibleTasks(state.db, user()), pinned = state.db.pins?.[user().id] || [];
  const query = state.taskQuery.trim().toLocaleLowerCase();
  const filtered = tasks.filter(t => state.filter === 'focus' ? pinned.includes(t.id) : state.filter === 'all' || t.status === state.filter)
    .filter(t => (!state.taskPriority || t.priority === state.taskPriority) && (!state.taskScope || t.owners.includes(user().id)))
    .filter(t => !query || `${t.title} ${t.detail} ${names(t.owners)}`.toLocaleLowerCase().includes(query));
  const active = Boolean(state.taskQuery || state.taskPriority || state.taskScope || state.filter !== 'all');
  const statusFilters = `<div class="segmented task-status-filters" role="group" aria-label="任务状态">${[['all', '全部'], ['focus', '个人重点'], ...Object.entries(STATUS)].map(([id, label]) => `<button class="segment ${state.filter === id ? 'is-active' : ''}" aria-pressed="${state.filter === id}" data-filter="${id}">${label}</button>`).join('')}</div>`;
  const searchForm = `<form class="task-search" data-form="task-filter" role="search"><label class="search-field"><span aria-hidden="true">⌕</span><input type="search" name="query" data-task-query value="${esc(state.taskQuery)}" placeholder="任务、说明或负责人" aria-label="搜索任务" autocomplete="off"></label><select name="priority" data-task-select aria-label="筛选优先级"><option value="">全部优先级</option>${Object.entries(PRIORITY).map(([value, label]) => `<option value="${value}" ${state.taskPriority === value ? 'selected' : ''}>${label}</option>`).join('')}</select><select name="scope" data-task-select aria-label="筛选负责人范围"><option value="">全部可见任务</option><option value="mine" ${state.taskScope ? 'selected' : ''}>我负责的</option></select>${active ? button('重置', 'clear-task-search', '', 'text-button task-reset') : ''}</form>`;
  const table = `<p class="task-table-hint">左右滑动查看负责人和截止时间</p><section class="task-table-panel" aria-label="任务表格"><table class="task-table"><thead><tr><th scope="col">任务名称</th><th scope="col">状态 / 优先级</th><th scope="col">负责人</th><th scope="col">起止时间</th></tr></thead><tbody>${filtered.map(t => `<tr class="${t.status === 'done' ? 'is-done' : ''}"><td><button class="task-title-button" data-action="task" data-id="${esc(t.id)}"><span class="task-tag-dot" style="background:${taskPalette(t).bg}" title="${esc(taskTag(t)?.name || '长期任务')}"></span>${esc(t.title)}</button>${tagBadge(t)}<small>${esc(t.detail)}</small></td><td><div class="task-table-pills">${statusPill(t.status)}${priorityPill(t.priority)}</div></td><td>${esc(names(t.owners))}</td><td class="due ${isOverdue(t) ? 'due--late' : ''}">${dueText(taskStartAt(t))}<br>${dueText(t.dueAt)}</td></tr>`).join('')}</tbody></table></section>`;
  return `<div class="task-filter-bar"><div class="task-filter-head">${statusFilters}<span class="filter-count" role="status" title="共 ${filtered.length} 项任务">${filtered.length}</span></div>${searchForm}</div>` + (filtered.length ? table + '<p class="task-live-empty" hidden>没有匹配的任务，换个关键词试试</p>' : empty('当前筛选没有任务'));
}

function resetLogFilters() {
  for (const key of ['logQuery','logDepartment','logRole','logAuthor','logFrom','logTo']) state[key] = '';
  state.logSubmission = 'all'; state.logCheckDate = dateKey();
}
function readLogFilters(form) {
  const values = Object.fromEntries(new FormData(form));
  for (const [name,key] of Object.entries({query:'logQuery',department:'logDepartment',role:'logRole',author:'logAuthor',from:'logFrom',to:'logTo',submission:'logSubmission',checkDate:'logCheckDate'})) state[key] = values[name] || (name === 'submission' ? 'all' : name === 'checkDate' ? dateKey() : '');
  if (state.logAuthor && !USERS.some(u => u.id === state.logAuthor && canViewLog(user(),u.id) && (!state.logDepartment || u.department === state.logDepartment) && (!state.logRole || u.role === state.logRole))) state.logAuthor = '';
  if (state.logFrom || state.logTo) state.logRange = 'all';
  if (state.logFrom && state.logTo && state.logFrom > state.logTo) { [state.logFrom,state.logTo] = [state.logTo,state.logFrom]; }
}
function logsPage() {
  const supervisor = isSupervisor(user()), allLogs = visibleLogs(state.db,user());
  const members = USERS.filter(u => canViewLog(user(),u.id));
  const authors = members.filter(u => (!state.logDepartment || u.department === state.logDepartment) && (!state.logRole || u.role === state.logRole) && (!state.logAuthor || u.id === state.logAuthor));
  const reportingMembers = authors.filter(u => u.enabled !== false);
  const ids = new Set(authors.map(u => u.id));
  const from = state.logSubmission === 'submitted' ? state.logCheckDate : state.logFrom || (state.logRange === '7' ? dayOffset(-6) : state.logRange === '30' ? dayOffset(-29) : '');
  const to = state.logSubmission === 'submitted' ? state.logCheckDate : state.logTo || dateKey(), query = state.logQuery.trim().toLowerCase();
  const submitted = new Set(allLogs.filter(l => l.date === state.logCheckDate).map(l => l.author));
  const missing = reportingMembers.filter(u => !submitted.has(u.id));
  const logs = allLogs.filter(l => ids.has(l.author) && (!from || l.date >= from) && l.date <= to)
    .filter(l => state.logSubmission === 'all' || (state.logSubmission === 'submitted' && l.date === state.logCheckDate))
    .filter(l => !query || `${l.title} ${l.content} ${userById(l.author)?.name || ''}`.toLowerCase().includes(query))
    .sort((a,b) => b.date.localeCompare(a.date) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const select = (name,label,items,value) => `<label>${label}<select name="${name}" data-log-select><option value="">全部${label}</option>${items.map(([id,text]) => `<option value="${esc(id)}" ${value === id ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  const departments = [...new Set(members.map(u => u.department).filter(Boolean))];
  const roles = [...new Map(members.map(u => [u.role,u.roleName || u.role])).entries()];
  const needsHistory = state.logRange !== '7' || state.logCheckDate < dayOffset(-6);
  const loading = needsHistory && state.logLoading;
  const error = needsHistory && state.logError;
  const incompleteCheck = state.logCheckDate < dayOffset(-6) && !state.logHistoryLoaded;
  const active = query || state.logDepartment || state.logRole || state.logAuthor || state.logFrom || state.logTo || state.logSubmission !== 'all';
  const title = isGlobal(user()) ? '公司工作日志' : isDeptManager(user()) ? '本部门工作日志' : isTeamLead(user()) ? '团队成员日志' : '我的日志';
  const overview = supervisor ? `<section class="log-submission"><header><div><h2>提交概览</h2><p>${state.logCheckDate} · ${reportingMembers.length} 位成员</p></div><strong>${incompleteCheck ? '待加载' : `${reportingMembers.length - missing.length} / ${reportingMembers.length}`}</strong></header>${incompleteCheck ? '<p>请加载该日期的历史日志后查看提交情况。</p>' : `<div class="submission-members">${reportingMembers.map(u => `<button class="submission-person ${submitted.has(u.id) ? 'is-submitted' : ''}" data-log-member="${esc(u.id)}" title="筛选该成员日志">${esc(u.name)}<small>${submitted.has(u.id) ? '已提交' : '未提交'}</small></button>`).join('') || '<p>当前组织范围内没有成员</p>'}</div>`}</section>` : '';
  return head(title, supervisor ? '按部门、职位、成员和日期筛选，查看每天的工作日志与提交情况。' : '记录今日完成、下一步计划，以及需要协助的问题。', button('写日志','new-log','','primary-button')) +
    `<section class="log-filter" aria-busy="${loading}"><div class="segmented log-range" role="group" aria-label="日志时间范围">${[['7','近7天'],['30','近30天'],['all','全部']].map(([id,label]) => `<button class="segment ${state.logRange === id ? 'is-active' : ''}" aria-pressed="${state.logRange === id}" data-log-range="${id}">${label}</button>`).join('')}</div><form class="log-search log-discovery" data-form="log-filter"><label class="search-field"><span aria-hidden="true">⌕</span><input type="search" name="query" value="${esc(state.logQuery)}" placeholder="搜索姓名或工作内容（选填）" aria-label="搜索日志"></label><div class="log-filter-fields">${supervisor ? select('department','部门',departments.map(d => [d,d]),state.logDepartment) + select('role','职位',roles,state.logRole) + select('author','成员',members.filter(u => (!state.logDepartment || u.department === state.logDepartment) && (!state.logRole || u.role === state.logRole)).map(u => [u.id,u.name]),state.logAuthor) : ''}<label>开始日期<input name="from" type="date" data-log-select max="${dateKey()}" value="${state.logFrom}"></label><label>结束日期<input name="to" type="date" data-log-select max="${dateKey()}" value="${state.logTo}"></label>${supervisor ? `<label>统计日期<input name="checkDate" type="date" data-log-select max="${dateKey()}" value="${state.logCheckDate}"></label><label>提交状态<select name="submission" data-log-select>${[['all','全部日志'],['submitted','统计日已提交'],['missing','统计日未提交成员']].map(([id,label]) => `<option value="${id}" ${state.logSubmission === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>` : ''}</div><button class="soft-button" type="submit">搜索</button></form><div class="log-filter-summary"><span role="status">${loading ? '正在加载历史日志…' : error || `共 ${logs.length} 篇日志`}</span>${error ? button('重新加载','retry-log-history','','text-button') : ''}${active ? button('清除筛选','clear-log-filters','','text-button') : ''}</div></section>${overview}<section class="log-results" aria-label="日志列表">${state.logSubmission === 'missing' ? (incompleteCheck ? empty('请先加载统计日期的日志') : missing.map(u => `<article class="log-card"><b>${esc(u.name)}</b><p>${esc(u.department)} · ${esc(u.roleName || u.role)}</p><span>${state.logCheckDate} 未提交</span></article>`).join('') || empty('该范围成员均已提交')) : logs.map(logCard).join('') || empty(loading ? '正在加载日志' : error ? '日志加载失败，请重试' : '这个范围内没有符合条件的日志')}</section>`;
}

const messageKey = r => r.messageType === 'update' ? r.id : `${r.id}:${r.status}:${r.reviewedAt || r.createdAt}`;
function allMessages() {
  return [...visibleRequests(state.db,user()), ...(state.db.notifications || []).map(n => ({...n,messageType:'update'}))];
}
function readMessages() {
  try { const value = JSON.parse(localStorage.getItem(`pandora.messages.${user().id}`) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}
function unreadMessages() {
  const read = new Set(readMessages());
  return allMessages().filter(r => !read.has(messageKey(r))).length;
}
function markMessagesRead(requests) {
  try { localStorage.setItem(`pandora.messages.${user().id}`, JSON.stringify([...new Set([...readMessages(), ...requests.map(messageKey)])].slice(-2000))); } catch { /* Storage may be unavailable in private browsing. */ }
}
function updateMessageCard(n) {
  return `<article class="log-card"><div class="log-card-top"><b>${n.kind === 'tasks' ? '任务看板' : '事件纪'}更新</b><span>${stamp(n.createdAt)}</span></div><h3>${esc(n.title)}</h3><p>${esc(n.summary)}</p>${button('查看消息','notification',n.id,'soft-button')}</article>`;
}
function messagesContent() {
  const read = new Set(readMessages()), all = allMessages();
  const requests = all.filter(r => state.messageFilter === 'review' ? canReviewRequest(user(),r) : state.messageFilter === 'mine' ? r.proposer === user().id : state.messageFilter === 'results' ? r.messageType !== 'update' && r.status !== 'pending' : state.messageFilter === 'unread' ? !read.has(messageKey(r)) : ['events','tasks'].includes(state.messageFilter) ? r.messageType === 'update' && r.kind === state.messageFilter : true)
    .sort((a,b) => Number(canReviewRequest(user(),b)) - Number(canReviewRequest(user(),a)) || String(b.reviewedAt || b.createdAt).localeCompare(String(a.reviewedAt || a.createdAt)));
  return `<div class="messages-toolbar"><p>事件纪、任务看板更新与申请审核通知</p>${button('全部已读','messages-read','','soft-button')}</div>` +
    `<section class="message-summary"><span><b>${all.filter(r => canReviewRequest(user(),r)).length}</b>待我审核</span><span><b>${all.filter(r => r.proposer === user().id && r.status === 'pending').length}</b>我的待审申请</span><span><b>${unreadMessages()}</b>未读消息</span></section><div class="segmented message-filters">${[['all','全部'],['unread','未读'],['events','事件纪'],['tasks','任务看板'],...(isGlobal(user()) ? [['review','待我审核']] : []),['mine','我的申请'],['results','审核结果']].map(([id,label]) => `<button class="segment ${state.messageFilter === id ? 'is-active' : ''}" data-message-filter="${id}">${label}</button>`).join('')}</div><section class="message-list">${requests.map(r => `<div class="message-item ${read.has(messageKey(r)) ? '' : 'is-unread'}">${r.messageType === 'update' ? updateMessageCard(r) : requestCard(r)}</div>`).join('') || empty('暂无此类消息')}</section>`;
}
function openMessages() {
  open('消息', `<div class="messages-dialog">${messagesContent()}</div>`);
  modal.dataset.messages = 'list';
}

function notificationDetail(id) {
  const n = (state.db.notifications || []).find(n => n.id === id);
  if (!n) return;
  markMessagesRead([{...n,messageType:'update'}]); render();
  const task = visibleTasks(state.db,user()).find(t => t.id === n.targetId);
  const highlight = (state.db.highlights || []).find(h => h.id === n.targetId);
  open(n.title, `<div class="request-content">${button('‹ 返回消息','messages-return','','text-button messages-back')}<p>${esc(n.summary)}</p><p class="panel-note">${stamp(n.createdAt)}</p>${task ? button('查看任务','task',task.id,'soft-button') : highlight ? button('查看事项','highlight',highlight.id,'soft-button') : '<p class="panel-note">该内容已移除或当前不在你的查看范围内。</p>'}</div>`);
  modal.dataset.messages = 'detail';
}


const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {year:'numeric', month:'long', day:'numeric'});
function lunarDate(day) {
  const parts = lunarFormatter.formatToParts(new Date(`${day}T12:00:00`));
  const part = type => parts.find(p => p.type === type)?.value || '';
  const n = Number(part('day'));
  const digits = ['一','二','三','四','五','六','七','八','九','十'];
  const label = n <= 10 ? `初${digits[n-1]}` : n < 20 ? `十${digits[n-11]}` : n === 20 ? '二十' : n < 30 ? `廿${digits[n-21]}` : '三十';
  return {short:n === 1 ? part('month') : label, full:`${part('yearName')}年${part('month')}${label}`};
}
// Holiday and solar-term metadata is loaded from the backend per calendar year.

function dayMarkers(day) {
  const markers = [];
  const metadata = state.calendarMetadata.years[day.slice(0,4)]?.data;
  const holiday = metadata?.holidays[day];
  if (holiday) {
    markers.push({ type: holiday.type === 'holiday' ? 'rest' : 'work', label: holiday.type === 'holiday' ? '休' : '班' });
    markers.push({ type: 'event', label: holiday.label });
  }
  const term = metadata?.solarTerms[day];
  if (term && !holiday) {
    markers.push({ type: 'event', label: term });
  }
  const lunar = lunarDate(day);
  if (!markers.some(m => m.type === 'event')) {
    markers.push({ type: 'lunar', label: lunar.short });
  }
  return markers;
}
const calendarIcon = name => {
  const paths = {back:'M15 4l-8 8 8 8',mode:'M4 4h16v6H4z M4 14h16v6H4z',search:'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',plus:'M12 3v18 M3 12h18',calendar:'M4 5h16v16H4z M4 9h16 M8 3v4 M16 3v4 M8 13h1 M12 13h1 M16 13h1 M8 17h1 M12 17h1',list:'M8 5h13 M8 12h13 M8 19h13 M3 5h.1 M3 12h.1 M3 19h.1',prev:'M15 5l-7 7 7 7',next:'M9 5l7 7-7 7'};
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name].split(' M').map((d,i)=>`<path d="${i?'M':''}${d}"/>`).join('')}</svg>`;
};
const monthName = date => ['一','二','三','四','五','六','七','八','九','十','十一','十二'][date.getMonth()] + '月';
const WEEKDAY = ['周日','周一','周二','周三','周四','周五','周六'];
// 「日历 / 任务列表」共用同一个切换控件，两屏保持同一位置与同一外观。
const viewSwitch = active => `<div class="view-switch" role="tablist" aria-label="视图切换">${[['calendar','日历'],['list','任务列表']].map(([id,label]) => `<button class="view-switch-item ${active === id ? 'is-active' : ''}" role="tab" aria-selected="${active === id}" data-task-view="${id}">${label}</button>`).join('')}</div>`;
function calendarDates(mode) {
  const anchor = new Date(`${state.calendarDate}T12:00:00`);
  const first = mode === 'month' ? `${state.calendarDate.slice(0,7)}-01` : state.calendarDate;
  const start = dayOffset(-new Date(`${first}T12:00:00`).getDay(), first);
  const length = mode === 'month' ? Math.ceil((new Date(`${first}T12:00:00`).getDay() + new Date(anchor.getFullYear(),anchor.getMonth()+1,0).getDate()) / 7) * 7 + 7 : 7;
  return Array.from({length}, (_,i) => dayOffset(i,start));
}
function getMonthLabel(day, currentMonth) {
  const dayMonth = day.slice(0,7);
  if (dayMonth !== currentMonth && Number(day.slice(8,10)) === 1) {
    return `${Number(day.slice(5,7))}月`;
  }
  return '';
}
function calendarAgenda(tasks, logs, todos = []) {
  const dayTasks = tasks.filter(t => taskOccursOn(t,state.calendarDate)).sort((a,b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
  const dayLogs = logs.filter(l => l.date === state.calendarDate);
  const dayTodos = todos.filter(t => t.date === state.calendarDate).sort((a, b) => Number(a.done) - Number(b.done));
  const date = new Date(`${state.calendarDate}T12:00:00`);
  const event = t => `<button style="${taskColorStyle(t)}" class="timeline-item event--${t.priority} ${t.status === 'done' ? 'event--done' : ''}" data-action="task" data-id="${esc(t.id)}"><time datetime="${esc(t.dueAt)}">${esc(t.dueAt.slice(11,16))}</time><span class="timeline-copy"><b>${esc(t.title)}</b><small>${esc(names(t.owners))} · ${STATUS[t.status]}</small></span></button>`;
  const spanning = dayTasks.filter(t=>taskStartAt(t).slice(0,10)!==t.dueAt.slice(0,10));
  const hours = Array.from({length:24}, (_,hour) => `<div class="calendar-hour" data-hour="${hour}"><span class="hour-label">${String(hour).padStart(2,'0')}:00</span><div class="hour-events">${dayTasks.filter(t => !spanning.includes(t) && Number(t.dueAt.slice(11,13)) === hour).map(event).join('')}</div></div>`).join('');
  const allDay = dayLogs.length || spanning.length || dayTodos.length ? `<div class="timeline-all-day"><span class="all-day-label">全天</span><div>${spanning.map(t=>`<button class="timeline-item event--${t.priority} event--span" style="${taskColorStyle(t)}" data-action="task" data-id="${esc(t.id)}"><span class="timeline-copy"><b>${esc(t.title)}</b><small>${taskPeriodText(t)}</small></span></button>`).join('')}${dayTodos.map(t=>`<button class="timeline-item event--todo ${t.done?'event--done':''}" data-action="todo-select" data-id="${state.calendarDate}"><span class="timeline-copy"><b>${esc(t.title)}</b><small>每日事项 · ${t.done?'已完成':'待完成'}</small></span></button>`).join('')}${dayLogs.map(l => `<button class="timeline-item event--log" data-action="log" data-id="${esc(l.id)}"><span class="timeline-copy"><b>${esc(l.title)}</b><small>工作日志</small></span></button>`).join('')}</div></div>` : '';
  return `<section class="calendar-day-timeline calendar-hour-timeline" aria-label="${state.calendarDate} 任务与日志时间线"><header class="timeline-header"><h2>${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日 − ${['周日','周一','周二','周三','周四','周五','周六'][date.getDay()]}</h2><p>${lunarDate(state.calendarDate).full}</p></header>${allDay}<div class="timeline-list">${hours}</div></section>`;
}
function calendarMonthRows(tasks, logs, dates, todoDays) {
  const weeks = [];
  const month = state.calendarDate.slice(0,7);
  for (let i = 0; i < dates.length; i += 7) {
    const days = dates.slice(i, i + 7);
    if (!days.some(day => day.slice(0,7) === month)) continue;
    const layout = calendarWeekLayout(tasks, days, month);
    const items = layout.dates.map(({ day, overflow }, column) => {
      if (day.slice(0,7) !== month) return '';
      return `<div class="month-day-events" data-event-day="${day}" style="grid-column:${column + 1}">${overflow ? `<button class="calendar-more" style="grid-column:${column + 1};grid-row:${layout.laneCount + 1}" data-action="calendar-overflow" data-id="${day}" aria-label="查看 ${day} 其余 ${overflow} 项任务">+${overflow}</button>` : ''}</div>`;
    }).join('');
    const spans = layout.segments.map(({ task: t, lane, column, length, start, end }) => {
      const continuation = `${taskStartAt(t).slice(0,10) < start ? ' continues-before' : ''}${t.dueAt.slice(0,10) > end ? ' continues-after' : ''}`;
      return `<button class="month-task-span zoom-event${continuation}" style="${taskColorStyle(t)};grid-column:${column + 1} / span ${length};grid-row:${lane + 1}" data-span-start="${start}" data-span-end="${end}" data-lane="${lane}" data-action="task" data-id="${esc(t.id)}" title="${esc(t.title)}" aria-label="${esc(t.title)}，${start} 至 ${end}"><span class="zoom-event-text">${esc(t.title)}</span></button>`;
    }).join('');
    weeks.push(`<div class="calendar-week-row zoom-level-2${layout.laneCount ? ' has-events' : ''}"><div class="calendar-week-dates">${days.map(day => calendarDateCell(day,false,todoDays)).join('')}</div><div class="month-events-grid">${spans}${items}</div></div>`);
  }
  return weeks.join('');
}
function calendarDateCell(day, showMonthLabel = false, todoDays) {
  const outside = state.calendarMode === 'month' && day.slice(0,7) !== state.calendarDate.slice(0,7);
  if (outside) {
    // 非当月日期渲染为空单元格，保持 7 列网格对齐
    return `<article class="calendar-day is-outside"></article>`;
  }
  const markers = dayMarkers(day);
  const restWork = markers.find(m => m.type === 'rest' || m.type === 'work');
  const subLabel = markers.find(m => m.type === 'event' || m.type === 'lunar');
  const monthLabel = showMonthLabel ? getMonthLabel(day, state.calendarDate.slice(0,7)) : '';
  const isWeekend = [0,6].includes(new Date(`${day}T12:00:00`).getDay());
  const hasTodos = Boolean(todoDays?.has(day));
  return `<article class="calendar-day ${day===dateKey()?'is-today':''} ${day===state.calendarDate?'is-selected':''} ${isWeekend?'is-weekend':''} ${hasTodos?'has-todos':''}">
    ${monthLabel ? `<div class="month-divider-label">${monthLabel}</div>` : ''}
    <button class="day-date" data-day="${day}" aria-pressed="${day===state.calendarDate}" ${day===dateKey()?'aria-current="date"':''} aria-label="查看 ${day} 日安排">
      <span class="day-number">${Number(day.slice(-2))}</span>
      <small class="day-sub ${restWork ? `day-sub--${restWork.type}` : ''}">
        ${restWork ? `<em>${restWork.label}</em>` : ''}${subLabel ? esc(subLabel.label) : ''}${hasTodos ? '<i class="day-todo-dot" title="有每日事项" aria-hidden="true"></i>' : ''}
      </small>
    </button>
  </article>`;
}
const taskPeriodText = t => `${dueText(taskStartAt(t))} — ${dueText(t.dueAt)}`;
function calendarSelectedAgenda(tasks, todos = []) {
  const list = tasks.filter(t=>taskOccursOn(t,state.calendarDate)).sort((a,b)=>taskStartAt(a).localeCompare(taskStartAt(b))||a.id.localeCompare(b.id));
  const dayTodos = todos.filter(t => t.date === state.calendarDate).sort((a, b) => Number(a.done) - Number(b.done));
  const doneCount = dayTodos.filter(t => t.done).length;
  const todoBlock = dayTodos.length ? `<div class="agenda-todos"><div class="agenda-todos-head"><b>每日事项</b><span>${doneCount}/${dayTodos.length} 已完成</span></div>${dayTodos.map(t=>`<button class="agenda-todo ${t.done?'is-done':''}" data-action="todo-select" data-id="${state.calendarDate}"><span class="todo-check">${t.done?'✓':''}</span><span>${esc(t.title)}</span></button>`).join('')}</div>` : '';
  return `<section class="calendar-selected-agenda" aria-label="所选日期的任务"><header><div><h2>${shortDate(state.calendarDate)}的任务</h2><p>${list.length} 项安排 · 包含当天持续进行的任务</p></div><button data-mode="day">按小时查看 ›</button></header>${list.slice(0,3).map(t=>`<button class="calendar-selected-task" style="${taskColorStyle(t)}" data-action="task" data-id="${esc(t.id)}"><span class="selected-task-dot selected-task-dot--${t.priority}"></span><span><b>${esc(t.title)}</b><small>${taskPeriodText(t)}</small><small>${esc(names(t.owners))} · ${STATUS[t.status]}</small></span></button>`).join('')||'<p class="calendar-selected-empty">当天没有任务安排</p>'}${list.length > 3 ? button(`+${list.length-3}`, 'calendar-overflow', state.calendarDate, 'calendar-more') : ''}${todoBlock}</section>`;
}
function calendarPage() {
  const tasks = visibleTasks(state.db, user()), logs = visibleLogs(state.db, user());
  // 首页「每日事项」与日历展示同一份数据，日历里也能看到当天事项。
  const todos = state.db.todos || [];
  const todoDays = new Set(todos.map(t => t.date));
  const date = new Date(`${state.calendarDate}T12:00:00`), month = monthName(date);
  if (state.taskView === 'list') {
    const today = new Date(`${dateKey()}T12:00:00`);
    return `<div class="company-panel"><section class="task-page-head"><div class="task-page-title"><span class="eyebrow">${dateKey()} · ${WEEKDAY[today.getDay()]}</span><h1>公司任务</h1></div>${button('＋ 新建任务','new-task','','primary-button task-create-button')}</section><div class="task-view-row">${viewSwitch('list')}</div>` + taskListView() + `</div>`;
  }
  const isMonth = state.calendarMode === 'month';
  const year = state.calendarDate.slice(0,4), metadata = state.calendarMetadata.years[year]?.data;
  const metadataNote = state.calendarMetadata.errors[year] ? `日历信息暂时无法更新${metadata ? '，使用已缓存数据' : ''} ${button('重试','calendar-metadata-retry','','text-button')}`
    : !metadata ? '正在加载日历信息…' : !metadata.published ? `${year} 年暂未获取到已公布的放假、调休安排，将自动检查更新`
    : metadata.syncStatus === 'unavailable' ? '节假日安排同步暂不可用，使用已缓存数据，将自动重试' : '';
  const zoomClass = isMonth ? 'zoom-2' : '';
  const top = `<header class="ios-calendar-toolbar"><div class="calendar-title-group"><h1 class="ios-month-title"><button data-action="calendar-back" aria-label="${isMonth?'选择年月':'返回月视图'}">${month}</button></h1><span class="calendar-year">${date.getFullYear()}年</span></div><div class="calendar-head-actions"><button class="calendar-today-button" data-action="today">今天</button><button class="calendar-create-button" data-action="new-task" aria-label="新建任务">${calendarIcon('plus')}</button></div></header><div class="calendar-view-row">${viewSwitch('calendar')}</div>`;
  const dates = calendarDates(isMonth ? 'month' : 'week');
  const dateStrip = `<section class="calendar-panel calendar-panel--${isMonth?'month':'week'}" aria-label="${date.getFullYear()}年${date.getMonth()+1}月"><div class="calendar-week">${['日','一','二','三','四','五','六'].map(v=>`<span>${v}</span>`).join('')}</div><div class="calendar-grid" style="--calendar-rows:${dates.length/7}">${isMonth ? calendarMonthRows(tasks,logs,dates,todoDays) : dates.map(day=>calendarDateCell(day,false,todoDays)).join('')}</div></section>`;
  const modes = `<div class="calendar-mode-tabs" role="group" aria-label="日历周期">${[['month','月'],['week','周'],['day','日']].map(([mode,label]) => `<button data-mode="${mode}" aria-pressed="${state.calendarMode === mode}">${label}</button>`).join('')}</div>`;
  return `<section class="ios-calendar ios-calendar--${state.calendarMode} ${zoomClass}">${top}${modes}${metadataNote ? `<p class="calendar-metadata-note" role="status">${metadataNote}</p>` : ''}${isMonth?`<div class="calendar-month-content" id="calendar-scroll-area">${dateStrip}${calendarSelectedAgenda(tasks,todos)}</div>`:dateStrip+`<div class="calendar-agenda-scroll">${calendarAgenda(tasks,logs,todos)}</div>`}</section>`;
}

function announcementsDetail() {
  const items = [...(state.db.announcements || [])].sort((a,b) => Number(b.pinned)-Number(a.pinned) || b.date.localeCompare(a.date));
  open('公司公告', `<div class="highlight-dialog-list">${items.map(a => `<article class="announcement"><span class="announcement-tag">${a.pinned ? '置顶 · ' : ''}${esc(a.category)} · ${esc(a.date)}</span><h3>${esc(a.title)}</h3><p class="log-content">${esc(a.content)}</p></article>`).join('') || '<p class="detail-copy">暂无公司公告</p>'}</div>`);
}

function highlightsDetail(kind = 'company', id = '') {
  const titles = {company:'事件纪',dispatch:'派发任务',personal:'个人事项'};
  const items = (state.db.highlights || []).filter(h => h.kind === kind && h.enabled !== false && (kind !== 'personal' || h.audience === user().id) && (!id || h.id === id)).sort((a,b) => a.position - b.position);
  const body = `<div class="highlight-dialog-list">${items.map(h => `<article class="announcement"><span class="announcement-tag">第 ${h.position} 项</span><h3>${esc(h.title)}</h3><p class="log-content">${esc(h.content)}</p>${h.taskId ? button('查看关联任务','task',h.taskId,'soft-button') : ''}</article>`).join('') || '<p class="detail-copy">暂无展示内容</p>'}</div>`;
  open(id ? items[0]?.title || '重要事项' : titles[kind], body);
}

const kindLabel = k => ({ create: '创建', edit: '编辑', delete: '删除' }[k]);
function requestCard(r) {
  return `<article class="log-card"><div class="log-card-top"><b>${kindLabel(r.kind)}申请</b><span>${({pending:'待审核',approved:'已通过',rejected:'已驳回'})[r.status]}</span></div><h3>${esc(r.after?.title || r.before?.title)}</h3><p>申请人 · ${esc(userById(r.proposer)?.name)}<br>${stamp(r.createdAt)}</p>${r.reason ? `<p>审核备注：${esc(r.reason)}</p>` : ''}${button('查看申请', 'request', r.id, 'soft-button')}</article>`;
}

function settingsRow(icon, title, detail, action) {
  return `<button data-action="${action}"><span class="settings-icon" aria-hidden="true">${icon}</span><span><b>${title}</b><small>${detail}</small></span><i aria-hidden="true">›</i></button>`;
}

function minePage() {
  const today = dateKey(), month = today.slice(0, 7);
  const myTasks = visibleTasks(state.db, user()).filter(t => t.owners.includes(user().id));
  const myLogs = visibleLogs(state.db, user()).filter(l => l.author === user().id);
  const done = myTasks.filter(t => t.status === 'done' && t.completedAt?.slice(0, 7) === month).length;
  const monthLogs = myLogs.filter(l => l.date.slice(0, 7) === month && l.date <= today).length;
  const days = [0, -1, -2].map(offset => dayOffset(offset));
  const written = days.filter(date => myLogs.some(l => l.date === date)).length;
  return `<div class="mine-page"><section class="profile-hero"><div class="profile-identity"><button class="profile-avatar-button" data-action="change-avatar" aria-label="更换头像">${avatar(user(), `profile-avatar avatar avatar--${esc(user().color || 'blue')}`)}<small>更换</small></button><input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" hidden><div><span class="profile-eyebrow">我的工作空间</span><h1>${esc(user().name)}</h1><p>${esc(user().department || '未设置部门')} · ${esc(user().roleName || user().role)}</p><span>手机号 ${esc(user().phone || '未填写')}</span></div></div><div class="profile-bottom"><span>把每天的积累，留在这里</span></div></section>` +
    panel('工作概览', `<dl class="profile-stats"><div><dt>未完成任务</dt><dd>${myTasks.filter(t => t.status !== 'done').length}</dd></div><div><dt>本月已完成</dt><dd>${done}</dd></div><div><dt>本月日志</dt><dd>${monthLogs}</dd></div></dl><p class="overview-note">${Number(today.slice(5, 7))}月的工作积累，从每一项完成开始</p>`, `<span class="month-label">${Number(today.slice(5, 7))}月</span>`) +
    panel('最近三天日志', `<p class="journal-intro">已记录 <b>${written}</b> / 3 天${written === 3 ? '，最近的工作都已记下' : '，忙碌过后也记得补上'}</p><div class="journal-days">${days.map((date, i) => {
      const log = myLogs.find(l => l.date === date);
      return `<button class="journal-day ${log ? 'is-written' : ''}" data-action="${log ? 'edit-log' : 'new-log-date'}" data-id="${esc(log?.id || date)}" aria-label="${['今天','昨天','前天'][i]} ${date} ${log ? '已填写，编辑日志' : '待填写，写日志'}"><span class="journal-label">${['今天','昨天','前天'][i]}</span><strong>${shortDate(date)}</strong><span class="journal-status">${log ? '✓ 已填写' : '＋ 待填写'}</span><small>${log ? '编辑记录' : i ? '补写日志' : '记录今天'}</small></button>`;
    }).join('')}</div>`, '<span class="section-caption">点击填写或编辑</span>') +
    panel('账号与安全', `<div class="settings-list">${settingsRow('◎', '个人资料', '查看账号、部门与岗位信息', 'profile-details')}${settingsRow('◇', '修改密码', '定期更新密码，保护工作账号', 'password-form')}</div>`) +
    panel('帮助与关于', `<div class="settings-list">${settingsRow('?', '使用帮助', '日志补写规则与常见问题', 'help')}${settingsRow('P', '关于潘多拉', `当前版本 ${APP_VERSION}`, 'about')}</div>`) +
    button('退出登录', 'confirm-logout', '', 'danger-button mine-logout') + '<p class="mine-footer">潘多拉 · 让工作有记录</p></div>';
}

function profileDetails() {
  open('个人资料', `<div class="profile-dialog"><div class="account-details">${[['姓名',user().name],['性别',user().gender || '未填写'],['身份证号',user().idNumber || '未填写'],['手机号',user().phone || '未填写'],['部门',user().department || '未设置'],['岗位',user().roleName || user().role]].map(([label,value]) => `<div><span>${label}</span><b>${esc(value)}</b></div>`).join('')}</div><p class="help-note">资料需要更正时，请联系公司管理员。</p></div>`);
}

function passwordForm() {
  open('修改密码', `<form class="modal-form" data-form="password"><p class="form-tip">修改成功后需重新登录，其他设备的登录也将失效。</p><label>原密码<input type="password" name="currentPassword" required autocomplete="current-password" placeholder="请输入原密码"></label><label>新密码<input type="password" name="newPassword" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="请输入8～64位新密码"></label><label>确认新密码<input type="password" name="confirmPassword" minlength="8" maxlength="64" required autocomplete="new-password" placeholder="再次输入新密码"></label><p class="form-error" role="alert"></p><div class="modal-actions"><button class="primary-button" type="submit">确认修改</button></div></form>`);
}

function helpDialog() {
  open('使用帮助', `<div class="help-content"><section><h3>哪几天的日志可以补写？</h3><p>支持今天、昨天和前天，每人每天一篇。点击“写日志”或“我的”页面中的日期即可填写；已填写的日期可以继续编辑。</p></section><section><h3>更早的日志还能查看吗？</h3><p>可以。在日志页切换“近7天”“近30天”或“全部”，也可以搜索标题和正文。超过三天的日志只读，修改前的版本会保留。</p></section><section><h3>日志的可见范围是怎样的？</h3><p>员工只能看到自己的日志；团队长可以查看本部门员工和自己的日志；部门负责人可以查看本部门成员的日志；创始人和管理员可以查看全部日志。</p></section><section><h3>任务如何创建与审核？</h3><p>在视图页点击“新建任务”。普通成员可申请创建本人任务，管理角色可选择管理范围内的负责人。进入“消息”中的“待我审核”，管理员或创始人可审核他人的申请。</p></section><section><h3>任务进展和完成如何处理？</h3><p>负责人在任务详情里记录进展或标记完成。任务的创建、编辑和删除需审核，记录进展与完成任务直接生效。</p></section><section><h3>账号资料有误或忘记密码怎么办？</h3><p>请联系公司管理员核对账号信息。记得原密码时，可在“账号与安全”中修改密码。</p></section></div>`);
}

// ============ 路由渲染 ============
function render(preservePosition = false) {
  deferredRender = false;
  const selectors = ['.calendar-month-content','.calendar-agenda-scroll','.tile-scroll','.main-content'];
  const positions = preservePosition ? selectors.flatMap(selector => [...root.querySelectorAll(selector)].map((el,index) => ({selector,index,top:el.scrollTop,left:el.scrollLeft}))) : [];
  const windowPosition = [window.scrollX,window.scrollY];
  // 「公司」下分日历与任务列表两个视图，两屏共用同一套外壳，切换时不跳版。
  const calendarActive = Boolean(state.token && state.user && state.route === 'calendar');
  document.body.classList.toggle('calendar-active', calendarActive);
  const dashboardActive = Boolean(state.token && state.user && state.route === 'dashboard');
  document.body.classList.toggle('dashboard-active', dashboardActive);
  document.querySelector('meta[name="theme-color"]').content = '#264f40';
  if (!state.token || !state.user) {
    root.innerHTML = loginPage();
    return;
  }
  // 资料不完善时只显示完善信息页，不允许使用其他功能
  if (state.user.profileComplete === false) {
    root.innerHTML = profileCompletePage();
    return;
  }
  if (state.route === 'calendar' && state.taskView === 'calendar') {
    const years = new Set([state.calendarDate.slice(0,4), ...(state.calendarMode === 'month' ? [] : calendarDates('week').map(day=>day.slice(0,4)))]);
    for (const year of years) void loadCalendarMetadata(year);
  }
  const nav = [['dashboard','首页','⌂'],['logs','日志','✎'],['calendar','任务','▦'],['mine','我的','◯']];
  const pages = { dashboard, logs: logsPage, calendar: calendarPage, mine: minePage };
  root.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">P</span><strong>潘多拉</strong></div><nav class="nav" aria-label="主导航">${nav.map(([route,label,icon]) => `<button class="nav-item ${state.route === route ? 'is-active' : ''}" data-route="${route}"><span class="nav-glyph">${icon}</span><span>${label}</span></button>`).join('')}</nav></aside><main class="main-content"><header class="topbar"><div class="mobile-brand"><span class="brand-mark">P</span><b>潘多拉</b></div><span class="version-label">工作台</span><button class="user-menu" data-route="mine" aria-label="进入我的页面">${person(user())}<span>›</span></button></header><div class="page-wrap ${state.route === 'dashboard' ? 'page-wrap--dashboard' : ''}">${pages[state.route]()}</div></main></div>`;
  const monthContent = root.querySelector('.calendar-month-content');
  const selectedWeek = monthContent?.querySelector('.calendar-day.is-selected')?.closest('.calendar-week-row');
  if (!preservePosition && selectedWeek && monthContent.scrollHeight > monthContent.clientHeight) {
    monthContent.scrollTop = Math.max(0, selectedWeek.getBoundingClientRect().top - monthContent.getBoundingClientRect().top - 36);
  }
  for (const position of positions) {
    const el = root.querySelectorAll(position.selector)[position.index];
    if (el) { el.scrollTop = position.top; el.scrollLeft = position.left; }
  }
  if (preservePosition) window.scrollTo(...windowPosition);
}

// ============ 详情弹窗 ============
function taskDetail(id) {
  const t = visibleTasks(state.db, user()).find(t => t.id === id);
  if (!t) return notify('没有查看这项任务的权限', true);
  const pending = state.db.requests.some(r => r.taskId === id && r.status === 'pending');
  const tag = taskTag(t);
  const tagRow = `<div class="detail-tag"><span>任务标签</span><span class="task-tag ${tag ? '' : 'task-tag--empty'}" style="${tag ? taskColorStyle(t) : `background:${LONG_TERM_COLOR};color:${LONG_TERM_FG}`}">${esc(tag ? tag.name : '长期任务 · 未设置标签')}</span></div>`;
  open(t.title, `<div class="detail-status">${statusPill(t.status)}${priorityPill(t.priority)}</div>${tagRow}<p class="detail-copy log-content">${esc(t.detail)}</p><div class="detail-owner"><b>负责人 · ${esc(names(t.owners))}</b><small>开始 · ${dueText(taskStartAt(t))}</small><small>结束 · ${dueText(t.dueAt)}</small><small>创建 · ${stamp(t.createdAt)}（精确到分钟）</small></div>` +
    (canWorkOnTask(user(), t) && t.status !== 'done' ? `<form class="modal-form" data-form="note" data-id="${esc(id)}"><label>记录进展<textarea name="note" maxlength="1000" rows="3" placeholder="今天完成了什么，还有什么待处理？" required></textarea></label><button class="soft-button" type="submit">保存进展</button></form>` : '') +
    `<div class="detail-actions">${button((state.db.pins?.[user().id] || []).includes(id) ? '取消重点' : '关注为重点','pin',id)}${canWorkOnTask(user(),t) && t.status !== 'done' ? button('标记完成','complete',id,'primary-button') : ''}${canManageTask(user(),t) && !pending ? button('申请编辑','edit-task',id) + button('申请删除','delete-task',id) : ''}${pending ? '<span class="done-message">有变更等待审核，当前内容仍有效</span>' : ''}</div>` +
    `<div class="detail-history"><div class="section-label">执行与审核记录</div>${[...t.history].reverse().map(h => `<div class="history-item"><span></span><p class="log-content">${esc(h.text)}<small>${esc(userById(h.actor)?.name)} · ${stamp(h.at)}</small></p></div>`).join('')}</div>`);
}

async function taskForm(id = '') {
  if (id && !isManager(user())) return notify('只有负责人可以申请编辑任务', true);
  try { const tags = await api('/tags'); if (Array.isArray(tags)) state.db.tags = tags; }
  catch (error) { return notify(error.message,true); }
  const t = id ? state.db.tasks.find(t => t.id === id) : null;
  const allowed = state.db.allowedAssignees?.length ? state.db.allowedAssignees : [user()];
  const owners = t?.owners || [user().id];
  const defaultDate = state.route === 'calendar' && state.taskView === 'calendar' ? state.calendarDate : dayOffset(1);
  const ownerField = isManager(user())
    ? `<fieldset class="assignee-field"><legend>负责人（可多选）</legend>${allowed.map(u => `<label class="check-option"><input type="checkbox" name="owners" value="${esc(u.id)}" ${owners.includes(u.id) ? 'checked' : ''}>${esc(u.name)} · ${esc(u.roleName || u.role)}</label>`).join('')}</fieldset>`
    : `<input type="hidden" name="owners" value="${esc(user().id)}"><p class="task-assignee-self">负责人 · ${esc(user().name)}</p>`;
  const tagField = tagChoices('tagId', t?.tagId);
  open(t ? '申请编辑任务' : '创建任务申请', `<form class="modal-form" data-form="task" data-id="${esc(id)}"><label>任务名称<input name="title" value="${esc(t?.title || '')}" maxlength="80" required></label>${ownerField}${tagField}<label>开始时间<input type="datetime-local" name="startAt" value="${t ? taskStartAt(t) : `${defaultDate}T09:00`}" step="60" required></label><label>结束时间<input type="datetime-local" name="dueAt" value="${t?.dueAt || `${defaultDate}T18:30`}" step="60" required></label><label>优先级<select name="priority">${Object.entries(PRIORITY).map(([priority,label]) => `<option value="${priority}" ${t?.priority === priority ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>任务说明<textarea name="detail" maxlength="2000" rows="4">${esc(t?.detail || '')}</textarea></label><p class="panel-note">创建申请通过后，任务会出现在相关负责人的视图中。</p><div class="modal-actions"><button class="primary-button" type="submit">${t ? '提交修改申请' : '提交创建申请'}</button></div></form>`);
}

function tagEditor(id = '') {
  if (!isGlobal(user())) return;
  const editor = modal.querySelector('.tag-editor');
  if (!editor) return;
  const tag = state.db.tags.find(t => t.id === id);
  editor.hidden = false;
  editor.innerHTML = `<b>${tag ? '编辑标签' : '新建标签'}</b><label>标签名称<input name="tagName" maxlength="40" value="${esc(tag?.name || '')}" placeholder="请输入标签名称"></label><label>标签颜色<input name="tagColor" type="color" value="${esc(tag?.color || '#1abc9c')}"></label><div class="tag-editor-actions">${button('取消','tag-cancel','','ghost-button')}${button('保存标签','tag-save',id,'soft-button')}</div><p class="form-error" role="alert"></p>`;
  editor.querySelector('input').focus();
}

async function saveTag(id) {
  if (!isGlobal(user())) return;
  const editor = modal.querySelector('.tag-editor');
  const name = editor.querySelector('[name="tagName"]').value.trim();
  const color = editor.querySelector('[name="tagColor"]').value;
  const error = editor.querySelector('.form-error'), submit = editor.querySelector('[data-action="tag-save"]');
  if (!name || name.length > 40) { error.textContent = '标签名称需为 1～40 个字'; return; }
  submit.disabled = true; error.textContent = '';
  try {
    const tag = await api(`/admin/tags${id ? `/${encodeURIComponent(id)}` : ''}`, {method:id ? 'PUT' : 'POST',body:JSON.stringify({name,color})});
    state.db.tags = await api('/tags');
    const field = modal.querySelector('.tag-choices');
    const selected = id ? field.querySelector('input:checked')?.value || '' : tag.id;
    field.outerHTML = tagChoices('tagId',selected);
    notify(id ? '标签已更新，所有成员将使用最新标签' : '标签已新建并选中');
  } catch (e) { error.textContent = e.message; }
  finally { submit.disabled = false; }
}

function chooseLogDate() {
  const dates = [0, -1, -2].map(offset => dayOffset(offset)), labels = ['今天', '昨天', '前天'];
  open('选择日志日期', `<div class="date-choice-list">${dates.map((date, i) => {
    const log = state.db.logs.find(v => v.author === user().id && v.date === date);
    return `<button data-action="${log ? 'edit-log' : 'new-log-date'}" data-id="${esc(log?.id || date)}"><span><b>${labels[i]}</b><small>${shortDate(date)}</small></span><em>${log ? '已填写 · 编辑' : '待填写'}</em><i>›</i></button>`;
  }).join('')}</div><p class="date-choice-tip">仅支持今天、昨天和前天，每天一篇</p>`);
}

function logForm(id = '', selectedDate = '') {
  const l = id ? state.db.logs.find(v => v.id === id) : null;
  if (l && !canEditLog(user(), l)) return notify('只能编辑本人最近三天的日志', true);
  const logDate = l?.date || selectedDate || dateKey();
  const dateField = `<label>日志日期<input type="date" name="date" value="${logDate}" readonly></label>`;
  const sections = logSections(l?.content || '');
  open(l ? `编辑${shortDate(l.date)}日志` : '写工作日志', `<form class="modal-form" data-form="log" data-id="${esc(l?.id || '')}">${dateField}<p class="form-tip">每人每天一篇，可补写或编辑最近三天 · 日报模板</p><label>今日完成<textarea name="content" maxlength="2800" rows="5" placeholder="记录完成的工作、结果和进展" required>${esc(sections.content)}</textarea></label><label>下一步计划<textarea name="plan" maxlength="2800" rows="3" placeholder="接下来准备推进什么？">${esc(sections.plan)}</textarea></label><label>问题与协助<textarea name="issues" maxlength="2800" rows="3" placeholder="有哪些阻塞，需要谁提供什么帮助？">${esc(sections.issues)}</textarea></label><p class="panel-note">三个部分合计最多 3000 字，含段落标题。</p><details><summary>自定义标题（可选）</summary><label>标题<input name="title" value="${esc(l?.title || '')}" maxlength="80" placeholder="不填则自动使用日志日期"></label></details><div class="modal-actions"><button class="primary-button" type="submit">保存日志</button></div></form>`);
}

async function logDetail(id) {
  const l = visibleLogs(state.db,user()).find(v => v.id === id);
  if (!l) return notify('无权查看日志',true);
  const linked = l.taskId ? visibleTasks(state.db,user()).find(t => t.id === l.taskId) : null;
  const linkedBlock = linked ? `<div class="log-linked-task">${button(`关联任务 · ${esc(linked.title)}`, 'task', linked.id, 'soft-button')}</div>` : '';
  const canComment = canViewLog(user(), l.author) && l.author !== user().id;
  // 异步加载评论
  if (!state.logComments[id]) {
    state.logComments[id] = 'loading';
    api(`/logs/${id}/comments`).then(data => {
      state.logComments[id] = data;
      if (modal.open && modal.dataset.log === id) logDetail(id); else render();
    }).catch(() => {
      state.logComments[id] = [];
      if (modal.open && modal.dataset.log === id) logDetail(id);
    });
  }
  const comments = state.logComments[id] === 'loading' ? [] : (state.logComments[id] || []);
  const commentsHtml = comments.length ? comments.map(c => `<div class="comment-item"><strong>${esc(c.authorName)}</strong> · ${stamp(c.createdAt)}<p>${esc(c.content)}</p></div>`).join('') : '<p class="panel-note">暂无评论</p>';
  const commentForm = canComment ?
    `<form class="modal-form comment-form" data-form="log-comment" data-id="${esc(id)}"><label>发表评论<textarea name="content" maxlength="1000" rows="3" placeholder="对这篇日志的评论或批示…"></textarea></label><div class="modal-actions"><button class="primary-button" type="submit">发表评论</button></div></form>` :
    '<p class="panel-note">不能评论自己的日志，等待上级批示</p>';
  open(l.title, `<p class="detail-copy">${esc(userById(l.author)?.name)} · ${l.date}</p><p class="detail-copy log-content">${esc(l.content)}</p>${linkedBlock}<div class="detail-actions">${canEditLog(user(),l) ? button('编辑这篇日志','edit-log',id,'primary-button') : '<span class="done-message">超过三天或他人日志只读</span>'}</div><div class="detail-history"><h3>修改记录（${l.versions?.length || 0}）</h3>${[...(l.versions || [])].reverse().map((v,i) => `<details class="version-item"><summary>历史版本 ${(l.versions?.length || 0)-i} · ${stamp(v.at)}</summary><b>${esc(v.title)}</b><p class="log-content">${esc(v.content)}</p></details>`).join('') || '<p class="panel-note">尚无修改记录</p>'}</div><div class="detail-history"><h3>评论（${comments.length}）</h3>${commentsHtml}${commentForm}</div>`);
  modal.dataset.log = id;
}

function requestDetail(id) {
  const r = visibleRequests(state.db,user()).find(v => v.id === id);
  if (!r) return notify('无权查看申请',true);
  const fromMessages = Boolean(modal.dataset.messages);
  const view = v => v ? `<h3>${esc(v.title)}</h3><p>负责人 · ${esc(names(v.owners))}<br>开始 · ${dueText(taskStartAt(v))}<br>结束 · ${dueText(v.dueAt)}<br>${PRIORITY[v.priority]}</p><p class="log-content">${esc(v.detail)}</p>` : '<p>无</p>';
  open(`${kindLabel(r.kind)}任务申请`, `<div class="request-content">${r.before ? '<h4>原内容</h4>'+view(r.before) : ''}<h4>${r.kind === 'delete' ? '变更结果' : '申请内容'}</h4>${r.kind === 'delete' ? '<p>审核通过后归档删除，历史记录仍保留。</p>' : view(r.after)}<p class="panel-note">申请人：${esc(userById(r.proposer)?.name)} · ${stamp(r.createdAt)}</p>${r.reason ? `<p>审核备注：${esc(r.reason)}</p>` : ''}</div>${r.status !== 'pending' ? `<p class="detail-copy">审核结果：${r.status === 'approved' ? '已通过' : '已驳回'}<br>审核人：${esc(userById(r.reviewer)?.name || '管理员或创始人')} · ${stamp(r.reviewedAt || r.createdAt)}</p>` : canReviewRequest(user(),r) ? `<form class="modal-form" data-form="review" data-id="${esc(id)}"><label>审核备注（驳回必填）<textarea name="reason" maxlength="500" rows="3"></textarea></label><div class="modal-actions"><button class="ghost-button" name="decision" value="reject" type="submit">驳回</button><button class="primary-button" name="decision" value="approve" type="submit">审核通过</button></div></form>` : '<p class="detail-copy">申请人不能自审；待审核内容需另一位管理员或创始人处理。</p>'}`);
  if (fromMessages) {
    modal.dataset.messages = 'request';
    modal.querySelector('.request-content').insertAdjacentHTML('beforebegin', button('‹ 返回消息', 'messages-return', '', 'text-button messages-back'));
  }
}

// ============ 操作分发 ============
async function action(name,id) {
  if (name === 'calendar-metadata-retry') return loadCalendarMetadata(state.calendarDate.slice(0,4), true);
  if (name === 'messages-open') {
    state.messageFilter = 'all'; openMessages();
    try { await loadWorkspace(); render(); if (modal.dataset.messages === 'list') openMessages(); }
    catch (e) { notify(e.message,true); }
    return;
  }
  if (name === 'messages-return') return openMessages();
  if (name === 'messages-read') { markMessagesRead(allMessages()); render(); return openMessages(); }
  if (name === 'notification') return notificationDetail(id);
  if (name === 'tag-new') return tagEditor();
  if (name === 'tag-edit') return tagEditor(id);
  if (name === 'tag-save') return saveTag(id);
  if (name === 'tag-cancel') { const editor = modal.querySelector('.tag-editor'); if (editor) { editor.hidden = true; editor.innerHTML = ''; } return; }
  if (name === 'calendar-overflow') {
    state.calendarDate = id;
    const tasks = visibleTasks(state.db,user()).filter(t => taskOccursOn(t,id));
    return open(`${shortDate(id)} · ${tasks.length} 项任务`, `<div class="overflow-task-list">${tasks.map(t => `<button class="overflow-task" data-action="task" data-id="${esc(t.id)}">${tagBadge(t)}<b>${esc(t.title)}</b><small>${taskPeriodText(t)} · ${STATUS[t.status]}</small></button>`).join('')}</div>`);
  }
  if (name === 'todo-reschedule') {
    const todo = state.db.todos.find(t => t.id === id);
    if (todo) open('事项改期', `<form class="modal-form" data-form="todo-move" data-id="${esc(id)}"><p>${esc(todo.title)}</p><label>移动到日期<input type="date" name="date" value="${todo.date}" required></label><button type="submit" class="primary-button">确认改期</button></form>`);
    return;
  }
  if (name === 'calendar-modes') return open('日历视图', `<div class="calendar-mode-menu">${[['month','月视图','查看整月工作安排'],['week','周视图','选择本周日期，查看工作安排'],['day','日视图','按小时查看当天任务与日志']].map(([mode,title,detail])=>`<button data-mode="${mode}" aria-pressed="${state.calendarMode===mode}"><b>${title}</b><small>${detail}</small><span>${state.calendarMode===mode?'✓':''}</span></button>`).join('')}</div>`);
  if (name === 'calendar-back') {
    if (state.calendarMode !== 'month') {state.calendarMode='month';render();return;}
    const year = Number(state.calendarDate.slice(0,4));
    return open('选择年月', `<form class="modal-form" data-form="calendar-jump"><label>跳转到日期<input type="date" name="date" value="${state.calendarDate}" required></label><button class="primary-button" type="submit">查看日期</button></form><div class="calendar-year-grid">${Array.from({length:12},(_,i)=>`<button data-calendar-month="${year}-${String(i+1).padStart(2,'0')}-01">${i+1}月</button>`).join('')}</div>`);
  }
  if (name === 'calendar-search') {state.taskView='list';render();root.querySelector('[aria-label="搜索任务"]')?.focus();return;}
  if (name === 'all-tasks') {state.route='calendar';state.taskView='list';state.filter='all';state.taskQuery='';state.taskPriority='';state.taskScope='';render();window.scrollTo(0,0);return;}
  if (name === 'todo-calendar') return openTodoCalendar(state.todoDate);
  if (name === 'todo-select') return openTodoDay(id);
  if (name === 'todo-month-prev') return shiftTodoMonth(-1);
  if (name === 'todo-month-next') return shiftTodoMonth(1);
  if (name === 'todo-toggle') return todoAction(`/todos/${id}/toggle`, '事项状态已更新');
  if (name === 'todo-delete') return todoAction(`/todos/${id}`, '事项已删除', 'DELETE');
  if (name === 'task') return taskDetail(id);
  if (name === 'new-task' || name === 'edit-task') return taskForm(id);
  if (name === 'new-log') return chooseLogDate();
  if (name === 'new-log-date') return logForm('', id);
  if (name === 'edit-log') return logForm(id);
  if (name === 'log') return logDetail(id);
  if (name === 'request') { const r = visibleRequests(state.db,user()).find(r => r.id === id); if (r) markMessagesRead([r]); render(); return requestDetail(id); }
  if (name === 'company-highlights') return highlightsDetail();
  if (name === 'announcements-open') return announcementsDetail();
  if (name === 'dispatch-highlights') return highlightsDetail('dispatch');
  if (name === 'personal-highlights') return highlightsDetail('personal');
  if (name === 'highlight') {
    const item = (state.db.highlights || []).find(h => h.id === id);
    if (item) return highlightsDetail(item.kind, id);
    return;
  }
  if (name === 'company-tasks' || name === 'personal-focus') { state.route='calendar'; state.taskView='list'; state.filter=name === 'personal-focus' ? 'focus' : 'all'; close(); render(); return; }
  if (name === 'personal-logs') { state.route='logs'; close(); render(); return; }
  if (name === 'profile-details') return profileDetails();
  if (name === 'change-avatar') return document.querySelector('#avatar-file')?.click();
  if (name === 'clear-task-search') { state.taskQuery = ''; state.taskPriority = ''; state.taskScope = ''; state.filter = 'all'; render(); return; }
  if (name === 'password-form') return passwordForm();
  if (name === 'help') return helpDialog();
  if (name === 'about') return open('关于潘多拉', `<div class="about-content"><span class="brand-mark">P</span><h3>潘多拉</h3><p>智能掌上工作系统</p><span class="about-version">版本 ${APP_VERSION}</span><p class="help-note">让任务有进展，让工作有记录。</p></div>`);
  if (name === 'confirm-logout') return open('退出登录', `<p class="detail-copy">确认退出当前账号？再次使用时需要登录。</p><div class="detail-actions confirm-actions">${button('取消','cancel-dialog')}${button('确认退出','logout','','primary-button')}</div>`);
  if (name === 'cancel-dialog') return close();
  if (name === 'logout') return logout();
  if (name === 'clear-log-filters') { resetLogFilters(); render(); return; }
  if (name === 'retry-log-history') return loadLogHistory();
  if (name === 'route-tasks') { state.route = 'calendar'; state.taskView = 'list'; render(); window.scrollTo(0,0); return; }
  if (name === 'pin') return save(async () => { await api(`/tasks/${id}/pin`, { method: 'POST' }); },'个人重点已更新');
  if (name === 'complete') return open('确认完成任务', `<p class="detail-copy">此操作会将整项任务标记完成，其他负责人也会看到已完成状态，无需审核。</p><div class="detail-actions confirm-actions">${button('确认完成','confirm-complete',id,'primary-button')}${button('返回任务','task',id)}</div>`);
  if (name === 'confirm-complete') return save(async () => { await api(`/tasks/${id}/complete`, { method: 'POST' }); },'任务已完成，无需审核');
  if (name === 'delete-task') return open('申请删除任务', `<p class="detail-copy">审核通过前任务继续有效。通过后任务归档，操作记录保留。</p><div class="detail-actions confirm-actions">${button('提交删除申请','confirm-delete',id,'primary-button')}${button('返回任务','task',id)}</div>`);
  if (name === 'confirm-delete') return save(async () => { await api('/tasks/requests', { method: 'POST', body: JSON.stringify({ kind: 'delete', taskId: id }) }); },'删除申请已提交');
  if (name === 'prev' || name === 'next') state.calendarDate = shiftCalendar(state.calendarDate,state.calendarMode,name === 'prev' ? -1 : 1);
  if (name === 'today') state.calendarDate = dateKey();
  render();
}

// ============ 事件绑定 ============
let suppressTodoClickUntil = 0, movingTodo = false;
async function moveTodo(id, date) {
  if (movingTodo) return false;
  const todo = state.db.todos?.find(t => t.id === id);
  if (!todo || todo.date === date) return false;
  movingTodo = true;
  try {
    await api(`/todos/${encodeURIComponent(id)}/date`, {method:'PUT',body:JSON.stringify({date})});
    todo.date = date; state.todoDate = date;
    render();
    refreshTodoDialog();
    notify('事项已移动'); return true;
  } catch (error) { notify(error.message,true); return false; }
  finally { movingTodo = false; }
}
let draggedTodo = '', touchDrag = null;
const clearDropTarget = () => document.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
document.addEventListener('dragstart', e => {
  const item = e.target.closest('[data-todo-drag]'); if (!item) return;
  draggedTodo = item.dataset.todoDrag;
  e.dataTransfer.setData('text/plain',draggedTodo); e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', e => {
  const cell = e.target.closest('[data-todo-drop]'); if (!cell || !draggedTodo) return;
  e.preventDefault(); clearDropTarget(); cell.classList.add('is-drop-target');
});
document.addEventListener('drop', e => {
  const cell = e.target.closest('[data-todo-drop]'); if (!cell || !draggedTodo) return;
  e.preventDefault(); const id = draggedTodo; draggedTodo = ''; clearDropTarget();
  suppressTodoClickUntil = Date.now()+500; moveTodo(id,cell.dataset.todoDrop);
});
document.addEventListener('dragend', () => { draggedTodo = ''; clearDropTarget(); });
document.addEventListener('pointerdown', e => {
  const item = e.target.closest('[data-todo-drag]');
  if (!item || e.pointerType !== 'touch') return;
  touchDrag = {id:item.dataset.todoDrag,x:e.clientX,y:e.clientY,active:false};
  touchDrag.timer = setTimeout(() => { if (touchDrag) { touchDrag.active = true; item.classList.add('is-dragging'); navigator.vibrate?.(25); } },350);
});
document.addEventListener('touchmove', e => {
  if (!touchDrag || !e.touches[0]) return;
  const touch = e.touches[0];
  if (!touchDrag.active) {
    if (Math.hypot(touch.clientX-touchDrag.x,touch.clientY-touchDrag.y)>10) { clearTimeout(touchDrag.timer); touchDrag=null; }
    return;
  }
  e.preventDefault(); clearDropTarget();
  document.elementFromPoint(touch.clientX,touch.clientY)?.closest('[data-todo-drop]')?.classList.add('is-drop-target');
}, {passive:false});
function finishTouchDrag(e) {
  if (!touchDrag) return;
  clearTimeout(touchDrag.timer);
  const drag = touchDrag; touchDrag = null;
  document.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
  const cell = document.querySelector('.is-drop-target'); clearDropTarget();
  if (drag.active) { suppressTodoClickUntil=Date.now()+600; if (cell && e.type !== 'touchcancel') moveTodo(drag.id,cell.dataset.todoDrop); }
}
document.addEventListener('touchend',finishTouchDrag);
document.addEventListener('touchcancel',finishTouchDrag);
document.addEventListener('click', async e => {
  if (Date.now() < suppressTodoClickUntil && e.target.closest('button[data-todo-drag]')) { e.preventDefault(); return; }
  const el = e.target.closest('button'); if (!el) return;
  if (el.dataset.messageFilter) { state.messageFilter = el.dataset.messageFilter; openMessages(); return; }
  if (el.dataset.logMember) { state.logAuthor = el.dataset.logMember; state.logSubmission = 'all'; render(); return; }
  if (el.hasAttribute('data-close')) return close();
  if (el.dataset.route) {
    state.route = el.dataset.route;
    render(); window.scrollTo(0,0); return;
  }
  if (el.dataset.filter) { state.filter=el.dataset.filter; render(); return; }
  if (el.dataset.mode) { state.calendarMode=el.dataset.mode; close(); render(); return; }
  if (el.dataset.calendarMonth) {state.calendarDate=el.dataset.calendarMonth;state.calendarMode='month';close();render();return;}
  if (el.dataset.taskView) { state.taskView=el.dataset.taskView; render(); return; }
  if (el.dataset.day) { state.calendarDate=el.dataset.day; render(); return; }
  if (el.dataset.logRange) {
    state.logRange = el.dataset.logRange;
    state.logFrom = ''; state.logTo = '';
    render();
    if (state.logRange !== '7') await loadLogHistory();
    return;
  }
  if (el.dataset.action) action(el.dataset.action,el.dataset.id);
});

function readAvatarFile(file) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)
    return Promise.reject(new Error('请选择 8 MB 以内的 JPG、PNG 或 WebP 图片'));
  return new Promise((resolve, reject) => {
    const image = new Image(), source = URL.createObjectURL(file);
    image.onload = () => {
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) { URL.revokeObjectURL(source); reject(new Error('无法处理这张图片')); return; }
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(source);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => { URL.revokeObjectURL(source); reject(new Error('无法读取这张图片')); };
    image.src = source;
  });
}

// 任务搜索：输入一两个字就即时过滤下方列表，不必再点「筛选」。
document.addEventListener('input', e => {
  const input = e.target;
  if (!input.matches || !input.matches('[data-task-query]')) return;
  const query = input.value.trim().toLowerCase();
  let shown = 0;
  root.querySelectorAll('.task-table tbody tr').forEach(row => {
    const hit = !query || row.textContent.toLowerCase().includes(query);
    row.hidden = !hit;
    if (hit) shown += 1;
  });
  const count = root.querySelector('.filter-count');
  if (count) count.textContent = String(shown);
  const panel = root.querySelector('.task-table-panel');
  if (panel) panel.hidden = shown === 0;
  const emptyHint = root.querySelector('.task-live-empty');
  if (emptyHint) emptyHint.hidden = shown > 0;
});

document.addEventListener('change', async e => {
  if (e.target.matches('[data-log-select]')) {
    const form = e.target.closest('form');
    if (['department','role'].includes(e.target.name)) form.elements.author.value = '';
    readLogFilters(form); render();
    if (state.logRange !== '7' || state.logCheckDate < dayOffset(-6)) await loadLogHistory();
    return;
  }
  if (e.target.matches('[data-task-select]')) {
    // 选完优先级或可见范围立即生效，不需要再点「筛选」
    const form = e.target.closest('[data-form="task-filter"]');
    const data = form ? new FormData(form) : null;
    state.taskQuery = data ? (data.get('query') || '') : state.taskQuery;
    state.taskPriority = data ? (data.get('priority') || '') : state.taskPriority;
    state.taskScope = data ? (data.get('scope') || '') : state.taskScope;
    render();
    return;
  }
  if (e.target.matches('[data-calendar-date]')) {
    if (!e.target.value) return;
    state.calendarDate = e.target.value;
    state.calendarMode = 'day';
    state.taskView = 'calendar';
    render();
    return;
  }
  if (e.target.id !== 'avatar-file' || !e.target.files?.[0]) return;
  try {
    const avatarData = await readAvatarFile(e.target.files[0]);
    await api('/auth/profile/avatar', { method: 'PUT', body: JSON.stringify({ avatarData }) });
    await loadWorkspace();
    close(); render(); notify('头像已更新');
  } catch (err) { notify(err.message, true); }
  finally { e.target.value = ''; }
});

document.addEventListener('submit', async e => {
  if(e.target.dataset.form === 'calendar-jump') {e.preventDefault();state.calendarDate=new FormData(e.target).get('date');state.calendarMode='day';close();render();return;}
  e.preventDefault(); const form=e.target, fd=new FormData(form), v=Object.fromEntries(fd.entries()), id=form.dataset.id;
  if (form.dataset.form === 'log-filter') { readLogFilters(form); render(); if (state.logRange !== '7' || state.logCheckDate < dayOffset(-6)) await loadLogHistory(); return; }
  if (form.dataset.form === 'task-filter') { state.taskQuery = v.query || ''; state.taskPriority = v.priority || ''; state.taskScope = v.scope || ''; render(); return; }
  if (form.dataset.form === 'login') {
    try {
      const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: v.identifier, password: v.password }) });
      state.token = r.token; localStorage.setItem('pandora.token', r.token);
      await loadWorkspace(); close(); render(); notify(`欢迎，${state.user.name}`);
    } catch (err) { notify(err.message, true); }
    return;
  }
  if (form.dataset.form === 'profile') {
    const error = form.querySelector('.form-error') || form.appendChild(document.createElement('div'));
    error.className = 'form-error'; error.textContent = '';
    try {
      const updated = await api('/auth/profile', { method: 'PUT', body: JSON.stringify({ name: v.name, gender: v.gender, idNumber: v.idNumber }) });
      state.user = { ...state.user, ...updated };
      await loadWorkspace(); close(); render();
      notify('个人信息已完善，欢迎使用');
    } catch (err) { notify(err.message, true); }
    return;
  }
  if (!state.token) return notify('请先登录', true);
  if (form.dataset.form === 'password') {
    const error = form.querySelector('.form-error'), submit = form.querySelector('[type="submit"]');
    error.textContent = '';
    if (v.newPassword !== v.confirmPassword) { error.textContent = '两次输入的新密码不一致'; return; }
    submit.disabled = true; submit.textContent = '正在修改…';
    try {
      await api('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: v.currentPassword, newPassword: v.newPassword }) });
      logout(); notify('密码已修改，请使用新密码登录');
    } catch (err) {
      if (form.isConnected) error.textContent = err.message;
      else notify(err.message, true);
    } finally {
      submit.disabled = false; submit.textContent = '确认修改';
    }
    return;
  }
  if (form.dataset.form === 'task') {
    v.owners=fd.getAll('owners');
    await save(async () => { await api('/tasks/requests', { method: 'POST', body: JSON.stringify({ kind: id ? 'edit' : 'create', taskId: id || undefined, values: v }) }); }, id ? '任务修改申请已提交' : '任务创建申请已提交');
  }
  if (form.dataset.form === 'note') await save(async () => { await api(`/tasks/${id}/progress`, { method: 'POST', body: JSON.stringify({ text: v.note }) }); },'工作进展已保存');
  if (form.dataset.form === 'log') {
    if (!v.content?.trim()) return notify('请填写今日完成的工作', true);
    v.content = composeLogSections(v);
    if (v.content.length > 3000) return notify('日志内容合计不能超过 3000 字', true);
    await save(async () => { await api('/logs', { method: 'POST', body: JSON.stringify({ logId: id || undefined, values: v }) }); },`${shortDate(v.date)}日志已保存`);
  }
  if (form.dataset.form === 'todo-move') {
    if (await moveTodo(id,v.date)) openTodoCalendar(v.date); return;
  }
  if (form.dataset.form === 'todo') {
    const title = v.title?.trim();
    if (!title) { notify('请填写事项内容', true); return; }
    try {
      await api('/todos', { method: 'POST', body: JSON.stringify({ date: state.todoDate, title }) });
      await loadWorkspace(); render(); refreshTodoDialog(); notify('事项已添加');
    } catch (err) { notify(err.message, true); }
    return;
  }
  if (form.dataset.form === 'log-comment') {
    try {
      const content = v.content?.trim();
      if (!content) throw new Error('评论内容不能为空');
      await api(`/logs/${id}/comments`, { method: 'POST', body: JSON.stringify({ content }) });
      // 清除缓存，重新加载评论
      state.logComments[id] = 'loading';
      api(`/logs/${id}/comments`).then(data => { state.logComments[id] = data; render(); });
      close(); notify('评论已发表');
    } catch (err) { notify(err.message, true); }
    return;
  }
  if (form.dataset.form === 'review') await save(async () => { await api(`/tasks/requests/${id}/review`, { method: 'POST', body: JSON.stringify({ approve: e.submitter.value === 'approve', reason: v.reason }) }); },'审核结果已保存');
});

modal.addEventListener('cancel', e => {
  if (['request','detail'].includes(modal.dataset.messages)) { e.preventDefault(); openMessages(); }
});
window.pandoraBack = () => { if (modal.open) { if (['request','detail'].includes(modal.dataset.messages)) openMessages(); else close(); return true; } if (state.route !== 'dashboard') { state.route='dashboard'; render(); return true; } return false; };
let refreshingWorkspace = false;
async function refreshWorkspace() {
  checkSystemDate();
  if (refreshingWorkspace || document.hidden || !state.token || !state.db) return;
  if (state.route === 'calendar' && state.taskView === 'calendar') {
    const years = new Set([state.calendarDate.slice(0,4), ...(state.calendarMode === 'month' ? [] : calendarDates('week').map(day=>day.slice(0,4)))]);
    for (const year of years) void loadCalendarMetadata(year);
  }
  refreshingWorkspace = true;
  const tagsBefore = JSON.stringify(state.db.tags);
  try {
    await loadWorkspace();
    // Keep form drafts and the reader's place while receiving updates.
    refreshView();
    if (modal.dataset.messages === 'list') { render(); openMessages(); }
    const field = modal.querySelector('[data-form="task"] .tag-choices');
    if (field && tagsBefore !== JSON.stringify(state.db.tags) && !field.querySelector('.tag-editor:not([hidden])')) {
      const selected = field.querySelector('input:checked')?.value || '';
      field.outerHTML = tagChoices('tagId',state.db.tags.some(t => t.id === selected) ? selected : '');
    }
  } catch { /* Retry on the next refresh; manual actions still report errors. */ }
  finally { refreshingWorkspace = false; }
}
setInterval(refreshWorkspace,30000);
document.addEventListener('visibilitychange',refreshWorkspace);
window.addEventListener('focus',refreshWorkspace);
window.addEventListener('pageshow',refreshWorkspace);
window.addEventListener('online',refreshWorkspace);
root.addEventListener('focusout', () => { if (deferredRender) queueMicrotask(refreshView); });
modal.addEventListener('close', () => {
  if (modal.open) return;
  if (deferredTodoDate && state.todoDate === deferredTodoDate) state.todoDate = dateKey();
  deferredTodoDate = '';
  checkSystemDate();
  if (deferredRender) refreshView();
});
checkSystemDate();
modal.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.closest('.tag-editor') && e.target.tagName === 'INPUT') {
    e.preventDefault(); const submit = modal.querySelector('[data-action="tag-save"]');
    if (submit && !submit.disabled) saveTag(submit.dataset.id);
  }
});

// 启动：有 token 则自动加载工作区。
if (state.token) loadWorkspace().then(render).catch(() => render());
else render();

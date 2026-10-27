import {
  USERS, STATUS, PRIORITY, dateKey, dayOffset, minuteKey, userById, isManager,
  visibleTasks, visibleLogs, recentLogs, canSeeTask, canManageTask, canWorkOnTask, canEditLog,
  requestTaskChange, reviewTaskChange, visibleRequests, canReviewRequest,
  updateTaskDetail, completeTask, saveLog, togglePin, allowedAssignees,
  calendarDays, shiftCalendar, isOverdue
} from './domain.js';

const root = document.querySelector('#app'), modal = document.querySelector('#modal'), toast = document.querySelector('#toast');
const API = window.__PANDORA_API_BASE__ || 'http://localhost:8080/api';

const state = { token: localStorage.getItem('pandora.token'), user: null, route: 'dashboard', filter: 'all',
  calendarMode: 'month', calendarDate: dateKey(), logRange: '7', logQuery: '',
  taskQuery: '', taskPriority: '', taskScope: '', logHistoryLoaded: false, logLoading: false, logError: '', taskView: 'calendar', logArchive: false, db: null };
const APP_VERSION = '0.4.1';

// ============ API 客户端 ============
async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) }
    });
  } catch {
    throw new Error(`无法连接服务器 ${new URL(API).host}，请确认手机与电脑同网且后端已启动`);
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
  try { await action(); await loadWorkspace(); close(); render(); notify(message); }
  catch (e) { notify(e.message, true); }
}

function logout() {
  localStorage.removeItem('pandora.token');
  state.token = null; state.user = null; state.db = null; state.route = 'dashboard';
  state.logHistoryLoaded = false; state.logLoading = false; state.logError = ''; state.logRange = '7'; state.logQuery = '';
  state.taskQuery = ''; state.taskPriority = ''; state.taskScope = ''; state.filter = 'all';
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
const button = (label, action, id = '', cls = 'ghost-button') => `<button class="${cls}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
function notify(text, error = false) {
  toast.textContent = text; toast.dataset.type = error ? 'error' : 'success'; toast.classList.add('toast--show');
  clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('toast--show'), 3000);
}
function open(title, body) {
  modal.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" aria-label="关闭" data-close>×</button></div>${body}`;
  if (!modal.open) modal.showModal();
}
function close() { modal.close(); modal.innerHTML = ''; }
function avatar(u, className = 'avatar') { return u.avatarData ? `<span class="${className}"><img src="${esc(u.avatarData)}" alt=""></span>` : `<span class="${className}">${esc(u.avatar || u.name?.slice(-1) || '?')}</span>`; }
function person(u) { return `<span class="person">${avatar(u, `avatar avatar--${u.color || 'blue'}`)}<span><b>${esc(u.name)}</b><small>${esc(u.roleName || u.role)}</small></span></span>`; }
function head(title, detail, action = '', className = '') { return `<section class="page-head ${esc(className)}"><div><span class="eyebrow">${dateKey()}</span><h1>${title}</h1><p class="lede">${detail}</p></div>${action}</section>`; }
function panel(title, content, action = '') { return `<section class="panel"><div class="panel-head"><h2>${title}</h2>${action}</div>${content}</section>`; }
const empty = text => `<div class="empty-state"><span class="empty-icon">✓</span><p>${text}</p></div>`;

// ============ 页面组件 ============
function taskCard(t) {
  return `<article class="task-card"><button class="task-open" data-action="task" data-id="${esc(t.id)}"><div class="task-card-top">${statusPill(t.status)}${priorityPill(t.priority)}</div><h3>${esc(t.title)}</h3><p>${esc(t.detail)}</p><div class="task-meta"><span>负责人 · ${esc(names(t.owners))}</span><span class="due ${isOverdue(t) ? 'due--late' : ''}">${isOverdue(t) ? '已逾期 · ' : '截止 · '}${dueText(t.dueAt)}</span></div></button></article>`;
}
function logCard(l) { return `<article class="log-card"><div class="log-card-top"><b>${esc(userById(l.author)?.name)}</b><span>${l.date}${l.date === dateKey() ? ' · 今天' : ''}</span></div><h3>${button(esc(l.title), 'log', l.id, 'log-title-button')}</h3><p class="log-content">${esc(l.content)}</p>${l.versions?.length ? `<small>保留 ${l.versions.length} 次修改记录</small>` : ''}</article>`; }

function loginPage() {
  return `<div class="login-page"><div class="login-card"><div class="brand login-brand"><span class="brand-mark">P</span><strong>潘多拉</strong></div><h1>欢迎回来</h1><p class="login-sub">登录你的工作账号</p><form data-form="login"><label>手机号或姓名<input name="identifier" required autocomplete="username" placeholder="请输入手机号或姓名"></label><label>密码<input type="password" name="password" required autocomplete="current-password" placeholder="请输入密码"></label><button class="primary-button login-button" type="submit">登录</button></form></div></div>`;
}

function dashboard() {
  const tasks = visibleTasks(state.db, user()), pinned = (state.db.pins?.[user().id] || []).map(id => tasks.find(t => t.id === id)).filter(Boolean);
  const logs = visibleLogs(state.db, user()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const highlights = state.db.highlights || [];
  const entries = kind => highlights.filter(h => h.kind === kind && h.enabled !== false && (kind !== 'personal' || h.audience === user().id)).sort((a,b) => a.position - b.position).slice(0,10);
  const company = entries('company'), dispatch = entries('dispatch'), personal = entries('personal');
  const managed = Array.isArray(state.db.highlights);
  const highlightRows = list => list.map(h => `<button class="tile-row" data-action="highlight" data-id="${esc(h.id)}"><span class="tile-rank">${String(h.position).padStart(2,'0')}</span><span class="tile-row-main"><b>${esc(h.title)}</b><small>${esc(h.kind === 'dispatch' ? state.db.tasks.find(t => t.id === h.taskId)?.title || '关联任务' : h.content)}</small></span></button>`).join('');
  const chevron = '<svg class="tile-arrow" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const tile = (title, action, content, count) => `<section class="dashboard-tile"><header><div><span>${count}</span><h2>${title}</h2></div><button class="tile-open" data-action="${action}" aria-label="打开${title}">${chevron}</button></header><div class="tile-content">${content}</div></section>`;
  const taskRows = (list, emptyText) => list.length ? list.map(t => `<button class="tile-row" data-action="task" data-id="${esc(t.id)}"><span class="tile-marker tile-marker--${t.priority}"></span><span class="tile-row-main"><b>${esc(t.title)}</b><small>${STATUS[t.status]} · ${dueText(t.dueAt)}</small></span></button>`).join('') : `<p class="tile-empty">${emptyText}</p>`;
  return `<section class="dashboard-page"><header class="dashboard-head"><div><span class="eyebrow">${dateKey()}</span><h1>你好，${esc(user().name)}</h1></div></header><div class="dashboard-grid">` +
    tile('公司 10 大重要展示项', 'company-highlights', highlightRows(company) || '<p class="tile-empty">暂无重要展示项，请在 Web 管理端维护</p>', String(company.length).padStart(2, '0')) +
    tile('公司 10 大派发任务', 'dispatch-highlights', highlightRows(dispatch) || (managed ? '<p class="tile-empty">暂无已发布的派发重点</p>' : taskRows(tasks.slice(0, 10), '当前没有可见任务')), String(managed ? dispatch.length : Math.min(tasks.length,10)).padStart(2, '0')) +
    tile('个人 10 大重要展示项', 'personal-highlights', highlightRows(personal) || (managed ? '<p class="tile-empty">暂无个人展示项，关注任务可在任务列表查看</p>' : taskRows(pinned.slice(0, 10), '在任务详情中关注重点工作')), String(managed ? personal.length : Math.min(pinned.length,10)).padStart(2, '0')) +
    tile('个人日志', 'personal-logs', logs.map(l => `<button class="tile-row" data-action="log" data-id="${esc(l.id)}"><span class="tile-marker tile-marker--log"></span><span class="tile-row-main"><b>${esc(l.title)}</b><small>${l.date}</small></span></button>`).join('') || '<p class="tile-empty">暂无日志</p>', String(logs.length).padStart(2, '0')) +
    `</div></section>`;
}

function taskListView() {
  const tasks = visibleTasks(state.db, user()), pinned = state.db.pins?.[user().id] || [];
  const query = state.taskQuery.trim().toLocaleLowerCase();
  const filtered = tasks.filter(t => state.filter === 'focus' ? pinned.includes(t.id) : state.filter === 'all' || t.status === state.filter)
    .filter(t => (!state.taskPriority || t.priority === state.taskPriority) && (!state.taskScope || t.owners.includes(user().id)))
    .filter(t => !query || `${t.title} ${t.detail} ${names(t.owners)}`.toLocaleLowerCase().includes(query));
  return `<div class="filter-bar task-list-filters"><div class="segmented task-status-filters">${[['all', '全部'], ['focus', '个人重点'], ...Object.entries(STATUS)].map(([id, label]) => `<button class="segment ${state.filter === id ? 'is-active' : ''}" aria-pressed="${state.filter === id}" data-filter="${id}">${label}</button>`).join('')}</div><form class="task-search" data-form="task-filter"><label class="search-field"><span aria-hidden="true">⌕</span><input type="search" name="query" value="${esc(state.taskQuery)}" placeholder="任务、说明或负责人" aria-label="搜索任务"></label><select name="priority" aria-label="筛选优先级"><option value="">全部优先级</option>${Object.entries(PRIORITY).map(([value,label]) => `<option value="${value}" ${state.taskPriority === value ? 'selected' : ''}>${label}</option>`).join('')}</select><select name="scope" aria-label="筛选负责人范围"><option value="">全部可见任务</option><option value="mine" ${state.taskScope ? 'selected' : ''}>我负责的</option></select><button class="soft-button" type="submit">筛选</button>${state.taskQuery || state.taskPriority || state.taskScope || state.filter !== 'all' ? button('重置','clear-task-search','','text-button') : ''}</form><span class="filter-hint" role="status">${filtered.length} 项任务</span></div>${filtered.length ? `<section class="task-table-panel" aria-label="任务表格"><table class="task-table"><thead><tr><th scope="col">任务名称</th><th scope="col">状态 / 优先级</th><th scope="col">负责人</th><th scope="col">截止时间</th></tr></thead><tbody>${filtered.map(t => `<tr><td><button class="task-title-button" data-action="task" data-id="${esc(t.id)}">${esc(t.title)}</button><small>${esc(t.detail)}</small></td><td>${statusPill(t.status)} ${priorityPill(t.priority)}</td><td>${esc(names(t.owners))}</td><td class="due ${isOverdue(t) ? 'due--late' : ''}">${dueText(t.dueAt)}</td></tr>`).join('')}</tbody></table></section>` : empty('当前筛选没有任务')}`;
}

function logsPage() {
  const allLogs = visibleLogs(state.db, user());
  const start = state.logRange === '7' ? dayOffset(-6) : state.logRange === '30' ? dayOffset(-29) : '';
  const query = state.logQuery.trim().toLowerCase();
  const logs = allLogs.filter(l => (!start || l.date >= start) && l.date <= dateKey())
    .filter(l => !query || `${l.title} ${l.content}`.toLowerCase().includes(query))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const rangeLabel = { '7': '近7天', '30': '近30天', all: '全部日志' }[state.logRange];
  const status = state.logRange !== '7' && state.logLoading ? '正在加载历史日志…'
    : state.logRange !== '7' && state.logError ? state.logError : `${rangeLabel} · 共 ${logs.length} 篇`;
  return head('我的日志', '记录每天的工作与思考，忙碌时可补写最近三天。', button('写日志', 'new-log', '', 'primary-button')) +
    `<section class="log-filter" aria-busy="${state.logLoading}"><div class="segmented log-range" role="group" aria-label="日志时间范围">${[['7','近7天'],['30','近30天'],['all','全部']].map(([id,label]) => `<button class="segment ${state.logRange === id ? 'is-active' : ''}" aria-pressed="${state.logRange === id}" data-log-range="${id}">${label}</button>`).join('')}</div><form class="log-search" data-form="log-filter"><label class="search-field"><span aria-hidden="true">⌕</span><input type="search" name="query" value="${esc(state.logQuery)}" placeholder="搜索我的日志" aria-label="搜索我的日志"></label><button class="soft-button" type="submit">搜索</button></form><div class="log-filter-summary"><span role="status">${status}</span>${state.logError && state.logRange !== '7' ? button('重新加载', 'retry-log-history', '', 'text-button') : query ? button('清除搜索', 'clear-log-filters', '', 'text-button') : ''}</div></section><section class="log-results" aria-label="日志列表">${logs.map(logCard).join('') || empty(state.logLoading ? '正在加载日志' : state.logError && state.logRange !== '7' ? '暂时无法获取完整日志，请重新加载' : '这个范围内没有符合条件的日志')}</section>`;
}

function calendarAgenda(tasks, logs) {
  const dayTasks = tasks.filter(t => t.dueAt.slice(0,10) === state.calendarDate).sort((a,b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
  const dayLogs = logs.filter(l => l.date === state.calendarDate).sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const weekday = new Date(`${state.calendarDate}T12:00:00`).toLocaleDateString('zh-CN', {weekday:'long'});
  const event = t => {
    const latest = [...(t.history || [])].sort((a,b) => b.at.localeCompare(a.at))[0];
    return `<button class="timeline-item event--${t.priority} ${t.status === 'done' ? 'event--done' : ''}" data-action="task" data-id="${esc(t.id)}"><time datetime="${esc(t.dueAt)}">${esc(t.dueAt.slice(11,16))}<small>截止</small></time><span class="timeline-copy"><b>${esc(t.title)}</b><span class="event-badges">${statusPill(t.status)}${priorityPill(t.priority)}${isOverdue(t) ? '<span class="event-overdue">已逾期</span>' : ''}</span><small>负责人 · ${esc(names(t.owners))}</small><span class="event-description">${esc(t.detail || '暂无事务说明')}</span>${latest ? `<small class="event-progress">最新动态 · ${esc(latest.text)}</small>` : ''}<span class="event-open">查看事务详情 ›</span></span></button>`;
  };
  const logEvent = l => {
    const linked = l.taskId ? tasks.find(t => t.id === l.taskId) : null;
    return `<button class="timeline-item event--log" data-action="log" data-id="${esc(l.id)}"><time datetime="${esc(l.date)}">全天<small>日志</small></time><span class="timeline-copy"><b>${esc(l.title)}</b><span class="event-badges"><span class="event-log-badge">工作日志</span></span>${linked ? `<small>关联任务 · ${esc(linked.title)}</small>` : ''}<span class="event-description">${esc(l.content)}</span><span class="event-open">查看日志详情 ›</span></span></button>`;
  };
  const total = dayTasks.length + dayLogs.length;
  const hours = Array.from({length:24},(_,hour) => `<div class="calendar-hour"><span class="hour-label">${String(hour).padStart(2,'0')}:00</span><div class="hour-events">${dayTasks.filter(t => Number(t.dueAt.slice(11,13)) === hour).map(event).join('')}</div></div>`).join('');
  const content = !total ? '<div class="calendar-empty"><b>当天没有安排</b><p>选择其他日期查看事务与日志，或新建任务。</p></div>' : state.calendarMode === 'day'
    ? (dayLogs.length ? `<div class="timeline-all-day">${dayLogs.map(logEvent).join('')}</div>` : '') + (dayTasks.length ? hours : '')
    : [...dayLogs.map(logEvent), ...dayTasks.map(event)].join('');
  return `<section class="calendar-day-timeline ${state.calendarMode === 'day' ? 'calendar-hour-timeline' : ''}" aria-label="${state.calendarDate} 任务与日志时间线"><header class="timeline-header"><div><span class="eyebrow">${weekday}${state.calendarDate === dateKey() ? ' · 今天' : ''}</span><h2>${shortDate(state.calendarDate)}<small>工作安排</small></h2></div><strong>${total} 项安排</strong></header><div class="timeline-list">${content}</div><footer class="calendar-footnote">按日志与任务截止时间排列 · 点击查看详情</footer></section>`;
}

function calendarPage() {
  const tasks = visibleTasks(state.db, user());
  const logs = visibleLogs(state.db, user());
  const canCreate = button('＋ 新建任务', 'new-task', '', 'primary-button');
  const viewSwitch = `<div class="segmented task-view-switch"><button class="segment ${state.taskView === 'calendar' ? 'is-active' : ''}" data-task-view="calendar">日历</button><button class="segment ${state.taskView === 'list' ? 'is-active' : ''}" data-task-view="list">任务列表</button></div>`;
  const date = new Date(`${state.calendarDate}T12:00:00`);
  const monthTitle = `${date.getFullYear()}年${date.getMonth() + 1}月`;
  const rangeTitle = state.calendarMode === 'month' ? monthTitle : state.calendarMode === 'week' ? `${state.calendarDate} 所在周` : `${state.calendarDate}`;
  const controls = `<div class="view-toolbar">${viewSwitch}${state.taskView === 'calendar' ? `<div class="calendar-mode-switch segmented">${[['month','月'],['week','周'],['day','日']].map(([m,label]) => `<button class="segment ${state.calendarMode === m ? 'is-active' : ''}" aria-pressed="${state.calendarMode === m}" data-mode="${m}">${label}</button>`).join('')}</div><div class="calendar-controls">${button('‹','prev')}<label class="calendar-date-label"><span>选择日期</span><input type="date" value="${esc(state.calendarDate)}" aria-label="选择日期" data-calendar-date></label><strong>${rangeTitle}</strong>${button('›','next')}${button('今天','today')}</div>` : ''}${canCreate}</div>`;
  const requests = visibleRequests(state.db, user()).sort((a,b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.createdAt.localeCompare(a.createdAt));
  const requestPanel = requests.length ? `<details class="task-requests"><summary>任务申请与审核 <span>${requests.filter(r => r.status === 'pending').length} 项待审核</span></summary><div class="request-list">${requests.map(requestCard).join('')}</div></details>` : '';
  if (state.taskView === 'list') return head('任务视图', '按状态管理任务；选择任务可查看详情、记录进展或申请变更。') + controls + taskListView() + requestPanel;
  const days = calendarDays(state.calendarDate, state.calendarMode);
  const agenda = calendarAgenda(tasks, logs);
  if (state.calendarMode === 'day') return head('工作日历', '按小时查看事务与日志，随时了解工作详情。', '', 'calendar-page-head') + controls + agenda + requestPanel;
  return head('工作日历', '选择日期，查看当天的具体事务与工作日志。', '', 'calendar-page-head') + controls + `<div class="calendar-layout calendar-layout--${state.calendarMode}">` +
    `<section class="calendar-panel calendar-panel--${state.calendarMode}" aria-label="${rangeTitle}"><div class="calendar-week">${['一','二','三','四','五','六','日'].map(v=>`<span>${v}</span>`).join('')}</div><div class="calendar-grid">${days.map(day => {
      const ts = tasks.filter(t => t.dueAt.slice(0, 10) === day).sort((a,b) => a.dueAt.localeCompare(b.dueAt));
      const ls = logs.filter(l => l.date === day);
      const markers = ts.slice(0, 4).map(t => `<i class="calendar-dot calendar-dot--${t.priority}"></i>`).join('');
      const logDot = ls.length ? `<i class="calendar-dot calendar-dot--log"></i>` : '';
      const extra = ts.length > 4 ? `<span class="calendar-more">+${ts.length - 4}</span>` : '';
      const count = ts.length ? `<span class="calendar-count">${ts.length} 项</span>` : '';
      const logBadge = ls.length ? `<span class="calendar-log-badge">✎ ${ls.length}</span>` : '';
      return `<article class="calendar-day ${day === dateKey() ? 'is-today' : ''} ${day === state.calendarDate ? 'is-selected' : ''} ${day.slice(0, 7) !== state.calendarDate.slice(0, 7) ? 'is-outside' : ''}"><button class="day-date" data-day="${day}" aria-pressed="${day === state.calendarDate}" ${day === dateKey() ? 'aria-current="date"' : ''} aria-label="查看 ${day} 日安排">${Number(day.slice(-2))}</button><button class="day-summary" data-day="${day}" aria-label="查看 ${day} 的 ${ts.length} 项任务${ls.length ? `与 ${ls.length} 篇日志` : ''}"><span class="calendar-marker-row">${markers}${logDot}${extra}</span>${count}${logBadge}</button></article>`;
    }).join('')}</div></section>${agenda}</div>` + requestPanel;
}

function highlightsDetail(kind = 'company', id = '') {
  const titles = {company:'公司 10 大重要展示项',dispatch:'公司 10 大派发任务',personal:'个人 10 大重要展示项'};
  const items = (state.db.highlights || []).filter(h => h.kind === kind && h.enabled !== false && (kind !== 'personal' || h.audience === user().id) && (!id || h.id === id)).sort((a,b) => a.position - b.position);
  open(id ? items[0]?.title || '重要事项' : titles[kind], items.map(h => `<article class="announcement"><span class="announcement-tag">第 ${h.position} 项</span><h3>${esc(h.title)}</h3><p class="log-content">${esc(h.content)}</p>${h.taskId ? button('查看关联任务','task',h.taskId,'soft-button') : ''}</article>`).join('') || '<p class="detail-copy">暂无展示内容</p>');
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
  const myLogs = visibleLogs(state.db, user());
  const done = myTasks.filter(t => t.status === 'done' && t.completedAt?.slice(0, 7) === month).length;
  const monthLogs = myLogs.filter(l => l.date.slice(0, 7) === month && l.date <= today).length;
  const days = [0, -1, -2].map(offset => dayOffset(offset));
  const written = days.filter(date => myLogs.some(l => l.date === date)).length;
  return `<div class="mine-page"><section class="profile-hero"><div class="profile-identity"><button class="profile-avatar-button" data-action="change-avatar" aria-label="更换头像">${avatar(user(), `profile-avatar avatar avatar--${esc(user().color || 'blue')}`)}<small>更换</small></button><input id="avatar-file" type="file" accept="image/jpeg,image/png,image/webp" hidden><div><span class="profile-eyebrow">我的工作空间</span><h1>${esc(user().name)}</h1><p>${esc(user().department || '未设置部门')} · ${esc(user().roleName || user().role)}</p><span>手机号 ${esc(user().phone || '未填写')}</span></div></div><div class="profile-bottom"><span>把每天的积累，留在这里</span>${button('个人资料 ›', 'profile-details', '', 'profile-detail-button')}</div></section>` +
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
  open('使用帮助', `<div class="help-content"><section><h3>哪几天的日志可以补写？</h3><p>支持今天、昨天和前天，每人每天一篇。点击“写日志”或“我的”页面中的日期即可填写；已填写的日期可以继续编辑。</p></section><section><h3>更早的日志还能查看吗？</h3><p>可以。在日志页切换“近7天”“近30天”或“全部”，也可以搜索标题和正文。超过三天的日志只读，修改前的版本会保留。</p></section><section><h3>为什么只能看到自己的日志？</h3><p>日志是个人工作记录，登录后只展示本人的日志，可在日志页查找自己的历史记录。</p></section><section><h3>任务如何创建与审核？</h3><p>在视图页点击“新建任务”。普通成员可申请创建本人任务，管理角色可选择管理范围内的负责人。进入任务列表下方的“任务申请与审核”，管理员或创始人可审核他人的申请。</p></section><section><h3>任务进展和完成如何处理？</h3><p>负责人在任务详情里记录进展或标记完成。任务的创建、编辑和删除需审核，记录进展与完成任务直接生效。</p></section><section><h3>账号资料有误或忘记密码怎么办？</h3><p>请联系公司管理员核对账号信息。记得原密码时，可在“账号与安全”中修改密码。</p></section></div>`);
}

// ============ 路由渲染 ============
function render() {
  if (!state.token || !state.user) {
    root.innerHTML = loginPage();
    return;
  }
  const nav = [['dashboard','首页','⌂'],['logs','日志','✎'],['calendar','视图','▦'],['mine','我的','◯']];
  const pages = { dashboard, logs: logsPage, calendar: calendarPage, mine: minePage };
  root.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">P</span><strong>潘多拉</strong></div><nav class="nav" aria-label="主导航">${nav.map(([route,label,icon]) => `<button class="nav-item ${state.route === route ? 'is-active' : ''}" data-route="${route}"><span class="nav-glyph">${icon}</span><span>${label}</span></button>`).join('')}</nav></aside><main class="main-content"><header class="topbar"><div class="mobile-brand"><span class="brand-mark">P</span><b>潘多拉</b></div><span class="version-label">工作台</span><button class="user-menu" data-route="mine" aria-label="进入我的页面">${person(user())}<span>›</span></button></header><div class="page-wrap">${pages[state.route]()}</div></main></div>`;
  const hours = root.querySelector('.calendar-hour-timeline .timeline-list');
  const firstEvent = hours?.querySelector('.calendar-hour .timeline-item');
  if (firstEvent) hours.scrollTop = Math.max(0, firstEvent.closest('.calendar-hour').offsetTop - 12);
}

// ============ 详情弹窗 ============
function taskDetail(id) {
  const t = visibleTasks(state.db, user()).find(t => t.id === id);
  if (!t) return notify('没有查看这项任务的权限', true);
  const pending = state.db.requests.some(r => r.taskId === id && r.status === 'pending');
  open(t.title, `<div class="detail-status">${statusPill(t.status)}${priorityPill(t.priority)}</div><p class="detail-copy log-content">${esc(t.detail)}</p><div class="detail-owner"><b>负责人 · ${esc(names(t.owners))}</b><small>截止 · ${dueText(t.dueAt)}</small><small>创建 · ${stamp(t.createdAt)}（精确到分钟）</small></div>` +
    (canWorkOnTask(user(), t) && t.status !== 'done' ? `<form class="modal-form" data-form="note" data-id="${esc(id)}"><label>记录进展<textarea name="note" maxlength="1000" rows="3" placeholder="今天完成了什么，还有什么待处理？" required></textarea></label><button class="soft-button" type="submit">保存进展</button></form>` : '') +
    `<div class="detail-actions">${button((state.db.pins?.[user().id] || []).includes(id) ? '取消重点' : '关注为重点','pin',id)}${canWorkOnTask(user(),t) && t.status !== 'done' ? button('标记完成','complete',id,'primary-button') : ''}${canManageTask(user(),t) && !pending ? button('申请编辑','edit-task',id) + button('申请删除','delete-task',id) : ''}${pending ? '<span class="done-message">有变更等待审核，当前内容仍有效</span>' : ''}</div>` +
    `<div class="detail-history"><div class="section-label">执行与审核记录</div>${[...t.history].reverse().map(h => `<div class="history-item"><span></span><p class="log-content">${esc(h.text)}<small>${esc(userById(h.actor)?.name)} · ${stamp(h.at)}</small></p></div>`).join('')}</div>`);
}

function taskForm(id = '') {
  if (id && !isManager(user())) return notify('只有负责人可以申请编辑任务', true);
  const t = id ? state.db.tasks.find(t => t.id === id) : null;
  const allowed = state.db.allowedAssignees?.length ? state.db.allowedAssignees : [user()];
  const owners = t?.owners || [user().id];
  const defaultDate = state.route === 'calendar' && state.taskView === 'calendar' ? state.calendarDate : dayOffset(1);
  const ownerField = isManager(user())
    ? `<fieldset class="assignee-field"><legend>负责人（可多选）</legend>${allowed.map(u => `<label class="check-option"><input type="checkbox" name="owners" value="${esc(u.id)}" ${owners.includes(u.id) ? 'checked' : ''}>${esc(u.name)} · ${esc(u.roleName || u.role)}</label>`).join('')}</fieldset>`
    : `<input type="hidden" name="owners" value="${esc(user().id)}"><p class="task-assignee-self">负责人 · ${esc(user().name)}</p>`;
  open(t ? '申请编辑任务' : '创建任务申请', `<form class="modal-form" data-form="task" data-id="${esc(id)}"><label>任务名称<input name="title" value="${esc(t?.title || '')}" maxlength="80" required></label>${ownerField}<label>截止时间<input type="datetime-local" name="dueAt" value="${t?.dueAt || `${defaultDate}T18:30`}" step="60" required></label><label>优先级<select name="priority">${Object.entries(PRIORITY).map(([priority,label]) => `<option value="${priority}" ${t?.priority === priority ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>任务说明<textarea name="detail" maxlength="2000" rows="4">${esc(t?.detail || '')}</textarea></label><p class="panel-note">创建申请通过后，任务会出现在相关负责人的视图中。</p><div class="modal-actions"><button class="primary-button" type="submit">${t ? '提交修改申请' : '提交创建申请'}</button></div></form>`);
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
  open(l ? `编辑${shortDate(l.date)}日志` : '写工作日志', `<form class="modal-form" data-form="log" data-id="${esc(l?.id || '')}">${dateField}<p class="form-tip">每人每天一篇，可补写或编辑最近三天</p><label>工作内容<textarea name="content" maxlength="3000" rows="8" placeholder="完成了什么？遇到什么问题？下一步准备做什么？" required>${esc(l?.content || '')}</textarea></label><details><summary>标题与关联任务（可选）</summary><label>标题<input name="title" value="${esc(l?.title || '')}" maxlength="80" placeholder="不填则自动使用日志日期"></label><label>关联任务<select name="taskId"><option value="">不关联任务</option>${visibleTasks(state.db,user()).map(t => `<option value="${esc(t.id)}" ${l?.taskId === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></label></details><div class="modal-actions"><button class="primary-button" type="submit">保存日志</button></div></form>`);
}

function logDetail(id) {
  const l = visibleLogs(state.db,user()).find(v => v.id === id);
  if (!l) return notify('无权查看日志',true);
  const linked = l.taskId ? visibleTasks(state.db,user()).find(t => t.id === l.taskId) : null;
  const linkedBlock = linked ? `<div class="log-linked-task">${button(`关联任务 · ${esc(linked.title)}`, 'task', linked.id, 'soft-button')}</div>` : '';
  open(l.title, `<p class="detail-copy">${esc(userById(l.author)?.name)} · ${l.date}</p><p class="detail-copy log-content">${esc(l.content)}</p>${linkedBlock}<div class="detail-actions">${canEditLog(user(),l) ? button('编辑这篇日志','edit-log',id,'primary-button') : '<span class="done-message">超过三天或他人日志只读</span>'}</div><div class="detail-history"><h3>修改记录（${l.versions?.length || 0}）</h3>${[...(l.versions || [])].reverse().map((v,i) => `<details class="version-item"><summary>历史版本 ${(l.versions?.length || 0)-i} · ${stamp(v.at)}</summary><b>${esc(v.title)}</b><p class="log-content">${esc(v.content)}</p></details>`).join('') || '<p class="panel-note">尚无修改记录</p>'}</div>`);
}

function requestDetail(id) {
  const r = visibleRequests(state.db,user()).find(v => v.id === id);
  if (!r) return notify('无权查看申请',true);
  const view = v => v ? `<h3>${esc(v.title)}</h3><p>负责人 · ${esc(names(v.owners))}<br>截止 · ${dueText(v.dueAt)}<br>${PRIORITY[v.priority]}</p><p class="log-content">${esc(v.detail)}</p>` : '<p>无</p>';
  open(`${kindLabel(r.kind)}任务申请`, `<div class="request-content">${r.before ? '<h4>原内容</h4>'+view(r.before) : ''}<h4>${r.kind === 'delete' ? '变更结果' : '申请内容'}</h4>${r.kind === 'delete' ? '<p>审核通过后归档删除，历史记录仍保留。</p>' : view(r.after)}<p class="panel-note">申请人：${esc(userById(r.proposer)?.name)} · ${stamp(r.createdAt)}</p>${r.reason ? `<p>审核备注：${esc(r.reason)}</p>` : ''}</div>${canReviewRequest(user(),r) ? `<form class="modal-form" data-form="review" data-id="${esc(id)}"><label>审核备注（驳回必填）<textarea name="reason" maxlength="500" rows="3"></textarea></label><div class="modal-actions"><button class="ghost-button" name="decision" value="reject" type="submit">驳回</button><button class="primary-button" name="decision" value="approve" type="submit">审核通过</button></div></form>` : '<p class="detail-copy">申请人不能自审；待审核内容需另一位管理员或创始人处理。</p>'}`);
}

// ============ 操作分发 ============
async function action(name,id) {
  if (name === 'task') return taskDetail(id);
  if (name === 'new-task' || name === 'edit-task') return taskForm(id);
  if (name === 'new-log') return chooseLogDate();
  if (name === 'new-log-date') return logForm('', id);
  if (name === 'edit-log') return logForm(id);
  if (name === 'log') return logDetail(id);
  if (name === 'request') return requestDetail(id);
  if (name === 'company-highlights') return highlightsDetail();
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
  if (name === 'clear-log-filters') { state.logQuery = ''; render(); return; }
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
document.addEventListener('click', async e => {
  const el = e.target.closest('button'); if (!el) return;
  if (el.hasAttribute('data-close')) return close();
  if (el.dataset.route) { state.route=el.dataset.route; render(); window.scrollTo(0,0); return; }
  if (el.dataset.filter) { state.filter=el.dataset.filter; render(); return; }
  if (el.dataset.mode) { state.calendarMode=el.dataset.mode; render(); return; }
  if (el.dataset.taskView) { state.taskView=el.dataset.taskView; render(); return; }
  if (el.dataset.day) { state.calendarDate=el.dataset.day; render(); return; }
  if (el.dataset.logRange) {
    state.logRange = el.dataset.logRange;
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

document.addEventListener('change', async e => {
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
  e.preventDefault(); const form=e.target, fd=new FormData(form), v=Object.fromEntries(fd.entries()), id=form.dataset.id;
  if (form.dataset.form === 'log-filter') { state.logQuery = v.query || ''; render(); return; }
  if (form.dataset.form === 'task-filter') { state.taskQuery = v.query || ''; state.taskPriority = v.priority || ''; state.taskScope = v.scope || ''; render(); return; }
  if (form.dataset.form === 'login') {
    try {
      const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: v.identifier, password: v.password }) });
      state.token = r.token; localStorage.setItem('pandora.token', r.token);
      await loadWorkspace(); close(); render(); notify(`欢迎，${state.user.name}`);
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
  if (form.dataset.form === 'log') await save(async () => { await api('/logs', { method: 'POST', body: JSON.stringify({ logId: id || undefined, values: v }) }); },`${shortDate(v.date)}日志已保存`);
  if (form.dataset.form === 'review') await save(async () => { await api(`/tasks/requests/${id}/review`, { method: 'POST', body: JSON.stringify({ approve: e.submitter.value === 'approve', reason: v.reason }) }); },'审核结果已保存');
});

window.pandoraBack = () => { if (modal.open) { close(); return true; } if (state.route !== 'dashboard') { state.route='dashboard'; render(); return true; } return false; };
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.token) loadWorkspace().then(render).catch(e => notify(e.message, true)); });

// 启动：有 token 则自动加载工作区
if (state.token) loadWorkspace().then(render).catch(() => render());
else render();

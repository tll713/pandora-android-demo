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
  calendarMode: 'month', calendarDate: dateKey(), taskView: 'calendar', logArchive: false, db: null };

// ============ API 客户端 ============
async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) }
  });
  if (res.status === 401) { logout(); throw new Error('登录已过期，请重新登录'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

async function loadWorkspace() {
  const data = await api('/workspace');
  state.user = data.user;
  state.db = data.db;
  USERS.length = 0;
  USERS.push(...(state.db.members || []));
}

async function save(action, message) {
  try { await action(); await loadWorkspace(); close(); render(); notify(message); }
  catch (e) { notify(e.message, true); }
}

function logout() {
  localStorage.removeItem('pandora.token');
  state.token = null; state.user = null; state.db = null; state.route = 'dashboard';
  close(); render();
}

const user = () => state.user || USERS.find(u => u.id === 'lin') || USERS[0];
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const names = owners => owners.map(id => userById(id)?.name || id).join('、');
const stamp = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
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
function person(u) { return `<span class="person"><span class="avatar avatar--${u.color || 'blue'}">${esc(u.avatar || u.name?.slice(-1) || '?')}</span><span><b>${esc(u.name)}</b><small>${esc(u.roleName || u.role)}</small></span></span>`; }
function head(title, detail, action = '') { return `<section class="page-head"><div><span class="eyebrow">${dateKey()}</span><h1>${title}</h1><p class="lede">${detail}</p></div>${action}</section>`; }
function panel(title, content, action = '') { return `<section class="panel"><div class="panel-head"><h2>${title}</h2>${action}</div>${content}</section>`; }
const empty = text => `<div class="empty-state"><span class="empty-icon">✓</span><p>${text}</p></div>`;

// ============ 页面组件 ============
function taskCard(t) {
  return `<article class="task-card"><button class="task-open" data-action="task" data-id="${esc(t.id)}"><div class="task-card-top">${statusPill(t.status)}${priorityPill(t.priority)}</div><h3>${esc(t.title)}</h3><p>${esc(t.detail)}</p><div class="task-meta"><span>负责人 · ${esc(names(t.owners))}</span><span class="due ${isOverdue(t) ? 'due--late' : ''}">${isOverdue(t) ? '已逾期 · ' : '截止 · '}${dueText(t.dueAt)}</span></div></button></article>`;
}
function logCard(l) { return `<article class="log-card"><div class="log-card-top"><b>${esc(userById(l.author)?.name)}</b><span>${l.date}${l.date === dateKey() ? ' · 今天' : ''}</span></div><h3>${button(esc(l.title), 'log', l.id, 'log-title-button')}</h3><p class="log-content">${esc(l.content)}</p>${l.versions?.length ? `<small>保留 ${l.versions.length} 次修改记录</small>` : ''}</article>`; }

function loginPage() {
  return `<div class="login-page"><div class="login-card"><div class="brand login-brand"><span class="brand-mark">P</span><strong>潘多拉</strong></div><p class="login-sub">智能掌上工作系统</p><form data-form="login"><label>账号<input name="username" required autocomplete="username"></label><label>密码<input type="password" name="password" required autocomplete="current-password"></label><button class="primary-button login-button" type="submit">登 录</button></form><p class="login-hint">演示账号：admin / lin / manager / founder，密码与账号相同</p></div></div>`;
}

function dashboard() {
  const tasks = visibleTasks(state.db, user()), pinned = (state.db.pins?.[user().id] || []).map(id => tasks.find(t => t.id === id)).filter(Boolean);
  const logs = visibleLogs(state.db, user()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const announcements = (state.db.announcements || []).slice(0, 10);
  const tile = (title, action, content, count) => `<section class="dashboard-tile"><header><div><span>${count}</span><h2>${title}</h2></div><button class="tile-open" data-action="${action}" aria-label="打开${title}">→</button></header><div class="tile-content">${content}</div></section>`;
  const taskRows = (list, emptyText) => list.length ? list.map(t => `<button class="tile-row" data-action="task" data-id="${esc(t.id)}"><span class="tile-marker tile-marker--${t.priority}"></span><span class="tile-row-main"><b>${esc(t.title)}</b><small>${STATUS[t.status]} · ${dueText(t.dueAt)}</small></span></button>`).join('') : `<p class="tile-empty">${emptyText}</p>`;
  return `<section class="dashboard-page"><header class="dashboard-head"><div><span class="eyebrow">${dateKey()}</span><h1>你好，${esc(user().name)}</h1></div><button class="primary-button dashboard-log-action" data-action="new-log">＋ 写今日日志</button></header><div class="dashboard-grid">` +
    tile('公司 10 大重要展示项', 'company-highlights', announcements.map(a => `<button class="tile-row" data-action="company-highlights"><span class="tile-marker tile-marker--highlight"></span><span class="tile-row-main"><b>${esc(a.title)}</b><small>${esc(a.category)}</small></span></button>`).join('') || '<p class="tile-empty">暂无重要展示项</p>', String(announcements.length).padStart(2, '0')) +
    tile('公司 10 大派发任务', 'company-tasks', taskRows(tasks.slice(0, 10), '当前没有可见任务'), String(Math.min(tasks.length, 10)).padStart(2, '0')) +
    tile('个人 10 大重要展示项', 'personal-focus', taskRows(pinned.slice(0, 10), '在任务详情中关注重点工作'), String(Math.min(pinned.length, 10)).padStart(2, '0')) +
    tile('个人日志', 'personal-logs', logs.map(l => `<button class="tile-row" data-action="log" data-id="${esc(l.id)}"><span class="tile-marker tile-marker--log"></span><span class="tile-row-main"><b>${esc(l.title)}</b><small>${l.date}</small></span></button>`).join('') || '<p class="tile-empty">暂无日志</p>', String(logs.length).padStart(2, '0')) +
    `</div></section>`;
}

function taskListView() {
  const tasks = visibleTasks(state.db, user()), pinned = state.db.pins?.[user().id] || [];
  const filtered = tasks.filter(t => state.filter === 'focus' ? pinned.includes(t.id) : state.filter === 'all' || t.status === state.filter);
  return `<div class="filter-bar task-list-filters"><div class="segmented">${[['all', '全部'], ['focus', '个人重点'], ...Object.entries(STATUS)].map(([id, label]) => `<button class="segment ${state.filter === id ? 'is-active' : ''}" data-filter="${id}">${label}</button>`).join('')}</div><span class="filter-hint">${filtered.length} 项任务</span></div><section class="task-grid">${filtered.map(taskCard).join('') || empty('当前筛选没有任务')}</section>`;
}

function logsPage() {
  const logs = (state.logArchive ? visibleLogs(state.db, user()) : recentLogs(state.db, user())).sort((a, b) => b.date.localeCompare(a.date));
  return head('工作日志', '每天一篇综合记录；仅本人当天日志可编辑，修改前内容留档。', button('写／编辑今日日志', 'new-log', '', 'primary-button')) +
    `<div class="filter-bar"><div class="segmented"><button class="segment ${!state.logArchive ? 'is-active' : ''}" data-log-range="recent">近七天</button><button class="segment ${state.logArchive ? 'is-active' : ''}" data-log-range="archive">历史记录</button></div><span class="filter-hint">${logs.length} 篇 · ${state.logArchive ? '历史日志只读保留' : '今天及前六天'}</span></div>${logs.map(logCard).join('') || empty('当前范围没有日志')}`;
}

function calendarPage() {
  const tasks = visibleTasks(state.db, user());
  const canCreate = isManager(user()) ? button('＋ 新建任务', 'new-task', '', 'primary-button') : '';
  const viewSwitch = `<div class="segmented task-view-switch"><button class="segment ${state.taskView === 'calendar' ? 'is-active' : ''}" data-task-view="calendar">日历</button><button class="segment ${state.taskView === 'list' ? 'is-active' : ''}" data-task-view="list">任务列表</button></div>`;
  const controls = `<div class="view-toolbar">${viewSwitch}${state.taskView === 'calendar' ? `<div class="segmented">${[['month','月'],['week','周'],['day','日']].map(([m,label]) => `<button class="segment ${state.calendarMode === m ? 'is-active' : ''}" data-mode="${m}">${label}</button>`).join('')}</div><div class="calendar-controls">${button('‹','prev')}<strong>${state.calendarDate}</strong>${button('›','next')}${button('今天','today')}</div>` : ''}${canCreate}</div>`;
  if (state.taskView === 'list') return head('任务视图', '按状态管理任务；选择任务可查看详情、记录进展或申请变更。') + controls + taskListView();
  const days = calendarDays(state.calendarDate, state.calendarMode);
  return head('工作视图', '按截止日期浏览和管理任务。') + controls +
    `<section class="calendar-panel calendar-panel--${state.calendarMode}">${state.calendarMode === 'month' ? '<div class="calendar-week">'+['一','二','三','四','五','六','日'].map(v=>`<span>${v}</span>`).join('')+'</div>' : ''}<div class="calendar-grid">${days.map(day => {
      const ts = tasks.filter(t => t.dueAt.slice(0, 10) === day).sort((a,b) => a.dueAt.localeCompare(b.dueAt));
      const visible = state.calendarMode === 'month' ? ts.slice(0, 2) : ts;
      return `<article class="calendar-day ${day === dateKey() ? 'is-today' : ''} ${day.slice(0, 7) !== state.calendarDate.slice(0, 7) ? 'is-outside' : ''}"><div class="day-head"><button class="day-date" data-day="${day}" aria-label="查看 ${day} 日任务">${state.calendarMode === 'month' ? Number(day.slice(-2)) : day.slice(5)}${day === dateKey() ? '<small>今天</small>' : ''}</button>${ts.length ? `<span class="day-task-total">${ts.length}</span>` : ''}</div><div class="day-items">${visible.map(t => `<button class="day-task day-task--${t.priority}" data-action="task" data-id="${esc(t.id)}" title="${esc(t.title)}"><span>${t.dueAt.slice(11)}</span>${esc(t.title)}</button>`).join('')}${state.calendarMode === 'month' && ts.length > visible.length ? `<button class="day-more" data-day="${day}">还有 ${ts.length - visible.length} 项</button>` : ''}${!ts.length ? '<p class="calendar-empty">—</p>' : ''}</div></article>`;
    }).join('')}</div></section>`;
}

function highlightsDetail() {
  const items = (state.db.announcements || []).slice(0, 10);
  open('公司 10 大重要展示项', items.map(a => `<article class="announcement"><span class="announcement-tag">${esc(a.category)}</span><h3>${esc(a.title)}</h3><p>${esc(a.content)}</p></article>`).join('') || '<p class="detail-copy">暂无重要展示项</p>');
}

const kindLabel = k => ({ create: '创建', edit: '编辑', delete: '删除' }[k]);
function requestCard(r) {
  return `<article class="log-card"><div class="log-card-top"><b>${kindLabel(r.kind)}申请</b><span>${({pending:'待审核',approved:'已通过',rejected:'已驳回'})[r.status]}</span></div><h3>${esc(r.after?.title || r.before?.title)}</h3><p>申请人 · ${esc(userById(r.proposer)?.name)}<br>${stamp(r.createdAt)}</p>${r.reason ? `<p>审核备注：${esc(r.reason)}</p>` : ''}${button('查看申请', 'request', r.id, 'soft-button')}</article>`;
}

function minePage() {
  return head('我的', '潘多拉智能掌上工作系统') +
    panel('当前身份', `${person(user())}<p class="panel-note">${esc(user().department || '')}</p>${button('退出登录','logout','','primary-button')}`) +
    panel('使用说明', `<p class="panel-note">本系统连接公司服务器，数据实时同步。任务创建、编辑、删除需提交审核；任务完成和进展记录直接生效。每日日志仅当天可编辑，历史版本长期保留。</p>`);
}

// ============ 路由渲染 ============
function render() {
  if (!state.token || !state.user) {
    root.innerHTML = loginPage();
    return;
  }
  const nav = [['dashboard','首页','⌂'],['logs','日志','✎'],['calendar','视图','▦'],['mine','我的','◯']];
  const pages = { dashboard, logs: logsPage, calendar: calendarPage, mine: minePage };
  root.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">P</span><strong>潘多拉</strong></div><nav class="nav" aria-label="主导航">${nav.map(([route,label,icon]) => `<button class="nav-item ${state.route === route ? 'is-active' : ''}" data-route="${route}"><span class="nav-glyph">${icon}</span><span>${label}</span></button>`).join('')}</nav></aside><main class="main-content"><header class="topbar"><div class="mobile-brand"><span class="brand-mark">P</span><b>潘多拉</b></div><span class="version-label">在线版</span><button class="user-menu" data-action="logout">${person(user())}<span>⌄</span></button></header><div class="page-wrap">${pages[state.route]()}</div></main></div>`;
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
  if (!isManager(user())) return notify('只有负责人可以提交任务变更', true);
  const t = id ? state.db.tasks.find(t => t.id === id) : null;
  open(t ? '申请编辑任务' : '创建任务申请', `<form class="modal-form" data-form="task" data-id="${esc(id)}"><label>任务名称<input name="title" value="${esc(t?.title || '')}" maxlength="80" required></label><fieldset class="assignee-field"><legend>负责人（可多选）</legend>${(state.db.allowedAssignees || []).map(u => `<label class="check-option"><input type="checkbox" name="owners" value="${esc(u.id)}" ${t?.owners.includes(u.id) ? 'checked' : ''}>${esc(u.name)} · ${esc(u.roleName || u.role)}</label>`).join('')}</fieldset><label>截止时间<input type="datetime-local" name="dueAt" value="${t?.dueAt || `${dayOffset(1)}T18:30`}" step="60" required></label><label>优先级<select name="priority">${Object.entries(PRIORITY).map(([id,label]) => `<option value="${id}" ${t?.priority === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>任务说明<textarea name="detail" maxlength="2000" rows="4">${esc(t?.detail || '')}</textarea></label><p class="panel-note">提交后由另一位管理员或创始人审核，通过后生效。</p><div class="modal-actions"><button class="primary-button" type="submit">提交审核</button></div></form>`);
}

function logForm(id = '') {
  const l = id ? state.db.logs.find(v => v.id === id) : state.db.logs.find(v => v.author === user().id && v.date === dateKey());
  if (l && !canEditLog(user(), l)) return notify('只能编辑本人当天日志', true);
  open(l ? '编辑今日日志' : '写今日日志', `<form class="modal-form" data-form="log" data-id="${esc(l?.id || '')}"><p class="panel-note">${dateKey()} · 每天一篇，不必逐项填写任务日志</p><label>今天的工作<textarea name="content" maxlength="3000" rows="8" placeholder="完成了什么？遇到什么问题？下一步准备做什么？" required>${esc(l?.content || '')}</textarea></label><details><summary>可选：标题与关联任务</summary><label>标题<input name="title" value="${esc(l?.title || '')}" maxlength="80" placeholder="不填则自动使用日期"></label><label>关联任务<select name="taskId"><option value="">不关联任务</option>${visibleTasks(state.db,user()).map(t => `<option value="${esc(t.id)}" ${l?.taskId === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></label></details><div class="modal-actions"><button class="primary-button" type="submit">保存日志</button></div></form>`);
}

function logDetail(id) {
  const l = visibleLogs(state.db,user()).find(v => v.id === id);
  if (!l) return notify('无权查看日志',true);
  open(l.title, `<p class="detail-copy">${esc(userById(l.author)?.name)} · ${l.date}</p><p class="detail-copy log-content">${esc(l.content)}</p><div class="detail-actions">${canEditLog(user(),l) ? button('编辑今日日志','edit-log',id,'primary-button') : '<span class="done-message">历史或他人日志只读</span>'}</div><div class="detail-history"><h3>修改记录（${l.versions?.length || 0}）</h3>${[...(l.versions || [])].reverse().map((v,i) => `<details class="version-item"><summary>历史版本 ${(l.versions?.length || 0)-i} · ${stamp(v.at)}</summary><b>${esc(v.title)}</b><p class="log-content">${esc(v.content)}</p></details>`).join('') || '<p class="panel-note">尚无修改记录</p>'}</div>`);
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
  if (name === 'new-log' || name === 'edit-log') return logForm(id);
  if (name === 'log') return logDetail(id);
  if (name === 'request') return requestDetail(id);
  if (name === 'company-highlights') return highlightsDetail();
  if (name === 'company-tasks' || name === 'personal-focus') { state.route='calendar'; state.taskView='list'; state.filter=name === 'personal-focus' ? 'focus' : 'all'; close(); render(); return; }
  if (name === 'personal-logs') { state.route='logs'; close(); render(); return; }
  if (name === 'logout') return logout();
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
document.addEventListener('click', e => {
  const el = e.target.closest('button'); if (!el) return;
  if (el.hasAttribute('data-close')) return close();
  if (el.dataset.route) { state.route=el.dataset.route; render(); window.scrollTo(0,0); return; }
  if (el.dataset.filter) { state.filter=el.dataset.filter; render(); return; }
  if (el.dataset.mode) { state.calendarMode=el.dataset.mode; render(); return; }
  if (el.dataset.taskView) { state.taskView=el.dataset.taskView; render(); return; }
  if (el.dataset.day) { state.calendarDate=el.dataset.day; state.calendarMode='day'; render(); return; }
  if (el.dataset.logRange) { state.logArchive=el.dataset.logRange === 'archive'; render(); return; }
  if (el.dataset.action) action(el.dataset.action,el.dataset.id);
});

document.addEventListener('submit', async e => {
  e.preventDefault(); const form=e.target, fd=new FormData(form), v=Object.fromEntries(fd.entries()), id=form.dataset.id;
  if (form.dataset.form === 'login') {
    try {
      const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: v.username, password: v.password }) });
      state.token = r.token; localStorage.setItem('pandora.token', r.token);
      await loadWorkspace(); close(); render(); notify(`欢迎，${state.user.name}`);
    } catch (err) { notify(err.message, true); }
    return;
  }
  if (!state.token) return notify('请先登录', true);
  if (form.dataset.form === 'task') { v.owners=fd.getAll('owners'); await save(async () => { await api('/tasks/requests', { method: 'POST', body: JSON.stringify({ kind: id ? 'edit' : 'create', taskId: id || undefined, values: v }) }); },'任务变更已提交审核'); }
  if (form.dataset.form === 'note') await save(async () => { await api(`/tasks/${id}/progress`, { method: 'POST', body: JSON.stringify({ text: v.note }) }); },'工作进展已保存');
  if (form.dataset.form === 'log') await save(async () => { await api('/logs', { method: 'POST', body: JSON.stringify({ logId: id || undefined, values: v }) }); },'今日日志已保存，历史版本已保留');
  if (form.dataset.form === 'review') await save(async () => { await api(`/tasks/requests/${id}/review`, { method: 'POST', body: JSON.stringify({ approve: e.submitter.value === 'approve', reason: v.reason }) }); },'审核结果已保存');
});

window.pandoraBack = () => { if (modal.open) { close(); return true; } if (state.route !== 'dashboard') { state.route='dashboard'; render(); return true; } return false; };
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.token) loadWorkspace().then(render); });

// 启动：有 token 则自动加载工作区
if (state.token) loadWorkspace().then(render).catch(() => render());
else render();

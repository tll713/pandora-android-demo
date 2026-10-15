import {
  USERS, STATUS, PRIORITY, STORAGE_KEY, dateKey, dayOffset, minuteKey, userById, isManager,
  visibleTasks, visibleLogs, recentLogs, canSeeTask, canManageTask, canWorkOnTask, canEditLog,
  createTask, requestTaskChange, reviewTaskChange, visibleRequests, canReviewRequest,
  updateTaskDetail, completeTask, saveLog, createDemoAccount, togglePin, allowedAssignees,
  seedDatabase, validateDatabase, hydrateUsers, calendarDays, shiftCalendar, isOverdue
} from './domain.js';

const root = document.querySelector('#app'), modal = document.querySelector('#modal'), toast = document.querySelector('#toast');
const state = { userId: localStorage.getItem('pandora.user') || 'lin', route: 'dashboard', filter: 'all',
  calendarMode: 'month', calendarDate: dateKey(), logArchive: false, db: loadDb() };
hydrateUsers(state.db);
function loadDb() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return seedDatabase();
  const db = JSON.parse(stored);
  if (!validateDatabase(db)) throw new Error('本地记录无法读取，请保留数据并联系维护人员。');
  return db;
}
const user = () => userById(state.userId) || userById('lin');
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
function save(action, message) {
  const before = structuredClone(state.db);
  const memberCount = USERS.length;
  try { action(); localStorage.setItem(STORAGE_KEY, JSON.stringify(state.db)); close(); render(); notify(message); }
  catch (e) { state.db = before; USERS.splice(memberCount); notify(e.message, true); }
}
function open(title, body) {
  modal.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" aria-label="关闭" data-close>×</button></div>${body}`;
  if (!modal.open) modal.showModal();
}
function close() { modal.close(); modal.innerHTML = ''; }
function person(u) { return `<span class="person"><span class="avatar avatar--${u.color}">${esc(u.avatar)}</span><span><b>${esc(u.name)}</b><small>${esc(u.role)}</small></span></span>`; }
function head(title, detail, action = '') { return `<section class="page-head"><div><span class="eyebrow">${dateKey()}</span><h1>${title}</h1><p class="lede">${detail}</p></div>${action}</section>`; }
function panel(title, content, action = '') { return `<section class="panel"><div class="panel-head"><h2>${title}</h2>${action}</div>${content}</section>`; }
const empty = text => `<div class="empty-state"><span class="empty-icon">✓</span><p>${text}</p></div>`;
function taskCard(t) {
  return `<article class="task-card"><button class="task-open" data-action="task" data-id="${esc(t.id)}"><div class="task-card-top">${statusPill(t.status)}${priorityPill(t.priority)}</div><h3>${esc(t.title)}</h3><p>${esc(t.detail)}</p><div class="task-meta"><span>负责人 · ${esc(names(t.owners))}</span><span class="due ${isOverdue(t) ? 'due--late' : ''}">${isOverdue(t) ? '已逾期 · ' : '截止 · '}${dueText(t.dueAt)}</span></div></button></article>`;
}
function logCard(l) { return `<article class="log-card"><div class="log-card-top"><b>${esc(userById(l.author)?.name)}</b><span>${l.date}${l.date === dateKey() ? ' · 今天' : ''}</span></div><h3>${button(esc(l.title), 'log', l.id, 'log-title-button')}</h3><p class="log-content">${esc(l.content)}</p>${l.versions.length ? `<small>保留 ${l.versions.length} 次修改记录</small>` : ''}</article>`; }
function dashboard() {
  const tasks = visibleTasks(state.db, user()), pinned = (state.db.pins[user().id] || []).map(id => tasks.find(t => t.id === id)).filter(Boolean);
  const daily = state.db.logs.find(l => l.author === user().id && l.date === dateKey());
  return head(`你好，${esc(user().name)}`, '先处理重要的事，再把今天的工作记下来。', button(daily ? '编辑今日日志' : '＋ 写今日日志', 'new-log', '', 'primary-button')) +
    `<section class="metric-grid"><div class="metric-card metric-card--green"><span class="metric-label">我的未完成</span><strong>${tasks.filter(t => t.owners.includes(user().id) && t.status !== 'done').length}</strong></div><div class="metric-card"><span class="metric-label">今日截止</span><strong>${tasks.filter(t => t.dueAt.slice(0, 10) === dateKey() && t.status !== 'done').length}</strong></div></section>` +
    panel('个人重要任务', pinned.length ? pinned.map(taskCard).join('') : empty('在任务详情中关注重点工作'), button('全部任务 →', 'route-tasks', '', 'text-button')) +
    panel('公司派发任务', tasks.slice(0, 10).map(taskCard).join('') || empty('当前没有可见任务')) +
    panel('公司重要事项', state.db.announcements.slice(0, 10).map(a => `<article class="announcement"><span class="announcement-tag">${esc(a.category)}</span><h3>${esc(a.title)}</h3><p>${esc(a.content)}</p></article>`).join('')) +
    panel('今日日志', daily ? logCard(daily) : empty('今天还没有记录工作日志'));
}
function tasksPage() {
  const tasks = visibleTasks(state.db, user()), filtered = tasks.filter(t => state.filter === 'all' || t.status === state.filter);
  return head('任务', '多人共同负责，进展直接记在任务详情里。') + `<div class="filter-bar"><div class="segmented">${[['all', '全部'], ...Object.entries(STATUS)].map(([id, label]) => `<button class="segment ${state.filter === id ? 'is-active' : ''}" data-filter="${id}">${label}</button>`).join('')}</div></div><section class="task-grid">${filtered.map(taskCard).join('') || empty('当前筛选没有任务')}</section>`;
}
function logsPage() {
  const logs = (state.logArchive ? visibleLogs(state.db, user()) : recentLogs(state.db, user())).sort((a, b) => b.date.localeCompare(a.date));
  return head('工作日志', '每天一篇综合记录；仅本人当天日志可编辑，修改前内容留档。', button('写／编辑今日日志', 'new-log', '', 'primary-button')) +
    `<div class="filter-bar"><div class="segmented"><button class="segment ${!state.logArchive ? 'is-active' : ''}" data-log-range="recent">近七天</button><button class="segment ${state.logArchive ? 'is-active' : ''}" data-log-range="archive">历史记录</button></div><span class="filter-hint">${logs.length} 篇 · ${state.logArchive ? '历史日志只读保留' : '今天及前六天'}</span></div>${logs.map(logCard).join('') || empty('当前范围没有日志')}`;
}
function calendarPage() {
  const days = calendarDays(state.calendarDate, state.calendarMode), tasks = visibleTasks(state.db, user()), logs = visibleLogs(state.db, user());
  return head('工作视图', '任务按截止时间展示，日志按记录日期展示。') +
    `<div class="filter-bar"><div class="segmented">${[['month','月'],['week','周'],['day','日']].map(([m,label]) => `<button class="segment ${state.calendarMode === m ? 'is-active' : ''}" data-mode="${m}">${label}视图</button>`).join('')}</div><div class="calendar-controls">${button('←','prev')}<strong>${state.calendarDate}</strong>${button('→','next')}${button('今天','today')}</div></div>` +
    `<section class="calendar-panel calendar-panel--${state.calendarMode}">${state.calendarMode === 'month' ? '<div class="calendar-week">'+['一','二','三','四','五','六','日'].map(v=>`<span>${v}</span>`).join('')+'</div>' : ''}<div class="calendar-grid">${days.map(day => {
      const ts = tasks.filter(t => t.dueAt.slice(0, 10) === day), ls = logs.filter(l => l.date === day);
      return `<article class="calendar-day ${day === dateKey() ? 'is-today' : ''} ${day.slice(0, 7) !== state.calendarDate.slice(0, 7) ? 'is-outside' : ''}"><div class="day-head"><button class="day-date" data-day="${day}" aria-label="查看 ${day} 日视图">${state.calendarMode === 'month' ? Number(day.slice(-2)) : day.slice(5)}${day === dateKey() ? ' 今天' : ''}</button></div><div class="day-items">${state.calendarMode === 'month' ? `<button class="day-count" data-day="${day}">${ts.length ? `<span>${ts.length} 任务</span>` : ''}${ls.length ? `<span>${ls.length} 日志</span>` : ''}</button>` : ts.map(t => `<button class="day-task day-task--${t.priority}" data-action="task" data-id="${esc(t.id)}">${t.dueAt.slice(11)} · ${esc(t.title)} · ${STATUS[t.status]}</button>`).join('') + ls.map(l => `<button class="day-log" data-action="log" data-id="${esc(l.id)}">${esc(userById(l.author)?.name)} · ${esc(l.title)}</button>`).join('') + (!ts.length && !ls.length ? '<p class="calendar-empty">暂无记录</p>' : '')}</div></article>`;
    }).join('')}</div></section>`;
}
const kindLabel = k => ({ create: '创建', edit: '编辑', delete: '删除' }[k]);
function requestCard(r) {
  return `<article class="log-card"><div class="log-card-top"><b>${kindLabel(r.kind)}申请</b><span>${({pending:'待审核',approved:'已通过',rejected:'已驳回'})[r.status]}</span></div><h3>${esc(r.after?.title || r.before?.title)}</h3><p>申请人 · ${esc(userById(r.proposer)?.name)}<br>${stamp(r.createdAt)}</p>${r.reason ? `<p>审核备注：${esc(r.reason)}</p>` : ''}${button('查看申请', 'request', r.id, 'soft-button')}</article>`;
}
function consolePage() {
  const requests = visibleRequests(state.db, user());
  return head('后台流程演示', '此入口模拟 Web 管理端，便于在同一部手机演示。', isManager(user()) ? button('＋ 创建任务申请','new-task','','primary-button') : '') +
    panel('任务变更审核', requests.map(requestCard).join('') || empty('尚无变更申请')) +
    panel('任务管理', visibleTasks(state.db, user()).map(taskCard).join('')) +
    (user().role === '管理员' ? panel('账号管理', `<p class="panel-note">新建账号仅用于本地演示身份，不设置真实登录密码。</p>${button('创建演示账号','new-account','','primary-button')}`) : '');
}
function minePage() {
  return head('我的', '安卓离线演示版 · 0.2.0') + panel('当前身份', `${person(user())}<p class="panel-note">${esc(user().department)}</p>${button('切换演示身份','switch','','primary-button')}`) +
    panel('演示工具', `${button('查看演示步骤','guide','','soft-button')}${button('进入后台流程演示','console','','soft-button')}${button('刷新本地记录','refresh','','soft-button')}`) +
    panel('版本说明', '<p class="panel-note">记录保存在本机，重启 App 后保留。卸载或清除应用数据会删除记录。本版不连接服务器，不提供电脑与手机同步。AI 功能留待后续范围确认。</p>');
}
function render() {
  const nav = [['dashboard','首页','⌂'],['tasks','任务','☷'],['logs','日志','✎'],['calendar','视图','▦'],['mine','我的','◯']];
  const pages = { dashboard, tasks: tasksPage, logs: logsPage, calendar: calendarPage, mine: minePage, console: consolePage };
  root.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">P</span><strong>潘多拉</strong></div><nav class="nav" aria-label="主导航">${nav.map(([route,label,icon]) => `<button class="nav-item ${state.route === route ? 'is-active' : ''}" data-route="${route}"><span class="nav-glyph">${icon}</span><span>${label}</span></button>`).join('')}</nav></aside><main class="main-content"><header class="topbar"><div class="mobile-brand"><span class="brand-mark">P</span><b>潘多拉</b></div><span class="version-label">离线演示</span><button class="user-menu" data-action="switch">${person(user())}<span>⌄</span></button></header><div class="page-wrap">${pages[state.route]()}</div></main></div>`;
}
function taskDetail(id) {
  const t = visibleTasks(state.db, user()).find(t => t.id === id);
  if (!t) return notify('没有查看这项任务的权限', true);
  const pending = state.db.requests.some(r => r.taskId === id && r.status === 'pending');
  open(t.title, `<div class="detail-status">${statusPill(t.status)}${priorityPill(t.priority)}</div><p class="detail-copy log-content">${esc(t.detail)}</p><div class="detail-owner"><b>负责人 · ${esc(names(t.owners))}</b><small>截止 · ${dueText(t.dueAt)}</small><small>创建 · ${stamp(t.createdAt)}（精确到分钟）</small></div>` +
    (canWorkOnTask(user(), t) && t.status !== 'done' ? `<form class="modal-form" data-form="note" data-id="${esc(id)}"><label>记录进展<textarea name="note" maxlength="1000" rows="3" placeholder="今天完成了什么，还有什么待处理？" required></textarea></label><button class="soft-button" type="submit">保存进展</button></form>` : '') +
    `<div class="detail-actions">${button((state.db.pins[user().id] || []).includes(id) ? '取消重点' : '关注为重点','pin',id)}${canWorkOnTask(user(),t) && t.status !== 'done' ? button('标记完成','complete',id,'primary-button') : ''}${canManageTask(user(),t) && !pending ? button('申请编辑','edit-task',id) + button('申请删除','delete-task',id) : ''}${pending ? '<span class="done-message">有变更等待审核，当前内容仍有效</span>' : ''}</div>` +
    `<div class="detail-history"><div class="section-label">执行与审核记录</div>${[...t.history].reverse().map(h => `<div class="history-item"><span></span><p class="log-content">${esc(h.text)}<small>${esc(userById(h.actor)?.name)} · ${stamp(h.at)}</small></p></div>`).join('')}</div>`);
}
function taskForm(id = '') {
  if (!isManager(user())) return notify('请用负责人身份进入后台演示', true);
  const t = id ? state.db.tasks.find(t => t.id === id) : null;
  open(t ? '申请编辑任务' : '创建任务申请', `<form class="modal-form" data-form="task" data-id="${esc(id)}"><label>任务名称<input name="title" value="${esc(t?.title || '')}" maxlength="80" required></label><fieldset class="assignee-field"><legend>负责人（可多选）</legend>${allowedAssignees(user()).map(u => `<label class="check-option"><input type="checkbox" name="owners" value="${esc(u.id)}" ${t?.owners.includes(u.id) ? 'checked' : ''}>${esc(u.name)} · ${esc(u.role)}</label>`).join('')}</fieldset><label>截止时间<input type="datetime-local" name="dueAt" value="${t?.dueAt || `${dayOffset(1)}T18:30`}" step="60" required></label><label>优先级<select name="priority">${Object.entries(PRIORITY).map(([id,label]) => `<option value="${id}" ${t?.priority === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>任务说明<textarea name="detail" maxlength="2000" rows="4">${esc(t?.detail || '')}</textarea></label><p class="panel-note">提交后由另一位管理员或创始人审核，通过后生效。</p><div class="modal-actions"><button class="primary-button" type="submit">提交审核</button></div></form>`);
}
function logForm(id = '') {
  const l = id ? state.db.logs.find(v => v.id === id) : state.db.logs.find(v => v.author === user().id && v.date === dateKey());
  if (l && !canEditLog(user(), l)) return notify('只能编辑本人当天日志', true);
  open(l ? '编辑今日日志' : '写今日日志', `<form class="modal-form" data-form="log" data-id="${esc(l?.id || '')}"><p class="panel-note">${dateKey()} · 每天一篇，不必逐项填写任务日志</p><label>今天的工作<textarea name="content" maxlength="3000" rows="8" placeholder="完成了什么？遇到什么问题？下一步准备做什么？" required>${esc(l?.content || '')}</textarea></label><details><summary>可选：标题与关联任务</summary><label>标题<input name="title" value="${esc(l?.title || '')}" maxlength="80" placeholder="不填则自动使用日期"></label><label>关联任务<select name="taskId"><option value="">不关联任务</option>${visibleTasks(state.db,user()).map(t => `<option value="${esc(t.id)}" ${l?.taskId === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></label></details><div class="modal-actions"><button class="primary-button" type="submit">保存日志</button></div></form>`);
}
function logDetail(id) {
  const l = visibleLogs(state.db,user()).find(v => v.id === id);
  if (!l) return notify('无权查看日志',true);
  open(l.title, `<p class="detail-copy">${esc(userById(l.author)?.name)} · ${l.date}</p><p class="detail-copy log-content">${esc(l.content)}</p><div class="detail-actions">${canEditLog(user(),l) ? button('编辑今日日志','edit-log',id,'primary-button') : '<span class="done-message">历史或他人日志只读</span>'}</div><div class="detail-history"><h3>修改记录（${l.versions.length}）</h3>${[...l.versions].reverse().map((v,i) => `<details class="version-item"><summary>历史版本 ${l.versions.length-i} · ${stamp(v.at)}</summary><b>${esc(v.title)}</b><p class="log-content">${esc(v.content)}</p></details>`).join('') || '<p class="panel-note">尚无修改记录</p>'}</div>`);
}
function requestDetail(id) {
  const r = visibleRequests(state.db,user()).find(v => v.id === id);
  if (!r) return notify('无权查看申请',true);
  const view = v => v ? `<h3>${esc(v.title)}</h3><p>负责人 · ${esc(names(v.owners))}<br>截止 · ${dueText(v.dueAt)}<br>${PRIORITY[v.priority]}</p><p class="log-content">${esc(v.detail)}</p>` : '<p>无</p>';
  open(`${kindLabel(r.kind)}任务申请`, `<div class="request-content">${r.before ? '<h4>原内容</h4>'+view(r.before) : ''}<h4>${r.kind === 'delete' ? '变更结果' : '申请内容'}</h4>${r.kind === 'delete' ? '<p>审核通过后归档删除，历史记录仍保留。</p>' : view(r.after)}<p class="panel-note">申请人：${esc(userById(r.proposer)?.name)} · ${stamp(r.createdAt)}</p>${r.reason ? `<p>审核备注：${esc(r.reason)}</p>` : ''}</div>${canReviewRequest(user(),r) ? `<form class="modal-form" data-form="review" data-id="${esc(id)}"><label>审核备注（驳回必填）<textarea name="reason" maxlength="500" rows="3"></textarea></label><div class="modal-actions"><button class="ghost-button" name="decision" value="reject" type="submit">驳回</button><button class="primary-button" name="decision" value="approve" type="submit">审核通过</button></div></form>` : '<p class="detail-copy">申请人不能自审；待审核内容需另一位管理员或创始人处理。</p>'}`);
}
function switcher() { open('切换演示身份', `<div class="user-switch-list">${USERS.map(u => `<button class="user-switch" data-user="${esc(u.id)}">${person(u)}<span>${u.id === user().id ? '当前' : '切换'}</span></button>`).join('')}</div>`); }
function accountForm() { open('创建演示账号', `<form class="modal-form" data-form="account"><label>姓名<input name="name" maxlength="30" required></label><label>账号<input name="login" minlength="3" maxlength="30" required></label><label>部门<input name="department" value="产品设计部" maxlength="40" required></label><label>角色<select name="role"><option>员工</option><option>团队长</option><option>部门负责人</option></select></label><div class="modal-actions"><button class="primary-button">创建</button></div></form>`); }
function guide() { open('三分钟演示步骤', `<div class="demo-guide"><ol><li>在“我的”切换为沈知夏，进入后台流程演示。创建任务申请，勾选林予安和周一鸣，填写精确到分钟的截止时间。</li><li>切换为许文清或系统管理员，在后台查看申请并审核通过。</li><li>切换为林予安，打开任务，保存一条文字进展，再标记完成。任务立即完成，无需再次审核。</li><li>在日志页写当天综合日志，保存后再次修改，打开日志查看旧版本。</li><li>切换为沈知夏申请编辑或删除任务，确认审核前任务未改变；切换审核人通过后检查结果。</li><li>切换月／周／日视图，关闭再打开 App，确认记录保留。</li></ol><p>后台入口是离线模拟。多人任务暂按任一负责人可标记整项完成；历史日志长期保留，默认显示近七天。具体审批层级和原报告的版式需进一步确认。</p></div>`); }
function action(name,id) {
  if (name === 'task') return taskDetail(id);
  if (name === 'new-task' || name === 'edit-task') return taskForm(id);
  if (name === 'new-log' || name === 'edit-log') return logForm(id);
  if (name === 'log') return logDetail(id);
  if (name === 'request') return requestDetail(id);
  if (name === 'switch') return switcher();
  if (name === 'new-account') return accountForm();
  if (name === 'guide') return guide();
  if (name === 'console' || name === 'route-tasks') { state.route = name === 'console' ? 'console' : 'tasks'; render(); window.scrollTo(0,0); return; }
  if (name === 'pin') return save(() => togglePin(state.db,user(),id),'个人重点已更新');
  if (name === 'complete') return open('确认完成任务', `<p class="detail-copy">此操作会将整项任务标记完成，其他负责人也会看到已完成状态，无需审核。</p><div class="detail-actions confirm-actions">${button('确认完成','confirm-complete',id,'primary-button')}${button('返回任务','task',id)}</div>`);
  if (name === 'confirm-complete') return save(() => completeTask(state.db,user(),id),'任务已完成，无需审核');
  if (name === 'delete-task') return open('申请删除任务', `<p class="detail-copy">审核通过前任务继续有效。通过后任务归档，操作记录保留。</p><div class="detail-actions confirm-actions">${button('提交删除申请','confirm-delete',id,'primary-button')}${button('返回任务','task',id)}</div>`);
  if (name === 'confirm-delete') return save(() => requestTaskChange(state.db,user(),'delete',{},id),'删除申请已提交');
  if (name === 'refresh') { try { state.db=loadDb(); hydrateUsers(state.db); render(); notify('已读取本地记录'); } catch(e) { notify(e.message,true); } return; }
  if (name === 'prev' || name === 'next') state.calendarDate = shiftCalendar(state.calendarDate,state.calendarMode,name === 'prev' ? -1 : 1);
  if (name === 'today') state.calendarDate = dateKey();
  render();
}
document.addEventListener('click', e => {
  const el = e.target.closest('button'); if (!el) return;
  if (el.hasAttribute('data-close')) return close();
  if (el.dataset.user) { state.userId=el.dataset.user; localStorage.setItem('pandora.user',state.userId); state.route='dashboard'; close(); render(); notify(`已切换为${user().name}`); return; }
  if (el.dataset.route) { state.route=el.dataset.route; render(); window.scrollTo(0,0); return; }
  if (el.dataset.filter) { state.filter=el.dataset.filter; render(); return; }
  if (el.dataset.mode) { state.calendarMode=el.dataset.mode; render(); return; }
  if (el.dataset.day) { state.calendarDate=el.dataset.day; state.calendarMode='day'; render(); return; }
  if (el.dataset.logRange) { state.logArchive=el.dataset.logRange === 'archive'; render(); return; }
  if (el.dataset.action) action(el.dataset.action,el.dataset.id);
});
modal.addEventListener('submit', e => {
  e.preventDefault(); const form=e.target, fd=new FormData(form), v=Object.fromEntries(fd.entries()), id=form.dataset.id;
  if (form.dataset.form === 'task') { v.owners=fd.getAll('owners'); save(() => id ? requestTaskChange(state.db,user(),'edit',v,id) : createTask(state.db,user(),v),'任务变更已提交审核'); }
  if (form.dataset.form === 'note') save(() => updateTaskDetail(state.db,user(),id,v.note),'工作进展已保存');
  if (form.dataset.form === 'log') save(() => saveLog(state.db,user(),v,id || null),'今日日志已保存，历史版本已保留');
  if (form.dataset.form === 'account') save(() => createDemoAccount(state.db,user(),v),'演示账号已创建');
  if (form.dataset.form === 'review') save(() => reviewTaskChange(state.db,user(),id,e.submitter.value === 'approve',v.reason),'审核结果已保存');
});
window.pandoraBack = () => { if (modal.open) { close(); return true; } if (state.route !== 'dashboard') { state.route='dashboard'; render(); return true; } return false; };
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
render();

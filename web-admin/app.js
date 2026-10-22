/**
 * 潘多拉智能掌上工作系统 · Web 管理端
 * 原生 JS，无构建依赖
 */

(function () {
  'use strict';

  var API_BASE = '';
  var TOKEN_KEY = 'pandora.admin.token';

  /* ================= 映射 ================= */
  var ROLE_MAP = {
    ADMIN: '管理员',
    FOUNDER: '创始人',
    DEPT_MANAGER: '部门负责人',
    TEAM_LEAD: '团队长',
    EMPLOYEE: '员工'
  };
  var STATUS_MAP = { todo: '待开始', doing: '进行中', done: '已完成' };
  var PRIORITY_MAP = { high: '高', medium: '中', low: '低' };
  var KIND_MAP = { create: '创建', edit: '编辑', delete: '删除' };

  /* ================= 工具 ================= */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function toast(msg, type) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast ' + (type || 'info');
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.classList.add('hidden');
    }, 2800);
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }
  function setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }

  /* ================= API ================= */
  function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    var token = getToken();
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(API_BASE + path, opts).then(function (res) {
      if (res.status === 401) {
        logout(false);
        throw new Error('登录已过期，请重新登录');
      }
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error(t || ('HTTP ' + res.status));
        });
      }
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('application/json') > -1) return res.json();
      return res.text();
    });
  }

  /* ================= 页面切换 ================= */
  var pageMap = {
    dashboard: 'page-dashboard',
    users: 'page-users',
    announcements: 'page-announcements',
    tasks: 'page-tasks',
    logs: 'page-logs'
  };

  function switchPage(page) {
    Object.keys(pageMap).forEach(function (k) {
      $(pageMap[k]).classList.toggle('hidden', k !== page);
    });
    document.querySelectorAll('.nav-item[data-page]').forEach(function (n) {
      n.classList.toggle('active', n.getAttribute('data-page') === page);
    });
    loadPageData(page);
  }

  function loadPageData(page) {
    if (page === 'dashboard') loadDashboard();
    else if (page === 'users') loadUsers();
    else if (page === 'announcements') loadAnnouncements();
    else if (page === 'tasks') loadTasks();
    else if (page === 'logs') loadLogs();
  }

  /* ================= 登录 / 退出 ================= */
  function showLogin() {
    $('login-view').classList.remove('hidden');
    $('app-view').classList.add('hidden');
  }
  function showApp() {
    $('login-view').classList.add('hidden');
    $('app-view').classList.remove('hidden');
    switchPage('dashboard');
  }

  function logout(redirect) {
    setToken('');
    if (redirect !== false) {
      toast('已退出登录', 'info');
    }
    showLogin();
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('login-btn');
    btn.disabled = true;
    btn.textContent = '登录中...';
    $('login-error').classList.add('hidden');

    api('/api/auth/login', {
      method: 'POST',
      body: {
        username: $('login-username').value.trim(),
        password: $('login-password').value
      }
    }).then(function (res) {
      setToken(res.token);
      var u = res.user || {};
      $('current-user').textContent = (u.name || u.login || '用户') + ' · ' + (ROLE_MAP[u.role] || u.roleName || '');
      showApp();
      toast('登录成功', 'success');
    }).catch(function (err) {
      var el = $('login-error');
      el.textContent = err.message || '登录失败，请检查账号密码';
      el.classList.remove('hidden');
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = '登 录';
    });
  });

  $('logout-btn').addEventListener('click', function () {
    logout(true);
  });

  /* ================= 数据概览 ================= */
  function loadDashboard() {
    api('/api/admin/stats').then(function (s) {
      var items = [
        { label: '总任务数', value: s.totalTasks },
        { label: '已完成', value: s.doneTasks },
        { label: '待审核', value: s.pendingRequests },
        { label: '总日志', value: s.totalLogs },
        { label: '总用户', value: s.totalUsers }
      ];
      $('stats-grid').innerHTML = items.map(function (it) {
        return '<div class="stat-card">' +
          '<div class="stat-label">' + it.label + '</div>' +
          '<div class="stat-value">' + (it.value !== undefined && it.value !== null ? it.value : 0) + '</div>' +
          '</div>';
      }).join('');
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  /* ================= 组织与权限 ================= */
  function roleTag(role) {
    var cls = 'tag-gray';
    if (role === 'ADMIN' || role === 'FOUNDER') cls = 'tag-red';
    else if (role === 'DEPT_MANAGER') cls = 'tag-purple';
    else if (role === 'TEAM_LEAD') cls = 'tag-blue';
    else if (role === 'EMPLOYEE') cls = 'tag-green';
    return '<span class="tag ' + cls + '">' + (ROLE_MAP[role] || esc(role)) + '</span>';
  }

  function loadUsers() {
    api('/api/admin/users').then(function (list) {
      list = list || [];
      $('users-count').textContent = '共 ' + list.length + ' 人';
      var tbody = $('users-tbody');
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;">暂无用户</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(function (u) {
        return '<tr>' +
          '<td>' + esc(u.name) + '</td>' +
          '<td>' + esc(u.login || u.username) + '</td>' +
          '<td>' + esc(u.department) + '</td>' +
          '<td>' + roleTag(u.role) + '</td>' +
          '</tr>';
      }).join('');
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  $('user-form').addEventListener('submit', function (e) {
    e.preventDefault();
    api('/api/admin/users', {
      method: 'POST',
      body: {
        name: $('user-name').value.trim(),
        login: $('user-login').value.trim(),
        department: $('user-department').value.trim(),
        role: $('user-role').value
      }
    }).then(function () {
      toast('用户创建成功', 'success');
      $('user-form').reset();
      loadUsers();
      loadDashboard();
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  });

  /* ================= 公司事项 ================= */
  function loadAnnouncements() {
    api('/api/announcements').then(function (list) {
      list = list || [];
      $('ann-count').textContent = '共 ' + list.length + ' 条';
      var wrap = $('announcements-list');
      if (!list.length) {
        wrap.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无公告</div>';
        return;
      }
      wrap.innerHTML = list.map(function (a) {
        return '<div class="ann-item">' +
          '<div class="ann-item-header">' +
            '<div>' +
              '<span class="ann-item-title">' + esc(a.title) + '</span>' +
              ' <span class="tag tag-green">' + esc(a.category || '通知') + '</span>' +
            '</div>' +
            '<div class="ann-item-meta">' + esc(a.date || '') +
              ' <button class="btn btn-danger btn-sm" data-ann-id="' + a.id + '">删除</button>' +
            '</div>' +
          '</div>' +
          '<div class="ann-item-body">' + esc(a.content) + '</div>' +
          '</div>';
      }).join('');
      wrap.querySelectorAll('[data-ann-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (!confirm('确定删除该公告吗？')) return;
          api('/api/admin/announcements/' + btn.getAttribute('data-ann-id'), { method: 'DELETE' })
            .then(function () {
              toast('公告已删除', 'success');
              loadAnnouncements();
            }).catch(function (err) {
              toast(err.message, 'error');
            });
        });
      });
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  $('announcement-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var today = new Date();
    var dateStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    api('/api/admin/announcements', {
      method: 'POST',
      body: {
        title: $('ann-title').value.trim(),
        category: $('ann-category').value.trim(),
        content: $('ann-content').value.trim(),
        date: dateStr
      }
    }).then(function () {
      toast('公告发布成功', 'success');
      $('announcement-form').reset();
      loadAnnouncements();
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  });

  /* ================= 任务管理 ================= */
  function statusTag(s) {
    var cls = 'tag-gray';
    if (s === 'doing') cls = 'tag-blue';
    else if (s === 'done') cls = 'tag-green';
    else if (s === 'todo') cls = 'tag-orange';
    return '<span class="tag ' + cls + '">' + (STATUS_MAP[s] || esc(s)) + '</span>';
  }
  function priorityTag(p) {
    var cls = 'tag-gray';
    if (p === 'high') cls = 'tag-red';
    else if (p === 'medium') cls = 'tag-orange';
    else if (p === 'low') cls = 'tag-green';
    return '<span class="tag ' + cls + '">' + (PRIORITY_MAP[p] || esc(p)) + '</span>';
  }

  var currentTab = 'task-list';

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tab);
    });
    $('tab-task-list').classList.toggle('hidden', tab !== 'task-list');
    $('tab-review-queue').classList.toggle('hidden', tab !== 'review-queue');
    if (tab === 'task-list') loadTasks();
    else loadRequests();
  }

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      switchTab(t.getAttribute('data-tab'));
    });
  });

  function loadTasks() {
    api('/api/admin/tasks').then(function (list) {
      list = list || [];
      $('tasks-count').textContent = '共 ' + list.length + ' 条';
      var tbody = $('tasks-tbody');
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;">暂无任务</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(function (t) {
        var owner = (t.ownerNames && t.ownerNames.length) ? t.ownerNames.join('、') : '';
        return '<tr>' +
          '<td>' + esc(t.title) + '</td>' +
          '<td>' + esc(owner) + '</td>' +
          '<td>' + statusTag(t.status) + '</td>' +
          '<td>' + priorityTag(t.priority) + '</td>' +
          '<td>' + esc(t.dueAt || '') + '</td>' +
          '</tr>';
      }).join('');
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  function loadRequests() {
    api('/api/admin/requests').then(function (list) {
      list = list || [];
      var pending = list.filter(function (r) {
        return (r.status || 'pending') === 'pending';
      });
      $('requests-count').textContent = '共 ' + pending.length + ' 条待审核';
      updateReviewBadge(pending.length);
      var wrap = $('requests-list');
      if (!pending.length) {
        wrap.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无待审核申请</div>';
        return;
      }
      wrap.innerHTML = pending.map(function (r) {
        var taskTitle = r.taskTitle || (r.taskId ? ('任务 #' + r.taskId) : '新任务');
        var applicant = r.proposerName || r.proposer || '';
        var kind = r.kind || '';
        return '<div class="request-item">' +
          '<div class="request-header">' +
            '<div class="request-info">' +
              '<span class="tag tag-blue">' + (KIND_MAP[kind] || esc(kind)) + '</span> ' +
              '<strong>' + esc(taskTitle) + '</strong>' +
              (applicant ? ' · 申请人：' + esc(applicant) : '') +
            '</div>' +
            '<div class="request-actions">' +
              '<button class="btn btn-success btn-sm" data-review-approve="' + r.id + '">通过</button>' +
              '<button class="btn btn-danger btn-sm" data-review-reject="' + r.id + '">驳回</button>' +
            '</div>' +
          '</div>' +
          '<div class="review-form hidden" id="review-form-' + r.id + '">' +
            '<input type="text" placeholder="请输入驳回原因（必填）" id="review-reason-' + r.id + '">' +
            '<button class="btn btn-danger btn-sm" data-review-confirm="' + r.id + '">确认驳回</button>' +
            '<button class="btn btn-sm" data-review-cancel="' + r.id + '">取消</button>' +
          '</div>' +
          '</div>';
      }).join('');

      wrap.querySelectorAll('[data-review-approve]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          reviewRequest(btn.getAttribute('data-review-approve'), true, '');
        });
      });
      wrap.querySelectorAll('[data-review-reject]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          $('review-form-' + btn.getAttribute('data-review-reject')).classList.remove('hidden');
        });
      });
      wrap.querySelectorAll('[data-review-cancel]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          $('review-form-' + btn.getAttribute('data-review-cancel')).classList.add('hidden');
        });
      });
      wrap.querySelectorAll('[data-review-confirm]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-review-confirm');
          var reason = $('review-reason-' + id).value.trim();
          if (!reason) {
            toast('驳回必须填写原因', 'error');
            return;
          }
          reviewRequest(id, false, reason);
        });
      });
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  function reviewRequest(id, approve, reason) {
    api('/api/tasks/requests/' + id + '/review', {
      method: 'POST',
      body: { approve: approve, reason: reason }
    }).then(function () {
      toast(approve ? '已通过' : '已驳回', 'success');
      loadRequests();
      loadTasks();
      loadDashboard();
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  function updateReviewBadge(count) {
    var badge = $('review-badge');
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  /* ================= 日志管理 ================= */
  function loadLogs() {
    api('/api/admin/logs').then(function (list) {
      list = list || [];
      $('logs-count').textContent = '共 ' + list.length + ' 条';
      var tbody = $('logs-tbody');
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;">暂无日志</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(function (l) {
        var content = (l.content || '').replace(/\s+/g, ' ');
        var summary = content.length > 60 ? content.slice(0, 60) + '...' : content;
        return '<tr>' +
          '<td>' + esc(l.authorName || l.author || '') + '</td>' +
          '<td>' + esc(l.date || '') + '</td>' +
          '<td>' + esc(l.title) + '</td>' +
          '<td title="' + esc(content) + '">' + esc(summary) + '</td>' +
          '</tr>';
      }).join('');
    }).catch(function (err) {
      toast(err.message, 'error');
    });
  }

  /* ================= 导航 ================= */
  document.querySelectorAll('.nav-item[data-page]').forEach(function (n) {
    n.addEventListener('click', function () {
      switchPage(n.getAttribute('data-page'));
    });
  });

  /* ================= 初始化 ================= */
  function init() {
    if (getToken()) {
      api('/api/auth/me').then(function (u) {
        $('current-user').textContent = (u.name || u.login || '用户') + ' · ' + (ROLE_MAP[u.role] || u.roleName || '');
        showApp();
      }).catch(function () {
        logout(false);
      });
    } else {
      showLogin();
    }
  }

  init();
})();

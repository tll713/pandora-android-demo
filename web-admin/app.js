/* 潘多拉管理空间 · 无构建依赖，复用任务审核业务规则 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const paths = {
    dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    tasks:'<rect x="5" y="4" width="15" height="17" rx="2"/><path d="M9 3v3m7-3v3M8 11l1 1 2-2m2 1h4m-9 6 1 1 2-2m2 1h4"/>',
    reviews:'<path d="m12 3 8 3v6c0 4-3.5 7-8 9-4.5-2-8-5-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v1"/>',
    logs:'<path d="M5 3h14v18H5zM9 7h6m-6 5h6m-6 5h4"/>',
    announcements:'<path d="m4 10 15-6v15L4 14v-4Zm1 4 2 7h4l-2-5m10-6h2v4h-2"/>',
    plus:'<path d="M12 5v14M5 12h14"/>', search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    refresh:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>', arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
    logout:'<path d="M10 3H5v18h5m-1-9h12m-5-5 5 5-5 5"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check:'<path d="m5 12 4 4L19 6"/>', info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    chevron:'<path d="m9 6 6 6-6 6"/>', leaf:'<path d="M5 19C-1 5 14 3 21 3c0 11-5 20-16 16Zm0 0L16 8"/>',
    pin:'<path d="m8 3 8 0-1 6 4 4v2H5v-2l4-4-1-6Zm4 12v7"/>'
  };
  const icon = name => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'+(paths[name] || paths.info)+'</svg>';
  const roles = {ADMIN:'管理员',FOUNDER:'创始人',DEPT_MANAGER:'部门负责人',TEAM_LEAD:'团队长',EMPLOYEE:'员工'};
  const statuses = {todo:'待开始',doing:'进行中',done:'已完成'};
  const priorities = {high:'高优先级',medium:'中优先级',low:'低优先级'};
  const kinds = {create:'创建任务',edit:'编辑任务',delete:'删除任务'};
  const reviewStatuses = {pending:'待审核',approved:'已通过',rejected:'已驳回'};
  const pages = {
    dashboard:['工作台','OVERVIEW','团队进展与待办事项，一目了然'],
    tasks:['任务管理','TASK MANAGEMENT','明确目标与分工，跟进每一项任务'],
    reviews:['审核中心','REVIEW CENTER','审慎处理每一次变更，让协作有据可循'],
    users:['组织与账号','TEAM & MEMBERS','管理团队成员，明确角色与访问权限'],
    logs:['工作日志','WORK JOURNAL','汇聚工作记录，看见团队的每一份进展'],
    announcements:['公司公告','ANNOUNCEMENTS','及时传递信息，连接团队共识']
  };
  const tokenKey = 'pandora.admin.token';
  const state = {user:null,page:'dashboard',data:null,filters:{},pages:{},reviewTab:'pending',loading:false,error:'',busy:false,session:0,load:0};
  let toastTimer, dialogContext=null, confirmCallback=null;
  const tag = (text,color='') => '<span class="tag '+color+'">'+esc(text)+'</span>';
  const statusTag = status => tag(statuses[status] || status,({todo:'amber',doing:'blue',done:'green'})[status]);
  const priorityTag = priority => tag(priorities[priority] || priority,({high:'red',medium:'amber',low:'green'})[priority]);
  const reviewTag = status => tag(reviewStatuses[status] || status,({pending:'amber',approved:'green',rejected:'red'})[status]);
  const fmt = value => value ? String(value).replace('T',' ').slice(0,16) : '—';
  const dateOnly = value => value ? String(value).slice(0,10) : '—';
  const member = id => state.data?.users.find(u=>u.id===id);
  const memberName = id => member(id)?.name || id || '—';
  const ownerNames = task => (task.ownerNames || (task.owners || []).map(memberName)).join('、') || '—';
  const isOverdue = task => task.status!=='done' && new Date(task.dueAt).getTime()<Date.now();
  const action = (name,id,label,cls='row-link') => '<button type="button" class="'+cls+'" data-action="'+name+'" data-id="'+esc(id)+'">'+label+'</button>';
  function toast(message,error=false) {
    clearTimeout(toastTimer);
    $('toast').textContent=message; $('toast').className='toast'+(error?' error':''); $('toast').hidden=false;
    toastTimer=setTimeout(()=>$('toast').hidden=true,4000);
  }
  async function api(path,options={}) {
    const token=localStorage.getItem(tokenKey);
    const headers={...(options.body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})};
    let response;
    try { response=await fetch('/api'+path,{...options,headers,body:options.body?JSON.stringify(options.body):undefined}); }
    catch { throw new Error('网络连接失败，请检查后重试'); }
    const text=await response.text();
    let body; try { body=text?JSON.parse(text):{}; } catch { body={}; }
    if(response.status===401 && !path.endsWith('/login')) { logout(false); throw new Error('登录已过期，请重新登录'); }
    if(!response.ok) throw new Error(body.error || body.message || (response.status===403?'没有此操作的权限':'请求失败，请稍后重试'));
    return body;
  }
  function logout(notify=true) {
    state.session++; state.load++; state.user=null; state.data=null; state.filters={}; state.pages={}; state.error=''; state.loading=false;
    localStorage.removeItem(tokenKey);
    $('detail-dialog').close(); $('confirm-dialog').close();
    $('app-view').hidden=true; $('login-view').hidden=false; $('boot-state').hidden=true;
    $('login-form').elements.password.value='';
    if(notify) toast('已退出登录');
  }
  async function enter(user) {
    if(!['ADMIN','FOUNDER'].includes(user.role)) {
      logout(false); throw new Error('仅管理员和创始人可登录管理后台');
    }
    clearTimeout(toastTimer); $('toast').hidden=true;
    state.user=user; state.session++;
    $('side-name').textContent=user.name; $('side-role').textContent=roles[user.role]; $('side-avatar').textContent=user.name?.slice(-1)||'管';
    $('logout-btn').innerHTML=icon('logout');
    document.querySelectorAll('.mobile-menu').forEach(b=>b.innerHTML=icon('menu'));
    $('detail-dialog').querySelector('[data-action="close-dialog"]').innerHTML=icon('close');
    $('refresh-btn').innerHTML=icon('refresh')+'刷新';
    $('today-label').textContent=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(new Date());
    $('login-view').hidden=true; $('app-view').hidden=false; $('boot-state').hidden=true;
    navigate(location.hash.slice(1)||'dashboard',false); await reload();
  }
  async function reload() {
    if(!state.user) return;
    const session=state.session, load=++state.load;
    state.loading=true; state.error=''; render();
    $('refresh-btn').disabled=true;
    try {
      const [users,tasks,requests,logs,announcements]=await Promise.all([
        api('/admin/users'),api('/admin/tasks'),api('/admin/requests'),api('/admin/logs'),api('/announcements')
      ]);
      if(session!==state.session || load!==state.load) return;
      state.data={users,tasks,requests,logs,announcements};
      $('refresh-time').textContent='更新于 '+new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
    } catch(error) { if(session===state.session && load===state.load) state.error=error.message; }
    finally {
      if(session===state.session && load===state.load) {state.loading=false;$('refresh-btn').disabled=false;render();}
    }
  }
  function navigate(page,updateHash=true) {
    if(!pages[page]) page='dashboard';
    state.page=page;
    if(updateHash && location.hash!=='#'+page) history.pushState(null,'','#'+page);
    $('app-view').classList.remove('menu-open'); render();
  }
  window.addEventListener('hashchange',()=>{if(state.user) navigate(location.hash.slice(1),false);});
  window.addEventListener('popstate',()=>{if(state.user) navigate(location.hash.slice(1),false);});
  function nav() {
    $('navigation').innerHTML=Object.entries(pages).map(([key,value])=>{
      const count=key==='reviews' ? state.data?.requests.filter(r=>r.status==='pending').length : 0;
      return '<a class="nav-item '+(state.page===key?'active':'')+'" href="#'+key+'" '+(state.page===key?'aria-current="page"':'')+'>'+icon(key)+value[0]+(count?'<span class="nav-count">'+count+'</span>':'')+'</a>';
    }).join('');
  }
  function render() {
    if(!state.user) return;
    nav();
    const meta=pages[state.page];
    $('breadcrumb-title').textContent=meta[0]; $('page-title').textContent=meta[0]; $('page-kicker').textContent=meta[1]; $('page-description').textContent=meta[2];
    const primary=$('primary-action');
    const primaryMap={dashboard:['new-task','创建任务'],tasks:['new-task','创建任务'],users:['new-user','添加成员'],announcements:['new-announcement','发布公告']};
    const next=primaryMap[state.page];
    primary.hidden=!next || (state.page==='users' && state.user.role!=='ADMIN');
    primary.disabled=state.loading || !!state.error || !state.data;
    if(next) {primary.dataset.action=next[0];primary.innerHTML=icon('plus')+next[1];}
    if(state.loading) {$('page-content').innerHTML='<div class="loading-state"><span class="spinner"></span>正在加载团队数据…</div>';return;}
    if(state.error) {$('page-content').innerHTML='<section class="panel">'+empty('数据加载失败',state.error,'refresh','重新加载')+'</section>';return;}
    if(!state.data) return;
    $('page-content').innerHTML=({dashboard:dashboard,tasks:tasksPage,reviews:reviewsPage,users:usersPage,logs:logsPage,announcements:announcementsPage})[state.page]();
  }
  function empty(title='暂无匹配结果',description='试试调整筛选条件，或稍后再来查看。',button='',label='') {
    return '<div class="empty-state"><div class="empty-icon">'+icon(state.page)+'</div><h3>'+esc(title)+'</h3><p>'+esc(description)+'</p>'+(button?action(button,'',esc(label),'btn'):'')+'</div>';
  }
  function miniTask(t) {
    return '<div class="mini-row"><span class="priority-dot '+esc(t.priority)+'"></span><div class="mini-content">'+action('task-detail',t.id,esc(t.title),'mini-title row-link')+'<div class="mini-meta">'+esc(ownerNames(t))+' · 截止 '+esc(fmt(t.dueAt))+'</div></div>'+ (isOverdue(t)?tag('已逾期','red'):statusTag(t.status))+'</div>';
  }
  function dashboard() {
    const {tasks,requests,logs,users,announcements}=state.data;
    const done=tasks.filter(t=>t.status==='done').length, doing=tasks.filter(t=>t.status==='doing').length, todo=tasks.length-done-doing;
    const pending=requests.filter(r=>r.status==='pending'), overdue=tasks.filter(isOverdue);
    const completion=tasks.length?Math.round(done/tasks.length*100):0;
    const dueSoon=tasks.filter(t=>t.status!=='done').sort((a,b)=>a.dueAt.localeCompare(b.dueAt)).slice(0,4);
    const cards=[
      ['团队任务',tasks.length,'项','tasks',done+' 项已完成 · 完成率 '+completion+'%','all'],
      ['待审核申请',pending.length,'项','reviews',pending.filter(r=>r.proposer!==state.user.id).length+' 项可由你处理','pending'],
      ['逾期任务',overdue.length,'项','clock','关注截止时间，及时协调进度','overdue'],
      ['工作日志',logs.length,'篇','logs',users.filter(u=>u.enabled!==false).length+' 位在职成员 · 持续积累成果','all']
    ];
    const hour=new Date().getHours(), greeting=hour<12?'上午好':hour<18?'下午好':'晚上好';
    const activities=[
      ...requests.map(r=>({at:r.reviewedAt||r.createdAt,title:(r.reviewedAt?(r.reviewerName||memberName(r.reviewer))+' '+(r.status==='approved'?'通过':'驳回')+'了申请':r.proposerName+' 提交了'+(kinds[r.kind]||'变更')),meta:r.taskTitle,action:'request-detail',id:r.id,icon:'reviews'})),
      ...logs.map(l=>({at:l.updatedAt||l.createdAt,title:(l.authorName||memberName(l.author))+' 更新了工作日志',meta:l.title,action:'log-detail',id:l.id,icon:'logs'})),
      ...tasks.flatMap(t=>(t.history||[]).map(h=>({at:h.at,title:memberName(h.actor)+' · '+h.text,meta:t.title,action:'task-detail',id:t.id,icon:'tasks'})))
    ].sort((a,b)=>(b.at||'').localeCompare(a.at||'')).slice(0,4);
    return '<section class="welcome"><div class="welcome-art">'+icon('leaf')+'</div><div class="welcome-main"><h2>'+esc(greeting+'，'+state.user.name)+'</h2><p>'+ (pending.length?'有 '+pending.length+' 项申请等待审核，团队的进展需要你的关注。':'每一份清晰的安排，都让团队离目标更近一步。')+'</p></div>'+action('go-reviews','', '查看待办 '+icon('arrow'),'btn')+'</section>'+
      '<div class="stats-grid">'+cards.map(([label,value,unit,ico,foot,filter],index)=>'<button class="stat-card '+(index===1||index===2?'attention':'')+'" data-action="stat" data-id="'+index+'" data-filter="'+filter+'"><div class="stat-top">'+label+'<span class="stat-icon">'+icon(ico)+'</span></div><div class="stat-value">'+value+'<small>'+unit+'</small></div><div class="stat-foot">'+foot+'</div></button>').join('')+'</div>'+
      '<div class="dashboard-grid"><section class="panel"><div class="panel-head"><h2>任务运行概况</h2>'+action('go-tasks','', '全部任务 '+icon('arrow'),'btn text')+'</div><div class="panel-body"><div class="distribution"><div class="donut" style="--done:'+completion+'%;--doing:'+(tasks.length?(done+doing)/tasks.length*100:0)+'%"><div><strong>'+completion+'<small style="display:inline">%</small></strong><small>任务完成率</small></div></div><div class="legend">'+[[done,'已完成','#456c52'],[doing,'进行中','#a7bd85'],[todo,'待开始','#e7ecde']].map(([n,label,color])=>'<div class="legend-row"><i class="legend-dot" style="background:'+color+'"></i>'+label+'<b>'+n+'</b><small>'+ (tasks.length?Math.round(n/tasks.length*100):0)+'%</small></div>').join('')+'</div></div><div class="panel-divider"><span>把目标分解为行动，让每一步都有回响</span><strong>'+tasks.length+' 项团队任务</strong></div></div></section>'+
      '<section class="panel"><div class="panel-head"><h2>近期需关注</h2>'+tag(overdue.length+' 项逾期',overdue.length?'red':'green')+'</div><div class="mini-list">'+(dueSoon.length?dueSoon.map(miniTask).join(''):empty('暂无待办任务','团队的任务都已处理完成。'))+'</div></section>'+
      '<section class="panel"><div class="panel-head"><h2>团队动态</h2><span class="muted" style="font-size:10px">最近更新</span></div><div class="mini-list">'+(activities.length?activities.map(a=>'<div class="mini-row"><span class="activity-marker">'+icon(a.icon)+'</span><div class="mini-content">'+action(a.action,a.id,esc(a.title),'mini-title row-link')+'<div class="mini-meta">'+esc(a.meta)+'</div></div><span class="activity-time">'+esc(fmt(a.at).slice(5))+'</span></div>').join(''):empty('暂无团队动态','开始创建任务，记录团队进展。'))+'</div></section>'+
      '<section class="panel"><div class="panel-head"><h2>公司公告</h2>'+action('go-announcements','','查看全部 '+icon('arrow'),'btn text')+'</div><div class="panel-body">'+(sortAnnouncements(announcements).slice(0,3).map(a=>'<div class="notice-mini"><button data-action="announcement-detail" data-id="'+esc(a.id)+'"><div class="notice-top"><strong>'+ (a.pinned?'⌑ ':'')+esc(a.title)+'</strong><small>'+esc(a.date)+'</small></div><p>'+esc(a.content)+'</p></button></div>').join('')||empty('暂无公告','团队通知将在这里展示。'))+'</div></section></div>';
  }
  function filters() {return state.filters[state.page] ||= {};}
  function selectFilter(name,label,options) {
    const value=filters()[name]||'';
    return '<label>'+label+'<select name="'+name+'" data-filter="'+name+'"><option value="">全部'+label+'</option>'+options.map(([v,text])=>'<option value="'+esc(v)+'" '+(value===v?'selected':'')+'>'+esc(text)+'</option>').join('')+'</select></label>';
  }
  function toolbar(extra='') {
    return '<form class="toolbar" id="filter-form"><label class="search-field">关键词<div class="search-wrap">'+icon('search')+'<input type="search" name="q" aria-label="关键词" placeholder="输入关键词搜索" value="'+esc(filters().q||'')+'"></div></label>'+extra+'<button class="btn" type="submit">搜索</button>'+action('reset-filters','','重置','btn text')+'</form>';
  }
  function searchMatch(text) {const q=(filters().q||'').toLowerCase().trim();return !q || String(text||'').toLowerCase().includes(q);}
  function paginated(list) {
    const total=list.length, count=Math.max(1,Math.ceil(total/10)), page=Math.min(state.pages[state.page]||1,count);
    state.pages[state.page]=page;
    const start=(page-1)*10;
    let numbers=[...new Set([1,page-1,page,page+1,count].filter(n=>n>0&&n<=count))].sort((a,b)=>a-b), last=0;
    const buttons=numbers.map(n=>{const dots=n-last>1?'<span>…</span>':'';last=n;return dots+action('page',n,String(n),'btn '+(n===page?'current':''));}).join('');
    return {items:list.slice(start,start+10),footer:'<div class="pagination"><span>共 '+total+' 条'+(total?' · 显示 '+(start+1)+'–'+Math.min(start+10,total)+' 条':'')+'</span><div class="page-buttons"><button class="btn" data-action="page" data-id="'+(page-1)+'" '+(page===1?'disabled':'')+'>上一页</button>'+buttons+'<button class="btn" data-action="page" data-id="'+(page+1)+'" '+(page===count?'disabled':'')+'>下一页</button></div></div>'};
  }
  function table(title,headers,rows,total,footer) {
    return '<section class="panel"><div class="table-top"><h2>'+title+'</h2><span>'+total+' 条记录</span></div>'+(rows.length?'<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row+'</tr>').join('')+'</tbody></table></div>':empty())+footer+'</section>';
  }
  const cell = text => '<td>'+text+'</td>';
  function tasksPage() {
    const f=filters(),list=state.data.tasks.filter(t=>searchMatch(t.title+' '+t.detail+' '+ownerNames(t))
      &&(!f.status||t.status===f.status)&&(!f.priority||t.priority===f.priority)&&(!f.owner||(t.owners||[]).includes(f.owner))&&(!f.overdue||isOverdue(t)))
      .sort((a,b)=>isOverdue(b)-isOverdue(a)||a.dueAt.localeCompare(b.dueAt));
    const p=paginated(list);
    return toolbar(selectFilter('status','状态',Object.entries(statuses))+selectFilter('priority','优先级',Object.entries(priorities))+selectFilter('owner','负责人',state.data.users.map(u=>[u.id,u.name]))+selectFilter('overdue','截止情况',[['yes','仅逾期任务']]))+
      table('团队任务',['任务名称','负责人','状态','优先级','截止时间','操作'],p.items.map(t=>
        cell(action('task-detail',t.id,esc(t.title),'cell-title')+'<div class="cell-sub">创建人：'+esc(t.creatorName||memberName(t.creator))+'</div>')+
        cell(esc(ownerNames(t)))+cell(statusTag(t.status))+cell(priorityTag(t.priority))+cell(esc(fmt(t.dueAt))+(isOverdue(t)?'<div class="cell-sub">'+tag('已逾期','red')+'</div>':''))+
        cell('<div class="row-actions">'+action('task-detail',t.id,'详情')+action('edit-task',t.id,'编辑')+'</div>')),list.length,p.footer);
  }
  function reviewsPage() {
    const f=filters(), list=state.data.requests.filter(r=>(state.reviewTab==='all'||r.status===state.reviewTab)&&searchMatch(r.taskTitle+' '+r.proposerName)&&(!f.kind||r.kind===f.kind)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const p=paginated(list);
    return '<div class="review-tabs" role="group" aria-label="审核状态">'+[['pending','待审核'],['approved','已通过'],['rejected','已驳回'],['all','全部申请']].map(([key,label])=>'<button class="review-tab '+(state.reviewTab===key?'active':'')+'" data-action="review-tab" data-id="'+key+'" aria-pressed="'+(state.reviewTab===key)+'">'+label+'<small>'+state.data.requests.filter(r=>key==='all'||r.status===key).length+'</small></button>').join('')+'</div>'+
      '<div class="section-note">'+icon('info')+'任务创建、编辑、删除经另一位管理员或创始人审核后生效；驳回需填写原因。</div>'+
      toolbar(selectFilter('kind','变更类型',Object.entries(kinds)))+
      table('变更申请',['任务 / 变更类型','申请人','申请时间','审核状态','操作'],p.items.map(r=>cell(action('request-detail',r.id,esc(r.taskTitle),'cell-title')+'<div class="cell-sub">'+esc(kinds[r.kind])+'</div>')+cell(esc(r.proposerName))+cell(esc(fmt(r.createdAt)))+cell(reviewTag(r.status))+cell(action('request-detail',r.id,r.status==='pending'?(r.proposer===state.user.id?'查看 · 本人申请':'查看并审核'):'查看记录'))),list.length,p.footer);
  }
  function usersPage() {
    const f=filters(), departments=[...new Set(state.data.users.map(u=>u.department))].sort();
    const list=state.data.users.filter(u=>searchMatch(u.name+' '+u.id+' '+u.department)&&(!f.department||u.department===f.department)&&(!f.role||u.role===f.role)&&(!f.enabled||(u.enabled!==false)===(f.enabled==='yes'))).sort((a,b)=>a.id.localeCompare(b.id));
    const p=paginated(list);
    return '<div class="section-note">'+icon('info')+(state.user.role==='ADMIN'?'管理员可维护普通成员账号；管理员与创始人账号受保护。':'你可以查看全体成员；账号创建、编辑和密码重置由管理员维护。')+'</div>'+
      toolbar(selectFilter('department','部门',departments.map(d=>[d,d]))+selectFilter('role','角色',Object.entries(roles))+selectFilter('enabled','账号状态',[['yes','正常'],['no','已停用']]))+
      table('团队成员',['成员','登录账号','部门','角色','账号状态','操作'],p.items.map(u=>cell('<div class="member-cell"><span class="avatar">'+esc(u.name.slice(-1))+'</span><strong>'+esc(u.name)+'</strong></div>')+cell(esc(u.login||u.id))+cell(esc(u.department))+cell(tag(roles[u.role],u.role==='ADMIN'?'purple':u.role==='FOUNDER'?'amber':'green'))+cell(tag(u.enabled===false?'已停用':'正常',u.enabled===false?'':'green'))+cell(state.user.role==='ADMIN'&&!['ADMIN','FOUNDER'].includes(u.role)?'<div class="row-actions">'+action('edit-user',u.id,'编辑')+action('reset-password',u.id,'重置密码')+'</div>':'<span class="cell-sub">'+(['ADMIN','FOUNDER'].includes(u.role)?'受保护账号':'仅管理员可维护')+'</span>')),list.length,p.footer);
  }
  function logsPage() {
    const f=filters();
    const list=state.data.logs.filter(l=>searchMatch(l.title+' '+l.content+' '+l.authorName)&&(!f.author||l.author===f.author)&&(!f.from||l.date>=f.from)&&(!f.to||l.date<=f.to)).sort((a,b)=>b.date.localeCompare(a.date)||(b.updatedAt||'').localeCompare(a.updatedAt||''));
    const p=paginated(list);
    return toolbar(selectFilter('author','人员',state.data.users.map(u=>[u.id,u.name]))+'<label>开始日期<input name="from" data-filter="from" type="date" value="'+esc(f.from||'')+'"></label><label>结束日期<input name="to" data-filter="to" type="date" value="'+esc(f.to||'')+'"></label>')+
      table('团队工作日志',['日志标题','作者','日志日期','内容摘要','操作'],p.items.map(l=>cell(action('log-detail',l.id,esc(l.title),'cell-title'))+cell(esc(l.authorName||memberName(l.author)))+cell(esc(l.date))+cell('<div class="cell-title" style="font-weight:400;color:var(--muted);max-width:230px">'+esc(l.content)+'</div>')+cell(action('log-detail',l.id,'查看全文'+(l.versions?.length?' · '+l.versions.length+' 个历史版本':'')))),list.length,p.footer);
  }
  function sortAnnouncements(items) {return [...items].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||b.date.localeCompare(a.date)||a.id.localeCompare(b.id));}
  function announcementsPage() {
    const f=filters(), categories=[...new Set(state.data.announcements.map(a=>a.category))].sort();
    const list=sortAnnouncements(state.data.announcements.filter(a=>searchMatch(a.title+' '+a.content)&&(!f.category||a.category===f.category)));
    const p=paginated(list);
    return toolbar(selectFilter('category','分类',categories.map(c=>[c,c])))+(list.length?'<div class="announcement-grid">'+p.items.map(a=>'<article class="announcement-card"><div class="notice-top">'+tag(a.category,'green')+(a.pinned?tag('置顶','amber'):'')+'</div><h2>'+action('announcement-detail',a.id,esc(a.title),'')+'</h2><p>'+esc(a.content)+'</p><footer><span>发布于 '+esc(a.date)+'</span><div class="row-actions">'+action('edit-announcement',a.id,'编辑')+action('toggle-pin',a.id,a.pinned?'取消置顶':'置顶')+action('delete-announcement',a.id,'删除','row-link danger')+'</div></footer></article>').join('')+'</div>': '<section class="panel">'+empty('暂无公告','发布公司通知，与团队同步重要事项。')+'</section>')+p.footer;
  }

  function openDialog(title,body,kicker='DETAIL',context=null) {
    dialogContext=context;
    $('dialog-title').textContent=title; $('dialog-kicker').textContent=kicker; $('dialog-content').innerHTML=body;
    if(!$('detail-dialog').open) $('detail-dialog').showModal();
    $('detail-dialog').scrollTop=0;
  }
  function inlineError() {return '<p class="inline-error" id="form-error" role="alert" hidden></p>';}
  function formActions(label) {return inlineError()+'<div class="form-actions"><button type="button" class="btn" data-action="close-dialog">取消</button><button type="submit" class="btn primary">'+label+'</button></div>';}
  function detailGrid(entries) {return '<dl class="detail-grid">'+entries.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>';}
  function section(title,body) {return '<section class="detail-section"><h3>'+esc(title)+'</h3>'+body+'</section>';}
  function taskDetail(id) {
    const t=state.data.tasks.find(t=>t.id===id);
    if(!t) return toast('任务已不存在，请刷新数据',true);
    const pending=state.data.requests.find(r=>r.taskId===id&&r.status==='pending');
    const history=[...(t.history||[])].sort((a,b)=>b.at.localeCompare(a.at));
    openDialog(t.title,'<div class="detail-tags">'+statusTag(t.status)+priorityTag(t.priority)+(isOverdue(t)?tag('已逾期','red'):'')+'</div>'+
      detailGrid([['负责人',ownerNames(t)],['截止时间',fmt(t.dueAt)],['创建人',t.creatorName||memberName(t.creator)],['创建时间',fmt(t.createdAt)],['完成时间',fmt(t.completedAt)],['当前版本','第 '+t.revision+' 版']])+
      (pending?'<div class="section-note">'+icon('reviews')+'此任务已有待审核变更 '+action('request-detail',pending.id,'查看申请')+'</div>':'')+
      section('任务说明','<p class="prose">'+esc(t.detail||'暂无任务说明')+'</p>')+
      section('进展时间线',history.length?'<div class="timeline">'+history.map(h=>'<div class="timeline-item"><small>'+esc(fmt(h.at))+' · '+esc(memberName(h.actor))+'</small><p>'+esc(h.text)+'</p></div>').join('')+'</div>':'<p class="muted form-hint">暂无进展记录</p>')+
      '<div class="detail-actions">'+(!pending?action('edit-task',id,'编辑任务','btn primary')+action('delete-task',id,'申请删除','btn danger'):'<p class="form-hint">当前申请处理完成后，才可再次提交变更。</p>')+'</div>','TASK DETAIL',{type:'task',id});
  }
  function taskForm(id='') {
    const t=state.data.tasks.find(t=>t.id===id);
    if(id&&!t) return toast('任务不存在',true);
    if(t&&state.data.requests.some(r=>r.taskId===id&&r.status==='pending')) return toast('此任务已有待审核变更，请先处理申请',true);
    const owners=state.data.users.filter(u=>u.enabled!==false&&u.role!=='ADMIN');
    const selected=t?.owners||[];
    const unavailable=selected.filter(id=>!owners.some(u=>u.id===id));
    openDialog(t?'编辑任务':'创建任务','<div class="section-note">'+icon('info')+'提交后需由另一位管理员或创始人审核，审核通过后生效。</div>'+
      (unavailable.length?'<div class="inline-error">原负责人中有已停用账号，请重新分配负责人。</div>':'')+
      '<form id="task-form"><div class="form-grid"><label class="full">任务名称<input name="title" maxlength="80" required placeholder="为团队安排一项清晰的任务" value="'+esc(t?.title||'')+'"></label><label>截止时间<input name="dueAt" type="datetime-local" required value="'+esc(t?.dueAt||'')+'"></label><label>优先级<select name="priority">'+Object.entries(priorities).map(([v,label])=>'<option value="'+v+'" '+((t?.priority||'medium')===v?'selected':'')+'>'+label+'</option>').join('')+'</select></label><div class="full"><label>任务负责人（可多选）<div class="owner-options">'+(owners.length?owners.map(u=>'<label class="owner-option"><input type="checkbox" name="owners" value="'+esc(u.id)+'" '+(selected.includes(u.id)?'checked':'')+'><span>'+esc(u.name)+'<small>'+esc(u.department)+' · '+esc(roles[u.role])+'</small></span></label>').join(''):'<span class="form-hint">暂无可分配成员，请先添加成员。</span>')+'</div></label></div><label class="full">任务说明<textarea name="detail" rows="5" maxlength="2000" placeholder="补充背景、目标和验收要求">'+esc(t?.detail||'')+'</textarea></label></div>'+formActions('提交'+(t?'编辑':'创建')+'申请')+'</form>','TASK REQUEST',{type:'task-form',id});
  }
  function comparison(r) {
    const fields=[['title','任务名称'],['owners','负责人'],['dueAt','截止时间'],['priority','优先级'],['detail','任务说明']];
    const format=(obj,key)=>{
      if(!obj) return '—';
      const value=obj[key];
      if(key==='owners') return (value||[]).map(memberName).join('、')||'—';
      if(key==='dueAt') return fmt(value);
      if(key==='priority') return priorities[value]||value||'—';
      return value||'—';
    };
    return '<div class="table-wrap"><table class="compare-table"><thead><tr><th>字段</th><th>变更前</th><th>变更后</th></tr></thead><tbody>'+fields.map(([key,label])=>{
      const before=format(r.before,key),after=format(r.after,key),changed=before!==after;
      return '<tr><th scope="row">'+label+'</th><td>'+esc(before)+'</td><td class="'+(changed?'changed':'')+'">'+esc(after)+'</td></tr>';
    }).join('')+'</tbody></table></div>';
  }
  function requestDetail(id) {
    const r=state.data.requests.find(r=>r.id===id);
    if(!r) return toast('申请不存在，请刷新数据',true);
    const canReview=r.status==='pending'&&r.proposer!==state.user.id;
    openDialog(r.taskTitle||kinds[r.kind],'<div class="detail-tags">'+tag(kinds[r.kind],'blue')+reviewTag(r.status)+'</div>'+
      detailGrid([['申请人',r.proposerName||memberName(r.proposer)],['申请时间',fmt(r.createdAt)],['审核人',r.reviewerName||memberName(r.reviewer)],['审核时间',fmt(r.reviewedAt)]])+
      section('变更内容对比',comparison(r))+
      (r.status!=='pending'?section('审核'+(r.status==='rejected'?'原因':'备注'),'<p class="prose">'+esc(r.reason||'审核通过，无补充备注')+'</p>'):'')+
      (canReview?'<form id="review-form"><label>审核备注 / 驳回原因<textarea name="reason" maxlength="500" rows="3" placeholder="驳回时必须说明原因，通过时可选填备注"></textarea></label>'+inlineError()+'<div class="detail-actions" style="margin-top:20px"><button type="button" class="btn primary" data-action="approve-request" data-id="'+esc(id)+'">通过申请</button><button type="submit" class="btn danger">驳回申请</button></div></form>':r.status==='pending'?'<div class="section-note">'+icon('info')+'这是你提交的申请，需要由另一位管理员或创始人审核。</div>':''),
      'REVIEW DETAIL',{type:'request',id});
  }
  function userForm(id='') {
    if(state.user.role!=='ADMIN') return toast('只有管理员可以维护账号',true);
    const u=member(id);
    if(id&&(!u||['ADMIN','FOUNDER'].includes(u.role))) return toast('此账号受保护，不能在此修改',true);
    openDialog(u?'编辑成员':'添加成员','<form id="user-form"><div class="form-grid"><label>姓名<input name="name" required maxlength="30" value="'+esc(u?.name||'')+'" placeholder="请输入姓名"></label><label>登录账号<input name="login" required pattern="[a-zA-Z0-9_-]{3,30}" minlength="3" maxlength="30" '+(u?'readonly':'')+' value="'+esc(u?.id||'')+'" placeholder="3～30 位字母、数字、_ 或 -"></label><label>部门<input name="department" required maxlength="40" value="'+esc(u?.department||'')+'" list="department-options" placeholder="输入或选择部门"><datalist id="department-options">'+[...new Set(state.data.users.map(u=>u.department))].map(d=>'<option value="'+esc(d)+'">').join('')+'</datalist></label><label>角色<select name="role">'+['EMPLOYEE','TEAM_LEAD','DEPT_MANAGER'].map(r=>'<option value="'+r+'" '+(u?.role===r?'selected':'')+'>'+roles[r]+'</option>').join('')+'</select></label>'+
      (u?'<label class="check-label full"><input type="checkbox" name="enabled" '+(u.enabled!==false?'checked':'')+'>启用此账号</label><p class="form-hint full">保存后该成员需重新登录；停用后将无法访问系统。原任务、日志等业务记录会保留。</p>':'<p class="form-hint full">新成员的初始密码与登录账号相同，创建后可通过“重置密码”为其设置新密码。</p>')+'</div>'+formActions(u?'保存修改':'创建成员')+'</form>','TEAM MEMBER',{type:'user-form',id});
  }
  function passwordForm(id) {
    const u=member(id);
    if(state.user.role!=='ADMIN'||!u||['ADMIN','FOUNDER'].includes(u.role)) return toast('无法重置此账号的密码',true);
    openDialog('重置密码',detailGrid([['成员',u.name],['登录账号',u.id]])+'<form id="password-form"><div class="form-grid"><label class="full">新密码<input type="password" name="password" autocomplete="new-password" minlength="8" maxlength="64" required placeholder="设置 8～64 位新密码"></label><label class="full">确认新密码<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" maxlength="64" required placeholder="再次输入新密码"></label><p class="form-hint full">密码重置成功后，该成员的原登录状态将立即失效。</p></div>'+formActions('确认重置密码')+'</form>','ACCOUNT SECURITY',{type:'password-form',id});
  }
  function logDetail(id) {
    const l=state.data.logs.find(l=>l.id===id);
    if(!l) return toast('日志不存在，请刷新数据',true);
    const versions=[...(l.versions||[])].sort((a,b)=>b.at.localeCompare(a.at));
    const related=state.data.tasks.find(t=>t.id===l.taskId);
    openDialog(l.title,detailGrid([['作者',l.authorName||memberName(l.author)],['日志日期',l.date],['更新时间',fmt(l.updatedAt)],['关联任务',related?.title||(l.taskId?'任务已归档':'无')]])+
      section('日志正文','<p class="prose">'+esc(l.content)+'</p>')+
      section('历史版本 · '+versions.length,versions.length?versions.map((v,i)=>'<details class="version-item"><summary>'+esc(fmt(v.at))+' · '+esc(memberName(v.actor))+' · 历史记录 '+(versions.length-i)+'</summary><div class="prose"><strong>'+esc(v.title)+'</strong><br>'+esc(v.content)+'<br><small>关联任务：'+esc(state.data.tasks.find(t=>t.id===v.taskId)?.title||(v.taskId?'任务已归档':'无'))+'</small></div></details>').join(''):'<p class="form-hint">尚无历史修改版本。</p>'),'WORK JOURNAL');
  }
  function announcementDetail(id) {
    const a=state.data.announcements.find(a=>a.id===id);
    if(!a) return toast('公告不存在，请刷新数据',true);
    openDialog(a.title,'<div class="detail-tags">'+tag(a.category,'green')+(a.pinned?tag('置顶','amber'):'')+'</div>'+detailGrid([['发布日期',a.date],['分类',a.category]])+'<section class="detail-section"><div class="prose">'+esc(a.content)+'</div></section><div class="detail-actions">'+action('edit-announcement',a.id,'编辑公告','btn primary')+action('toggle-pin',a.id,a.pinned?'取消置顶':'置顶公告','btn')+action('delete-announcement',a.id,'删除公告','btn danger')+'</div>','ANNOUNCEMENT');
  }
  function announcementForm(id='') {
    const a=state.data.announcements.find(a=>a.id===id);
    if(id&&!a) return toast('公告不存在',true);
    openDialog(a?'编辑公告':'发布公告','<form id="announcement-form"><div class="form-grid"><label class="full">公告标题<input name="title" maxlength="120" required value="'+esc(a?.title||'')+'" placeholder="请输入公告标题"></label><label class="full">公告分类<input name="category" maxlength="40" required value="'+esc(a?.category||'通知')+'" list="category-options"><datalist id="category-options">'+[...new Set(['通知','制度','活动',...state.data.announcements.map(a=>a.category)])].map(c=>'<option value="'+esc(c)+'">').join('')+'</datalist></label><label class="full">正文内容<textarea name="content" rows="12" required maxlength="20000" placeholder="与团队同步重要信息">'+esc(a?.content||'')+'</textarea></label>'+(a?'<label class="check-label full"><input type="checkbox" name="pinned" '+(a.pinned?'checked':'')+'>置顶此公告</label>':'')+'</div>'+formActions(a?'保存修改':'发布公告')+'</form>','ANNOUNCEMENT EDIT',{type:'announcement-form',id});
  }
  function confirmAction(title,description,callback,danger=false) {
    $('confirm-title').textContent=title; $('confirm-description').textContent=description;
    $('confirm-submit').className='btn '+(danger?'danger':'primary');
    $('confirm-submit').textContent=danger?'确认操作':'确认通过';
    confirmCallback=callback; $('confirm-dialog').showModal();
  }
  function showFormError(error) {
    const el=$('form-error');
    if(el) {el.textContent=error.message;el.hidden=false;el.scrollIntoView({block:'nearest'});}
    toast(error.message,true);
  }
  async function mutate(operation,message) {
    if(state.busy) return;
    state.busy=true;
    const session=state.session;
    const controls=[...document.querySelectorAll('dialog button,dialog input,dialog textarea,dialog select')];
    const disabled=controls.map(el=>el.disabled);
    controls.forEach(el=>el.disabled=true);
    try {
      await operation();
      if(session!==state.session) return;
      $('confirm-dialog').close(); $('detail-dialog').close(); dialogContext=null; confirmCallback=null;
      toast(message); await reload();
    } catch(error) {if(session===state.session) showFormError(error);}
    finally {state.busy=false;controls.forEach((el,i)=>el.disabled=disabled[i]);}
  }
  function resetFilters() {state.filters[state.page]={};state.pages[state.page]=1;render();}
  document.addEventListener('click',event=>{
    const navLink=event.target.closest('#navigation a');
    if(navLink) {event.preventDefault();navigate(navLink.hash.slice(1));return;}
    const button=event.target.closest('[data-action]');
    if(!button||button.disabled||state.busy) return;
    const name=button.dataset.action,id=button.dataset.id;
    try {
      if(name==='logout') return logout();
      if(name==='menu') return $('app-view').classList.toggle('menu-open');
      if(name==='close-dialog') return $('detail-dialog').close();
      if(name==='cancel-confirm') return $('confirm-dialog').close();
      if(name==='refresh') return void reload();
      if(name==='page') {state.pages[state.page]=Number(id);render();return;}
      if(name==='reset-filters') return resetFilters();
      if(name==='go-reviews') {state.reviewTab='pending';state.pages.reviews=1;return navigate('reviews');}
      if(name.startsWith('go-')) return navigate(name.slice(3));
      if(name==='review-tab') {state.reviewTab=id;state.pages.reviews=1;render();return;}
      if(name==='stat') {
        const n=Number(id);
        if(n===1) {state.reviewTab='pending';navigate('reviews');}
        else if(n===3) navigate('logs');
        else {state.filters.tasks=n===2?{overdue:'yes'}:{};state.pages.tasks=1;navigate('tasks');}
        return;
      }
      if(!state.data) return;
      if(name==='task-detail') return taskDetail(id);
      if(name==='new-task') return taskForm();
      if(name==='edit-task') return taskForm(id);
      if(name==='request-detail') return requestDetail(id);
      if(name==='new-user') return userForm();
      if(name==='edit-user') return userForm(id);
      if(name==='reset-password') return passwordForm(id);
      if(name==='log-detail') return logDetail(id);
      if(name==='announcement-detail') return announcementDetail(id);
      if(name==='new-announcement') return announcementForm();
      if(name==='edit-announcement') return announcementForm(id);
      if(name==='delete-task') {
        const t=state.data.tasks.find(t=>t.id===id);
        return confirmAction('提交任务删除申请？','“'+t.title+'”将在另一位管理员或创始人审核通过后归档。',()=>mutate(()=>api('/tasks/requests',{method:'POST',body:{kind:'delete',taskId:id}}),'删除申请已提交，等待审核'),true);
      }
      if(name==='approve-request') {
        const r=state.data.requests.find(r=>r.id===id);
        const reason=$('review-form').elements.reason.value.trim();
        return confirmAction('通过这项申请？','审核通过后，“'+r.taskTitle+'”的'+(kinds[r.kind]||'变更')+'将立即生效。',()=>mutate(()=>api('/tasks/requests/'+encodeURIComponent(id)+'/review',{method:'POST',body:{approve:true,reason}}),'申请已通过'));
      }
      if(name==='toggle-pin') {
        const a=state.data.announcements.find(a=>a.id===id);
        return void mutate(()=>api('/admin/announcements/'+encodeURIComponent(id),{method:'PUT',body:{...a,pinned:!a.pinned}}),a.pinned?'已取消置顶':'公告已置顶');
      }
      if(name==='delete-announcement') {
        const a=state.data.announcements.find(a=>a.id===id);
        return confirmAction('删除这条公告？','“'+a.title+'”删除后无法恢复，请确认。',()=>mutate(()=>api('/admin/announcements/'+encodeURIComponent(id),{method:'DELETE'}),'公告已删除'),true);
      }
    } catch(error) {toast(error.message,true);}
  });
  // Clicking outside the sidebar dismisses the compact navigation.
  document.addEventListener('click',event=>{
    if(!event.target.closest('.sidebar,.mobile-menu')) $('app-view').classList.remove('menu-open');
  });
  document.addEventListener('change',event=>{
    if(!event.target.matches('#filter-form [data-filter]')) return;
    applyFilters($('filter-form'));
  });
  function applyFilters(form) {
    const data=Object.fromEntries(new FormData(form));
    if(data.from&&data.to&&data.from>data.to) return toast('开始日期不能晚于结束日期',true);
    state.filters[state.page]=data;state.pages[state.page]=1;render();
  }
  document.addEventListener('submit',event=>{
    const form=event.target;
    if(!['login-form','filter-form','task-form','review-form','user-form','password-form','announcement-form','confirm-form'].includes(form.id)) return;
    event.preventDefault();
    if(form.id==='login-form') return;
    if(state.busy) return;
    if(form.id==='filter-form') return applyFilters(form);
    if(form.id==='confirm-form') return void confirmCallback?.();
    const data=Object.fromEntries(new FormData(form)),id=dialogContext?.id;
    try {
      if(form.id==='task-form') {
        const owners=new FormData(form).getAll('owners');
        if(!owners.length) throw new Error('请至少选择一位负责人');
        const values={title:data.title.trim(),detail:data.detail.trim(),dueAt:data.dueAt,priority:data.priority,owners};
        return void mutate(()=>api('/tasks/requests',{method:'POST',body:{kind:id?'edit':'create',taskId:id||undefined,values}}),'任务'+(id?'编辑':'创建')+'申请已提交，等待审核');
      }
      if(form.id==='review-form') {
        const reason=data.reason.trim();
        if(!reason) throw new Error('驳回申请时必须填写原因');
        return confirmAction('驳回这项申请？','驳回原因：'+reason,()=>mutate(()=>api('/tasks/requests/'+encodeURIComponent(id)+'/review',{method:'POST',body:{approve:false,reason}}),'申请已驳回'),true);
      }
      if(form.id==='user-form') {
        const body={name:data.name.trim(),department:data.department.trim(),role:data.role,enabled:data.enabled==='on',login:data.login.trim()};
        return void mutate(()=>api('/admin/users'+(id?'/'+encodeURIComponent(id):''),{method:id?'PUT':'POST',body}),id?'成员信息已更新':'成员已创建，初始密码与账号相同');
      }
      if(form.id==='password-form') {
        if(data.password!==data.confirmPassword) throw new Error('两次输入的密码不一致');
        if(new TextEncoder().encode(data.password).length>72) throw new Error('新密码不能超过 72 字节');
        return void mutate(()=>api('/admin/users/'+encodeURIComponent(id)+'/password',{method:'POST',body:{password:data.password}}),'密码已重置，原登录状态已失效');
      }
      if(form.id==='announcement-form') {
        const body={title:data.title.trim(),category:data.category.trim(),content:data.content.trim(),pinned:data.pinned==='on'};
        return void mutate(()=>api('/admin/announcements'+(id?'/'+encodeURIComponent(id):''),{method:id?'PUT':'POST',body}),id?'公告已更新':'公告已发布');
      }
    } catch(error) {showFormError(error);}
  });
  $('login-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.target,button=form.querySelector('button');
    if(button.disabled) return;
    button.disabled=true;button.textContent='正在登录…';$('login-error').hidden=true;
    try {
      const body=Object.fromEntries(new FormData(form));body.username=body.username.trim();
      const result=await api('/auth/login',{method:'POST',body});
      if(!['ADMIN','FOUNDER'].includes(result.user?.role)) throw new Error('仅管理员和创始人可登录管理后台');
      localStorage.setItem(tokenKey,result.token);
      await enter(result.user);
    } catch(error) {$('login-error').textContent=error.message;$('login-error').hidden=false;}
    finally {button.disabled=false;button.innerHTML='登录工作台 <span>→</span>';}
  });
  for(const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('cancel',event=>{if(state.busy) event.preventDefault();});
    dialog.addEventListener('click',event=>{if(event.target===dialog&&!state.busy){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom) dialog.close();}});
    dialog.addEventListener('close',()=>{
      if(dialog.id==='confirm-dialog') confirmCallback=null;
      if(!document.querySelector('dialog[open]')) document.body.style.overflow='';
    });
    new MutationObserver(()=>{if(dialog.open) document.body.style.overflow='hidden';}).observe(dialog,{attributes:true,attributeFilter:['open']});
  }
  async function init() {
    if(!localStorage.getItem(tokenKey)) return logout(false);
    try {await enter(await api('/auth/me'));}
    catch(error) {logout(false);$('login-error').textContent=error.message;$('login-error').hidden=false;}
  }
  init();
})();

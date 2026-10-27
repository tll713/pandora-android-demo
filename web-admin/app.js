/* 潘多拉管理端 · 原生 HTML / CSS / JavaScript */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const paths = {
    highlights:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17h7m-3.5-3.5v7"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v1"/>',
    announcements:'<path d="m4 10 15-6v15L4 14v-4Zm1 4 2 7h4l-2-5m10-6h2v4h-2"/>',
    plus:'<path d="M12 5v14M5 12h14"/>', search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    refresh:'<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    logout:'<path d="M10 3H5v18h5m-1-9h12m-5-5 5 5-5 5"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>'
  };
  const icon = name => '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">'+(paths[name] || paths.info)+'</svg>';
  const roles = {ADMIN:'管理员',FOUNDER:'创始人',DEPT_MANAGER:'部门负责人',TEAM_LEAD:'团队长',EMPLOYEE:'员工'};
  const pages = {
    users:['组织与账号','ORGANIZATION & ACCOUNTS','管理公司成员、部门与账号'],
    announcements:['公司公告','COMPANY ANNOUNCEMENTS','发布并维护公司通知'],
    highlights:['十大内容','TOP TEN HIGHLIGHTS','录入与维护 App 首页的公司事项、派发任务和个人事项']
  };
  const highlightKinds={company:'公司十大重要事项',dispatch:'公司十大派发任务',personal:'个人十大重要事项'};
  const tokenKey = 'pandora.admin.token';
  const state = {user:null,page:'users',data:null,filters:{},pages:{},loading:false,error:'',busy:false,session:0,load:0};
  let toastTimer, dialogContext=null, confirmCallback=null;
  const tag = (text,color='') => '<span class="tag '+color+'">'+esc(text)+'</span>';
  const member = id => state.data?.users.find(u=>u.id===id);
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
    navigate(pages[location.hash.slice(1)]?location.hash.slice(1):'users',true); await reload();
  }
  async function reload() {
    if(!state.user) return;
    const session=state.session, load=++state.load;
    state.loading=true; state.error=''; render();
    $('refresh-btn').disabled=true;
    try {
      const [users,announcements,highlights,tasks]=await Promise.all([
        api('/admin/users'),api('/announcements'),api('/admin/highlights'),api('/admin/tasks')
      ]);
      if(session!==state.session || load!==state.load) return;
      state.data={users,announcements,highlights,tasks};
      $('refresh-time').textContent='更新于 '+new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
    } catch(error) { if(session===state.session && load===state.load) state.error=error.message; }
    finally {
      if(session===state.session && load===state.load) {state.loading=false;$('refresh-btn').disabled=false;render();}
    }
  }
  function navigate(page,updateHash=true) {
    if(!pages[page]) page='users';
    state.page=page;
    if(updateHash && location.hash!=='#'+page) history.pushState(null,'','#'+page);
    $('app-view').classList.remove('menu-open'); render();
  }
  window.addEventListener('hashchange',()=>{if(state.user) navigate(location.hash.slice(1),false);});
  window.addEventListener('popstate',()=>{if(state.user) navigate(location.hash.slice(1),false);});
  function nav() {
    $('navigation').innerHTML=Object.entries(pages).map(([key,value])=>
      '<a class="nav-item '+(state.page===key?'active':'')+'" href="#'+key+'" '+(state.page===key?'aria-current="page"':'')+'>'+icon(key)+value[0]+'</a>'
    ).join('');
  }
  function render() {
    if(!state.user) return;
    nav();
    const meta=pages[state.page];
    $('breadcrumb-title').textContent=meta[0]; $('page-title').textContent=meta[0]; $('page-kicker').textContent=meta[1]; $('page-description').textContent=meta[2];
    const primary=$('primary-action');
    const primaryMap={users:['new-user','添加成员'],announcements:['new-announcement','发布公告'],highlights:['new-highlight','录入十大内容']};
    const next=primaryMap[state.page];
    primary.hidden=!next || (state.page==='users' && state.user.role!=='ADMIN');
    primary.disabled=state.loading || !!state.error || !state.data;
    if(next) {primary.dataset.action=next[0];primary.innerHTML=icon('plus')+next[1];}
    if(state.loading) {$('page-content').innerHTML='<div class="loading-state"><span class="spinner"></span>正在加载管理数据…</div>';return;}
    if(state.error) {$('page-content').innerHTML='<section class="panel">'+empty('数据加载失败',state.error,'refresh','重新加载')+'</section>';return;}
    if(!state.data) return;
    $('page-content').innerHTML=({users:usersPage,announcements:announcementsPage,highlights:highlightsPage})[state.page]();
  }
  function empty(title='暂无匹配结果',description='试试调整筛选条件，或稍后再来查看。',button='',label='') {
    return '<div class="empty-state"><div class="empty-icon">'+icon(state.page)+'</div><h3>'+esc(title)+'</h3><p>'+esc(description)+'</p>'+(button?action(button,'',esc(label),'btn'):'')+'</div>';
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
  function usersPage() {
    const f=filters(), departments=[...new Set(state.data.users.map(u=>u.department))].sort();
    const list=state.data.users.filter(u=>searchMatch(u.name+' '+(u.phone||'')+' '+u.department)&&(!f.department||u.department===f.department)&&(!f.role||u.role===f.role)&&(!f.enabled||(u.enabled!==false)===(f.enabled==='yes'))).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
    const p=paginated(list);
    return '<div class="section-note">'+icon('info')+(state.user.role==='ADMIN'?'管理员可维护普通成员账号；管理员与创始人账号受保护。':'你可以查看全体成员；账号创建、编辑和密码重置由管理员维护。')+'</div>'+
      toolbar(selectFilter('department','部门',departments.map(d=>[d,d]))+selectFilter('role','角色',Object.entries(roles))+selectFilter('enabled','账号状态',[['yes','正常'],['no','已停用']]))+
      table('团队成员',['成员','手机号','部门','角色','账号状态','操作'],p.items.map(u=>cell('<div class="member-cell"><span class="avatar">'+esc(u.name.slice(-1))+'</span><strong>'+esc(u.name)+'</strong></div>')+cell(esc(u.phone||'未填写，可用姓名登录'))+cell(esc(u.department))+cell(tag(roles[u.role],u.role==='ADMIN'?'purple':u.role==='FOUNDER'?'amber':'green'))+cell(tag(u.enabled===false?'已停用':'正常',u.enabled===false?'':'green'))+cell(state.user.role==='ADMIN'&&!['ADMIN','FOUNDER'].includes(u.role)?'<div class="row-actions">'+action('edit-user',u.id,'编辑')+action('reset-password',u.id,'重置密码')+'</div>':'<span class="cell-sub">'+(['ADMIN','FOUNDER'].includes(u.role)?'受保护账号':'仅管理员可维护')+'</span>')),list.length,p.footer);
  }
  function sortAnnouncements(items) {return [...items].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||b.date.localeCompare(a.date)||a.id.localeCompare(b.id));}
  function highlightsPage() {
    const f=filters();
    const list=state.data.highlights.filter(h=>(!f.kind||h.kind===f.kind)&&(!f.audience||h.audience===f.audience)&&(!f.enabled||h.enabled===(f.enabled==='yes'))&&searchMatch(h.title+' '+h.content+' '+(member(h.audience)?.name||'')))
      .sort((a,b)=>a.kind.localeCompare(b.kind)||a.audience.localeCompare(b.audience)||a.position-b.position);
    const p=paginated(list);
    return '<div class="section-note">'+icon('info')+'每个公司板块最多 10 项；个人板块按成员分别维护 10 项。展示位置决定 App 首页顺序，停用后不展示。派发内容关联已审核生效的任务。</div>'+
      '<div class="highlight-summary">'+Object.entries(highlightKinds).map(([kind,label])=>'<div><span>'+label+'</span><strong>'+state.data.highlights.filter(h=>h.kind===kind&&h.enabled).length+'</strong><small>'+(kind==='personal'?'已发布 · 各成员独立展示':'已发布 / 10')+'</small></div>').join('')+'</div>'+
      toolbar(selectFilter('kind','板块',Object.entries(highlightKinds))+selectFilter('audience','展示对象',state.data.users.map(u=>[u.id,u.name]))+selectFilter('enabled','发布状态',[['yes','已发布'],['no','已停用']]))+
      table('十大内容',['位置','内容','所属板块','展示对象','发布状态','操作'],p.items.map(h=>cell('<span class="highlight-position">'+String(h.position).padStart(2,'0')+'</span>')+cell('<button class="row-link highlight-title" data-action="highlight-detail" data-id="'+esc(h.id)+'">'+esc(h.title)+'</button><div class="cell-sub highlight-excerpt">'+esc(h.content)+'</div>')+cell(esc(highlightKinds[h.kind]))+cell(esc(h.kind==='personal'?member(h.audience)?.name||h.audience:h.kind==='dispatch'?'关联任务的可见成员':'全体成员'))+cell(tag(h.enabled?'已发布':'已停用',h.enabled?'green':''))+cell('<div class="row-actions">'+action('edit-highlight',h.id,'编辑')+action('toggle-highlight',h.id,h.enabled?'停用':'发布')+action('delete-highlight',h.id,'删除','row-link danger')+'</div>')),list.length,p.footer);
  }
  function highlightDetail(id) {
    const h=state.data.highlights.find(h=>h.id===id); if(!h) return;
    const task=state.data.tasks.find(t=>t.id===h.taskId);
    openDialog(h.title,detailGrid([['板块',highlightKinds[h.kind]],['展示位置','第 '+h.position+' 项'],['展示对象',h.kind==='personal'?member(h.audience)?.name||h.audience:h.kind==='dispatch'?'关联任务的可见成员':'全体成员'],['状态',h.enabled?'已发布':'已停用']])+'<section class="detail-section"><div class="prose">'+esc(h.content)+'</div></section>'+(h.taskId?'<section class="detail-section"><h3>关联派发任务</h3><div class="prose">'+esc(task?task.title+'\n截止：'+task.dueAt.replace('T',' ')+'\n负责人：'+(task.ownerNames||task.owners?.map(id=>member(id)?.name||id)||[]).join('、'):'任务已归档，App 不再展示此派发项')+'</div></section>':'')+'<div class="detail-actions">'+action('edit-highlight',h.id,'编辑内容','btn primary')+'</div>','TOP TEN');
  }
  function highlightForm(id='') {
    const h=state.data.highlights.find(h=>h.id===id);
    const kind=h?.kind||filters().kind||'company', audience=h?.audience||filters().audience||'';
    const occupied=state.data.highlights.filter(x=>x.kind===kind&&x.audience===(kind==='personal'?audience:'')).map(x=>x.position);
    const position=h?.position||Array.from({length:10},(_,i)=>i+1).find(n=>!occupied.includes(n))||1;
    openDialog(h?'编辑十大内容':'录入十大内容','<form id="highlight-form"><div class="form-grid"><label>所属板块<select name="kind">'+Object.entries(highlightKinds).map(([k,label])=>'<option value="'+k+'" '+(kind===k?'selected':'')+'>'+label+'</option>').join('')+'</select></label><label>展示位置<select name="position">'+Array.from({length:10},(_,i)=>'<option value="'+(i+1)+'" '+(position===i+1?'selected':'')+'>第 '+(i+1)+' 项</option>').join('')+'</select></label><label class="full" data-highlight-audience>个人展示对象<select name="audience"><option value="">请选择成员</option>'+state.data.users.filter(u=>u.enabled!==false||u.id===audience).map(u=>'<option value="'+esc(u.id)+'" '+(audience===u.id?'selected':'')+'>'+esc(u.name+' · '+u.department)+'</option>').join('')+'</select></label><label class="full" data-highlight-task>关联派发任务<select name="taskId"><option value="">请选择已生效任务</option>'+state.data.tasks.map(t=>'<option value="'+esc(t.id)+'" '+(h?.taskId===t.id?'selected':'')+'>'+esc(t.title)+'</option>').join('')+'</select><small class="form-hint">任务本身的创建、修改仍需在 App 提交申请并审核。</small></label><label class="full">展示标题<input name="title" required maxlength="120" value="'+esc(h?.title||'')+'" placeholder="输入首页展示标题"></label><label class="full">详细内容<textarea name="content" required maxlength="20000" rows="8" placeholder="输入具体事务、工作安排或注意事项">'+esc(h?.content||'')+'</textarea></label><label class="check-label full"><input type="checkbox" name="enabled" '+(h?.enabled!==false?'checked':'')+'>发布到 App 首页</label><p class="form-hint full">每个板块的展示位置不可重复；个人事项仅向所选成员展示。保存后 App 刷新即可看到最新内容。</p></div>'+formActions(h?'保存修改':'保存内容')+'</form>','TOP TEN EDIT',{type:'highlight-form',id});
    updateHighlightFields();
  }
  function updateHighlightFields() {
    const form=$('highlight-form'); if(!form) return;
    const kind=form.elements.kind.value;
    for(const [selector,name,visible] of [['[data-highlight-audience]','audience',kind==='personal'],['[data-highlight-task]','taskId',kind==='dispatch']]) {
      form.querySelector(selector).hidden=!visible; form.elements[name].disabled=!visible; form.elements[name].required=visible;
    }
  }
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
  function userForm(id='') {
    if(state.user.role!=='ADMIN') return toast('只有管理员可以维护账号',true);
    const u=member(id);
    if(id&&(!u||['ADMIN','FOUNDER'].includes(u.role))) return toast('此账号受保护，不能在此修改',true);
    openDialog(u?'编辑成员':'添加成员','<form id="user-form"><div class="form-grid"><label>姓名<input name="name" required maxlength="30" value="'+esc(u?.name||'')+'" placeholder="请输入姓名"></label><label>手机号<input type="tel" name="phone" required maxlength="24" value="'+esc(u?.phone||'')+'" autocomplete="tel" placeholder="用于手机号登录"></label><label>性别<select name="gender"><option value="">未填写</option>'+['男','女','其他'].map(g=>'<option '+(u?.gender===g?'selected':'')+'>'+g+'</option>').join('')+'</select></label><label>身份证号<input name="idNumber" maxlength="18" pattern="[0-9]{17}[0-9Xx]" value="'+esc(u?.idNumber||'')+'" placeholder="选填，18 位"></label><label>部门<input name="department" required maxlength="40" value="'+esc(u?.department||'')+'" list="department-options" placeholder="输入或选择部门"><datalist id="department-options">'+[...new Set(state.data.users.map(u=>u.department))].map(d=>'<option value="'+esc(d)+'">').join('')+'</datalist></label><label>角色<select name="role">'+['EMPLOYEE','TEAM_LEAD','DEPT_MANAGER'].map(r=>'<option value="'+r+'" '+(u?.role===r?'selected':'')+'>'+roles[r]+'</option>').join('')+'</select></label>'+
      (u?'<label class="check-label full"><input type="checkbox" name="enabled" '+(u.enabled!==false?'checked':'')+'>启用此账号</label><p class="form-hint full">成员可用手机号或姓名登录。停用后无法登录，重新启用后需重新登录。</p>':'<p class="form-hint full">成员可用手机号或姓名登录。创建时自动生成 18 位强密码，只在创建成功后展示一次，请妥善交付给本人。</p>')+'</div>'+formActions(u?'保存修改':'创建成员')+'</form>','TEAM MEMBER',{type:'user-form',id});
  }
  function passwordForm(id) {
    const u=member(id);
    if(state.user.role!=='ADMIN'||!u||['ADMIN','FOUNDER'].includes(u.role)) return toast('无法重置此账号的密码',true);
    openDialog('重置密码',detailGrid([['成员',u.name],['手机号',u.phone||'未填写，可用姓名登录']])+'<form id="password-form"><div class="form-grid"><label class="full">新密码<input type="password" name="password" autocomplete="new-password" minlength="8" maxlength="64" required placeholder="设置 8～64 位新密码"></label><label class="full">确认新密码<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" maxlength="64" required placeholder="再次输入新密码"></label><p class="form-hint full">密码重置成功后，该成员的原登录状态将立即失效。</p></div>'+formActions('确认重置密码')+'</form>','ACCOUNT SECURITY',{type:'password-form',id});
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
  async function mutate(operation,message,onSuccess) {
    if(state.busy) return;
    state.busy=true;
    const session=state.session;
    const controls=[...document.querySelectorAll('dialog button,dialog input,dialog textarea,dialog select')];
    const disabled=controls.map(el=>el.disabled);
    controls.forEach(el=>el.disabled=true);
    try {
      const result=await operation();
      if(session!==state.session) return;
      $('confirm-dialog').close(); $('detail-dialog').close(); dialogContext=null; confirmCallback=null;
      toast(message); await reload();
      if(session===state.session) onSuccess?.(result);
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
      if(name.startsWith('go-')) return navigate(name.slice(3));
      if(!state.data) return;
      if(name==='new-user') return userForm();
      if(name==='new-highlight') return highlightForm();
      if(name==='edit-highlight') return highlightForm(id);
      if(name==='highlight-detail') return highlightDetail(id);
      if(name==='toggle-highlight') {
        const h=state.data.highlights.find(h=>h.id===id);
        return void mutate(()=>api('/admin/highlights/'+encodeURIComponent(id),{method:'PUT',body:{...h,enabled:!h.enabled}}),h.enabled?'内容已停用':'内容已发布');
      }
      if(name==='delete-highlight') {
        const h=state.data.highlights.find(h=>h.id===id);
        return confirmAction('删除这项内容？','“'+h.title+'”将从十大展示项中移除，关联任务仍可在任务视图查看。',()=>mutate(()=>api('/admin/highlights/'+encodeURIComponent(id),{method:'DELETE'}),'内容已删除'),true);
      }
      if(name==='edit-user') return userForm(id);
      if(name==='reset-password') return passwordForm(id);
      if(name==='announcement-detail') return announcementDetail(id);
      if(name==='new-announcement') return announcementForm();
      if(name==='edit-announcement') return announcementForm(id);
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
    if(event.target.matches('#highlight-form [name="kind"]')) return updateHighlightFields();
    if(event.target.matches('#highlight-form [name="taskId"]')) {
      const task=state.data.tasks.find(t=>t.id===event.target.value), form=$('highlight-form');
      if(task) {if(!form.elements.title.value) form.elements.title.value=task.title;if(!form.elements.content.value) form.elements.content.value=task.detail||task.title;}
      return;
    }
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
    if(!['login-form','filter-form','user-form','password-form','announcement-form','highlight-form','confirm-form'].includes(form.id)) return;
    event.preventDefault();
    if(form.id==='login-form') return;
    if(state.busy) return;
    if(form.id==='filter-form') return applyFilters(form);
    if(form.id==='confirm-form') return void confirmCallback?.();
    const data=Object.fromEntries(new FormData(form)),id=dialogContext?.id;
    try {
      if(form.id==='highlight-form') {
        const body={kind:data.kind,audience:data.audience||'',position:Number(data.position),taskId:data.taskId||null,title:data.title.trim(),content:data.content.trim(),enabled:data.enabled==='on'};
        return void mutate(()=>api('/admin/highlights'+(id?'/'+encodeURIComponent(id):''),{method:id?'PUT':'POST',body}),id?'十大内容已更新':'十大内容已保存');
      }
      if(form.id==='user-form') {
        const body={name:data.name.trim(),phone:data.phone.trim(),gender:data.gender,idNumber:data.idNumber.trim(),department:data.department.trim(),role:data.role,enabled:data.enabled==='on'};
        return void mutate(()=>api('/admin/users'+(id?'/'+encodeURIComponent(id):''),{method:id?'PUT':'POST',body}),id?'成员信息已更新':'成员已创建',id?undefined:created=>{
          openDialog('成员已创建',detailGrid([['姓名',created.name],['手机号',created.phone]])+'<p class="form-hint">初始密码仅展示本次，请复制并通过可靠方式交给本人。关闭后不能再次查看，遗失可重置。</p><label>初始强密码<input id="temporary-password" readonly value="'+esc(created.temporaryPassword)+'" aria-label="初始强密码" autocomplete="off"></label><div class="form-actions">'+action('close-dialog','','已保存密码','btn primary')+'</div>','ACCOUNT CREATED');
        });
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
      const body=Object.fromEntries(new FormData(form));body.identifier=body.identifier.trim();
      const result=await api('/auth/login',{method:'POST',body});
      if(!['ADMIN','FOUNDER'].includes(result.user?.role)) throw new Error('仅管理员和创始人可登录管理后台');
      localStorage.setItem(tokenKey,result.token);
      await enter(result.user);
    } catch(error) {$('login-error').textContent=error.message;$('login-error').hidden=false;}
    finally {button.disabled=false;button.innerHTML='登录管理端 <span>→</span>';}
  });
  for(const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('cancel',event=>{if(state.busy) event.preventDefault();});
    dialog.addEventListener('click',event=>{if(event.target===dialog&&!state.busy){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom) dialog.close();}});
    dialog.addEventListener('close',()=>{
      if(dialog.id==='detail-dialog'&&!dialog.open) {$('dialog-content').innerHTML='';dialogContext=null;}
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

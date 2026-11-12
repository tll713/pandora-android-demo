import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium, browserChannel } from '../../scripts/browser-test.mjs';
const browser = await chromium.launch({ channel: browserChannel, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const member = { id: 'admin', name: '系统管理员', role: 'ADMIN', department: '管理中心' };
const founder = {id:'founder',name:'创始人',role:'FOUNDER',department:'管理中心'};
const employee = {id:'employee',name:'普通成员',role:'EMPLOYEE',department:'产品设计部'};
let current = member, failTagSave = false, taskRequests = 0;
const tags = [
  { id: 'design', name: '设计', color: '#1abc9c' },
  { id: 'meeting', name: '会议 <评审>', color: '#9b59b6' },
  { id: 'light', name: '浅色标签', color: '#ffffff' },
  { id: 'dark', name: '深色标签', color: '#000000' }
];
const tasks = [...tags.map(tag => ({ id: tag.id, tagId: tag.id })), { id: 'untagged' }, { id: 'removed', tagId: 'removed-tag' }]
  .map((task, index) => ({ title: `任务 ${task.id}`, owners: ['admin'], creator: 'admin', priority: 'high', status: index === 1 ? 'done' : 'doing',
    startAt: index === 0 ? '2026-11-02T09:00' : '2026-11-03T09:00', dueAt: '2026-11-03T18:00', createdAt: '2026-11-01T09:00', detail: '查看任务标签与颜色', history: [], ...task }));
const db = { members: [member,founder,employee], tasks, tags, logs: [], requests: [], announcements: [], highlights: [], pins: {} };
await page.clock.install({ time: new Date('2026-11-03T12:00:00+08:00') });
await page.route('**/api/**', route => {
  const calendarUrl = new URL(route.request().url());
  if (calendarUrl.pathname === '/api/calendar/metadata') return route.fulfill({json:{year:Number(calendarUrl.searchParams.get('year')),published:false,source:'',holidays:{},solarTerms:{}}});
  const req = route.request(), url = new URL(req.url()), reply = (json,status=200) => route.fulfill({status,json});
  if(url.pathname.endsWith('/auth/login')) return reply({token:'tag-ui-token',user:current});
  if(url.pathname.endsWith('/workspace')) return reply({user:current,db});
  if(url.pathname==='/api/tags') return reply(tags);
  if(url.pathname.startsWith('/api/admin/tags')) {
    if(failTagSave) return reply({error:'标签保存失败，请重试'},500);
    const values = req.postDataJSON(), id = url.pathname.split('/')[4];
    const tag = id ? tags.find(tag => tag.id===id) : {id:`new-${tags.length}`};
    Object.assign(tag,values); if(!id) tags.push(tag);
    return reply(tag);
  }
  if(url.pathname==='/api/tasks/requests') {taskRequests++; return reply({ok:true});}
  return reply({error:'Unexpected API'},404);
});
const computedColors = locator => locator.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, text: getComputedStyle(el).color }));
const expected = Object.fromEntries(tags.map(tag => {
  const rgb = [1,3,5].map(offset => parseInt(tag.color.slice(offset,offset+2),16));
  return [tag.id,{background:`rgb(${rgb.map(v => Math.round(v*0.12+255*0.88)).join(', ')})`,text:`rgb(${rgb.map(v => Math.round(v*0.44)).join(', ')})`}];
}));
const luminance = color => {
  const channels = color.match(/\d+/g).map(Number).map(v => v/255).map(v => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4);
  return channels[0]*0.2126 + channels[1]*0.7152 + channels[2]*0.0722;
};
try {
  await page.goto(process.env.PANDORA_URL || 'http://127.0.0.1:5173');
  await page.locator('[name=identifier]').fill(member.name);
  await page.locator('[name=password]').fill('admin');
  await page.locator('[data-form=login] button[type=submit]').click();
  await page.locator('[data-route=calendar]').click();
  assert.equal(await page.locator('.month-task-span').evaluateAll(els => els.filter(el => el.dataset.spanStart <= '2026-11-03' && el.dataset.spanEnd >= '2026-11-03').length),3);
  assert.equal(await page.locator('.month-task-span[data-id=design]').getAttribute('data-span-start'),'2026-11-02');
  assert.equal(await page.locator('.month-task-span[data-id=design]').getAttribute('data-span-end'),'2026-11-03');
  await page.locator('[data-event-day="2026-11-03"] .calendar-more').click();
  assert.equal(await page.locator('.overflow-task').count(),6);
  for (const tag of tags) {
    const badge = page.locator(`.overflow-task[data-id=${tag.id}] .task-tag`);
    const colors = await computedColors(badge);
    assert.deepEqual(colors,expected[tag.id]);
    const contrast = (luminance(colors.background)+0.05)/(luminance(colors.text)+0.05);
    assert.ok(contrast>=4.5,`readable label ${tag.id}: ${contrast}`);
    assert.equal(await badge.innerText(),tag.name);
    assert.equal(await badge.locator('> *').count(),0);
  }
  await page.locator('[data-close]').click();
  await page.locator('.calendar-selected-agenda [data-mode=day]').click();
  for (const tag of tags) {
    const event = page.locator(`.timeline-item[data-id=${tag.id}]`);
    assert.deepEqual(await computedColors(event),expected[tag.id]);
    await event.click();
    assert.equal(await page.locator('.task-tag').innerText(),tag.name);
    await page.locator('[data-close]').click();
  }
  const fallbackColors = await computedColors(page.locator('.timeline-item[data-id=untagged]'));
  assert.deepEqual(await computedColors(page.locator('.timeline-item[data-id=removed]')),fallbackColors);
  await page.locator('[data-task-view=list]').click();
  assert.equal(await page.locator('.task-table .task-tag').count(),6);
  await page.locator('[data-action=new-task]').click();
  const choice = page.locator('.tag-choice').filter({hasText:tags[1].name});
  await choice.click(); assert.equal(await choice.locator('input').isChecked(),true);
  assert.deepEqual(await computedColors(choice),expected.meeting);
  await page.locator('[name="title"]').fill('保留尚未提交的任务草稿');
  await page.locator('[data-action="tag-new"]').click();
  await page.locator('[name="tagName"]').fill('跨账号共享 <标签>');
  await page.locator('[name="tagColor"]').fill('#a7bfb4');
  failTagSave=true;
  await page.locator('[data-action="tag-save"]').click();
  await page.getByRole('alert').filter({hasText:'标签保存失败，请重试'}).waitFor();
  assert.equal(await page.locator('[name="title"]').inputValue(),'保留尚未提交的任务草稿');
  failTagSave=false;
  await page.locator('[data-action="tag-save"]').click();
  await page.locator('.tag-choice').filter({hasText:'跨账号共享 <标签>'}).waitFor();
  assert.equal(await page.locator('.tag-choice').filter({hasText:'跨账号共享 <标签>'}).locator('input').isChecked(),true);
  const savedTag = tags.at(-1);
  await page.locator(`[data-action="tag-edit"][data-id="${savedTag.id}"]`).evaluate(el => el.closest('details').open=true);
  await page.locator(`[data-action="tag-edit"][data-id="${savedTag.id}"]`).click();
  await page.locator('[name="tagName"]').fill('修改后的共享标签');
  await page.locator('[data-action="tag-save"]').click();
  await page.locator('.tag-choice').filter({hasText:'修改后的共享标签'}).waitFor();
  assert.equal(taskRequests,0,'tag buttons never submit the task application');
  assert.equal(await page.locator('[name="title"]').inputValue(),'保留尚未提交的任务草稿');
  await mkdir('output/playwright',{recursive:true});
  for(const width of [390,1280]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.locator('#modal').evaluate(el => el.scrollWidth>el.clientWidth),false);
    await page.screenshot({path:`output/playwright/task-tag-management-${width}.png`,fullPage:true});
  }
  for(const role of ['FOUNDER','DEPT_MANAGER','TEAM_LEAD','EMPLOYEE']) {
    current = role==='FOUNDER' ? founder : {...employee,role};
    await page.reload(); await page.locator('[data-route="calendar"]').click();
    await page.locator('[data-action="new-task"]').click();
    await page.locator('[data-form="task"]').waitFor();
    assert.equal(await page.locator('[data-action="tag-new"]').count(),role==='FOUNDER'?1:0);
    assert.equal(await page.locator('[data-action="tag-edit"]').count(),role==='FOUNDER'?tags.length:0);
    assert.equal(await page.locator('.tag-choice').filter({hasText:'修改后的共享标签'}).count(),1);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['pastel labels with WCAG AA contrast including white and black source colors','three month items plus expandable overflow','escaped label names','cross-day and completed tasks retain colors','removed labels use safe fallback','task list labels and colored selection','create and edit shared tags without submitting or losing task drafts','save failure and retry','tag creation and editing restricted to admin and founder','updated tags visible to founders, department managers, team leads and employees','tag management fits mobile and desktop dialogs']},null,2));
} finally { await browser.close(); }

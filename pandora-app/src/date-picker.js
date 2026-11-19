// Shared picker keeps the original form input and its validation/change handlers.
const pad = value => String(value).padStart(2, '0');
const key = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
let picker, active;
const validYear = value => /^[1-9]\d{3}$/.test(value);
const selectedValue = () => active.selected + (active.time ? `T${active.hour}:${active.minute}` : '');
const withinRange = value => value >= active.min && (!active.max || value <= active.max);
function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4)) < 1000) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && key(date) === value;
}

function selectMonth(year, month) {
  const day = Math.min(Number(active.selected.slice(8, 10)), new Date(year, month + 1, 0).getDate());
  active.month = new Date(year, month, 1, 12);
  active.selected = key(new Date(year, month, day, 12));
  active.yearText = String(year);
}

export function pickDate({ value = key(new Date()), min = '', max = '', time = false, title = '选择日期', onSelect }) {
  if (!picker) {
    picker = document.createElement('dialog');
    picker.id = 'date-picker'; picker.className = 'date-picker';
    picker.setAttribute('aria-labelledby', 'date-picker-title');
    document.body.append(picker);
    picker.addEventListener('click', event => {
      const control = event.target.closest('button');
      if (!control) return;
      if (control.hasAttribute('data-picker-close')) return picker.close();
      if (control.dataset.pickerDay) { active.selected = control.dataset.pickerDay; return draw(`[data-picker-day="${active.selected}"]`); }
      if (control.dataset.pickerQuick) {
        const day = new Date(); day.setDate(day.getDate() + Number(control.dataset.pickerQuick));
        active.selected = key(day); active.yearText = String(day.getFullYear()); active.month = new Date(day.getFullYear(), day.getMonth(), 1); return draw('[data-picker-quick]');
      }
      if (control.hasAttribute('data-picker-apply')) {
        const selected = selectedValue();
        if (!validYear(active.yearText) || !withinRange(selected)) return;
        const callback = active.onSelect; picker.close(); callback(selected);
      }
    });
    picker.addEventListener('change', event => {
      if (event.target.matches('[data-picker-year-choice]')) {
        selectMonth(Number(event.target.value), active.month.getMonth());
        draw('[data-picker-year-choice]');
      }
      if (event.target.matches('[data-picker-month]')) {
        selectMonth(active.month.getFullYear(), Number(event.target.value));
        draw('[data-picker-month]');
      }
      if (event.target.matches('[data-picker-hour],[data-picker-minute]')) {
        active.hour = picker.querySelector('[data-picker-hour]').value;
        active.minute = picker.querySelector('[data-picker-minute]').value;
        updateApply();
      }
    });
    const editYear = event => {
      if (event.isComposing || !event.target.matches('[data-picker-year]')) return;
      active.yearText = event.target.value;
      if (validYear(active.yearText)) selectMonth(Number(active.yearText),active.month.getMonth());
      draw('[data-picker-year]');
    };
    picker.addEventListener('input',editYear);
    picker.addEventListener('compositionend',editYear);
    picker.addEventListener('keydown',event => {
      if (event.isComposing || event.key !== 'Enter' || !event.target.matches('[data-picker-year]')) return;
      event.preventDefault();
      if (validYear(active.yearText)) picker.querySelector('[data-picker-month]').focus();
      else event.target.reportValidity();
    });
  }
  const day = validDay(value.slice(0,10)) ? value.slice(0,10) : key(new Date());
  active = { selected: day, yearText:day.slice(0,4), month: new Date(`${day.slice(0, 7)}-01T12:00:00`), min, max, time, title, onSelect,
    hour: value.slice(11, 13) || '09', minute: value.slice(14, 16) || '00' };
  draw(); if (!picker.open) picker.showModal();
}

function updateApply() {
  picker.querySelector('[data-picker-apply]').disabled = !validYear(active.yearText) || !withinRange(selectedValue());
}

function draw(focusSelector = '') {
  const yearField = focusSelector === '[data-picker-year]' ? picker.querySelector(focusSelector) : null;
  const selection = yearField ? [yearField.selectionStart,yearField.selectionEnd] : null;
  const { month, selected, min, max, time, title } = active;
  const year = month.getFullYear(), m = month.getMonth(), today = key(new Date());
  const first = new Date(year, m, 1).getDay(), count = new Date(year, m + 1, 0).getDate();
  const firstYear = Math.max(1000,Math.min(year - 6,9988));
  const invalidYear = !validYear(active.yearText);
  const options = (count, selected) => Array.from({ length: count }, (_, i) => `<option ${pad(i) === selected ? 'selected' : ''}>${pad(i)}</option>`).join('');
  const markup = `<header class="picker-head"><h2 id="date-picker-title"></h2><button type="button" data-picker-close aria-label="关闭日期选择">×</button></header>
    <div class="picker-month"><div class="picker-year-field"><label for="picker-year-input">年份 · 输入或选择</label><div class="picker-year-control"><input id="picker-year-input" type="text" inputmode="numeric" maxlength="4" pattern="[1-9][0-9]{3}" data-picker-year aria-label="年份" aria-describedby="picker-year-error" autocomplete="off" required><select data-picker-year-choice aria-label="选择年份">${Array.from({length:12},(_,i) => firstYear+i).map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}年</option>`).join('')}</select></div></div><label><span>月份</span><select data-picker-month aria-label="月份" ${invalidYear ? 'disabled' : ''}>${Array.from({ length: 12 }, (_, i) => `<option value="${i}" ${i === m ? 'selected' : ''}>${i + 1}月</option>`).join('')}</select></label></div><p id="picker-year-error" class="picker-year-error" role="alert" ${invalidYear ? '' : 'hidden'}>请输入 1000–9999 之间的四位年份</p>
    <div class="picker-week">${['日','一','二','三','四','五','六'].map(day => `<span>${day}</span>`).join('')}</div><div class="picker-days">${'<span></span>'.repeat(first)}${Array.from({ length: count }, (_, i) => {
      const day = `${year}-${pad(m + 1)}-${pad(i + 1)}`, disabled = invalidYear || day < min.slice(0, 10) || (max && day > max.slice(0, 10));
      return `<button type="button" data-picker-day="${day}" ${disabled ? 'disabled' : ''} aria-label="${day}" aria-pressed="${day === selected}" ${day === today ? 'aria-current="date"' : ''}>${i + 1}</button>`;
    }).join('')}</div>
    <div class="picker-quick"><button type="button" data-picker-quick="0" ${today < min.slice(0,10) || (max && today > max.slice(0,10)) ? 'disabled' : ''}>今天</button></div>${time ? `<div class="picker-time"><b>时间</b><label>时<select data-picker-hour aria-label="小时">${options(24,active.hour)}</select></label><span>:</span><label>分<select data-picker-minute aria-label="分钟">${options(60,active.minute)}</select></label></div>` : ''}
    <footer class="picker-footer"><span>${selected.replaceAll('-', ' / ')}</span><button type="button" class="primary-button" data-picker-apply>确认选择</button></footer>`;
  if (yearField) {
    // Keep the live input connected so typing does not interrupt the mobile keyboard.
    const template = document.createElement('template');
    template.innerHTML = markup;
    picker.querySelector('[data-picker-year-choice]').replaceChildren(...template.content.querySelector('[data-picker-year-choice]').childNodes);
    picker.querySelector('[data-picker-month]').disabled = invalidYear;
    for (const selector of ['#picker-year-error','.picker-days','.picker-footer']) {
      picker.querySelector(selector).replaceWith(template.content.querySelector(selector));
    }
  } else picker.innerHTML = markup;
  picker.querySelector('h2').textContent = title;
  picker.querySelector('[data-picker-year-choice]').value = invalidYear ? '' : String(year);
  const field = picker.querySelector('[data-picker-year]');
  field.value = active.yearText;
  field.setAttribute('aria-invalid',String(invalidYear));
  field.setCustomValidity(invalidYear ? '请输入 1000–9999 之间的四位年份' : '');
  if (focusSelector) picker.querySelector(focusSelector)?.focus({preventScroll:true});
  if (yearField) yearField.setSelectionRange(...selection);
  updateApply();
}

function openInputPicker(event) {
  const input = event.target.closest('input[type="date"],input[type="datetime-local"]');
  if (!input || input.disabled || input.readOnly) return;
  event.preventDefault();
  pickDate({ value: input.value, min: input.min, max: input.max, time: input.type === 'datetime-local',
    title: input.closest('label')?.childNodes[0]?.textContent.trim() || '选择日期',
    onSelect(value) { if (!input.isConnected) return; input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); } });
}
document.addEventListener('click', openInputPicker);
document.addEventListener('keydown', event => {
  if (event.key === ' ' && event.target.matches('input[type="date"],input[type="datetime-local"]')) openInputPicker(event);
});
export function closeDatePicker() { if (!picker?.open) return false; picker.close(); return true; }
export const datePickerOpen = () => Boolean(picker?.open);

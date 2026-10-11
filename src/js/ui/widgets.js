// メニュー・トースト・ダイアログ・ツールチップ・設定の部品

import { h, $ } from './dom.js';
import { icon } from './icons.js';

// ── ポップアップメニュー ───────────────────────────
let openMenuEl = null;

export function closeMenu() {
  openMenuEl?.remove();
  openMenuEl = null;
}

/**
 * items: [{ label, icon, onClick, key, danger, selected } | 'sep' | { header } | { node }]
 */
export function openMenu(anchor, items, { align = 'left', above = false } = {}) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') menu.append(h('div', { class: 'sep' }));
    else if (it.header) menu.append(h('div', { class: 'mh' }, it.header));
    else if (it.node) menu.append(it.node);
    else {
      menu.append(
        h(
          'button',
          {
            class: ['mi', it.danger && 'danger', it.selected && 'sel'],
            role: 'menuitem',
            onclick: (e) => {
              e.stopPropagation();
              if (!it.keepOpen) closeMenu();
              it.onClick?.();
            },
          },
          it.icon ? icon(it.icon, 17) : null,
          h('span', null, it.label),
          it.key ? h('span', { class: 'k' }, it.key) : null,
        ),
      );
    }
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mr = menu.getBoundingClientRect();
  let x = align === 'right' ? r.right - mr.width : align === 'center' ? r.left + r.width / 2 - mr.width / 2 : r.left;
  let y = above ? r.top - mr.height - 6 : r.bottom + 6;
  if (y + mr.height > innerHeight - 8) y = Math.max(8, r.top - mr.height - 6);
  if (y < 8) y = 8;
  x = Math.max(8, Math.min(innerWidth - mr.width - 8, x));
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  openMenuEl = menu;
  setTimeout(() => {
    const off = (e) => {
      if (!menu.contains(e.target)) {
        closeMenu();
        document.removeEventListener('pointerdown', off, true);
      }
    };
    document.addEventListener('pointerdown', off, true);
  });
  return menu;
}

// ── トースト ──────────────────────────────────────
export function toast(message, { action, onAction, timeout = 4200 } = {}) {
  const host = $('#toasts');
  const el = h(
    'div',
    { class: 'toast', role: 'status' },
    h('span', null, message),
    action
      ? h('button', {
          class: 'btn',
          onclick: () => {
            el.remove();
            onAction?.();
          },
        }, action)
      : null,
  );
  host.append(el);
  setTimeout(() => el.remove(), timeout);
  return el;
}

// ── ダイアログ ────────────────────────────────────
export function confirmDialog({ title, message, ok = 'OK', cancel = 'キャンセル', danger = false }) {
  return new Promise((resolve) => {
    const close = (v) => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      }
      if (e.key === 'Enter') {
        e.stopPropagation();
        close(true);
      }
    };
    const back = h(
      'div',
      { class: 'modal-back', onclick: (e) => e.target === back && close(false) },
      h(
        'div',
        { class: 'modal', role: 'alertdialog' },
        h('h3', null, title),
        message ? h('p', null, message) : null,
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => close(false) }, cancel),
          h('button', { class: ['btn', danger ? 'danger' : 'primary'], onclick: () => close(true) }, ok),
        ),
      ),
    );
    document.body.append(back);
    document.addEventListener('keydown', onKey, true);
    back.querySelector('.btn.primary, .btn.danger')?.focus();
  });
}

export function promptDialog({ title, message, value = '', placeholder = '', ok = '保存' }) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'txt', value, placeholder });
    const close = (v) => {
      back.remove();
      resolve(v);
    };
    const back = h(
      'div',
      { class: 'modal-back', onclick: (e) => e.target === back && close(null) },
      h(
        'div',
        { class: 'modal' },
        h('h3', null, title),
        message ? h('p', null, message) : null,
        input,
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn', onclick: () => close(null) }, 'キャンセル'),
          h('button', { class: 'btn primary', onclick: () => close(input.value.trim()) }, ok),
        ),
      ),
    );
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value.trim());
      if (e.key === 'Escape') close(null);
      e.stopPropagation();
    });
    document.body.append(back);
    input.focus();
    input.select();
  });
}

// ── ツールチップ ──────────────────────────────────
export function showTip(text, x, y) {
  const t = $('#tooltip');
  t.textContent = text;
  t.classList.add('show');
  const r = t.getBoundingClientRect();
  t.style.left = `${Math.max(6, Math.min(innerWidth - r.width - 6, x - r.width / 2))}px`;
  t.style.top = `${Math.max(6, y - r.height - 10)}px`;
}
export function hideTip() {
  $('#tooltip').classList.remove('show');
}
export function tipOn(el, textFn) {
  el.addEventListener('pointermove', (e) => showTip(typeof textFn === 'function' ? textFn() : textFn, e.clientX, e.clientY));
  el.addEventListener('pointerleave', hideTip);
  return el;
}

// ── 設定の部品 ────────────────────────────────────
export function row(label, control, { hint, disabled } = {}) {
  return h('div', { class: ['row', disabled && 'disabled'] }, h('div', { class: 'lbl' }, label, hint ? h('small', null, hint) : null), h('div', { class: 'ctl' }, control));
}

export function switchCtl(value, onChange) {
  const el = h('button', {
    class: ['switch', value && 'on'],
    role: 'switch',
    'aria-checked': String(!!value),
    onclick: () => {
      const v = !el.classList.contains('on');
      el.classList.toggle('on', v);
      el.setAttribute('aria-checked', String(v));
      onChange(v);
    },
  });
  return el;
}

export function stepper(value, onChange, { min = 0, max = 999, step = 1, unit = '' } = {}) {
  const input = h('input', { type: 'number', value, min, max, step });
  const set = (v) => {
    const n = Math.min(max, Math.max(min, Math.round(v / step) * step));
    const fixed = Number(n.toFixed(2));
    input.value = fixed;
    onChange(fixed);
  };
  input.addEventListener('change', () => set(Number(input.value) || min));
  input.addEventListener('keydown', (e) => e.stopPropagation());
  return h(
    'div',
    { class: 'stepper' },
    h('button', { type: 'button', onclick: () => set(Number(input.value) - step), 'aria-label': '減らす' }, icon('minus', 14)),
    input,
    unit ? h('span', { class: 'unit' }, unit) : null,
    h('button', { type: 'button', onclick: () => set(Number(input.value) + step), 'aria-label': '増やす' }, icon('plus', 14)),
  );
}

export function select(value, options, onChange) {
  const el = h(
    'select',
    { class: 'sel', onchange: () => onChange(el.value) },
    options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)),
  );
  return el;
}

export function segmented(value, options, onChange) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  for (const [v, label] of options) {
    const b = h('button', {
      type: 'button',
      class: String(v) === String(value) ? 'on' : '',
      role: 'radio',
      onclick: () => {
        wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        onChange(v);
      },
    }, label);
    wrap.append(b);
  }
  return wrap;
}

export function slider(value, onInput, { min = 0, max = 100, step = 1, width } = {}) {
  const el = h('input', { type: 'range', min, max, step, value });
  if (width) el.style.width = width;
  const paint = () => el.style.setProperty('--p', `${((el.value - min) / (max - min)) * 100}%`);
  paint();
  el.addEventListener('input', () => {
    paint();
    onInput(Number(el.value));
  });
  el.addEventListener('keydown', (e) => e.stopPropagation());
  return el;
}

export function colorPick(value, onChange) {
  const el = h('input', { type: 'color', value });
  el.addEventListener('input', () => onChange(el.value));
  return el;
}

export function textInput(value, onChange, { placeholder = '' } = {}) {
  const el = h('input', { class: 'txt', value, placeholder });
  el.addEventListener('change', () => onChange(el.value));
  el.addEventListener('keydown', (e) => e.stopPropagation());
  return el;
}

/** キーを押して登録する入力欄。format: 'code'（アプリ内）| 'accel'（全体のショートカット） */
export function keyRecorder(value, onChange, { format = 'code', display = (v) => v } = {}) {
  const el = h('button', { class: 'btn', type: 'button', style: { minWidth: '130px', justifyContent: 'center' } }, display(value) || '（なし）');
  el.addEventListener('click', () => {
    el.textContent = 'キーを押してください…';
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      document.removeEventListener('keydown', onKey, true);
      if (e.key === 'Escape') {
        el.textContent = display(value) || '（なし）';
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        value = '';
      } else if (format === 'accel') {
        const parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Super');
        parts.push(accelKey(e));
        value = parts.join('+');
      } else {
        value = e.code;
      }
      el.textContent = display(value) || '（なし）';
      onChange(value);
    };
    document.addEventListener('keydown', onKey, true);
  });
  return el;
}

function accelKey(e) {
  const c = e.code;
  if (c.startsWith('Key')) return c.slice(3);
  if (c.startsWith('Digit')) return c.slice(5);
  if (c.startsWith('Arrow')) return c.slice(5);
  if (c.startsWith('Numpad')) return 'num' + c.slice(6).toLowerCase();
  const map = { Space: 'Space', Enter: 'Enter', Tab: 'Tab', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\' };
  return map[c] ?? e.key.toUpperCase();
}

const CODE_LABEL = { Space: 'Space', Equal: '+ / =', Minus: '-', Comma: ',', Period: '.', Slash: '/', Enter: 'Enter', Escape: 'Esc' };
export function codeLabel(code) {
  if (!code) return '';
  if (CODE_LABEL[code]) return CODE_LABEL[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }[code];
  return code;
}

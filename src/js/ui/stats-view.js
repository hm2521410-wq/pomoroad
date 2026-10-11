// 統計パネル

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { segmented, showTip, hideTip, confirmDialog } from './widgets.js';
import { fmtDuration, fmtTime, addDays } from '../core/util.js';
import { guardStats } from './guard-view.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const dateOf = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function renderStats(body, app) {
  clear(body);
  const data = app.data;
  const today = data.todayKey();
  const rerender = () => renderStats(body, app);
  const range = app.ui.statsRange || 7;
  const sumToday = data.summary(today);
  const week = data.days(7);
  const weekMs = week.reduce((a, d) => a + d.focusMs, 0);
  const weekPomos = week.reduce((a, d) => a + d.pomos, 0);
  const tot = data.totals();

  body.append(
    h('div', { class: 'stat-tiles' },
      tileEl('今日の集中', fmtDuration(sumToday.focusMs + app.liveFocusMs()), `ポモドーロ ${sumToday.pomos} 回`),
      tileEl('この7日間', fmtDuration(weekMs), `ポモドーロ ${weekPomos} 回`),
      tileEl('連続して集中した日', `${data.streak()}日`, '今日か昨日から数えて'),
      tileEl('これまでの合計', fmtDuration(tot.focusMs), `ポモドーロ ${tot.pomos} 回`),
    ),
  );

  // 見守り（記録があるときだけ）
  const guard = guardStats(app);
  if (guard) body.append(guard);

  // 日ごとの棒グラフ
  const days = data.days(range);
  body.append(
    h('div', { class: 'section' },
      h('h3', null, '日ごとの集中時間', h('span', { class: 'spacer' }), segmented(range, [[7, '7日'], [14, '14日'], [30, '30日']], (v) => { app.ui.statsRange = Number(v); rerender(); })),
      barChart(days),
    ),
  );

  // カレンダー（ヒートマップ）
  body.append(h('div', { class: 'section' }, h('h3', null, 'この4か月'), heatmap(data, today)));

  // タスク別
  const keys = Array.from({ length: 7 }, (_, i) => addDays(today, -i));
  const byTask = data.byTask(keys).slice(0, 8);
  body.append(h('div', { class: 'section' }, h('h3', null, 'タスク別（この7日間）'), byTask.length ? taskBars(byTask) : h('p', { class: 'hint' }, 'まだ記録がありません')));

  // 今日の履歴
  const recs = sumToday.recs.slice().sort((a, b) => b.start - a.start);
  const label = { focus: '集中', short: '短い休憩', long: '長い休憩' };
  const color = { focus: 'var(--c-focus)', short: 'var(--c-short)', long: 'var(--c-long)' };
  const table = h('table', { class: 'history' },
    h('thead', null, h('tr', null, h('th', null, '時間'), h('th', null, '種類'), h('th', null, 'タスク'), h('th', { class: 'num' }, '分'), h('th', null, ''))),
    h('tbody', null, recs.map((r) => h('tr', null,
      h('td', null, `${fmtTime(r.start)}–${fmtTime(r.end)}`),
      h('td', null, h('span', { class: 'dot', style: { background: color[r.type] } }), label[r.type] ?? r.type, r.counted ? ' 🍅' : ''),
      h('td', null, r.taskId ? data.tasks.find((t) => t.id === r.taskId)?.title ?? '' : ''),
      h('td', { class: 'num' }, Math.round(r.ms / 60000)),
      h('td', null, h('button', { title: 'この記録を削除', onclick: async () => { if (await confirmDialog({ title: 'この記録を削除しますか？', ok: '削除', danger: true })) { data.deleteRecord(r.id); rerender(); } } }, icon('trash', 14))),
    ))),
  );
  body.append(h('div', { class: 'section' }, h('h3', null, '今日の記録'), recs.length ? table : h('p', { class: 'hint' }, 'まだ記録がありません。集中を始めると、ここに並びます。')));
}

function tileEl(label, value, sub) {
  return h('div', { class: 'stat-tile' }, h('div', { class: 'l' }, label), h('div', { class: 'v' }, value), sub ? h('div', { class: 'l', style: { marginTop: '4px' } }, sub) : null);
}

function barChart(days) {
  const W = 420;
  const H = 170;
  const padL = 34;
  const padB = 22;
  const padT = 14;
  const maxMin = Math.max(30, ...days.map((d) => d.focusMs / 60000));
  const step = maxMin > 240 ? 120 : maxMin > 120 ? 60 : 30;
  const top = Math.ceil(maxMin / step) * step;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '日ごとの集中時間' });
  const plotW = W - padL - 4;
  const plotH = H - padB - padT;
  for (let v = 0; v <= top; v += step) {
    const y = padT + plotH - (v / top) * plotH;
    root.append(svg('line', { class: 'grid', x1: padL, x2: W, y1: y, y2: y }));
    const t = svg('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end' });
    t.textContent = v >= 60 ? `${v / 60}h` : `${v}m`;
    root.append(t);
  }
  const band = plotW / days.length;
  const bw = Math.min(24, band * 0.62);
  days.forEach((d, i) => {
    const mins = d.focusMs / 60000;
    const bh = (mins / top) * plotH;
    const x = padL + band * i + (band - bw) / 2;
    const y = padT + plotH - bh;
    if (bh > 0.5) {
      const r = Math.min(4, bh, bw / 2);
      root.append(svg('path', { class: 'bar', fill: 'var(--c-focus)', d: `M${x},${y + bh} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${y + bh} Z` }));
    }
    const dt = dateOf(d.key);
    const showLabel = days.length <= 14 || i % 5 === 0 || i === days.length - 1;
    if (showLabel) {
      const t = svg('text', { x: padL + band * i + band / 2, y: H - 6, 'text-anchor': 'middle' });
      t.textContent = days.length <= 7 ? `${dt.getMonth() + 1}/${dt.getDate()}(${WD[dt.getDay()]})` : `${dt.getMonth() + 1}/${dt.getDate()}`;
      if (days.length <= 7) t.setAttribute('font-size', '10');
      root.append(t);
    }
    const hit = svg('rect', { class: 'hit', x: padL + band * i, y: padT, width: band, height: plotH + 4 });
    hit.addEventListener('pointermove', (e) => showTip(`${dt.getMonth() + 1}/${dt.getDate()}（${WD[dt.getDay()]}）  ${fmtDuration(d.focusMs)}・ポモドーロ ${d.pomos} 回`, e.clientX, e.clientY));
    hit.addEventListener('pointerleave', hideTip);
    root.append(hit);
  });
  // 一番多い日だけ数字を添える
  const best = days.reduce((a, d, i) => (d.focusMs > (days[a]?.focusMs ?? 0) ? i : a), -1);
  if (best >= 0 && days[best].focusMs > 0) {
    const mins = days[best].focusMs / 60000;
    const t = svg('text', { x: padL + band * best + band / 2, y: padT + plotH - (mins / top) * plotH - 5, 'text-anchor': 'middle', style: 'fill: var(--text-2)' });
    t.textContent = fmtDuration(days[best].focusMs);
    root.append(t);
  }
  return h('div', { class: 'chart' }, root);
}

function heatmap(data, today) {
  const weeks = 17;
  const end = dateOf(today);
  const days = data.days(weeks * 7 - (6 - end.getDay()), today);
  const max = Math.max(1, ...days.map((d) => d.focusMs));
  const grid = h('div', { class: 'heat', style: { gridTemplateColumns: `repeat(${weeks}, 1fr)` } });
  const steps = [0.22, 0.45, 0.7, 1];
  const level = (ms) => (ms <= 0 ? -1 : Math.min(3, Math.floor((ms / max) * 4 - 1e-9)));
  for (const d of days) {
    const lv = level(d.focusMs);
    const cell = h('i', { style: lv >= 0 ? { background: `color-mix(in srgb, var(--c-focus) ${steps[lv] * 100}%, var(--chip))` } : {} });
    const dt = dateOf(d.key);
    cell.addEventListener('pointermove', (e) => showTip(`${dt.getMonth() + 1}/${dt.getDate()}（${WD[dt.getDay()]}）  ${d.focusMs ? fmtDuration(d.focusMs) : '記録なし'}`, e.clientX, e.clientY));
    cell.addEventListener('pointerleave', hideTip);
    grid.append(cell);
  }
  const legend = h('div', { class: 'legend', style: { justifyContent: 'flex-end', alignItems: 'center', gap: '4px' } },
    h('span', { style: { marginRight: '4px' } }, '少'),
    h('i', { style: { background: 'var(--chip)', margin: 0 } }),
    steps.map((s) => h('i', { style: { background: `color-mix(in srgb, var(--c-focus) ${s * 100}%, var(--chip))`, margin: 0 } })),
    h('span', { style: { marginLeft: '4px' } }, '多'));
  return h('div', null, grid, legend);
}

function taskBars(items) {
  const max = Math.max(...items.map((x) => x.ms));
  return h('div', { style: { display: 'grid', gap: '8px' } },
    items.map((x) => h('div', { style: { display: 'grid', gridTemplateColumns: '110px 1fr auto', alignItems: 'center', gap: '10px', fontSize: '12.5px' } },
      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)' }, title: x.title }, x.title),
      h('span', { style: { height: '12px', borderRadius: '0 4px 4px 0', background: 'var(--c-focus)', width: `${Math.max(2, (x.ms / max) * 100)}%`, opacity: x.id ? 1 : 0.5 } }),
      h('span', { style: { color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' } }, fmtDuration(x.ms)),
    )));
}

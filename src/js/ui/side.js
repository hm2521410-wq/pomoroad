// 右のパネル：本日のポモドーロ時間・今日のタスク・今日の集中時間

import { h, clear, fill } from './dom.js';
import { icon } from './icons.js';
import { openMenu, promptDialog, tipOn } from './widgets.js';
import { fmtDuration, fmtTime, dayStart } from '../core/util.js';

export class SidePanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.showDone = false;
    this._build();
  }

  _build() {
    const app = this.app;
    this.todayNum = h('span', { class: 'num' }, '0');
    this.todayMeta = h('div', { class: 'today-meta' });
    this.goalBar = h('i', { style: { width: '0%' } });
    const today = h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-title' }, '本日のポモドーロ時間', h('span', { class: 'spacer' }), h('button', { class: 'mini-link', onclick: () => app.openDrawer('stats') }, '統計を見る')),
      h('div', { class: 'today-big' }, this.todayNum, h('span', { class: 'unit' }, '分')),
      h('div', { class: 'meter', title: '1日の目標' }, this.goalBar),
      this.todayMeta,
    );

    this.list = h('div', { class: 'task-list' });
    this.input = h('input', { placeholder: 'タスクを追加…（Enter）', maxlength: 120 });
    this.est = h('input', { class: 'est', type: 'number', min: 1, max: 20, value: 1, title: '見積もりポモドーロ数' });
    const add = () => {
      const title = this.input.value.trim();
      if (!title) return;
      const t = app.data.addTask(title, Math.max(1, Number(this.est.value) || 1));
      if (!app.data.currentTaskId) app.data.setCurrentTask(t.id);
      this.input.value = '';
      this.est.value = 1;
    };
    for (const inp of [this.input, this.est]) {
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.isComposing) add();
      });
    }
    const tasks = h(
      'div',
      { class: 'card task-card' },
      h('div', { class: 'card-title' }, '今日', h('span', { class: 'spacer' })),
      this.list,
      h('div', { class: 'task-add' }, this.input, this.est, h('button', { class: 'btn', onclick: add, title: '追加' }, icon('plus', 16))),
    );

    this.timeline = h('div', { class: 'timeline' });
    this.axis = h('div', { class: 'timeline-axis' });
    const tl = h(
      'div',
      { class: 'card' },
      h('div', { class: 'card-title' }, '今日の集中時間'),
      this.timeline,
      this.axis,
      h('div', { class: 'legend' }, h('span', null, h('i', { style: { background: 'var(--c-focus)' } }), '集中'), h('span', null, h('i', { style: { background: 'var(--c-short)' } }), '休憩')),
    );
    this.el.append(today, tasks, tl);
  }

  render() {
    this.renderToday();
    this.renderTasks();
    this.renderTimeline();
  }

  renderToday() {
    const app = this.app;
    const key = app.data.todayKey();
    const s = app.data.summary(key);
    const live = app.liveFocusMs();
    const ms = s.focusMs + live;
    this.todayNum.textContent = String(Math.floor(ms / 60000));
    const goal = app.settings.goal.daily;
    this.goalBar.style.width = `${Math.min(100, (s.pomos / Math.max(1, goal)) * 100)}%`;
    fill(
      this.todayMeta,
      h('span', null, 'ポモドーロ ', h('b', null, `${s.pomos}`), ` / ${goal}`),
      h('span', null, '連続 ', h('b', null, `${app.data.streak()}`), ' 日'),
      s.interruptions ? h('span', null, '気が散った ', h('b', null, `${s.interruptions}`), ' 回') : null,
    );
  }

  renderTasks() {
    const app = this.app;
    const data = app.data;
    const open = data.tasks.filter((t) => !t.completed);
    const done = data.tasks.filter((t) => t.completed);
    clear(this.list);
    if (!data.tasks.length) {
      this.list.append(h('div', { class: 'empty' }, icon('inbox', 40), h('div', null, 'タスクがありません'), h('small', null, '下の欄に入力して追加できます')));
      return;
    }
    const rowOf = (t) => {
      const sel = data.currentTaskId === t.id;
      const rowEl = h(
        'div',
        {
          class: ['task-row', sel && 'selected', t.completed && 'completed'],
          onclick: () => data.setCurrentTask(sel ? null : t.id),
          title: sel ? 'クリックで選択を外す' : 'クリックでこのタスクに集中',
        },
        h('button', {
          class: 'chk',
          title: t.completed ? '未完了に戻す' : '完了にする',
          onclick: (e) => {
            e.stopPropagation();
            data.updateTask(t.id, { completed: !t.completed });
            if (!t.completed === true && sel) data.setCurrentTask(null);
          },
        }, icon('check', 13)),
        h('span', { class: 't-title' }, t.title),
        h('span', { class: 't-count', title: '終わったポモドーロ / 見積もり' }, `🍅 ${t.done || 0}/${t.est || 1}`),
        h('button', {
          class: 't-more',
          title: 'その他',
          onclick: (e) => {
            e.stopPropagation();
            this._taskMenu(e.currentTarget, t);
          },
        }, icon('more', 16)),
      );
      return rowEl;
    };
    open.forEach((t) => this.list.append(rowOf(t)));
    if (done.length) {
      this.list.append(h('button', { class: 'done-toggle', onclick: () => { this.showDone = !this.showDone; this.renderTasks(); } }, `${this.showDone ? '▾' : '▸'} 完了したタスク（${done.length}）`));
      if (this.showDone) done.forEach((t) => this.list.append(rowOf(t)));
    }
  }

  _taskMenu(anchor, t) {
    const data = this.app.data;
    openMenu(anchor, [
      { label: '名前を変更', icon: 'edit', onClick: async () => { const v = await promptDialog({ title: 'タスク名', value: t.title }); if (v) data.updateTask(t.id, { title: v }); } },
      { label: '見積もりを増やす（+1）', icon: 'plus', onClick: () => data.updateTask(t.id, { est: (t.est || 1) + 1 }) },
      { label: '見積もりを減らす（-1）', icon: 'minus', onClick: () => data.updateTask(t.id, { est: Math.max(1, (t.est || 1) - 1) }) },
      { label: '上へ移動', icon: 'up', onClick: () => data.moveTask(t.id, -1) },
      { label: '下へ移動', icon: 'down', onClick: () => data.moveTask(t.id, 1) },
      'sep',
      { header: `集中した時間：${fmtDuration(t.focusMs || 0)}` },
      { label: '完了したタスクをまとめて削除', icon: 'trash', onClick: () => data.clearCompleted() },
      { label: 'このタスクを削除', icon: 'trash', danger: true, onClick: () => data.deleteTask(t.id) },
    ], { align: 'right' });
  }

  renderTimeline() {
    const app = this.app;
    const key = app.data.todayKey();
    const recs = app.data.dayRecords(key).slice();
    const live = app.liveSegments();
    const now = Date.now();
    const segs = [];
    for (const r of recs) for (const [a, b] of r.segs?.length ? r.segs : [[r.start, r.end]]) segs.push({ a, b, type: r.type, r });
    for (const s of live) segs.push(s);
    const day0 = dayStart(key, app.data.dayStartHour);
    let lo = segs.length ? Math.min(...segs.map((s) => s.a)) : now - 2 * 3600000;
    let hi = Math.max(now, ...segs.map((s) => s.b));
    lo = Math.max(day0, Math.floor(lo / 3600000) * 3600000);
    hi = Math.ceil((hi + 1) / 3600000) * 3600000;
    if (hi - lo < 3 * 3600000) hi = lo + 3 * 3600000;
    const span = hi - lo;
    clear(this.timeline);
    clear(this.axis);
    for (const s of segs) {
      const left = ((s.a - lo) / span) * 100;
      const w = Math.max(0.4, ((s.b - s.a) / span) * 100);
      const color = s.type === 'focus' ? 'var(--c-focus)' : 'var(--c-short)';
      const seg = h('div', { class: 'seg', style: { left: `${left}%`, width: `${w}%`, background: color, opacity: s.type === 'focus' ? 1 : 0.55 } });
      tipOn(seg, () => `${s.type === 'focus' ? '集中' : '休憩'} ${fmtTime(s.a)}–${fmtTime(s.b)}（${Math.max(1, Math.round((s.b - s.a) / 60000))}分）`);
      this.timeline.append(seg);
    }
    const hours = span / 3600000;
    const stepH = hours <= 6 ? 1 : hours <= 12 ? 2 : 4;
    for (let t = lo; t <= hi; t += stepH * 3600000) {
      this.axis.append(h('span', { style: { left: `${((t - lo) / span) * 100}%` } }, fmtTime(t)));
    }
  }
}

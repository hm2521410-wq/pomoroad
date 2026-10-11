// 記録（セッション履歴）・タスク・ユーザーのプリセットなどのデータ

import { Emitter, uid, dayKey, addDays, debounce } from './util.js';
import { load, save } from './store.js';

const validRecord = (r) => r && typeof r.start === 'number' && typeof r.end === 'number' && typeof r.ms === 'number' && typeof r.type === 'string';
const validTask = (t) => t && typeof t.id === 'string' && typeof t.title === 'string';

export class DataStore extends Emitter {
  constructor(getSettings) {
    super();
    this.getSettings = getSettings;
    this.records = (load('records', []) || []).filter(validRecord);
    this.tasks = (load('tasks', []) || []).filter(validTask);
    this.currentTaskId = load('currentTask', null);
    this.presets = load('presets', []) || [];
    this.mixes = load('mixes', []) || [];
    this.customSounds = load('customSounds', []) || [];
    this._saveRecords = debounce(() => save('records', this.records), 400);
    this._saveTasks = debounce(() => save('tasks', this.tasks), 300);
  }

  flush() {
    this._saveRecords.flush();
    this._saveTasks.flush();
  }

  get dayStartHour() {
    return this.getSettings().goal.dayStartHour ?? 4;
  }
  todayKey(now = Date.now()) {
    return dayKey(now, this.dayStartHour);
  }
  keyOf(ts) {
    return dayKey(ts, this.dayStartHour);
  }

  // ── 記録 ────────────────────────────────────────
  addRecord(rec) {
    this.records.push(rec);
    if (rec.type === 'focus' && rec.taskId) {
      const t = this.tasks.find((x) => x.id === rec.taskId);
      if (t) {
        t.focusMs = (t.focusMs || 0) + rec.ms;
        if (rec.counted) t.done = (t.done || 0) + 1;
        this._saveTasks();
        this.emit('tasks');
      }
    }
    this._saveRecords();
    this.emit('records');
  }

  deleteRecord(id) {
    const i = this.records.findIndex((r) => r.id === id);
    if (i < 0) return;
    const [rec] = this.records.splice(i, 1);
    const t = rec.taskId && this.tasks.find((x) => x.id === rec.taskId);
    if (t) {
      t.focusMs = Math.max(0, (t.focusMs || 0) - rec.ms);
      if (rec.counted) t.done = Math.max(0, (t.done || 0) - 1);
      this._saveTasks();
      this.emit('tasks');
    }
    this._saveRecords();
    this.emit('records');
  }

  dayRecords(key) {
    return this.records.filter((r) => this.keyOf(r.start) === key);
  }

  summary(key) {
    const recs = this.dayRecords(key);
    const focus = recs.filter((r) => r.type === 'focus');
    return {
      focusMs: focus.reduce((a, r) => a + r.ms, 0),
      pomos: focus.filter((r) => r.counted).length,
      sessions: focus.length,
      breakMs: recs.filter((r) => r.type !== 'focus').reduce((a, r) => a + r.ms, 0),
      interruptions: focus.reduce((a, r) => a + (r.interruptions || 0), 0),
      recs,
    };
  }

  /** 直近 n 日（古い順） */
  days(n, endKey = this.todayKey()) {
    const map = new Map();
    for (const r of this.records) {
      if (r.type !== 'focus') continue;
      const k = this.keyOf(r.start);
      const m = map.get(k) ?? { focusMs: 0, pomos: 0 };
      m.focusMs += r.ms;
      if (r.counted) m.pomos++;
      map.set(k, m);
    }
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const k = addDays(endKey, -i);
      out.push({ key: k, ...(map.get(k) ?? { focusMs: 0, pomos: 0 }) });
    }
    return out;
  }

  /** 連続して集中した日数（今日まだなら昨日から数える） */
  streak() {
    const set = new Set(this.records.filter((r) => r.type === 'focus' && r.ms >= 60000).map((r) => this.keyOf(r.start)));
    let k = this.todayKey();
    if (!set.has(k)) k = addDays(k, -1);
    let n = 0;
    while (set.has(k)) {
      n++;
      k = addDays(k, -1);
    }
    return n;
  }

  totals() {
    const focus = this.records.filter((r) => r.type === 'focus');
    return { focusMs: focus.reduce((a, r) => a + r.ms, 0), pomos: focus.filter((r) => r.counted).length };
  }

  byTask(keys) {
    const ks = new Set(keys);
    const map = new Map();
    for (const r of this.records) {
      if (r.type !== 'focus' || !ks.has(this.keyOf(r.start))) continue;
      const id = r.taskId || '';
      map.set(id, (map.get(id) || 0) + r.ms);
    }
    return [...map.entries()]
      .map(([id, ms]) => ({ id, ms, title: id ? this.tasks.find((t) => t.id === id)?.title ?? '（削除したタスク）' : 'タスクなし' }))
      .sort((a, b) => b.ms - a.ms);
  }

  // ── タスク ──────────────────────────────────────
  addTask(title, est = 1) {
    const t = { id: uid(), title, est, done: 0, focusMs: 0, completed: false, createdAt: Date.now() };
    this.tasks.push(t);
    this._saveTasks();
    this.emit('tasks');
    return t;
  }
  updateTask(id, patch) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    if ('completed' in patch) t.completedAt = patch.completed ? Date.now() : null;
    this._saveTasks();
    this.emit('tasks');
  }
  deleteTask(id) {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.currentTaskId === id) this.setCurrentTask(null);
    this._saveTasks();
    this.emit('tasks');
  }
  moveTask(id, dir) {
    const i = this.tasks.findIndex((t) => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.tasks.length) return;
    [this.tasks[i], this.tasks[j]] = [this.tasks[j], this.tasks[i]];
    this._saveTasks();
    this.emit('tasks');
  }
  clearCompleted() {
    this.tasks = this.tasks.filter((t) => !t.completed);
    this._saveTasks();
    this.emit('tasks');
  }
  setCurrentTask(id) {
    this.currentTaskId = id;
    save('currentTask', id);
    this.emit('tasks');
  }
  get currentTask() {
    return this.tasks.find((t) => t.id === this.currentTaskId) ?? null;
  }

  // ── プリセット・ミックス・自分の音源 ─────────────────
  savePreset(name, timer) {
    this.presets.push({ id: uid(), name, timer: structuredClone(timer) });
    save('presets', this.presets);
    this.emit('presets');
  }
  deletePreset(id) {
    this.presets = this.presets.filter((p) => p.id !== id);
    save('presets', this.presets);
    this.emit('presets');
  }
  saveMix(name, icon, mix) {
    this.mixes.push({ id: uid(), name, icon, mix: { ...mix } });
    save('mixes', this.mixes);
    this.emit('mixes');
  }
  deleteMix(id) {
    this.mixes = this.mixes.filter((m) => m.id !== id);
    save('mixes', this.mixes);
    this.emit('mixes');
  }
  addCustomSound(entry) {
    this.customSounds.push(entry);
    save('customSounds', this.customSounds);
    this.emit('custom');
  }
  removeCustomSound(id) {
    this.customSounds = this.customSounds.filter((s) => s.id !== id);
    save('customSounds', this.customSounds);
    this.emit('custom');
  }

  // ── 書き出し・読み込み ───────────────────────────
  exportAll(settings) {
    return {
      app: 'pomoroad',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      records: this.records,
      tasks: this.tasks,
      presets: this.presets,
      mixes: this.mixes,
    };
  }

  importAll(data) {
    if (!data || data.app !== 'pomoroad') throw new Error('Pomoroad のバックアップファイルではありません');
    if (Array.isArray(data.records)) this.records = data.records.filter(validRecord);
    if (Array.isArray(data.tasks)) this.tasks = data.tasks.filter(validTask);
    if (Array.isArray(data.presets)) this.presets = data.presets;
    if (Array.isArray(data.mixes)) this.mixes = data.mixes;
    save('records', this.records);
    save('tasks', this.tasks);
    save('presets', this.presets);
    save('mixes', this.mixes);
    this.emit('records');
    this.emit('tasks');
  }

  toCSV() {
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [['日付', '開始', '終了', '種類', '実働(分)', '予定(分)', 'ポモドーロ', 'タスク', '気が散った回数'].join(',')];
    const label = { focus: '集中', short: '短い休憩', long: '長い休憩' };
    for (const r of [...this.records].sort((a, b) => a.start - b.start)) {
      const task = r.taskId ? this.tasks.find((t) => t.id === r.taskId)?.title ?? '' : '';
      const d = new Date(r.start);
      const e = new Date(r.end);
      const t = (x) => `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
      lines.push(
        [this.keyOf(r.start), t(d), t(e), label[r.type] ?? r.type, (r.ms / 60000).toFixed(1), (r.planned / 60000).toFixed(1), r.counted ? 1 : 0, esc(task), r.interruptions || 0].join(','),
      );
    }
    return '﻿' + lines.join('\r\n');
  }
}

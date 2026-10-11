// Pomoroad 本体：タイマー・音・画面・Windows 連携をつなぐ

import { loadSettings, save, load, DEFAULTS } from './core/store.js';
import { TimerEngine } from './core/timer.js';
import { DataStore } from './core/data.js';
import { STEP_TYPES, isBreak } from './core/sequence.js';
import { fmtClock, fmtTime, setPath, debounce, clamp, mergeDefaults } from './core/util.js';
import { getFile } from './core/idb.js';
import { SoundEngine } from './audio/engine.js';
import { AlertSounds, speak } from './audio/alerts.js';
import { h, $, clear, fill, isTyping } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { Ring } from './ui/ring.js';
import { SidePanel } from './ui/side.js';
import { Background, effectForMix } from './ui/background.js';
import { MiniView, MINI_SIZES } from './ui/mini-view.js';
import { openMenu, closeMenu, toast, confirmDialog, stepper, tipOn } from './ui/widgets.js';
import { renderSettings, SETTINGS_TABS } from './ui/settings-view.js';
import { renderSounds } from './ui/sound-view.js';
import { renderStats } from './ui/stats-view.js';
import { GuardController } from './focus-guard.js';
import { PhoneController } from './phone-link.js';

class App {
  constructor() {
    this.settings = loadSettings();
    this.desktop = window.desktop?.isDesktop ? window.desktop : null;
    this.ui = { mixTab: 'focus', statsRange: 7 };
    this.data = new DataStore(() => this.settings);
    this.engine = new TimerEngine({
      getSettings: () => this.settings.timer,
      getTaskId: () => this.data.currentTaskId,
    });
    this.sound = new SoundEngine();
    this.sound.masterVol = this.settings.sound.master / 100;
    this.sound.variation = this.settings.sound.variation;
    this.sound.setCustomList(this.data.customSounds);
    this.alerts = new AlertSounds();
    this.guard = new GuardController(this);
    this.phone = new PhoneController(this);
    this.soundOverride = null;
    this.manualPlaying = false;
    this.previewMix = null;
    this.lastSecond = null;
    this.warned = false;
    this.drawer = null;
    this.saveState = debounce(() => save('timerState', this.engine.serialize()), 500);
    this.saveSettings = debounce(() => save('settings', this.settings), 300);
  }

  // ── 起動 ───────────────────────────────────────
  async init() {
    this.engine.restore(load('timerState', null));
    if (this.desktop) document.body.classList.add('is-desktop');
    else document.body.classList.add('no-titlebar');
    this.bg = new Background($('#bg'), $('#fx'), $('#dim'));
    this.ring = new Ring($('#ring'));
    this.side = new SidePanel($('#side'), this);
    this._buildChrome();
    this._bindEngine();
    this._bindKeys();
    this.applyView();
    await this.reloadBackgroundImage();
    this.renderAll();
    this.syncSound();
    this.loop = setInterval(() => this._tick(), 250);
    this._tick();
    this.data.on('tasks', () => {
      this.side.renderTasks();
      this.renderTaskPill();
    });
    this.data.on('records', () => {
      this.side.renderToday();
      this.side.renderTimeline();
      if (this.drawer === 'stats') this.renderDrawer();
    });
    this.sound.on('loading', () => this.drawer === 'sounds' && this.renderDrawer());
    this.sound.on('loaded', () => this.drawer === 'sounds' && this.renderDrawer());
    this.sound.on('error', (e) => toast(`音を読み込めませんでした：${e.message}`));
    addEventListener('beforeunload', () => {
      this.saveState.flush();
      this.saveSettings.flush();
      this.data.flush();
    });
    if (this.desktop) this._initDesktop();
    this.guard.start();
    this.phone.start();
    setInterval(() => {
      this.side.renderToday();
      this.side.renderTimeline();
    }, 30000);
    if (!this.settings.ui.onboarded) {
      this.settings.ui.onboarded = true;
      this.saveSettings();
      setTimeout(() => toast('Space で開始・一時停止。下の「ホワイトノイズ」から環境音を選べます', { timeout: 8000 }), 800);
    }
  }

  // ── 画面の骨組み ────────────────────────────────
  _buildChrome() {
    const left = $('#left-tools');
    left.append(
      tipOn(h('button', { class: 'icon-btn', onclick: () => this.collapseToMini(), 'aria-label': 'ミニ表示にしてしまう' }, icon('minimize', 22)), 'ミニ表示にして、この画面をしまう'),
      tipOn(h('button', { class: 'icon-btn', onclick: () => this.toggleMini(), 'aria-label': 'ミニ表示' }, icon('pip', 22)), 'ミニ表示（常に手前）を出す / 消す　M'),
    );
    const right = $('#right-tools');
    right.append(
      tipOn(h('button', { class: 'icon-btn', id: 'btn-sound-quick', onclick: () => this.toggleSoundPlayback() }, icon('volume', 21)), () => (this.sound.playing ? '環境音を止める' : '環境音を鳴らす')),
      tipOn(h('button', { class: 'icon-btn', onclick: () => this.toggleSide() }, icon('sidebar', 21)), 'パネルの表示/非表示'),
    );
    $('#task-pill').addEventListener('click', (e) => this._taskMenu(e.currentTarget));
    const tools = [
      ['fullscreen', 'fullscreen', '全画面', () => this.toggleFullscreen()],
      ['mode', 'hourglass', 'タイマーのモード', () => this.openDrawer('settings', 'timer')],
      ['sounds', 'music', 'ホワイトノイズ', () => this.openDrawer('sounds')],
      ['stats', 'chart', '統計', () => this.openDrawer('stats')],
      ['settings', 'settings', '設定', () => this.openDrawer('settings', this.settings.ui.lastTab === 'timer' ? 'alerts' : this.settings.ui.lastTab)],
    ];
    const tb = $('#toolbar');
    for (const [id, ic, label, fn] of tools) {
      tb.append(h('button', { class: 'tool', id: `tool-${id}`, onclick: fn }, icon(ic, 24), h('span', null, label)));
    }
    $('#side-toggle').append(icon('chevronRight', 16));
    $('#side-toggle').addEventListener('click', () => this.toggleSide());
    $('#drawer-close').append(icon('close', 20));
    $('#drawer-close').addEventListener('click', () => this.closeDrawer());
    $('#drawer-backdrop').addEventListener('click', () => this.closeDrawer());
    // 全画面ではマウスを止めると操作ボタンを隠す
    let idleT = null;
    addEventListener('pointermove', () => {
      document.body.classList.remove('idle');
      clearTimeout(idleT);
      if (document.body.classList.contains('focus-mode')) idleT = setTimeout(() => document.body.classList.add('idle'), 3000);
    });
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && !this.desktop) document.body.classList.remove('focus-mode');
    });
  }

  // ── タイマーのイベント ───────────────────────────
  _bindEngine() {
    const e = this.engine;
    e.on('change', () => {
      this.phone.sync();
      this.saveState();
      this.renderAll();
      this.syncSound();
      this._sendState(true);
    });
    e.on('record', (rec) => {
      this.guard.attach(rec);
      this.data.addRecord(rec);
    });
    e.on('stepstart', ({ step }) => {
      if (step.type === 'focus') this.guard.reset();
      this.warned = false;
      this.soundOverride = null;
      this.previewMix = null;
    });
    e.on('resume', () => {
      this.soundOverride = null;
      this.previewMix = null;
      this.requestNotifyOnce();
    });
    e.on('pause', () => {
      this.soundOverride = null;
      this.previewMix = null;
    });
    e.on('timeup', (ev) => this._onTimeUp(ev));
    e.on('setdone', () => {
      toast('セット完了！おつかれさまでした 🎉', { timeout: 6000 });
      if (this.settings.alerts.voice) speak('セット完了です。おつかれさまでした。');
    });
  }

  _onTimeUp({ step, overtime, nextType }) {
    const a = this.settings.alerts;
    const wasFocus = step.type === 'focus';
    const sound = wasFocus ? a.focusEndSound : a.breakEndSound;
    this.alerts.play(sound, { volume: a.volume / 100, repeat: a.repeat });
    const next = this.engine.step;
    const nextMin = Math.round((next?.dur ?? 0) / 60);
    let title;
    let body;
    if (wasFocus) {
      title = '集中おつかれさまでした';
      if (overtime) body = '時間になりました。区切りのいいところで休憩に入りましょう';
      else if (nextType === 'long') body = `長い休憩です（${nextMin}分）。しっかり休みましょう`;
      else if (nextType) body = `${nextMin}分休憩しましょう`;
      else body = 'セット完了です';
    } else {
      title = '休憩終了';
      body = overtime ? '時間になりました。次の集中を始めましょう' : '次の集中を始めましょう';
    }
    if (a.voice) speak(`${title}。${body}。`);
    if (a.notify) this.notify(title, body);
    if (this.desktop) this.desktop.attention({ focus: a.bringToFront, flash: a.flashTaskbar });
  }

  // ── 毎フレームの更新 ────────────────────────────
  _tick() {
    this.engine.tick();
    const snap = this.engine.snapshot();
    const sec = Math.floor((snap.countUp ? snap.elapsed : snap.remaining) / 1000);
    if (sec !== this.lastSecond) {
      const first = this.lastSecond == null;
      this.lastSecond = sec;
      this.renderTime(snap);
      if (!first) this._secondSounds(snap);
      this._sendState(false, snap);
      if (this.settings.view.titleTimer || this.desktop) this._updateTitle(snap);
      const fs = $('#fs-clock');
      if (document.body.classList.contains('focus-mode')) fs.textContent = fmtTime(Date.now());
    } else if (snap.status === 'running') {
      // 針はなめらかに動かす
      this._renderRing(snap);
    }
  }

  _secondSounds(snap) {
    const a = this.settings.alerts;
    if (snap.status !== 'running') return;
    if (a.tick !== 'none') {
      const ok = a.tickWhen === 'always' || (a.tickWhen === 'focus' && snap.type === 'focus') || (a.tickWhen === 'lastMinute' && !snap.countUp && snap.remaining <= 60000);
      if (ok) this.alerts.tick(a.tick, a.tickVolume / 100);
    }
    if (a.warnBefore > 0 && !snap.countUp && !this.warned && snap.remaining > 0 && snap.remaining <= a.warnBefore * 60000 && snap.planned > a.warnBefore * 60000 + 30000) {
      this.warned = true;
      this.alerts.play(a.warnSound, { volume: (a.volume / 100) * 0.8, repeat: 1 });
    }
  }

  _updateTitle(snap) {
    const label = STEP_TYPES[snap.type].label;
    const t = snap.countUp ? fmtClock(snap.elapsed) : fmtClock(snap.remaining);
    document.title = snap.status === 'ready' && !snap.elapsed ? 'Pomoroad' : `${t} ${label}${snap.status === 'paused' ? '（一時停止）' : ''} – Pomoroad`;
  }

  // ── 描画 ───────────────────────────────────────
  colorOf(type) {
    return this.settings.view.colors[type] ?? this.settings.view.colors.focus;
  }

  renderAll() {
    const snap = this.engine.snapshot();
    this.renderTime(snap);
    this.renderControls(snap);
    this.renderRoad(snap);
    this.renderTaskPill();
    this.side.render();
  }

  renderTime(snap = this.engine.snapshot()) {
    const v = this.settings.view;
    const color = this.colorOf(snap.type);
    document.documentElement.style.setProperty('--phase', color);
    document.body.classList.remove('status-ready', 'status-running', 'status-paused');
    document.body.classList.add(`status-${snap.status}`);
    const timeEl = $('#time');
    let text;
    if (snap.countUp) text = fmtClock(snap.elapsed, { seconds: v.showSeconds });
    else text = fmtClock(snap.remaining, { seconds: v.showSeconds });
    if (!v.showSeconds && !text.includes(':')) text += '分';
    timeEl.textContent = text;
    timeEl.classList.toggle('overtime', snap.overtime);

    const label = $('#phase-label');
    fill(
      label,
      h('span', { class: 'dot' }),
      h('span', null, snap.step.label || STEP_TYPES[snap.type].label),
      snap.mode === 'flow' ? h('span', { style: { color: 'var(--muted)' } }, '・フロー') : null,
      snap.mode === 'stopwatch' ? h('span', { style: { color: 'var(--muted)' } }, '・ストップウォッチ') : null,
    );

    const sub = [];
    if (snap.mode === 'pomodoro') {
      if (snap.type === 'focus') sub.push(h('span', null, h('b', null, `${snap.focusNo}`), ` / ${snap.focusTotal} 回目`));
      else if (snap.next) sub.push(h('span', null, `次は${STEP_TYPES[snap.next.type].short} ${Math.round(snap.next.dur / 60)}分`));
    } else if (snap.mode === 'flow' && snap.type === 'focus') {
      const f = this.settings.timer.flow;
      const br = clamp(Math.round((snap.elapsed / 60000 / f.ratio) * 2) / 2, f.minBreak, f.maxBreak);
      sub.push(h('span', null, `休憩の目安 ${br}分`));
    }
    if (snap.overtime) sub.push(h('span', null, '時間を過ぎています'));
    else if (v.showEndTime && snap.endsAt) sub.push(h('span', null, `${fmtTime(snap.endsAt)} に終了`));
    if (snap.status === 'ready' && snap.elapsed === 0 && snap.index > 0) sub.push(h('span', null, '準備ができたら開始'));
    if (snap.interruptions) sub.push(h('span', null, `⚡${snap.interruptions}`));
    const subEl = clear($('#sub-label'));
    sub.forEach((x, i) => subEl.append(i ? ' ・ ' : '', x));
    this._renderRing(snap);
  }

  _renderRing(snap) {
    const v = this.settings.view;
    this.ring.update({
      progress: snap.overtime ? 1 : snap.progress,
      color: this.colorOf(snap.type),
      style: v.ring,
      count: v.tickCount,
      direction: v.ringDirection,
      running: snap.status === 'running',
    });
  }

  renderControls(snap = this.engine.snapshot()) {
    const c = clear($('#controls'));
    const q = clear($('#quick-actions'));
    const t = this.settings.timer;
    const isFocus = snap.type === 'focus';
    const strictLock = t.strict && isFocus && snap.status === 'running' && snap.mode === 'pomodoro';

    let primaryLabel;
    let primaryIcon;
    let primaryFn;
    let startStyle = false;
    if (snap.overtime && snap.mode === 'pomodoro') {
      const nt = snap.next?.type;
      primaryLabel = nt && isBreak(nt) ? '休憩へ' : '集中へ';
      primaryIcon = 'skip';
      primaryFn = () => this.engine.skip();
      startStyle = true;
    } else if (strictLock) {
      primaryLabel = '中断する';
      primaryIcon = 'stop';
      primaryFn = () => this.abandon();
    } else if (snap.status === 'running') {
      primaryLabel = '一時停止';
      primaryIcon = 'pause';
      primaryFn = () => this.engine.pause();
    } else if (snap.status === 'paused') {
      primaryLabel = '再開';
      primaryIcon = 'play';
      primaryFn = () => this.engine.start();
      startStyle = true;
    } else {
      primaryLabel = isFocus ? '開始' : '休憩を開始';
      primaryIcon = 'play';
      primaryFn = () => this.engine.start();
      startStyle = true;
    }
    const primary = h('button', { class: ['primary-btn', startStyle && 'start'], onclick: primaryFn, id: 'primary' }, icon(primaryIcon, 20), primaryLabel);

    const rb = (ic, tip, fn, opts = {}) => tipOn(h('button', { class: 'round-btn', onclick: fn, disabled: opts.disabled, 'aria-label': tip }, opts.text ? h('span', { class: 'txt' }, opts.text) : icon(ic, 20)), tip);
    const left = [];
    const right = [];
    if (!strictLock) {
      left.push(rb('reset', 'このステップをやり直す（R）', () => this.resetStep(), { disabled: snap.status === 'ready' && snap.elapsed === 0 }));
      if (snap.mode === 'pomodoro') {
        if (isFocus) right.push(rb('coffee', '今すぐ休憩へ（B）', () => this.breakNow()));
        else right.push(rb('skip', '休憩をスキップ（N）', () => this.skip()));
      } else if (snap.mode === 'flow') {
        right.push(rb(isFocus ? 'coffee' : 'skip', isFocus ? '休憩する（B）' : '休憩をスキップ（N）', () => (isFocus ? this.breakNow() : this.skip())));
      } else {
        right.push(rb('check', '終了して記録（B）', () => this.breakNow(), { disabled: snap.status === 'ready' && snap.elapsed === 0 }));
      }
      if (!snap.countUp) right.push(rb('plus', '1分のばす（+ / Shift で5分）', (e) => this.engine.extend(e.shiftKey ? 300 : 60), { text: '+1' }));
    }
    right.push(rb('more', 'その他の操作', (e) => this._moreMenu(e.currentTarget, snap)));
    c.append(...left, primary, ...right);

    // 一時停止中・時間切れのときの選択肢
    const chip = (label, fn, opts = {}) => h('button', { class: ['chip-btn', opts.accent && 'accent'], onclick: fn }, opts.icon ? icon(opts.icon, 15) : null, label, opts.key ? h('span', { class: 'k' }, opts.key) : null);
    if (snap.mode === 'pomodoro' && snap.status === 'paused' && !snap.overtime) {
      if (isFocus) {
        q.append(
          chip('ここで切り上げて休憩に入る', () => this.breakNow(), { icon: 'coffee', accent: true, key: 'B' }),
          chip('長い休憩に入る', () => this.breakNow('long'), { icon: 'coffee' }),
          chip('次へスキップ', () => this.skip(), { icon: 'skip', key: 'N' }),
        );
      } else {
        q.append(chip('休憩をスキップして集中へ', () => this.skip(), { icon: 'skip', accent: true, key: 'N' }), snap.type === 'short' ? chip('長い休憩に切り替える', () => this.engine.breakNow('long'), { icon: 'coffee' }) : null);
      }
    } else if (snap.overtime) {
      q.append(chip('5分のばす', () => this.engine.extend(300), { icon: 'plus' }));
    } else if (snap.mode === 'flow' && isFocus && snap.status !== 'ready') {
      q.append(chip('休憩する', () => this.breakNow(), { icon: 'coffee', accent: true, key: 'B' }));
    } else if (snap.mode === 'pomodoro' && snap.status === 'ready' && !isFocus) {
      q.append(chip('休憩をとばして集中を始める', () => this.skip(), { icon: 'skip' }));
    }
  }

  _moreMenu(anchor, snap) {
    const e = this.engine;
    const isFocus = snap.type === 'focus';
    const items = [];
    if (snap.mode === 'pomodoro') {
      if (isFocus) {
        items.push({ label: '今すぐ短い休憩をとる', icon: 'coffee', onClick: () => this.breakNow('short') });
        items.push({ label: '今すぐ長い休憩をとる', icon: 'coffee', onClick: () => this.breakNow('long') });
      } else {
        items.push({ label: snap.type === 'short' ? '長い休憩に切り替える' : '短い休憩に切り替える', icon: 'repeat', onClick: () => e.breakNow(snap.type === 'short' ? 'long' : 'short') });
        items.push({ label: '休憩をスキップして集中へ', icon: 'skip', onClick: () => this.skip(), key: 'N' });
      }
    }
    if (!snap.countUp) {
      items.push({ label: '1分のばす', icon: 'plus', onClick: () => e.extend(60), key: '+' });
      items.push({ label: '5分のばす', icon: 'plus', onClick: () => e.extend(300), key: 'Shift +' });
      items.push({ label: '1分へらす', icon: 'minus', onClick: () => e.extend(-60), key: '-' });
      items.push({ node: h('div', { class: 'menu-row' }, h('span', { style: { flex: 1, fontSize: '13px' } }, '残り時間を指定'), stepper(Math.max(1, Math.round(snap.remaining / 60000)), (v) => e.extend(Math.round(v * 60 - e.remaining() / 1000)), { min: 1, max: 300, unit: '分' })) });
    }
    items.push('sep');
    if (isFocus) items.push({ label: '気が散ったを記録（+1）', icon: 'zap', onClick: () => this.distract(), key: 'D' });
    items.push({ label: 'このステップをやり直す', icon: 'reset', onClick: () => this.resetStep(), key: 'R' });
    items.push({ label: '最初（1回目）からやり直す', icon: 'repeat', onClick: () => this.restart() });
    items.push('sep');
    items.push({ label: 'タイマーの設定…', icon: 'settings', onClick: () => this.openDrawer('settings', 'timer') });
    openMenu(anchor, items, { align: 'center', above: true });
  }

  renderRoad(snap = this.engine.snapshot()) {
    const el = clear($('#road'));
    el.classList.toggle('hidden', !this.settings.view.showRoad);
    if (snap.mode !== 'pomodoro') {
      if (snap.mode === 'flow') {
        const flowRoad = snap.road.slice(-9);
        const off = snap.road.length - flowRoad.length;
        flowRoad.forEach((s, i) => this._roadNode(el, s, i + off, snap, i > 0));
      }
      return;
    }
    snap.road.forEach((s, i) => this._roadNode(el, s, i, snap, i > 0));
    if (this.settings.timer.repeat) el.append(h('span', { class: 'road-cycle', title: 'くり返し' }, icon('repeat', 13), snap.cycle > 0 ? `${snap.cycle + 1}周目` : ''));
  }

  _roadNode(el, s, i, snap, link) {
    const done = i < snap.index;
    if (link) el.append(h('span', { class: ['road-link', i <= snap.index && 'done'] }));
    const node = h('button', {
      class: ['road-node', `t-${s.type}`, done && 'done', i === snap.index && 'current'],
      style: { '--c': this.colorOf(s.type) },
      'aria-label': `${i + 1}番目：${STEP_TYPES[s.type].label}`,
      onclick: (e) => this._roadMenu(e.currentTarget, s, i, snap),
    }, h('span', { class: 'd' }));
    node.style.setProperty('--c', this.colorOf(s.type));
    tipOn(node, () => `${i + 1}. ${s.label || STEP_TYPES[s.type].label}${s.countUp ? '' : ` ${Math.round(s.dur / 60)}分`}${i === snap.index ? '（いま）' : ''}`);
    el.append(node);
  }

  _roadMenu(anchor, s, i, snap) {
    const e = this.engine;
    if (snap.mode !== 'pomodoro') return;
    const items = [{ header: `${i + 1}番目：${s.label || STEP_TYPES[s.type].label}` }];
    if (i !== snap.index) items.push({ label: 'ここへ移動', icon: 'flag', onClick: () => e.jump(i) });
    const types = Object.entries(STEP_TYPES).filter(([k]) => k !== s.type);
    for (const [k, v] of types) {
      const dur = (k === 'focus' ? this.settings.timer.simple.focus : k === 'long' ? this.settings.timer.simple.long : this.settings.timer.simple.short) * 60;
      items.push({ label: `「${v.label}」に変える`, icon: 'repeat', onClick: () => e.updateStep(i, { type: k, dur, label: '' }) });
    }
    items.push({
      node: h('div', { class: 'menu-row' }, h('span', { style: { flex: 1, fontSize: '13px' } }, '長さ'), stepper(Math.round(s.dur / 60), (v) => e.updateStep(i, { dur: v * 60 }), { min: 1, max: 240, unit: '分' })),
    });
    items.push('sep');
    items.push({ label: 'この後ろに短い休憩を入れる', icon: 'plus', onClick: () => e.insertStep(i + 1, { type: 'short', dur: this.settings.timer.simple.short * 60 }) });
    items.push({ label: 'この後ろに集中を入れる', icon: 'plus', onClick: () => e.insertStep(i + 1, { type: 'focus', dur: this.settings.timer.simple.focus * 60 }) });
    if (i !== snap.index) items.push({ label: 'このステップを消す', icon: 'trash', danger: true, onClick: () => e.removeStep(i) });
    items.push({ header: 'ここでの変更は今のセットだけ。ずっと使う並びは「タイマーのモード」で' });
    openMenu(anchor, items, { align: 'center', above: true });
  }

  renderTaskPill() {
    const pill = clear($('#task-pill'));
    const t = this.data.currentTask;
    pill.classList.toggle('has-task', !!t);
    if (t) pill.append(h('span', { class: 'task-dot' }), h('span', { class: 'label' }, t.title), h('span', { class: 'count' }, `🍅 ${t.done || 0}/${t.est || 1}`));
    else pill.append(h('span', { class: 'label' }, 'タスクを選んでください…'));
    pill.append(icon('chevronDown', 16));
  }

  _taskMenu(anchor) {
    const d = this.data;
    const open = d.tasks.filter((t) => !t.completed);
    const items = [{ header: '集中するタスク' }];
    items.push({ label: 'タスクなし', selected: !d.currentTaskId, onClick: () => d.setCurrentTask(null) });
    for (const t of open) items.push({ label: `${t.title}　🍅 ${t.done || 0}/${t.est || 1}`, selected: d.currentTaskId === t.id, onClick: () => d.setCurrentTask(t.id) });
    items.push('sep');
    items.push({
      label: '新しいタスクを追加…',
      icon: 'plus',
      onClick: async () => {
        const { promptDialog } = await import('./ui/widgets.js');
        const title = await promptDialog({ title: '新しいタスク', placeholder: '例：線形代数の課題', ok: '追加' });
        if (title) d.setCurrentTask(d.addTask(title, 1).id);
      },
    });
    openMenu(anchor, items, { align: 'center' });
  }

  // ── 操作 ───────────────────────────────────────
  _strictBlocked(snap) {
    if (this.settings.timer.strict && snap.mode === 'pomodoro' && snap.type === 'focus' && snap.status === 'running' && !snap.overtime) {
      toast('厳格モード中です。やめるときは「中断する」を押してください');
      return true;
    }
    return false;
  }

  async skip() {
    const snap = this.engine.snapshot();
    if (this._strictBlocked(snap)) return;
    if (this.settings.timer.confirmSkip && snap.type === 'focus' && snap.elapsed > 0 && !snap.overtime) {
      if (!(await confirmDialog({ title: 'この集中をスキップしますか？', message: 'ここまでの時間は記録に残ります。' }))) return;
    }
    this.engine.skip();
  }

  async breakNow(kind = null) {
    const snap = this.engine.snapshot();
    if (this._strictBlocked(snap)) return;
    if (this.settings.timer.confirmSkip && snap.type === 'focus' && snap.mode === 'pomodoro' && !snap.overtime && snap.elapsed > 0) {
      if (!(await confirmDialog({ title: 'ここで切り上げて休憩に入りますか？', message: 'ここまでの集中時間は記録に残ります。' }))) return;
    }
    this.engine.breakNow(kind);
  }

  resetStep() {
    if (this._strictBlocked(this.engine.snapshot())) return;
    this.engine.resetStep();
  }

  async restart() {
    if (this.engine.active && !(await confirmDialog({ title: '最初からやり直しますか？', message: 'ロードの1つ目に戻ります。ここまでの時間は記録に残ります。', ok: 'やり直す' }))) return;
    this.engine.restart();
  }

  async abandon() {
    if (!(await confirmDialog({ title: 'この集中を中断しますか？', message: '厳格モードです。ここまでの時間は記録に残りますが、ポモドーロには数えません。', ok: '中断する', danger: true }))) return;
    this.engine.abandon();
  }

  distract() {
    if (this.engine.step.type !== 'focus') return;
    this.engine.interruption();
    toast('気が散ったことを記録しました。深呼吸してもう一度 🍃', { timeout: 2500 });
  }

  liveFocusMs() {
    return this.engine.step.type === 'focus' ? this.engine.elapsed() : 0;
  }

  liveSegments() {
    const st = this.engine.st;
    const type = this.engine.step.type;
    const segs = st.segs.map(([a, b]) => ({ a, b, type }));
    if (st.status === 'running' && st.segStart) segs.push({ a: st.segStart, b: Date.now(), type });
    return segs;
  }

  // ── 設定 ───────────────────────────────────────
  set(path, value, { silent = false } = {}) {
    setPath(this.settings, path, value);
    this.saveSettings();
    this._applyChange(path);
    void silent;
  }

  replaceSettings(next) {
    this.settings = mergeDefaults(DEFAULTS, next);
    this.saveSettings.flush();
    this.engine.applySettings();
    this.sound.setMaster(this.settings.sound.master / 100);
    this.sound.setVariation(this.settings.sound.variation);
    this.applyView();
    this.syncSound();
    this.renderAll();
    this.phone.apply();
    if (this.desktop) this._pushDesktopSettings();
    if (this.drawer) this.renderDrawer();
  }

  applyPreset(patch) {
    const t = this.settings.timer;
    if (patch.simple) patch = { ...patch, simple: { ...t.simple, ...patch.simple } };
    this.settings.timer = mergeDefaults(DEFAULTS.timer, { ...t, ...patch });
    this.saveSettings();
    this.engine.applySettings();
    this.renderAll();
  }

  _applyChange(path) {
    const root = path.split('.')[0];
    if (root === 'timer') {
      this.engine.applySettings();
      this.renderAll();
    } else if (root === 'goal') {
      this.side.render();
    } else if (root === 'view') {
      this.applyView();
      this.renderAll();
    } else if (root === 'sound') {
      if (path === 'sound.master') this.sound.setMaster(this.settings.sound.master / 100);
      if (path === 'sound.variation') this.sound.setVariation(this.settings.sound.variation);
      this.syncSound();
    } else if (root === 'mini') {
      this._sendState(true);
      if (this.desktop) this._pushDesktopSettings({ shortcuts: false });
    } else if (root === 'phone') {
      this.phone.apply();
    } else if (root === 'globalKeys' || root === 'system') {
      if (this.desktop) this._pushDesktopSettings({ shortcuts: root === 'globalKeys' });
    }
  }

  applyView() {
    const v = this.settings.view;
    const de = document.documentElement;
    de.dataset.theme = v.theme;
    de.dataset.font = v.font;
    de.style.setProperty('--c-focus', v.colors.focus);
    de.style.setProperty('--c-short', v.colors.short);
    de.style.setProperty('--c-long', v.colors.long);
    const base = v.theme === 'light' ? '255, 255, 255' : '28, 30, 37';
    de.style.setProperty('--card', `rgba(${base}, ${v.cardOpacity / 100})`);
    document.body.classList.toggle('side-closed', !v.sidePanel);
    this.bg.apply(v, this.bgImageUrl);
    this._applyFx();
    if (this.desktop) this.desktop.setTitleBar({ dark: v.theme !== 'light' });
  }

  _applyFx() {
    const v = this.settings.view;
    let fx = v.fx;
    if (fx === 'auto') fx = this.sound.playing ? effectForMix(this.currentMix() ?? {}) : 'none';
    this.bg.setEffect(fx);
  }

  async reloadBackgroundImage() {
    if (this.bgImageUrl) URL.revokeObjectURL(this.bgImageUrl);
    this.bgImageUrl = null;
    if (this.settings.view.background === 'image') {
      try {
        const blob = await getFile('bg-image');
        if (blob) this.bgImageUrl = URL.createObjectURL(blob);
      } catch (err) {
        console.warn(err);
      }
    }
    this.bg.apply(this.settings.view, this.bgImageUrl);
  }

  toggleSide() {
    this.set('view.sidePanel', !this.settings.view.sidePanel);
  }

  // ── 環境音 ─────────────────────────────────────
  currentMixKey() {
    const s = this.settings.sound;
    if (this.previewMix) return this.previewMix;
    if (s.link !== 'separate') return 'focus';
    return this.engine.step.type === 'focus' ? 'focus' : 'break';
  }

  currentMix() {
    return this.settings.sound.mixes[this.currentMixKey()] ?? {};
  }

  syncSound() {
    const s = this.settings.sound;
    const st = this.engine.st;
    const type = this.engine.step.type;
    const running = st.status === 'running';
    const pausedMid = st.status === 'paused';
    let should;
    if (s.link === 'manual') should = this.manualPlaying;
    else if (s.link === 'focus') should = type === 'focus' && (running || (pausedMid && !s.pauseWithTimer));
    else should = running || (pausedMid && !s.pauseWithTimer);
    if (this.soundOverride !== null) should = this.soundOverride;
    const mix = this.currentMix();
    const key = JSON.stringify(mix);
    if (key !== this._mixKey) {
      this._mixKey = key;
      this.sound.setMix(mix);
    }
    if (should !== this.sound.playing) {
      this.sound.setPlaying(should, s.fadeSec);
      if (this.drawer === 'sounds') this.renderDrawer();
    }
    $('#btn-sound-quick')?.classList.toggle('active', should);
    this._applyFx();
  }

  toggleSoundPlayback() {
    const next = !this.sound.playing;
    if (this.settings.sound.link === 'manual') this.manualPlaying = next;
    else this.soundOverride = next;
    if (next && !Object.values(this.currentMix()).some((v) => v > 0)) {
      toast('音が選ばれていません。「ホワイトノイズ」から選んでください', { action: '開く', onAction: () => this.openDrawer('sounds') });
    }
    this.syncSound();
  }

  /** ミックスを変える。autoplay なら止まっていても鳴らして試聴できるようにする */
  setMix(key, mix, autoplay = false) {
    this.settings.sound.mixes[key] = mix;
    this.saveSettings();
    if (this.settings.sound.link === 'separate' && key !== this.currentMixKey()) this.previewMix = key;
    if (autoplay && !this.sound.playing) {
      if (this.settings.sound.link === 'manual') this.manualPlaying = true;
      else this.soundOverride = true;
    }
    this.syncSound();
  }

  // ── ドロワー ───────────────────────────────────
  openDrawer(kind, tab = null) {
    closeMenu();
    if (this.drawer === kind && (!tab || tab === this.drawerTab)) return this.closeDrawer();
    this.drawer = kind;
    this.drawerTab = tab ?? this.drawerTab ?? 'timer';
    if (kind === 'settings') {
      this.settings.ui.lastTab = this.drawerTab;
      this.saveSettings();
    }
    document.body.classList.add('drawer-open');
    for (const b of document.querySelectorAll('.tool')) b.classList.remove('active');
    const toolId = kind === 'settings' ? (this.drawerTab === 'timer' ? 'mode' : 'settings') : kind;
    $(`#tool-${toolId}`)?.classList.add('active');
    this.renderDrawer();
  }

  closeDrawer() {
    this.drawer = null;
    this.guard.preview = false;
    document.body.classList.remove('drawer-open');
    for (const b of document.querySelectorAll('.tool')) b.classList.remove('active');
  }

  renderDrawer() {
    const body = $('#drawer-body');
    const tabs = clear($('#drawer-tabs'));
    const title = $('#drawer-title');
    const scroll = body.scrollTop;
    this.guard.preview = this.drawer === 'settings' && this.drawerTab === 'guard';
    if (this.drawer === 'sounds') {
      title.textContent = 'ホワイトノイズ・環境音';
      tabs.style.display = 'none';
      renderSounds(body, this);
    } else if (this.drawer === 'stats') {
      title.textContent = '統計';
      tabs.style.display = 'none';
      renderStats(body, this);
    } else if (this.drawer === 'settings') {
      title.textContent = this.drawerTab === 'timer' ? 'タイマーのモード' : '設定';
      tabs.style.display = '';
      for (const [id, label, ic] of SETTINGS_TABS) {
        tabs.append(h('button', { class: ['tab', id === this.drawerTab && 'active'], onclick: () => { this.drawerTab = id; this.settings.ui.lastTab = id; this.saveSettings(); this.openDrawer('settings', id); } }, icon(ic, 15), label));
      }
      renderSettings(body, this.drawerTab, this);
    }
    body.scrollTop = scroll;
  }

  // ── 全画面・ミニ表示 ─────────────────────────────
  async toggleFullscreen() {
    const on = !document.body.classList.contains('focus-mode');
    document.body.classList.toggle('focus-mode', on);
    if (on) this.closeDrawer();
    try {
      if (this.desktop) await this.desktop.setFullScreen(on);
      else if (on) await document.documentElement.requestFullscreen?.();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch (err) {
      console.warn('fullscreen', err);
    }
    $('#tool-fullscreen')?.replaceChildren(icon(on ? 'exitfs' : 'fullscreen', 24), h('span', null, on ? '全画面を終了' : '全画面'));
    this._tick();
  }

  collapseToMini() {
    if (this.desktop) this.desktop.mini.collapse();
    else if (!this.pip) this.toggleMini();
  }

  async toggleMini() {
    if (this.desktop) {
      this.desktop.mini.toggle();
      return;
    }
    if (this.pip) {
      this.pip.win.close();
      return;
    }
    if (!('documentPictureInPicture' in window)) {
      toast('このブラウザはピクチャーインピクチャーに対応していません（Chrome / Edge で使えます）');
      return;
    }
    const [w, hgt] = MINI_SIZES[this.settings.mini.layout] ?? MINI_SIZES.bar;
    const win = await window.documentPictureInPicture.requestWindow({ width: w + 8, height: hgt + 8 });
    const link = win.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../css/mini.css', import.meta.url).href;
    win.document.head.append(link);
    win.document.body.className = 'mini-host';
    const root = win.document.createElement('div');
    win.document.body.append(root);
    this.pip = { win, view: new MiniView(root, (cmd) => this.command(cmd)) };
    win.addEventListener('pagehide', () => {
      this.pip = null;
    });
    this._sendState(true);
  }

  /** トレイ・ミニ表示・全体のショートカットから届く操作 */
  command(cmd) {
    const type = cmd?.type;
    if (type === 'toggle') this.engine.toggle();
    else if (type === 'skip') this.skip();
    else if (type === 'breakNow') this.breakNow();
    else if (type === 'plus') this.engine.extend(60);
    else if (type === 'mini' || type === 'closeMini') {
      if (this.desktop) this.desktop.mini.toggle(type === 'closeMini' ? false : undefined);
      else this.pip?.win.close();
    } else if (type === 'openMain') {
      if (this.desktop) this.desktop.showMain();
      else window.focus();
    } else if (type === 'sound') this.toggleSoundPlayback();
  }

  // ── ミニ表示・Windows への状態の送信 ───────────────
  miniState(snap) {
    const m = this.settings.mini;
    const v = this.settings.view;
    const t = snap.countUp ? fmtClock(snap.elapsed, { seconds: v.showSeconds }) : fmtClock(snap.remaining, { seconds: v.showSeconds });
    return {
      layout: m.layout,
      time: t,
      label: (snap.step.label || STEP_TYPES[snap.type].label) + (snap.status === 'paused' ? '（停止中）' : ''),
      sub: snap.mode === 'pomodoro' && snap.type === 'focus' ? `${snap.focusNo} / ${snap.focusTotal} 回目` : '',
      color: this.colorOf(snap.type),
      progress: snap.overtime ? 1 : snap.progress,
      running: snap.status === 'running',
      overtime: snap.overtime,
      task: this.data.currentTask?.title ?? '',
      alert: this.guard.miniAlert(),
      showTask: m.showTask,
      controls: m.controls,
      glass: m.glass,
      theme: v.theme,
    };
  }

  _sendState(force = false, snap = this.engine.snapshot()) {
    const mini = this.miniState(snap);
    this.pip?.view.update(mini);
    if (!this.desktop) return;
    const label = STEP_TYPES[snap.type].label;
    const state = {
      mini,
      status: snap.status,
      progress: snap.overtime ? 1 : snap.countUp ? -1 : snap.progress,
      type: snap.type,
      tooltip: `Pomoroad — ${label} ${mini.time}${snap.status === 'paused' ? '（一時停止中）' : ''}`,
      title: snap.status === 'ready' && !snap.elapsed ? 'Pomoroad' : `${mini.time} ${label} – Pomoroad`,
      running: snap.status === 'running',
    };
    this.desktop.sendState(state);
    // トレイのアイコン（進み具合のリング）は変化があったときだけ作り直す
    const key = `${snap.type}:${snap.status}:${Math.round((snap.overtime ? 1 : snap.progress) * 24)}`;
    if (force || key !== this._trayKey) {
      this._trayKey = key;
      this.desktop.setTray({ icons: trayIcons(snap.overtime ? 1 : snap.progress, this.colorOf(snap.type), snap.status) });
    }
  }

  // ── 通知 ───────────────────────────────────────
  requestNotifyOnce() {
    if (this._askedNotify) return;
    this._askedNotify = true;
    if (this.settings.alerts.notify) this.requestNotify();
  }

  requestNotify() {
    if (this.desktop) return;
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }

  notify(title, body) {
    if (this.desktop) {
      this.desktop.notify({ title, body });
      return;
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      if (document.hidden) return;
      toast(`${title}：${body}`);
      return;
    }
    try {
      const n = new Notification(title, { body, icon: 'assets/icon.png', silent: true });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch (err) {
      console.warn(err);
    }
  }

  // ── キーボード ─────────────────────────────────
  _bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeMenu();
        if (this.drawer) this.closeDrawer();
        else if (document.body.classList.contains('focus-mode')) this.toggleFullscreen();
        return;
      }
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal-back')) return;
      const k = this.settings.keys;
      const map = {
        [k.toggle]: () => {
          const snap = this.engine.snapshot();
          if (snap.overtime) this.engine.skip();
          else if (this.settings.timer.strict && snap.type === 'focus' && snap.status === 'running') this.abandon();
          else this.engine.toggle();
        },
        [k.skip]: () => this.skip(),
        [k.breakNow]: () => this.breakNow(),
        [k.reset]: () => this.resetStep(),
        [k.plus]: () => this.engine.extend(e.shiftKey ? 300 : 60),
        [k.minus]: () => this.engine.extend(-60),
        [k.fullscreen]: () => this.toggleFullscreen(),
        [k.mini]: () => this.toggleMini(),
        [k.sounds]: () => this.openDrawer('sounds'),
        [k.stats]: () => this.openDrawer('stats'),
        [k.distract]: () => this.distract(),
      };
      delete map[''];
      const fn = map[e.code];
      if (fn) {
        e.preventDefault();
        fn();
      }
    });
  }

  // ── Windows（Electron）との連携 ────────────────
  _initDesktop() {
    const d = this.desktop;
    d.onCommand((cmd) => this.command(cmd));
    d.onPower((ev) => {
      const sy = this.settings.system;
      if ((ev === 'lock-screen' && sy.pauseOnLock) || (ev === 'suspend' && sy.pauseOnSleep)) {
        if (this.engine.running) {
          this.engine.pause();
          toast(ev === 'suspend' ? 'スリープしたので一時停止しました' : '画面がロックされたので一時停止しました');
        }
      }
    });
    d.onFullScreen?.((on) => {
      if (!on && document.body.classList.contains('focus-mode')) {
        document.body.classList.remove('focus-mode');
        $('#tool-fullscreen')?.replaceChildren(icon('fullscreen', 24), h('span', null, '全画面'));
      }
    });
    // 離席の検出
    setInterval(async () => {
      const min = this.settings.system.idlePauseMin;
      if (!min || !this.engine.running || this.engine.step.type !== 'focus') return;
      const idle = await d.getIdleTime();
      if (idle >= min * 60) {
        this.engine.pause(Date.now() - idle * 1000);
        toast(`操作がなかった ${Math.round(idle / 60)} 分を記録から除いて、一時停止しました`, { timeout: 10000 });
      }
    }, 15000);
    this._pushDesktopSettings();
  }

  async _pushDesktopSettings({ shortcuts = true } = {}) {
    const d = this.desktop;
    const s = this.settings;
    d.mini.setOptions({ ...s.mini, size: MINI_SIZES[s.mini.layout] ?? MINI_SIZES.bar });
    d.setSystem({ closeToTray: s.system.closeToTray, mainOnTop: s.system.mainOnTop, openAtLogin: s.system.openAtLogin });
    if (!shortcuts) return;
    const res = await d.setShortcuts(s.globalKeys);
    this.shortcutFailures = res?.failed ?? [];
    if (this.shortcutFailures.length) toast(`全体のショートカット ${this.shortcutFailures.join('、')} は他のアプリが使っているため登録できませんでした`);
  }
}

/** トレイ用の小さなアイコン（進み具合のリング） */
function trayIcons(progress, color, status) {
  const make = (size) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const r = size / 2;
    const lw = Math.max(2, size * 0.16);
    g.fillStyle = '#16181d';
    g.beginPath();
    g.arc(r, r, r - 0.5, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.beginPath();
    g.arc(r, r, r - lw / 2 - 1, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = color;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(r, r, r - lw / 2 - 1, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, progress));
    g.stroke();
    g.fillStyle = status === 'running' ? color : 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.arc(r, r, size * 0.14, 0, Math.PI * 2);
    g.fill();
    return c.toDataURL('image/png');
  };
  return { x1: make(16), x2: make(32) };
}

const app = new App();
window.pomoroad = app;
app.init().catch((err) => {
  console.error(err);
  document.body.append(h('pre', { style: { position: 'fixed', bottom: 0, left: 0, color: '#f88', zIndex: 999, whiteSpace: 'pre-wrap' } }, String(err?.stack || err)));
});


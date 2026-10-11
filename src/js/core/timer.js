// タイマー本体。DOM にも Web Audio にも依存しない（Node でテストできる）。
// 時刻は Date.now() から毎回計算するので、ウィンドウが隠れて setInterval が
// 間引かれても時間がずれない。

import { Emitter, clamp, uid } from './util.js';
import { buildRoad, isBreak, focusOrdinal, focusCount } from './sequence.js';

const STATE_VERSION = 1;

export class TimerEngine extends Emitter {
  /**
   * @param {object} o
   * @param {() => object} o.getSettings  timer 設定（settings.timer）を返す関数
   * @param {() => string|null} [o.getTaskId] 記録に付ける選択中タスク ID
   * @param {() => number} [o.now]
   */
  constructor({ getSettings, getTaskId = () => null, now = () => Date.now() }) {
    super();
    this.cfg = getSettings;
    this.getTaskId = getTaskId;
    this.now = now;
    this.st = this._fresh();
  }

  _fresh() {
    const cfg = this.cfg();
    return {
      v: STATE_VERSION,
      mode: cfg.mode,
      road: buildRoad(cfg, 0),
      index: 0,
      cycle: 0,
      status: 'ready', // ready | running | paused
      elapsed: 0, // 現在の区間より前に積み上がった ms
      segStart: null, // running になった時刻
      segs: [], // [開始, 終了] の配列（一時停止で区切られた実働区間）
      extra: 0, // 延長した秒数
      stepStart: null,
      interruptions: 0,
      overtime: false,
    };
  }

  // ── 状態の読み出し ─────────────────────────────────────
  get step() {
    return this.st.road[this.st.index];
  }
  get running() {
    return this.st.status === 'running';
  }
  /** 進行中（開始済みで、まだ終わっていない）か */
  get active() {
    return this.st.status !== 'ready' || this.st.elapsed > 0;
  }
  elapsed(now = this.now()) {
    const st = this.st;
    return st.elapsed + (st.status === 'running' && st.segStart != null ? now - st.segStart : 0);
  }
  planned() {
    const s = this.step;
    if (!s || s.countUp) return Infinity;
    return Math.max(0, (s.dur + this.st.extra) * 1000);
  }
  remaining(now = this.now()) {
    return this.planned() - this.elapsed(now);
  }

  snapshot(now = this.now()) {
    const st = this.st;
    const step = this.step;
    const elapsed = this.elapsed(now);
    const planned = this.planned();
    const countUp = !!step.countUp;
    const remaining = countUp ? 0 : planned - elapsed;
    let progress;
    if (countUp) progress = (elapsed % 3600000) / 3600000;
    else progress = planned > 0 ? clamp(elapsed / planned, 0, 1) : 1;
    const next = st.road[st.index + 1] ?? (this.cfg().repeat ? buildRoad(this.cfg(), st.cycle + 1)[0] : null);
    return {
      mode: st.mode,
      status: st.status,
      step,
      type: step.type,
      index: st.index,
      road: st.road,
      cycle: st.cycle,
      elapsed,
      planned,
      remaining,
      progress,
      countUp,
      overtime: st.overtime || (!countUp && remaining < 0),
      endsAt: st.status === 'running' && !countUp ? now + Math.max(0, remaining) : null,
      focusNo: focusOrdinal(st.road, st.index),
      focusTotal: focusCount(st.road),
      interruptions: st.interruptions,
      next,
    };
  }

  // ── 操作 ──────────────────────────────────────────────
  start() {
    const st = this.st;
    if (st.status === 'running') return;
    const now = this.now();
    if (st.stepStart == null) st.stepStart = now;
    const first = st.elapsed === 0;
    st.status = 'running';
    st.segStart = now;
    if (first) this.emit('stepstart', { step: this.step, index: st.index });
    this.emit('resume', { step: this.step });
    this._changed();
  }

  /** at を渡すと、その時刻に止めたことにする（離席していた時間を記録から除くため） */
  pause(at = null) {
    const st = this.st;
    if (st.status !== 'running') return;
    const now = this.now();
    this._closeSeg(at != null ? Math.min(now, Math.max(st.segStart, at)) : now);
    st.status = 'paused';
    this.emit('pause', { step: this.step });
    this._changed();
  }

  toggle() {
    if (this.running) this.pause();
    else this.start();
  }

  /** 定期的に呼ぶ。時間切れを検出する */
  tick() {
    const st = this.st;
    if (st.status !== 'running' || this.step.countUp || st.overtime) return;
    const now = this.now();
    const rem = this.remaining(now);
    if (rem > 0) return;
    const endTs = now + rem; // 本来の終了時刻（tick が遅れても記録はずらさない）
    this._timeUp(endTs, now);
  }

  _timeUp(endTs, now) {
    const st = this.st;
    const cfg = this.cfg();
    const step = this.step;
    const nextIdx = st.index + 1;
    const nextType = st.road[nextIdx]?.type ?? (cfg.repeat ? buildRoad(cfg, st.cycle + 1)[0]?.type : null);
    const auto = nextType ? this._autoFor(nextType) : false;
    if (!auto && cfg.overtime && nextType) {
      // 次を自動で始めない設定のときは、0 を過ぎても数え続けて合図だけ出す
      st.overtime = true;
      this.emit('timeup', { step, overtime: true, nextType });
      this._changed();
      return;
    }
    this._finishStep({ completed: true, end: endTs, reason: 'complete' });
    const moved = this._goto(nextIdx, { autoStart: auto, now });
    this.emit('timeup', { step, overtime: false, nextType: moved ? this.step.type : null });
  }

  _autoFor(type) {
    const cfg = this.cfg();
    if (cfg.mode === 'flow') return isBreak(type) ? true : !!cfg.flow.autoStartFocus;
    return isBreak(type) ? !!cfg.autoStartBreak : !!cfg.autoStartFocus;
  }

  /** 次のステップへ（スキップ） */
  skip() {
    const st = this.st;
    const step = this.step;
    if (st.mode !== 'pomodoro' && step.type === 'focus') return this.breakNow();
    const wasOvertime = st.overtime;
    this._finishStep({ completed: wasOvertime, reason: wasOvertime ? 'complete' : 'skip' });
    const auto = wasOvertime ? true : this.cfg().startAfterSkip;
    this._goto(st.index + 1, { autoStart: auto });
  }

  /**
   * 今の集中を切り上げて休憩に入る。kind を指定すると休憩の種類を選べる。
   * 休憩中に呼ぶと、休憩の種類を切り替える（経過時間はそのまま）。
   */
  breakNow(kind = null) {
    const st = this.st;
    const cfg = this.cfg();
    const step = this.step;
    const now = this.now();

    if (isBreak(step.type)) {
      if (kind && kind !== step.type) {
        st.road = st.road.slice();
        st.road[st.index] = { ...step, type: kind, dur: this._breakDur(kind) };
        this._changed();
      }
      return;
    }

    if (st.mode === 'stopwatch') {
      this._finishStep({ completed: true, reason: 'complete' });
      this._resetStepFields();
      this._changed();
      return;
    }

    if (st.mode === 'flow') {
      const focusMin = this.elapsed(now) / 60000;
      const f = cfg.flow;
      const brMin = clamp(Math.round((focusMin / Math.max(1, f.ratio)) * 2) / 2, f.minBreak, f.maxBreak);
      this._finishStep({ completed: true, reason: 'complete' });
      const road = st.road.slice(0, st.index + 1);
      road.push({ type: kind ?? 'short', dur: Math.round(brMin * 60), flow: true });
      road.push({ type: 'focus', dur: 0, countUp: true });
      st.road = road.slice(-12); // 履歴が伸びすぎないように
      const idx = st.road.length - 2;
      this._goto(idx, { autoStart: true });
      return;
    }

    this._finishStep({ completed: st.overtime, reason: st.overtime ? 'complete' : 'break-now' });
    const j = st.index + 1;
    const road = st.road.slice();
    const next = road[j];
    if (next && isBreak(next.type)) {
      if (kind && next.type !== kind) road[j] = { ...next, type: kind, dur: this._breakDur(kind) };
    } else {
      const t = kind ?? 'short';
      road.splice(j, 0, { type: t, dur: this._breakDur(t), inserted: true });
    }
    st.road = road;
    this._goto(j, { autoStart: true });
  }

  _breakDur(kind) {
    const cfg = this.cfg();
    const m = kind === 'long' ? cfg.simple.long : cfg.simple.short;
    return Math.max(60, Math.round(m * 60));
  }

  /** 残り時間を増減する（秒） */
  extend(sec) {
    const st = this.st;
    if (this.step.countUp) return;
    st.extra += sec;
    const minExtra = -this.step.dur; // planned が 0 未満にならないように
    if (st.extra < minExtra) st.extra = minExtra;
    if (sec > 0 && st.overtime && this.remaining() > 0) st.overtime = false;
    this._changed();
    this.tick();
  }

  /** 厳格モードの「中断」：記録は残すがポモドーロには数えない */
  abandon() {
    this._finishStep({ completed: false, reason: 'abandon', noCount: true });
    this._resetStepFields();
    this._changed();
  }

  /** 今のステップを最初からやり直す */
  resetStep() {
    this._finishStep({ completed: false, reason: 'reset' });
    this._resetStepFields();
    this._changed();
  }

  /** 1 周目の最初に戻す */
  restart() {
    this._finishStep({ completed: false, reason: 'reset' });
    const cfg = this.cfg();
    const st = this.st;
    st.mode = cfg.mode;
    st.cycle = 0;
    st.road = buildRoad(cfg, 0);
    st.index = 0;
    this._resetStepFields();
    this._changed();
  }

  /** 任意のステップへ移動 */
  jump(index) {
    const st = this.st;
    if (index === st.index || index < 0 || index >= st.road.length) return;
    const wasActive = this.active;
    this._finishStep({ completed: false, reason: 'skip' });
    this._goto(index, { autoStart: wasActive && this.cfg().startAfterSkip });
  }

  /** 「気が散った」を記録 */
  interruption() {
    this.st.interruptions++;
    this._changed();
  }

  // ── ロードの編集 ───────────────────────────────────────
  updateStep(i, patch) {
    const st = this.st;
    if (!st.road[i]) return;
    st.road = st.road.slice();
    st.road[i] = { ...st.road[i], ...patch };
    if (i === st.index) this.tick();
    this._changed();
  }

  insertStep(i, step) {
    const st = this.st;
    st.road = st.road.slice();
    st.road.splice(i, 0, step);
    if (i <= st.index) st.index++;
    this._changed();
  }

  removeStep(i) {
    const st = this.st;
    if (i === st.index || !st.road[i] || st.road.length <= 1) return;
    st.road = st.road.slice();
    st.road.splice(i, 1);
    if (i < st.index) st.index--;
    this._changed();
  }

  /**
   * 設定（時間・並び・モード）が変わったときに呼ぶ。
   * 始める前なら丸ごと作り直す。途中なら経過時間を保ったまま、
   * 同じ種類のステップのうち今の位置に一番近いところへ乗り換える。
   */
  applySettings() {
    const cfg = this.cfg();
    const st = this.st;
    if (cfg.mode !== st.mode) {
      this._finishStep({ completed: false, reason: 'reset' });
      st.mode = cfg.mode;
      st.cycle = 0;
      st.road = buildRoad(cfg, 0);
      st.index = 0;
      this._resetStepFields();
      this._changed();
      return;
    }
    if (st.mode !== 'pomodoro') return;
    const road = buildRoad(cfg, st.cycle);
    if (!this.active && st.index === 0) {
      st.road = road;
      this._changed();
      return;
    }
    const cur = this.step;
    let best = -1;
    for (let k = 0; k < road.length; k++) {
      if (road[k].type !== cur.type) continue;
      if (best < 0 || Math.abs(k - st.index) < Math.abs(best - st.index)) best = k;
    }
    if (best < 0) {
      this._finishStep({ completed: false, reason: 'reset' });
      st.road = road;
      st.index = 0;
      this._resetStepFields();
    } else {
      st.road = road;
      st.index = best;
    }
    this._changed();
    this.tick();
  }

  // ── 内部処理 ──────────────────────────────────────────
  _closeSeg(now) {
    const st = this.st;
    if (st.status === 'running' && st.segStart != null) {
      const end = Math.max(st.segStart, now);
      st.elapsed += end - st.segStart;
      st.segs.push([st.segStart, end]);
      st.segStart = null;
    }
  }

  /** 今のステップを締めて記録を出す */
  _finishStep({ completed, end = this.now(), reason, noCount = false }) {
    const st = this.st;
    const step = this.step;
    if (st.status === 'running') {
      // 本来の終了時刻で区間を閉じる
      const e = Math.max(st.segStart ?? end, end);
      st.elapsed += e - st.segStart;
      st.segs.push([st.segStart, e]);
      st.segStart = null;
    }
    st.status = 'paused';
    const ms = st.elapsed;
    const cfg = this.cfg();
    const planned = step.countUp ? ms : (step.dur + st.extra) * 1000;
    const enough = ms >= (cfg.minRecordSec ?? 60) * 1000;
    if (ms > 0 && (enough || (completed && ms >= 5000))) {
      const counted =
        !noCount &&
        step.type === 'focus' &&
        (completed || (planned > 0 && ms >= planned * ((cfg.countThreshold ?? 80) / 100)));
      const rec = {
        id: uid(),
        type: step.type,
        label: step.label || '',
        start: st.stepStart ?? end - ms,
        end,
        ms,
        planned,
        completed: !!completed,
        counted: !!counted,
        reason,
        taskId: step.type === 'focus' ? this.getTaskId() : null,
        interruptions: st.interruptions,
        segs: st.segs.map((s) => s.slice()),
        mode: st.mode,
      };
      this.emit('record', rec);
    }
  }

  _resetStepFields() {
    const st = this.st;
    st.status = 'ready';
    st.elapsed = 0;
    st.segStart = null;
    st.segs = [];
    st.extra = 0;
    st.stepStart = null;
    st.interruptions = 0;
    st.overtime = false;
  }

  /** ステップを移動。ロードの最後を超えたら次の周回を作る。移動できたら true */
  _goto(index, { autoStart = false, now = this.now() } = {}) {
    const st = this.st;
    const cfg = this.cfg();
    if (index >= st.road.length) {
      if (st.mode !== 'pomodoro') {
        st.road = st.road.concat([{ type: 'focus', dur: 0, countUp: true }]);
      } else if (cfg.repeat) {
        st.cycle++;
        st.road = buildRoad(cfg, st.cycle);
        index = 0;
      } else {
        // 1 セット終了：最初に戻って待機
        st.cycle = 0;
        st.road = buildRoad(cfg, 0);
        st.index = 0;
        this._resetStepFields();
        this.emit('setdone', {});
        this._changed();
        return false;
      }
    }
    st.index = index;
    this._resetStepFields();
    if (autoStart) {
      st.status = 'running';
      st.segStart = now;
      st.stepStart = now;
      this.emit('stepstart', { step: this.step, index: st.index, auto: true });
    }
    this._changed();
    return true;
  }

  _changed() {
    this.emit('change', this.st);
  }

  // ── 保存と復元 ───────────────────────────────────────
  serialize() {
    const now = this.now();
    return { ...this.st, road: this.st.road, savedAt: now, savedElapsed: this.elapsed(now) };
  }

  /** 保存した状態を戻す。動いていたタイマーは「閉じた時点で一時停止」として戻す */
  restore(data) {
    try {
      if (!data || data.v !== STATE_VERSION || !Array.isArray(data.road) || !data.road.length) return false;
      const st = this._fresh();
      st.mode = data.mode ?? st.mode;
      st.road = data.road.filter((s) => s && typeof s.type === 'string' && Number.isFinite(s.dur));
      if (!st.road.length) return false;
      st.index = clamp(data.index | 0, 0, st.road.length - 1);
      st.cycle = data.cycle | 0;
      st.extra = Number(data.extra) || 0;
      st.stepStart = data.stepStart ?? null;
      st.interruptions = data.interruptions | 0;
      st.segs = Array.isArray(data.segs) ? data.segs.filter((s) => Array.isArray(s) && s.length === 2) : [];
      const el = Number(data.savedElapsed ?? data.elapsed) || 0;
      st.elapsed = el;
      if (data.status === 'running' && data.segStart != null && data.savedAt) {
        st.segs.push([data.segStart, data.savedAt]);
      }
      st.status = el > 0 ? 'paused' : 'ready';
      st.overtime = !!data.overtime;
      if (st.mode !== this.cfg().mode) return false;
      this.st = st;
      this._changed();
      return true;
    } catch (err) {
      console.warn('timer restore failed', err);
      return false;
    }
  }
}

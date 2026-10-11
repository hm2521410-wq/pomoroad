// ステップの並び（ロード）の組み立てとプリセット

export const STEP_TYPES = {
  focus: { label: '集中', short: '集中' },
  short: { label: '短い休憩', short: '休憩' },
  long: { label: '長い休憩', short: '長休憩' },
};

export const isBreak = (type) => type === 'short' || type === 'long';

/**
 * シンプル設定からステップ列を作る。
 * cfg: { focus, short, long (分), longEvery (0 = 長休憩なし), rounds,
 *        startWith: 'focus'|'short'|'long', warmup (分), lastBreak: 'auto'|'short'|'long'|'none' }
 * cycle: 何周目か（0 始まり）。warmupEveryCycle が false なら 2 周目以降は最初の休憩を省く
 */
export function buildSimple(cfg, cycle = 0) {
  const steps = [];
  const min = (v) => Math.max(1, Math.round(v * 60));
  if (cfg.startWith && cfg.startWith !== 'focus' && (cycle === 0 || cfg.warmupEveryCycle)) {
    steps.push({ type: cfg.startWith, dur: min(cfg.warmup || cfg[cfg.startWith]), label: 'ウォームアップ' });
  }
  const rounds = Math.max(1, Math.round(cfg.rounds));
  for (let i = 1; i <= rounds; i++) {
    steps.push({ type: 'focus', dur: min(cfg.focus) });
    const isLongSpot = cfg.longEvery > 0 && i % cfg.longEvery === 0;
    if (i < rounds) {
      steps.push(isLongSpot ? { type: 'long', dur: min(cfg.long) } : { type: 'short', dur: min(cfg.short) });
    } else {
      const last = cfg.lastBreak ?? 'auto';
      if (last === 'long' || (last === 'auto' && (cfg.longEvery > 0))) {
        steps.push({ type: 'long', dur: min(cfg.long) });
      } else if (last === 'short' || last === 'auto') {
        steps.push({ type: 'short', dur: min(cfg.short) });
      }
    }
  }
  return steps;
}

/** カスタム（自由編集）のステップ列。min は分（小数可） */
export function buildCustom(list) {
  const steps = (Array.isArray(list) ? list : [])
    .filter((s) => s && STEP_TYPES[s.type] && Number(s.min) > 0)
    .map((s) => ({ type: s.type, dur: Math.max(1, Math.round(Number(s.min) * 60)), label: s.label || '' }));
  return steps.length ? steps : [{ type: 'focus', dur: 25 * 60 }];
}

/** 設定のタイマー部分から 1 周分のロードを作る */
export function buildRoad(timer, cycle = 0) {
  if (timer.mode === 'flow' || timer.mode === 'stopwatch') {
    return [{ type: 'focus', dur: 0, countUp: true }];
  }
  return timer.planKind === 'custom' ? buildCustom(timer.custom.steps) : buildSimple(timer.simple, cycle);
}

/** ロードから「集中の何回目か」を数える */
export function focusOrdinal(road, index) {
  let n = 0;
  for (let i = 0; i <= index && i < road.length; i++) if (road[i].type === 'focus') n++;
  return n;
}

export function focusCount(road) {
  return road.filter((s) => s.type === 'focus').length;
}

export function roadMinutes(road) {
  return Math.round(road.reduce((a, s) => a + (s.dur || 0), 0) / 60);
}

// ── プリセット ──────────────────────────────────────────────
// timer 設定の一部を上書きする形で持つ
export const BUILTIN_PRESETS = [
  {
    id: 'classic',
    name: 'クラシック 25/5',
    desc: '25分集中＋5分休憩。4回ごとに15分の長い休憩',
    patch: { mode: 'pomodoro', planKind: 'simple', simple: { focus: 25, short: 5, long: 15, longEvery: 4, rounds: 4, startWith: 'focus', lastBreak: 'auto' } },
  },
  {
    id: 'warmup',
    name: '休憩から始める',
    desc: '最初に5分休憩（準備）してから 25/5 を4回',
    patch: { mode: 'pomodoro', planKind: 'simple', simple: { focus: 25, short: 5, long: 15, longEvery: 4, rounds: 4, startWith: 'short', warmup: 5, lastBreak: 'auto' } },
  },
  {
    id: 'deep50',
    name: 'ディープワーク 50/10',
    desc: '50分集中＋10分休憩。3回ごとに30分休憩',
    patch: { mode: 'pomodoro', planKind: 'simple', simple: { focus: 50, short: 10, long: 30, longEvery: 3, rounds: 3, startWith: 'focus', lastBreak: 'auto' } },
  },
  {
    id: 'desktime',
    name: '52/17 ルール',
    desc: 'DeskTime の調査で生産性が高い人に多かった配分',
    patch: { mode: 'pomodoro', planKind: 'simple', simple: { focus: 52, short: 17, long: 17, longEvery: 0, rounds: 4, startWith: 'focus', lastBreak: 'short' } },
  },
  {
    id: 'ultradian',
    name: '90/20 ウルトラディアン',
    desc: '約90分のリズムに合わせた長めの集中',
    patch: { mode: 'pomodoro', planKind: 'simple', simple: { focus: 90, short: 20, long: 30, longEvery: 0, rounds: 3, startWith: 'focus', lastBreak: 'short' } },
  },
  {
    id: 'exam',
    name: '試験演習 60/10',
    desc: '試験時間に慣れるための60分ブロック',
    patch: { mode: 'pomodoro', planKind: 'simple', simple: { focus: 60, short: 10, long: 20, longEvery: 3, rounds: 3, startWith: 'focus', lastBreak: 'auto' } },
  },
  {
    id: 'short15',
    name: 'ショート 15/3',
    desc: '集中が続かない日や、取りかかりのきっかけに',
    patch: { mode: 'pomodoro', planKind: 'simple', simple: { focus: 15, short: 3, long: 10, longEvery: 4, rounds: 4, startWith: 'focus', lastBreak: 'auto' } },
  },
  {
    id: 'flow',
    name: 'フロータイム',
    desc: '集中は時間を決めずに計測。休憩は集中時間の1/5',
    patch: { mode: 'flow' },
  },
  {
    id: 'stopwatch',
    name: 'ストップウォッチ',
    desc: '経過時間だけを測って記録する',
    patch: { mode: 'stopwatch' },
  },
];

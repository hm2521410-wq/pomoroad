// 設定・記録・タスクの保存（localStorage）と既定値

import { mergeDefaults } from './util.js';

const PREFIX = 'pomoroad.v1.';

export function load(name, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (err) {
    console.warn('load failed', name, err);
    return fallback;
  }
}

export function save(name, value) {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('save failed', name, err);
    return false;
  }
}

export function remove(name) {
  try {
    localStorage.removeItem(PREFIX + name);
  } catch {
    /* 保存領域が使えない環境では何もしない */
  }
}

export function keys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
  } catch {
    /* noop */
  }
  return out;
}

export const DEFAULTS = {
  timer: {
    mode: 'pomodoro', // pomodoro | flow | stopwatch
    planKind: 'simple', // simple | custom
    simple: {
      focus: 25,
      short: 5,
      long: 15,
      longEvery: 4,
      rounds: 4,
      startWith: 'focus', // focus | short | long
      warmup: 5,
      warmupEveryCycle: false,
      lastBreak: 'auto', // auto | short | long | none
    },
    custom: {
      steps: [
        { type: 'short', min: 5, label: 'ウォームアップ' },
        { type: 'focus', min: 25 },
        { type: 'short', min: 5 },
        { type: 'focus', min: 25 },
        { type: 'short', min: 5 },
        { type: 'focus', min: 25 },
        { type: 'long', min: 15 },
      ],
    },
    repeat: true,
    autoStartBreak: true,
    autoStartFocus: false,
    overtime: false,
    startAfterSkip: true,
    countThreshold: 80,
    minRecordSec: 60,
    flow: { ratio: 5, minBreak: 2, maxBreak: 30, autoStartFocus: false },
    strict: false,
    confirmSkip: false,
  },
  goal: { daily: 8, dayStartHour: 4 },
  alerts: {
    focusEndSound: 'chime',
    breakEndSound: 'marimba',
    volume: 70,
    repeat: 1,
    warnBefore: 0, // 分（0 = なし）
    warnSound: 'soft',
    tick: 'none', // none | clock | soft | wood | digital
    tickVolume: 30,
    tickWhen: 'focus', // focus | always | lastMinute
    voice: false,
    notify: true,
    bringToFront: false,
    flashTaskbar: true,
  },
  sound: {
    master: 60,
    link: 'focus', // manual | focus | separate
    fadeSec: 3,
    variation: 1, // 音の移り変わり：0 一定 / 0.5 ひかえめ / 1 ふつう / 1.6 大きめ
    pauseWithTimer: true,
    mixes: {
      focus: { 'rain-window': 0.55, cafe: 0.5 },
      break: { forest: 0.5, stream: 0.35 },
    },
    activeMix: 'focus',
  },
  view: {
    theme: 'dark', // dark | light
    background: 'forest', // forest | night | aurora | stars | sunset | ocean | mono | image
    bgDim: 35,
    bgBlur: 0,
    fx: 'none', // none | rain | snow | fireflies | auto
    colors: { focus: '#ff5a5f', short: '#33c48d', long: '#4ea1ff' },
    font: 'slim', // slim | bahnschrift | mono | round
    ring: 'ticks', // ticks | line | dots | none
    tickCount: 90,
    ringDirection: 'elapsed', // elapsed | remaining
    showSeconds: true,
    showEndTime: true,
    showRoad: true,
    sidePanel: true,
    cardOpacity: 82,
    titleTimer: true,
  },
  mini: {
    layout: 'bar', // bar | circle | text
    scale: 1,
    opacity: 100,
    glass: 70,
    showTask: true,
    controls: 'hover', // hover | always | never
    onTop: true,
    autoOnMinimize: true,
    hideWhenMainFocused: false,
  },
  keys: {
    toggle: 'Space',
    skip: 'KeyN',
    breakNow: 'KeyB',
    reset: 'KeyR',
    plus: 'Equal',
    minus: 'Minus',
    fullscreen: 'KeyF',
    mini: 'KeyM',
    sounds: 'KeyW',
    stats: 'KeyS',
    distract: 'KeyD',
  },
  globalKeys: {
    toggle: 'Ctrl+Alt+Space',
    skip: 'Ctrl+Alt+Right',
    mini: 'Ctrl+Alt+M',
    show: 'Ctrl+Alt+P',
  },
  system: {
    openAtLogin: false,
    closeToTray: true,
    pauseOnLock: true,
    pauseOnSleep: true,
    idlePauseMin: 0, // 0 = 無効
    mainOnTop: false,
  },
  // 見守り：集中中に気が散る画面を開いていたら声をかける（Windows アプリ）
  guard: {
    enabled: true,
    tone: 'coach', // gentle | coach | strict
    graceSec: 20, // この秒数までは見逃す
    speakSec: 60, // 2 回目の声かけ（読み上げ・前に出す）。0 = しない
    askMin: 3, // 一時停止をたずねる。0 = しない
    notify: true,
    mini: true,
    voice: true,
    front: true,
    praise: true,
    sortPrompt: true, // 集中のあと、使った画面の仕分けをすすめる
    groups: { video: true, sns: true, game: true, shop: true, chat: true, news: false },
    rules: [], // { id, kind: 'title' | 'app', text, as: 'study' | 'distract' | 'neutral', task: タスクの id | null }
  },
  // スマホ連携（ntfy で知らせ合う）
  phone: {
    enabled: false,
    server: 'https://ntfy.sh',
    topic: '',
    sendFocus: true, // 集中の始まりと終わりをスマホに知らせる
    nudge: true, // スマホで気が散るアプリを開いたら、パソコンでも声をかける
  },
  ui: { panelOpen: true, lastTab: 'timer', onboarded: false },
};

export function loadSettings() {
  return mergeDefaults(DEFAULTS, load('settings', {}));
}

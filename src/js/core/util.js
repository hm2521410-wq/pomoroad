// 汎用ユーティリティ（DOM 非依存。Node のテストからも読み込む）

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);

export function pad2(n) {
  return String(Math.floor(n)).padStart(2, '0');
}

/** ミリ秒を「mm:ss」または「h:mm:ss」にする。負の値は超過時間として扱う */
export function fmtClock(ms, { seconds = true } = {}) {
  const neg = ms < 0;
  let s = Math.abs(ms) / 1000;
  // カウントダウン中は切り上げ（残り 0.3 秒なら 00:01 と表示）
  s = neg ? Math.floor(s) : Math.ceil(s - 1e-6);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  let out;
  if (!seconds) {
    const mins = Math.ceil(s / 60);
    out = h > 0 ? `${Math.floor(mins / 60)}:${pad2(mins % 60)}` : `${mins}`;
  } else {
    out = h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
  }
  return (neg ? '+' : '') + out;
}

/** 「1時間23分」「45分」のような表記 */
export function fmtDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

export function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 1日の区切り（startHour 時）を考慮した日付キー YYYY-MM-DD */
export function dayKey(ts, startHour = 0) {
  const d = new Date(ts - startHour * 3600000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** dayKey の日の開始時刻（ローカル） */
export function dayStart(key, startHour = 0) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, startHour, 0, 0, 0).getTime();
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 既定値 base に保存値 over を重ねる。型が既定値と違う値は捨てる
 * （古い版や壊れた保存データでアプリが落ちないようにするため）。
 * 配列は丸ごと置き換え。base に無いキーは over の値をそのまま残す。
 */
export function mergeDefaults(base, over) {
  if (!isPlainObject(over)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    const b = base[k];
    if (b === undefined) {
      out[k] = v;
    } else if (isPlainObject(b)) {
      out[k] = mergeDefaults(b, v);
    } else if (Array.isArray(b)) {
      if (Array.isArray(v)) out[k] = v;
    } else if (typeof b === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    } else if (b === null || typeof v === typeof b) {
      out[k] = v;
    }
  }
  return out;
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isPlainObject(o[keys[i]])) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

export class Emitter {
  constructor() {
    this._handlers = new Map();
  }
  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this._handlers.get(type)?.delete(fn);
  }
  emit(type, data) {
    for (const fn of this._handlers.get(type) ?? []) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[emit ${type}]`, err);
      }
    }
  }
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}

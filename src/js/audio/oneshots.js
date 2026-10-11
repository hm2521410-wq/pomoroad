// 単発の音（鳥・雷・風鈴・ページをめくる音など）と、通知音・秒針の音。
// どれも数秒以内の短いバッファなので、メインスレッドでその場で作る。

import {
  TAU,
  Biquad,
  Brown,
  OnePole,
  rand,
  logRand,
  pick,
  midiHz,
  panGains,
  addAt,
  normPeak,
  noiseGrain,
  modal,
  bubble,
  mulberry32,
} from './dsp-core.js';
import { writeStrokes, writeTyping, clink } from './beds.js';

// ── 部品 ──────────────────────────────────────────────
/** 周波数が時間で変わる音符を書き込む。freq(x) の x は 0〜1 */
function note(out, sr, t0, dur, freq, amp, { attack = 0.006, release = 0.02, harm = 0.08, am = null } = {}) {
  const s0 = Math.round(t0 * sr);
  const n = Math.round(dur * sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const idx = s0 + i;
    if (idx < 0) continue;
    if (idx >= out.length) break;
    const t = i / sr;
    const x = i / n;
    ph += (TAU * freq(x)) / sr;
    let env = Math.min(1, t / attack) * Math.min(1, (dur - t) / release);
    if (am) env *= am(t);
    out[idx] += (Math.sin(ph) + harm * Math.sin(2 * ph)) * env * amp;
  }
}

function lowpassInPlace(buf, sr, fc) {
  const op = new OnePole(fc, sr);
  const op2 = new OnePole(fc, sr);
  for (let i = 0; i < buf.length; i++) buf[i] = op2.lp(op.lp(buf[i]));
  return buf;
}

// ── 鳥 ────────────────────────────────────────────────
const BIRD_SONGS = {
  chirps(out, sr, r) {
    const n = 3 + ((r() * 5) | 0);
    const hi = rand(r, 4200, 7000);
    const lo = hi * rand(r, 0.55, 0.75);
    const d = rand(r, 0.04, 0.09);
    const gap = rand(r, 0.05, 0.14);
    for (let k = 0; k < n; k++) note(out, sr, 0.02 + k * (d + gap), d, (x) => lo + (hi - lo) * (1 - x) * (1 - x), rand(r, 0.6, 1));
  },
  trill(out, sr, r) {
    const dur = rand(r, 0.5, 1.3);
    const f = rand(r, 3500, 5500);
    const am = rand(r, 18, 32);
    note(out, sr, 0.02, dur, (x) => f * (1 - 0.08 * x), 0.9, { am: (t) => Math.pow(0.5 + 0.5 * Math.sin(TAU * am * t), 2), attack: 0.05, release: 0.1 });
  },
  tsutsupi(out, sr, r) {
    // シジュウカラ「ツツピー」
    const reps = 2 + ((r() * 3) | 0);
    const hi = rand(r, 6000, 7000);
    const lo = rand(r, 3700, 4200);
    let t = 0.02;
    for (let k = 0; k < reps; k++) {
      note(out, sr, t, 0.045, (x) => hi * (1 - 0.15 * x), 0.7);
      note(out, sr, t + 0.09, 0.045, (x) => hi * (1 - 0.15 * x), 0.7);
      note(out, sr, t + 0.18, 0.17, (x) => lo * (1 - 0.04 * x), 1, { attack: 0.01, release: 0.04 });
      t += 0.48;
    }
  },
  warble(out, sr, r) {
    const dur = rand(r, 0.8, 1.8);
    const fc = rand(r, 2500, 4000);
    const p1 = r() * TAU;
    const gate = Array.from({ length: 40 }, () => r() < 0.75);
    note(out, sr, 0.02, dur, (x) => fc + 600 * Math.sin(TAU * 7 * x * dur + p1) + 400 * Math.sin(TAU * 13.3 * x * dur), 0.8, {
      am: (t) => (gate[Math.floor(t * 11) % 40] ? 1 : 0.15),
      attack: 0.02,
      release: 0.05,
    });
  },
  hiyodori(out, sr, r) {
    // ヒヨドリ「ピーヨ」
    const reps = 1 + ((r() * 2) | 0);
    for (let k = 0; k < reps; k++) {
      const t = 0.02 + k * 0.7;
      note(out, sr, t, 0.17, (x) => 2600 + 1000 * x, 0.9, { attack: 0.02 });
      note(out, sr, t + 0.17, 0.32, (x) => 3600 - 1400 * x, 1, { attack: 0.005, release: 0.06, harm: 0.15 });
    }
  },
};

export const EVENTS = {};

export const BIRD_KINDS = ['chirps', 'trill', 'tsutsupi', 'warble', 'hiyodori'];

/** o.seed を渡すと同じ鳥（同じ節回し）になる。o.pan・o.far で場所も固定できる */
EVENTS.bird = (sr, r, o = {}) => {
  const rs = o.seed != null ? mulberry32(o.seed) : r;
  const kind = o.kind ?? pick(rs, ['chirps', 'chirps', 'trill', 'tsutsupi', 'warble', 'hiyodori']);
  const out = new Float32Array(Math.round(sr * 2.4));
  BIRD_SONGS[kind](out, sr, rs);
  const far = o.far ?? r() < 0.5;
  if (far) lowpassInPlace(out, sr, 3000);
  return { data: normPeak(out, (far ? rand(r, 0.25, 0.5) : rand(r, 0.5, 0.9)) * (o.level ?? 1)), pan: o.pan ?? rand(r, -0.9, 0.9) };
};

EVENTS.uguisu = (sr, r, o = {}) => {
  // ウグイス「ホーーホケキョ」。同じ鳥は同じ高さで鳴く
  const out = new Float32Array(Math.round(sr * 2.6));
  const rs = o.seed != null ? mulberry32(o.seed) : r;
  const base = rand(rs, 1050, 1250);
  const hoo = rand(r, 1.1, 1.6);
  note(out, sr, 0.02, hoo, (x) => base * (1 + 0.08 * x) * (1 + 0.004 * Math.sin(TAU * 6 * x * hoo)), 0.75, { attack: 0.25, release: 0.08, harm: 0.12 });
  const t = 0.02 + hoo + 0.1;
  note(out, sr, t, 0.07, () => base * 2.0, 0.7, { attack: 0.005 });
  note(out, sr, t + 0.1, 0.07, (x) => base * (3.0 - 0.6 * x), 0.8, { attack: 0.003 });
  note(out, sr, t + 0.21, 0.26, (x) => base * (x < 0.4 ? 1.9 + 3.6 * x : 3.35 - 1.0 * (x - 0.4)), 1, { attack: 0.004, release: 0.06, harm: 0.1 });
  if (o.far) lowpassInPlace(out, sr, 2600);
  return { data: normPeak(out, rand(r, 0.5, 0.85) * (o.far ? 0.55 : 1)), pan: o.pan ?? rand(r, -0.7, 0.7) };
};

EVENTS.cuckoo = (sr, r, o = {}) => {
  // カッコウ「カッコー」を数回
  const reps = 3 + ((r() * 6) | 0);
  const out = new Float32Array(Math.round(sr * (reps * 0.95 + 0.6)));
  const rs = o.seed != null ? mulberry32(o.seed) : r;
  const f1 = rand(rs, 640, 700);
  const f2 = f1 * 0.8;
  for (let k = 0; k < reps; k++) {
    const t = 0.02 + k * rand(r, 0.85, 1.0);
    note(out, sr, t, 0.17, (x) => f1 * (1 - 0.03 * x), 0.8, { attack: 0.02, release: 0.05, harm: 0.2 });
    note(out, sr, t + 0.27, 0.32, (x) => f2 * (1 - 0.04 * x), 0.9, { attack: 0.03, release: 0.12, harm: 0.2 });
  }
  lowpassInPlace(out, sr, 2500);
  return { data: normPeak(out, rand(r, 0.3, 0.55)), pan: o.pan ?? rand(r, -0.8, 0.8) };
};

EVENTS.higurashi = (sr, r) => {
  // ヒグラシ「カナカナカナ…」
  const dur = rand(r, 4, 7);
  const out = new Float32Array(Math.round(sr * (dur + 0.5)));
  const fc = rand(r, 4000, 4800);
  const rate0 = rand(r, 8, 10);
  let t = 0.05;
  while (t < dur) {
    const k = t / dur;
    const rate = rate0 * (1 - 0.35 * k);
    const len = 0.75 / rate;
    const phraseEnv = Math.min(1, t / 0.6) * Math.pow(1 - k, 1.3);
    const f = fc * (1 - 0.06 * k);
    note(out, sr, t, len, (x) => f * (1.04 - 0.08 * x), phraseEnv, {
      attack: 0.004,
      release: len * 0.6,
      harm: 0.25,
      am: (tt) => 0.35 + 0.65 * Math.abs(Math.sin(TAU * 90 * tt)),
    });
    t += 1 / rate;
  }
  return { data: normPeak(out, rand(r, 0.35, 0.6)), pan: rand(r, -0.8, 0.8) };
};

// ── 雷 ────────────────────────────────────────────────
EVENTS.thunder = (sr, r) => {
  const dur = rand(r, 7, 13);
  const out = new Float32Array(Math.round(sr * dur));
  const br = new Brown(r);
  const fc = rand(r, 250, 600);
  const lp = new Biquad(sr).set('lp', fc, 0.7);
  const lp2 = new Biquad(sr).set('lp', fc * 1.3, 0.7);
  const bumps = [];
  let t = rand(r, 0.05, 0.4);
  const cnt = 3 + ((r() * 5) | 0);
  for (let k = 0; k < cnt; k++) {
    bumps.push({ t, a: k === 0 ? 1 : rand(r, 0.3, 1), tau: rand(r, 0.6, 2.5) });
    t += rand(r, 0.2, 1.5);
  }
  for (let i = 0; i < out.length; i++) {
    const tt = i / sr;
    let env = 0;
    for (const b of bumps) {
      const x = tt - b.t;
      if (x > 0) env += b.a * Math.min(1, x / 0.15) * Math.exp(-x / b.tau);
    }
    out[i] = lp2.run(lp.run(br.next())) * env;
  }
  if (r() < 0.25) {
    // 近い雷のバリッという音
    const hp = new Biquad(sr).set('hp', 800, 0.7);
    const s0 = Math.round(Math.max(0, bumps[0].t - 0.05) * sr);
    const n = Math.round(0.4 * sr);
    let pk = 0;
    for (let i = 0; i < out.length; i++) pk = Math.max(pk, Math.abs(out[i]));
    for (let i = 0; i < n && s0 + i < out.length; i++) out[s0 + i] += hp.run(r() * 2 - 1) * Math.exp(-i / (0.08 * sr)) * pk * 0.5;
  }
  return { data: normPeak(out, rand(r, 0.6, 0.95)), pan: rand(r, -0.5, 0.5) };
};

// ── 和の音 ────────────────────────────────────────────
EVENTS.furin = (sr, r) => {
  const out = new Float32Array(Math.round(sr * 3.2));
  const base = pick(r, [2093, 2349, 2637, 2794, 3136]) * rand(r, 0.98, 1.02);
  const strikes = 1 + (r() < 0.6 ? 1 : 0) + (r() < 0.3 ? 1 : 0);
  let t = 0;
  for (let k = 0; k < strikes; k++) {
    const g = modal(sr, base, [[1, 1, 1.6], [1.0065, 0.6, 1.6], [2.71, 0.35, 0.6], [5.15, 0.15, 0.25], [8.2, 0.07, 0.12]], 3.2 - t, { r, click: 0.25 });
    addAt(out, g, Math.round(t * sr), rand(r, 0.4, 1));
    t += rand(r, 0.09, 0.25);
  }
  return { data: normPeak(out, rand(r, 0.35, 0.7)), pan: rand(r, -0.3, 0.3) };
};

function bambooKnock(sr, r, f0, dur = 0.6) {
  return modal(sr, f0, [[1, 1, 0.22], [2.05, 0.5, 0.12], [3.3, 0.3, 0.06], [4.9, 0.15, 0.03]], dur, { r, click: 0.5 });
}

EVENTS.shishi = (sr, r) => {
  // ししおどし「カ・コーン」
  const out = new Float32Array(Math.round(sr * 1.5));
  const f0 = rand(r, 520, 680);
  addAt(out, bambooKnock(sr, r, f0 * 1.3, 0.3), 0, 0.25);
  addAt(out, bambooKnock(sr, r, f0, 1.2), Math.round(rand(r, 0.08, 0.12) * sr), 1);
  return { data: normPeak(out, 0.8), pan: rand(r, -0.2, 0.2) };
};

// ── 喫茶店 ────────────────────────────────────────────
EVENTS.steam = (sr, r) => {
  const dur = rand(r, 3, 5);
  const out = new Float32Array(Math.round(sr * dur));
  const bp = new Biquad(sr).set('bp', rand(r, 3000, 4500), 0.8);
  const hp = new Biquad(sr).set('hp', 1500, 0.7);
  const fl = new OnePole(8, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.3) * Math.min(1, (dur - t) / 0.6);
    out[i] = bp.run(hp.run(r() * 2 - 1)) * env * (0.7 + 3 * Math.abs(fl.lp(r() * 2 - 1)));
  }
  for (let k = 0; k < 25; k++) addAt(out, bubble(sr, logRand(r, 200, 600), 0.03, 1), Math.round(rand(r, 0, 0.8) * sr), 0.3);
  return { data: normPeak(out, 0.35), pan: rand(r, -0.6, 0.6) };
};

EVENTS.doorbell = (sr, r) => {
  // ドアベル「カランコロン」
  const out = new Float32Array(Math.round(sr * 2.5));
  const notes = [1318, 1568, 1760, 2093];
  let t = 0;
  const n = 3 + ((r() * 3) | 0);
  for (let k = 0; k < n; k++) {
    const f = pick(r, notes) * rand(r, 0.99, 1.01);
    addAt(out, modal(sr, f, [[1, 1, 0.9], [2.76, 0.4, 0.35], [5.4, 0.2, 0.15]], 2.4 - t, { r, click: 0.2 }), Math.round(t * sr), rand(r, 0.5, 1));
    t += rand(r, 0.1, 0.2);
  }
  return { data: normPeak(out, 0.45), pan: rand(r, -0.7, 0.7) };
};

// ── 図書館 ────────────────────────────────────────────
EVENTS.page = (sr, r) => {
  const dur = rand(r, 0.45, 0.9);
  const out = new Float32Array(Math.round(sr * (dur + 0.15)));
  const bp = new Biquad(sr).set('bp', rand(r, 1500, 3500), 0.9);
  const sw = (x) => (x < 1 ? Math.pow(Math.sin(Math.PI * x), 2) : 0);
  for (let i = 0; i < out.length; i++) out[i] = bp.run(r() * 2 - 1) * sw(i / sr / dur) * 0.35;
  const grains = Math.round(140 * dur);
  for (let k = 0; k < grains; k++) {
    const x = r();
    addAt(out, noiseGrain(sr, r, rand(r, 0.5, 2), rand(r, 2500, 7000), rand(r, 1, 2), 1), Math.round(x * dur * sr), (0.15 + r() * r()) * sw(x));
  }
  const flap = new Float32Array(Math.round(sr * 0.06));
  const lp = new Biquad(sr).set('lp', 2500, 0.7);
  for (let i = 0; i < flap.length; i++) flap[i] = lp.run(r() * 2 - 1) * Math.exp(-i / (0.012 * sr));
  addAt(out, flap, Math.round(dur * rand(r, 0.85, 1) * sr), 1.2);
  return { data: normPeak(out, rand(r, 0.35, 0.7)), pan: rand(r, -0.7, 0.7) };
};

EVENTS.pencil = (sr, r) => {
  const len = rand(r, 1.5, 5);
  const c = { sr, total: Math.round(sr * (len + 0.3)), L: null, R: null };
  c.L = new Float32Array(c.total);
  c.R = new Float32Array(c.total);
  writeStrokes(c, 0.02, len, r, 1, rand(r, -0.6, 0.6));
  normPeak(c.L, 0.4);
  normPeak(c.R, 0.4);
  return { L: c.L, R: c.R };
};

EVENTS.typing = (sr, r) => {
  const len = rand(r, 2, 6);
  const c = { sr, total: Math.round(sr * (len + 0.3)) };
  c.L = new Float32Array(c.total);
  c.R = new Float32Array(c.total);
  writeTyping(c, 0.02, len, r, 1, rand(r, -0.7, 0.7));
  lowpassInPlace(c.L, sr, 3500);
  lowpassInPlace(c.R, sr, 3500);
  const p = Math.max(...[c.L, c.R].map((b) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  for (const b of [c.L, c.R]) for (let i = 0; i < b.length; i++) b[i] *= 0.25 / (p || 1);
  return { L: c.L, R: c.R };
};

EVENTS.footsteps = (sr, r) => {
  const steps = 5 + ((r() * 8) | 0);
  const iv = rand(r, 0.48, 0.62);
  const out = { L: new Float32Array(Math.round(sr * (steps * iv + 0.6))), R: null };
  out.R = new Float32Array(out.L.length);
  const p0 = rand(r, -0.8, 0.8);
  const p1 = -p0 * rand(r, 0.5, 1);
  for (let k = 0; k < steps; k++) {
    const len = Math.round(sr * 0.12);
    const g = new Float32Array(len);
    const lp = new Biquad(sr).set('lp', rand(r, 300, 600), 0.7);
    for (let i = 0; i < len; i++) g[i] = lp.run(r() * 2 - 1) * Math.exp(-i / (0.025 * sr));
    addAt(g, noiseGrain(sr, r, 1, rand(r, 1400, 2200), 2, 6), 0, 0.3);
    normPeak(g, Math.sin((Math.PI * (k + 0.5)) / steps) * rand(r, 0.8, 1));
    const [gl, gr] = panGains(p0 + ((p1 - p0) * k) / steps);
    const pos = Math.round((k * iv + rand(r, -0.02, 0.02) + 0.05) * sr);
    addAt(out.L, g, pos, gl * 0.5);
    addAt(out.R, g, pos, gr * 0.5);
  }
  return out;
};

EVENTS.book = (sr, r) => {
  const out = new Float32Array(Math.round(sr * 0.4));
  const lp = new Biquad(sr).set('lp', rand(r, 200, 400), 0.7);
  for (let i = 0; i < out.length; i++) out[i] = lp.run(r() * 2 - 1) * Math.exp(-i / (0.03 * sr)) * 2;
  addAt(out, modal(sr, rand(r, 130, 170), [[1, 1, 0.08], [2.4, 0.6, 0.05], [4.4, 0.3, 0.03]], 0.4, { r, click: 0.2 }), 0, 0.7);
  return { data: normPeak(out, rand(r, 0.3, 0.55)), pan: rand(r, -0.7, 0.7) };
};

EVENTS.clinkSoft = (sr, r) => {
  const out = clink(sr, r, r() < 0.5 ? 'spoon' : 'cup');
  return { data: normPeak(out, 0.2), pan: rand(r, -0.7, 0.7) };
};

// ── 通知音（アラーム） ─────────────────────────────────
function bellTone(sr, f, dur, r, { decay = 2.5, hum = true } = {}) {
  const modes = [
    [1, 1, decay],
    [2, 0.45, decay * 0.5],
    [3, 0.25, decay * 0.3],
    [4.2, 0.18, decay * 0.2],
    [5.4, 0.1, decay * 0.12],
  ];
  if (hum) modes.push([0.5, 0.3, decay * 1.2]);
  return modal(sr, f, modes, dur, { r, click: 0.05 });
}

function seq(sr, notes, total, make) {
  const out = new Float32Array(Math.round(sr * total));
  for (const [t, f, a] of notes) addAt(out, make(f), Math.round(t * sr), a ?? 1);
  return out;
}

const NOTE = (name) => {
  const m = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[name[0]];
  const sharp = name.includes('#') ? 1 : 0;
  const oct = Number(name.slice(-1));
  return midiHz(12 * (oct + 1) + m + sharp);
};

export const ALARMS = {
  chime: { label: '学校のチャイム', make(sr, r) {
    const mel = ['E5', 'C5', 'D5', 'G4', 'G4', 'D5', 'E5', 'C5'];
    const notes = mel.map((n, i) => [i * 0.62 + (i >= 4 ? 0.45 : 0), NOTE(n), 0.8]);
    return seq(sr, notes, 7.5, (f) => bellTone(sr, f, 3, r, { decay: 1.8 }));
  } },
  bell: { label: 'ベル', make(sr, r) {
    return seq(sr, [[0, NOTE('C6'), 1], [0.9, NOTE('C6'), 0.7]], 4, (f) => bellTone(sr, f, 3.2, r, { decay: 1.4 }));
  } },
  marimba: { label: 'マリンバ', make(sr, r) {
    const notes = ['C5', 'E5', 'G5', 'C6', 'G5', 'C6'].map((n, i) => [i * 0.13 + (i >= 4 ? 0.2 : 0), NOTE(n), 0.8]);
    return seq(sr, notes, 2.2, (f) => modal(sr, f, [[1, 1, 0.45], [3.93, 0.25, 0.08], [9.9, 0.08, 0.03]], 1.2, { r, click: 0.05 }));
  } },
  musicbox: { label: 'オルゴール', make(sr, r) {
    const mel = ['G5', 'C6', 'E6', 'D6', 'C6', 'E6', 'G6', 'C7'];
    const notes = mel.map((n, i) => [i * 0.22, NOTE(n), 0.7]);
    return seq(sr, notes, 3.2, (f) => modal(sr, f, [[1, 1, 0.9], [3.9, 0.3, 0.2], [8.1, 0.1, 0.06]], 1.5, { r, click: 0.1 }));
  } },
  kalimba: { label: 'カリンバ', make(sr, r) {
    const notes = ['D5', 'F#5', 'A5', 'D6'].map((n, i) => [i * 0.18, NOTE(n), 0.8]);
    return seq(sr, notes, 2.4, (f) => modal(sr, f, [[1, 1, 0.8], [5.4, 0.25, 0.08], [2.01, 0.1, 0.3]], 1.6, { r, click: 0.08 }));
  } },
  bowl: { label: 'シンギングボウル', make(sr, r) {
    return modal(sr, 220, [[1, 1, 6], [1.006, 0.8, 6], [2.76, 0.5, 4], [2.772, 0.4, 4], [5.4, 0.25, 2], [8.9, 0.1, 1]], 6, { r, click: 0.05 });
  } },
  digital: { label: 'デジタル', make(sr) {
    const out = new Float32Array(Math.round(sr * 1.4));
    for (const g of [0, 0.7]) {
      for (let k = 0; k < 3; k++) {
        const s0 = Math.round((g + k * 0.16) * sr);
        const n = Math.round(0.08 * sr);
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          const env = Math.min(1, i / 60) * Math.min(1, (n - i) / 60);
          out[s0 + i] += (Math.sin(TAU * 2000 * t) + 0.3 * Math.sin(TAU * 6000 * t)) * env * 0.6;
        }
      }
    }
    return out;
  } },
  furin: { label: '風鈴', make(sr, r) {
    const out = new Float32Array(Math.round(sr * 4));
    addAt(out, EVENTS.furin(sr, r).data, 0, 1);
    addAt(out, EVENTS.furin(sr, r).data, Math.round(0.9 * sr), 0.8);
    return out;
  } },
  birds: { label: '小鳥', make(sr, r) {
    const out = new Float32Array(Math.round(sr * 3));
    const a = EVENTS.bird(sr, r).data;
    const b = EVENTS.bird(sr, r).data;
    addAt(out, a, 0, 1);
    addAt(out, b, Math.round(0.9 * sr), 0.8);
    return out;
  } },
  soft: { label: 'やわらかい音', make(sr, r) {
    const notes = [[0, NOTE('A5'), 0.6], [0.18, NOTE('E6'), 0.5]];
    return seq(sr, notes, 1.8, (f) => modal(sr, f, [[1, 1, 0.6], [2, 0.15, 0.3]], 1.4, { r, click: 0 }));
  } },
  none: { label: 'なし', make: (sr) => new Float32Array(Math.round(sr * 0.05)) },
};

export const TICKS = {
  clock: { label: '時計（チクタク）', make(sr, r, alt) {
    return modal(sr, alt ? 2500 : 3200, [[1, 0.6, 0.012], [1.7, 0.3, 0.006], [0.26, 0.5, 0.03]], 0.15, { r, click: 0.4 });
  } },
  soft: { label: 'やわらかい', make(sr, r) {
    const g = noiseGrain(sr, r, 0.8, 1200, 1.5, 4);
    return lowpassInPlace(g, sr, 1500);
  } },
  wood: { label: 'ウッドブロック', make(sr, r, alt) {
    return modal(sr, alt ? 880 : 1000, [[1, 1, 0.03], [2.65, 0.5, 0.012]], 0.12, { r, click: 0.2 });
  } },
  digital: { label: 'デジタル', make(sr) {
    const out = new Float32Array(Math.round(sr * 0.03));
    for (let i = 0; i < out.length; i++) out[i] = Math.sin((TAU * 2000 * i) / sr) * Math.min(1, (out.length - i) / 200);
    return out;
  } },
};

/** 通知音を作る（ピークをそろえる） */
export function renderAlarm(name, sr, r) {
  const a = ALARMS[name] ?? ALARMS.chime;
  const out = a.make(sr, r);
  return name === 'none' ? out : normPeak(out, 0.9);
}

export function renderTick(name, sr, r, alt = false) {
  const t = TICKS[name] ?? TICKS.soft;
  return normPeak(t.make(sr, r, alt), 0.8);
}

/** 単発イベントを作る。戻り値は {L, R}（ステレオ） */
export function renderEvent(name, sr, r, opts = {}) {
  const ev = EVENTS[name](sr, r, opts);
  if (ev.L) return ev;
  const [gl, gr] = panGains(ev.pan ?? 0);
  const L = new Float32Array(ev.data.length);
  const R = new Float32Array(ev.data.length);
  for (let i = 0; i < L.length; i++) {
    L[i] = ev.data[i] * gl;
    R[i] = ev.data[i] * gr;
  }
  return { L, R };
}


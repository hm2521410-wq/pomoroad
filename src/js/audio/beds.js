// ループ再生する環境音（ベッド）の生成：ノイズ・扇風機・機内・時計・電車・レコード・アンビエントなど、
// 一定であってほしい音だけ。雨や自然の音は streams.js（ゆっくり移り変わる流れ）で作る。
// Worker の中で動かす。

import {
  TAU,
  Biquad,
  Pink,
  Brown,
  Smooth,
  OnePole,
  rand,
  pick,
  midiHz,
  panGains,
  addAt,
  addPan,
  normPeak,
  noiseGrain,
  modal,
  workbench,
  finish,
  fitHz,
} from './dsp-core.js';

export const BEDS = {};

// ── ノイズ系 ───────────────────────────────────────────
function noiseBed(sr, seed, sec, make, filters, rms) {
  const c = workbench(sr, sec, seed, 0.5);
  for (const ch of [c.L, c.R]) {
    const src = make(c.r);
    const fs = filters.map(([t, f, q]) => new Biquad(sr).set(t, f, q ?? 0.707));
    for (let i = 0; i < c.total; i++) {
      let v = src();
      for (const b of fs) v = b.run(v);
      ch[i] = v;
    }
  }
  return finish(c, rms);
}

BEDS.white = (sr, seed) => noiseBed(sr, seed, 10, (r) => () => r() * 2 - 1, [['lp', 15000]], 0.1);
BEDS.pink = (sr, seed) =>
  noiseBed(sr, seed, 10, (r) => { const p = new Pink(r); return () => p.next(); }, [['hp', 20]], 0.1);
BEDS.brown = (sr, seed) =>
  noiseBed(sr, seed, 12, (r) => { const p = new Brown(r); return () => p.next(); }, [['hp', 22]], 0.12);
BEDS.deepbrown = (sr, seed) =>
  noiseBed(sr, seed, 12, (r) => { const p = new Brown(r); return () => p.next(); }, [['hp', 20], ['lp', 160], ['lp', 220]], 0.12);
BEDS.green = (sr, seed) =>
  noiseBed(sr, seed, 10, (r) => { const p = new Pink(r); return () => p.next(); }, [['hp', 180], ['lp', 1200], ['peak', 500, 0.8]], 0.1);

BEDS.fan = (sr, seed) => {
  const c = workbench(sr, 10, seed, 0.5);
  const fBlade = fitHz(54, c.n, sr);
  const fHum = fitHz(100, c.n, sr);
  for (const [ch, ph0] of [[c.L, 0], [c.R, 0.6]]) {
    const p = new Pink(c.r);
    const lp = new Biquad(sr).set('lp', 1500, 0.6);
    const hp = new Biquad(sr).set('hp', 70, 0.7);
    for (let i = 0; i < c.total; i++) {
      const t = i / sr;
      const am = 1 + 0.07 * Math.sin(TAU * fBlade * t + ph0);
      ch[i] = hp.run(lp.run(p.next())) * am + 0.012 * Math.sin(TAU * fHum * t) + 0.005 * Math.sin(TAU * 2 * fHum * t);
    }
  }
  return finish(c, 0.1);
};

BEDS.airplane = (sr, seed) => {
  const c = workbench(sr, 30, seed, 2);
  const e1 = fitHz(92, c.n, sr);
  const e2 = fitHz(92.6, c.n, sr);
  const mod = new Smooth(sr, 0.15, c.r);
  for (const [ch, side] of [[c.L, 0], [c.R, 1]]) {
    const b = new Brown(c.r);
    const p = new Pink(c.r);
    const lpB = new Biquad(sr).set('lp', 420, 0.6);
    const lpB2 = new Biquad(sr).set('lp', 900, 0.7);
    const hpP = new Biquad(sr).set('hp', 300, 0.7);
    const lpP = new Biquad(sr).set('lp', 1500, 0.7);
    const hissH = new Biquad(sr).set('hp', 4000, 0.7);
    for (let i = 0; i < c.total; i++) {
      const t = i / sr;
      const m = 0.95 + 0.1 * mod.at(i);
      ch[i] =
        lpB2.run(lpB.run(b.next())) * 1.0 * m +
        lpP.run(hpP.run(p.next())) * 0.22 +
        hissH.run(c.r() * 2 - 1) * 0.012 +
        0.025 * Math.sin(TAU * (side ? e2 : e1) * t) +
        0.008 * Math.sin(TAU * 2 * e1 * t);
    }
  }
  return finish(c, 0.11);
};

// ── 喫茶店・作業音の部品（単発音とストリームから使う） ──
export function clink(sr, r, kind) {
  if (kind === 'spoon') {
    return modal(sr, rand(r, 2800, 4200), [[1, 1, 0.08], [2.6, 0.5, 0.04], [5.2, 0.25, 0.02]], 0.25, { r, click: 0.3 });
  }
  return modal(sr, rand(r, 1600, 3000), [[1, 1, 0.18], [2.32, 0.6, 0.09], [3.86, 0.35, 0.05], [5.1, 0.2, 0.03]], 0.45, { r, click: 0.3 });
}

// ── 図書館・作業音 ─────────────────────────────────────
BEDS.libraryBed = (sr, seed) => {
  const c = workbench(sr, 30, seed);
  for (const ch of [c.L, c.R]) {
    const b = new Brown(c.r);
    const p = new Pink(c.r);
    const lp = new Biquad(sr).set('lp', 180, 0.7);
    const hp2 = new Biquad(sr).set('hp', 150, 0.7);
    const lp2 = new Biquad(sr).set('lp', 700, 0.7);
    for (let i = 0; i < c.total; i++) ch[i] = lp.run(b.next()) * 0.4 + lp2.run(hp2.run(p.next())) * 0.08;
  }
  return finish(c, 0.03);
};

/** 鉛筆で書く音を buffer（{L,R}）の [t0, t1) 秒に書き込む */
export function writeStrokes(c, t0, t1, r, gain, pan = 0) {
  const { sr } = c;
  const bpf = new Biquad(sr);
  const hp = new Biquad(sr).set('hp', 2200, 0.7);
  const rough = new OnePole(400, sr);
  let t = t0;
  let strokesInChar = 0;
  const [gl, gr] = panGains(pan);
  while (t < t1) {
    const len = rand(r, 0.05, 0.22);
    const amp = rand(r, 0.4, 1) * gain;
    bpf.set('bp', rand(r, 3000, 6000), 1.2);
    const s0 = Math.round(t * sr);
    const n = Math.round(len * sr);
    for (let i = 0; i < n; i++) {
      const idx = s0 + i;
      if (idx >= c.total) break;
      const x = i / n;
      const env = Math.pow(Math.sin(Math.PI * x), 0.7);
      const rg = 0.6 + 0.8 * Math.abs(rough.lp(r() * 2 - 1)) * 4;
      const v = bpf.run(hp.run(r() * 2 - 1)) * env * rg * amp + (i < sr * 0.001 ? (r() * 2 - 1) * 0.3 * amp : 0);
      c.L[idx] += v * gl;
      c.R[idx] += v * gr;
    }
    t += len + rand(r, 0.03, 0.12);
    if (++strokesInChar > 4 + r() * 8) {
      strokesInChar = 0;
      t += rand(r, 0.15, 0.45);
    }
  }
}

export function keyClick(sr, r, kind = 'key') {
  const len = Math.round(sr * 0.09);
  const out = new Float32Array(len);
  const click = noiseGrain(sr, r, rand(r, 0.4, 1), kind === 'space' ? 1800 : rand(r, 2500, 4500), 2, 6);
  addAt(out, click, 0, kind === 'space' ? 0.35 : 0.5);
  const th = modal(sr, kind === 'space' ? 140 : rand(r, 180, 320), [[1, 1, 0.02], [2.3, 0.4, 0.01]], 0.06, { r, click: 0 });
  const lpn = new Biquad(sr).set('lp', kind === 'space' ? 350 : rand(r, 300, 600), 0.7);
  for (let i = 0; i < Math.round(sr * 0.015); i++) th[i] += lpn.run(r() * 2 - 1) * Math.exp(-i / (sr * 0.004)) * 0.8;
  addAt(out, th, 0, kind === 'space' ? 0.9 : kind === 'enter' ? 0.8 : 0.55);
  const up = noiseGrain(sr, r, 0.4, rand(r, 2500, 4000), 2, 3);
  addAt(out, up, Math.round(sr * rand(r, 0.025, 0.045)), 0.12);
  return out;
}

/** タイピングを [t0, t1) 秒に書き込む */
export function writeTyping(c, t0, t1, r, gain, pan = 0) {
  const { sr } = c;
  const keys = [];
  for (let k = 0; k < 30; k++) keys.push(keyClick(sr, r, 'key'));
  const space = [keyClick(sr, r, 'space'), keyClick(sr, r, 'space')];
  const enter = keyClick(sr, r, 'enter');
  let t = t0;
  while (t < t1) {
    if (r() < 0.1) {
      t += rand(r, 1.2, 4);
      continue;
    }
    const word = 2 + ((r() * 8) | 0);
    for (let q = 0; q < word && t < t1; q++) {
      addPan(c, pick(r, keys), Math.round(t * sr), gain * rand(r, 0.5, 1), pan + rand(r, -0.1, 0.1));
      t += Math.exp(Math.log(0.11) + 0.35 * (r() + r() + r() - 1.5));
    }
    t += 0.05;
    if (r() < 0.12) {
      addPan(c, enter, Math.round(t * sr), gain, pan);
      t += rand(r, 0.6, 2.2);
    } else {
      addPan(c, pick(r, space), Math.round(t * sr), gain * 0.9, pan);
      t += rand(r, 0.08, 0.2);
    }
  }
}

BEDS.clock = (sr, seed) => {
  // ちょうど 2 秒でループ（つなぎ目の処理は不要）
  const c = workbench(sr, 2, seed, 0);
  const tick = modal(sr, 3200, [[1, 0.6, 0.012], [1.7, 0.3, 0.006], [0.26, 0.5, 0.03]], 0.2, { r: c.r, click: 0.4 });
  const tock = modal(sr, 2500, [[1, 0.6, 0.012], [1.85, 0.3, 0.006], [0.28, 0.6, 0.035]], 0.2, { r: c.r, click: 0.35 });
  addPan(c, tick, 0, 1, -0.05);
  addPan(c, tock, sr, 0.9, 0.05);
  return finish(c, 0.05, 0.6);
};

BEDS.train = (sr, seed) => {
  const c0 = workbench(sr, 1, seed, 0);
  const P = Math.round(1.28 * sr);
  const n = P * 24;
  const f = Math.round(0.6 * sr);
  const c = { ...c0, n, f, total: n + f, L: new Float32Array(n + f), R: new Float32Array(n + f) };
  const { r, total } = c;
  const hit = (f0, amp) => {
    const len = Math.round(sr * 0.25);
    const g = new Float32Array(len);
    const lp = new Biquad(sr).set('lp', 220, 0.7);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      g[i] = lp.run(r() * 2 - 1) * Math.exp(-t / 0.045) * 2.2 + Math.sin(TAU * f0 * t) * Math.exp(-t / 0.09) * 0.8;
    }
    addAt(g, noiseGrain(sr, r, 1.2, rand(r, 1200, 2200), 3, 12), 0, 0.22);
    return normPeak(g, amp);
  };
  const pattern = [[0, 0.7, 88], [0.11, 1.0, 84], [0.36, 0.6, 80], [0.47, 0.85, 76]];
  for (let k = 0; k * P < total; k++) {
    for (const [off, amp, f0] of pattern) {
      const g = hit(f0 * rand(r, 0.95, 1.05), amp * rand(r, 0.85, 1.1));
      addPan(c, g, k * P + Math.round(off * sr), 0.9, rand(r, -0.15, 0.15));
    }
  }
  const whine = fitHz(340, n, sr);
  const hum = fitHz(120, n, sr);
  for (const ch of [c.L, c.R]) {
    const b = new Brown(r);
    const p = new Pink(r);
    const lp = new Biquad(sr).set('lp', 220, 0.7);
    const hp = new Biquad(sr).set('hp', 250, 0.7);
    const lp2 = new Biquad(sr).set('lp', 1100, 0.7);
    const mod = new Smooth(sr, 0.3, r);
    for (let i = 0; i < total; i++) {
      const t = i / sr;
      ch[i] +=
        lp.run(b.next()) * 0.55 +
        lp2.run(hp.run(p.next())) * 0.25 * (0.93 + 0.14 * mod.at(i)) +
        0.008 * Math.sin(TAU * whine * t) +
        0.006 * Math.sin(TAU * hum * t);
    }
  }
  return finish(c, 0.1);
};

BEDS.vinyl = (sr, seed) => {
  const c0 = workbench(sr, 1, seed, 0);
  const P = Math.round(1.8 * sr);
  const n = P * 17;
  const f = Math.round(0.5 * sr);
  const c = { ...c0, n, f, total: n + f, L: new Float32Array(n + f), R: new Float32Array(n + f) };
  const { r, total } = c;
  for (const ch of [c.L, c.R]) {
    const p = new Pink(r);
    const b = new Brown(r);
    const hp = new Biquad(sr).set('hp', 3000, 0.7);
    const lp = new Biquad(sr).set('lp', 50, 0.7);
    for (let i = 0; i < total; i++) ch[i] = hp.run(p.next()) * 0.05 + lp.run(b.next()) * 0.08;
  }
  // パチパチ
  const count = Math.round((30 * total) / sr);
  const crackle = new Float32Array(total);
  for (let k = 0; k < count; k++) {
    const pos = (r() * total) | 0;
    const a = Math.pow(r(), 5) * (r() < 0.5 ? 1 : -1);
    const w = 1 + ((r() * 3) | 0);
    for (let q = 0; q < w && pos + q < total; q++) crackle[pos + q] += a;
  }
  const lp = new Biquad(sr).set('lp', 7000, 0.7);
  const hp = new Biquad(sr).set('hp', 300, 0.7);
  for (let i = 0; i < total; i++) {
    const v = hp.run(lp.run(crackle[i]));
    c.L[i] += v * 1.2;
    c.R[i] += v * 1.0;
  }
  // 回転ごとの小さな傷
  const scratch = noiseGrain(sr, r, 1.2, 1500, 1.5, 3);
  for (let k = 0; k * P < total; k++) addPan(c, scratch, k * P + Math.round(0.4 * sr), 0.25, 0);
  for (let k = 0; k < (0.3 * total) / sr; k++) addPan(c, noiseGrain(sr, r, rand(r, 0.6, 1.5), rand(r, 900, 2000), 1.5, 3), (r() * total) | 0, rand(r, 0.1, 0.4), rand(r, -0.3, 0.3));
  return finish(c, 0.035);
};

// ── 音楽的なもの ──────────────────────────────────────
BEDS.ambient = (sr, seed) => {
  const chords = [
    [38, 45, 54, 61, 64],
    [35, 42, 50, 57, 61],
    [31, 38, 47, 54, 57],
    [33, 40, 49, 59, 64],
  ];
  const seg = 16;
  const c = workbench(sr, seg * chords.length, seed, 3);
  const { r, total } = c;
  const TBL = 4096;
  const table = new Float32Array(TBL + 1);
  for (let i = 0; i <= TBL; i++) {
    const x = (TAU * i) / TBL;
    table[i] = Math.sin(x) + 0.22 * Math.sin(2 * x) + 0.08 * Math.sin(3 * x);
  }
  const voices = [];
  const T = total / sr;
  for (let ci = 0; ci * seg < T + seg; ci++) {
    const notes = chords[ci % chords.length];
    const t0 = ci * seg - 2;
    notes.forEach((m, j) => {
      for (const side of [-1, 1]) {
        voices.push({
          f: midiHz(m) * Math.pow(2, (side * rand(r, 2, 5)) / 1200),
          t0,
          t1: t0 + seg + 4,
          amp: (j === 0 ? 0.55 : j >= 3 ? 0.22 : 0.32) * 0.5,
          pan: side * rand(r, 0.3, 0.8) * (j === 0 ? 0.2 : 1),
          lfo: rand(r, 0.05, 0.12),
          lph: r() * TAU,
          ph: r(),
        });
      }
    });
  }
  for (const v of voices) {
    const s0 = Math.max(0, Math.round(v.t0 * sr));
    const s1 = Math.min(total, Math.round(v.t1 * sr));
    const [gl, gr] = panGains(v.pan);
    const inc = v.f / sr;
    let ph = v.ph;
    const dur = v.t1 - v.t0;
    let e = 0;
    for (let i = s0; i < s1; i++) {
      if (((i - s0) & 63) === 0) {
        const t = i / sr - v.t0;
        const env = Math.min(1, t / 4) * Math.min(1, (dur - t) / 5);
        e = (0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, env))) * (0.75 + 0.25 * Math.sin(TAU * v.lfo * (i / sr) + v.lph));
      }
      const x = ph * TBL;
      const k = x | 0;
      const s = (table[k] + (table[k + 1] - table[k]) * (x - k)) * v.amp * e;
      ph += inc;
      if (ph >= 1) ph -= 1;
      c.L[i] += s * gl;
      c.R[i] += s * gr;
    }
  }
  const lpL = new Biquad(sr).set('lp', 2400, 0.6);
  const lpR = new Biquad(sr).set('lp', 2400, 0.6);
  for (let i = 0; i < total; i++) {
    c.L[i] = lpL.run(c.L[i]);
    c.R[i] = lpR.run(c.R[i]);
  }
  return finish(c, 0.08);
};

/** 生成（Worker から呼ぶ入口） */
export function generateBed(name, sr, seed = 1) {
  const fn = BEDS[name];
  if (!fn) throw new Error(`unknown bed: ${name}`);
  return fn(sr, seed);
}

// ループ再生する環境音（ベッド）の生成。すべて乱数から合成するので著作権の心配が無く、
// 1 回作ればメモリ上でつなぎ目なくループする。Worker の中で動かす。

import {
  TAU,
  Biquad,
  Reson,
  Pink,
  Brown,
  Smooth,
  OnePole,
  rand,
  logRand,
  pick,
  childRng,
  midiHz,
  panGains,
  addAt,
  addPan,
  normPeak,
  noiseGrain,
  bubble,
  modal,
  normalize,
  workbench,
  finish,
  fitHz,
  poisson,
  SIN,
  SIN_N,
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

// ── 雨 ────────────────────────────────────────────────
function rainCore(c, o) {
  const { sr, total, r } = c;
  if (o.bed) {
    for (const ch of [c.L, c.R]) {
      const src = new Pink(r);
      const hp = new Biquad(sr).set('hp', o.bedHP, 0.7);
      const lp = new Biquad(sr).set('lp', o.bedLP, 0.7);
      const lp2 = new Biquad(sr).set('lp', o.bedLP, 0.7);
      const mod = new Smooth(sr, 0.25, r);
      for (let i = 0; i < total; i++) {
        let v = lp.run(hp.run(src.next()));
        if (o.steep) v = lp2.run(v);
        ch[i] += v * o.bed * (0.85 + 0.3 * mod.at(i));
      }
    }
  }
  const gust = o.gusty ? new Smooth(sr, 0.08, r) : null;
  if (o.density) {
    const bank = [];
    for (let k = 0; k < 96; k++) {
      bank.push(
        noiseGrain(sr, r, rand(r, o.dropMs[0], o.dropMs[1]), logRand(r, o.dropF[0], o.dropF[1]), rand(r, o.dropQ[0], o.dropQ[1]), o.ringMs ?? 3),
      );
    }
    const count = Math.round((o.density * total) / sr);
    for (let k = 0; k < count; k++) {
      const pos = (r() * total) | 0;
      if (gust && r() > 0.35 + 0.65 * gust.at(pos)) continue;
      const a = o.dropGain * (0.06 + Math.pow(r(), o.skew ?? 4));
      addPan(c, bank[(r() * bank.length) | 0], pos, a, (r() * 2 - 1) * (o.width ?? 0.9));
    }
  }
  if (o.metal) {
    const bank = [];
    for (let k = 0; k < 40; k++) {
      const f0 = logRand(r, 1100, 3400);
      bank.push(normPeak(modal(sr, f0, [[1, 1, rand(r, 0.03, 0.08)], [1.58, 0.6, 0.04], [2.37, 0.4, 0.025], [3.11, 0.25, 0.015]], 0.15, { r, click: 0.4 })));
    }
    const count = Math.round((o.metal * total) / sr);
    for (let k = 0; k < count; k++) {
      addPan(c, bank[(r() * bank.length) | 0], (r() * total) | 0, 0.35 * (0.05 + Math.pow(r(), 3)), rand(r, -0.8, 0.8));
    }
  }
  if (o.plinkRate) {
    const count = Math.round((o.plinkRate * total) / sr);
    for (let k = 0; k < count; k++) {
      const g = bubble(sr, logRand(r, o.plinkF[0], o.plinkF[1]), rand(r, 0.012, 0.035), rand(r, 0.6, 1.6));
      addPan(c, g, (r() * total) | 0, o.plinkGain * rand(r, 0.3, 1), rand(r, -0.7, 0.7));
    }
  }
  if (o.gutter) {
    // 雨どいから落ちる一定のしずく
    const f0 = rand(r, 650, 900);
    const pan = rand(r, -0.5, 0.5);
    let t = rand(r, 0, 1);
    while (t * sr < total) {
      const g = bubble(sr, f0 * rand(r, 0.97, 1.03), 0.03, 1.4);
      addPan(c, g, Math.round(t * sr), o.gutter * rand(r, 0.7, 1), pan);
      t += rand(r, 0.85, 1.35);
    }
  }
  if (o.rumble) {
    for (const ch of [c.L, c.R]) {
      const b = new Brown(r);
      const lp = new Biquad(sr).set('lp', 160, 0.7);
      for (let i = 0; i < total; i++) ch[i] += lp.run(b.next()) * o.rumble;
    }
  }
}

BEDS.rainLight = (sr, seed) => {
  const c = workbench(sr, 30, seed);
  rainCore(c, {
    bed: 0.3, bedHP: 700, bedLP: 7500,
    density: 260, dropMs: [0.4, 2.5], dropF: [1500, 9000], dropQ: [0.8, 3], dropGain: 1.0, skew: 5,
    plinkRate: 1.5, plinkF: [900, 2600], plinkGain: 0.25,
  });
  return finish(c, 0.08);
};

BEDS.rainHeavy = (sr, seed) => {
  const c = workbench(sr, 30, seed);
  rainCore(c, {
    bed: 1.0, bedHP: 250, bedLP: 9000,
    density: 1300, dropMs: [0.3, 2], dropF: [800, 8000], dropQ: [0.7, 2], dropGain: 0.5, skew: 3,
    rumble: 0.45,
  });
  return finish(c, 0.11);
};

BEDS.rainWindow = (sr, seed) => {
  const c = workbench(sr, 40, seed);
  rainCore(c, {
    bed: 0.7, bedHP: 150, bedLP: 1700, steep: true,
    density: 90, dropMs: [0.3, 1.5], dropF: [1800, 4500], dropQ: [5, 12], ringMs: 8, dropGain: 0.8, skew: 3, gusty: true,
    plinkRate: 0.5, plinkF: [600, 1400], plinkGain: 0.3,
    rumble: 0.25,
  });
  return finish(c, 0.08);
};

BEDS.rainRoof = (sr, seed) => {
  const c = workbench(sr, 30, seed);
  rainCore(c, {
    bed: 0.35, bedHP: 400, bedLP: 6000,
    density: 120, dropMs: [0.3, 1.5], dropF: [1500, 6000], dropQ: [1, 3], dropGain: 0.5, skew: 4,
    metal: 70, gutter: 0.45,
  });
  return finish(c, 0.08);
};

// 雷のベッドは遠くのかすかな雨音だけ（雷鳴そのものはイベントで鳴らす）
BEDS.thunderBed = (sr, seed) => {
  const c = workbench(sr, 20, seed);
  rainCore(c, { bed: 0.5, bedHP: 300, bedLP: 3500, steep: true, rumble: 0.4 });
  return finish(c, 0.03);
};

// ── 風・木々 ──────────────────────────────────────────
function windLayer(c, gain, { rate = 0.07, lo = 220, hi = 700, whistle = 0.12 } = {}) {
  const { sr, total, r } = c;
  const gust = new Smooth(sr, rate, r);
  const gust2 = new Smooth(sr, rate * 2.3, r);
  const shape = (i) => {
    const g = gust.at(i);
    return 0.12 + 0.88 * g * g * (0.8 + 0.2 * gust2.at(i));
  };
  const lag = Math.round(0.35 * sr);
  [[c.L, 0], [c.R, lag]].forEach(([ch, off]) => {
    const p = new Pink(r);
    const b = new Brown(r);
    const bp = new Biquad(sr);
    const bw = new Biquad(sr);
    const lpr = new Biquad(sr).set('lp', 140, 0.7);
    let g = 0;
    for (let i = 0; i < total; i++) {
      if ((i & 31) === 0) {
        g = shape(i + off);
        bp.set('bp', lo + (hi - lo) * g, 0.8 + 1.4 * g);
        bw.set('bp', 480 + 1100 * shape(i + off + lag), 14);
      }
      ch[i] += gain * (bp.run(p.next()) * (0.1 + g) * 1.6 + bw.run(r() * 2 - 1) * whistle * g * g + lpr.run(b.next()) * 0.45 * (0.3 + g));
    }
  });
}

BEDS.wind = (sr, seed) => {
  const c = workbench(sr, 60, seed, 3);
  windLayer(c, 1);
  return finish(c, 0.1);
};

function leavesLayer(c, gain, { rate = 0.12, density = 2600 } = {}) {
  const { sr, total, r } = c;
  const gust = new Smooth(sr, rate, r);
  const gAt = (i) => {
    const g = gust.at(i);
    return 0.12 + 0.88 * g * g;
  };
  [c.L, c.R].forEach((ch, ci) => {
    const hp = new Biquad(sr).set('hp', 1500, 0.7);
    const lp = new Biquad(sr).set('lp', 8000, 0.7);
    const b = new Brown(r);
    const lpb = new Biquad(sr).set('lp', 400, 0.7);
    const off = ci * Math.round(0.2 * sr);
    for (let i = 0; i < total; i++) {
      const g = gAt(i + off);
      ch[i] += gain * (lp.run(hp.run(r() * 2 - 1)) * 0.22 * g + lpb.run(b.next()) * 0.25 * g);
    }
  });
  const bank = [];
  for (let k = 0; k < 64; k++) bank.push(noiseGrain(sr, r, rand(r, 0.3, 2), logRand(r, 2000, 9000), rand(r, 0.7, 2.5), 1));
  const block = Math.round(sr * 0.005);
  for (let i = 0; i < total; i += block) {
    const g = gAt(i);
    const k = poisson(r, (200 + density * g * g) * 0.005);
    for (let j = 0; j < k; j++) {
      addPan(c, bank[(r() * bank.length) | 0], i + ((r() * block) | 0), gain * 0.3 * g * (0.15 + r() * r()), rand(r, -0.9, 0.9));
    }
  }
}

BEDS.leaves = (sr, seed) => {
  const c = workbench(sr, 40, seed);
  leavesLayer(c, 1);
  return finish(c, 0.07);
};

BEDS.forestBed = (sr, seed) => {
  const c = workbench(sr, 40, seed);
  leavesLayer(c, 0.6, { density: 1200 });
  windLayer(c, 0.25, { rate: 0.05 });
  return finish(c, 0.035);
};

BEDS.mountainBed = (sr, seed) => {
  const c = workbench(sr, 40, seed);
  windLayer(c, 0.5, { rate: 0.05, lo: 180, hi: 500, whistle: 0.05 });
  leavesLayer(c, 0.35, { density: 800 });
  bubbleField(c, { rate: 120, f: [400, 2000], dur: [0.004, 0.016], gain: 0.08, rise: 1.1 });
  return finish(c, 0.04);
};

BEDS.breeze = (sr, seed) => {
  const c = workbench(sr, 40, seed);
  windLayer(c, 0.6, { rate: 0.05, lo: 250, hi: 600, whistle: 0.03 });
  leavesLayer(c, 0.3, { density: 600 });
  return finish(c, 0.03);
};

// ── 水 ────────────────────────────────────────────────
function bubbleField(c, { rate, f, dur, gain, rise = 1, width = 0.8, mod = null }) {
  const { sr, total, r } = c;
  const count = Math.round((rate * total) / sr);
  for (let k = 0; k < count; k++) {
    const pos = (r() * total) | 0;
    if (mod && r() > 0.45 + 0.55 * mod.at(pos)) continue;
    const f0 = logRand(r, f[0], f[1]);
    const d = rand(r, dur[0], dur[1]) * Math.sqrt(900 / f0);
    const a = gain * (0.12 + r() * r()) * Math.sqrt(1000 / f0);
    const [gl, gr] = panGains(rand(r, -width, width));
    const len = Math.min(Math.round(sr * d * 1.3), total - pos);
    let ph = 0;
    const k = Math.exp(-1 / (d * 0.3 * sr));
    const atk = 0.0008 * sr;
    let e = a;
    for (let i = 0; i < len; i++) {
      ph += (f0 * (1 + (rise * i) / (sr * d))) / sr;
      if (ph >= 1) ph -= 1;
      const s = SIN[(ph * SIN_N) | 0] * (i < atk ? i / atk : 1) * e;
      e *= k;
      c.L[pos + i] += s * gl;
      c.R[pos + i] += s * gr;
    }
  }
}

function flowBed(c, gain, hp, lp, rumble = 0) {
  const { sr, total, r } = c;
  for (const ch of [c.L, c.R]) {
    const p = new Pink(r);
    const b = new Brown(r);
    const h = new Biquad(sr).set('hp', hp, 0.7);
    const l = new Biquad(sr).set('lp', lp, 0.7);
    const lb = new Biquad(sr).set('lp', 280, 0.7);
    const mod = new Smooth(sr, 0.4, r);
    for (let i = 0; i < total; i++) {
      ch[i] += l.run(h.run(p.next())) * gain * (0.85 + 0.3 * mod.at(i)) + (rumble ? lb.run(b.next()) * rumble : 0);
    }
  }
}

BEDS.stream = (sr, seed) => {
  const c = workbench(sr, 40, seed);
  flowBed(c, 0.22, 300, 2600);
  bubbleField(c, { rate: 340, f: [300, 2400], dur: [0.004, 0.02], gain: 0.55, rise: 1.2, mod: new Smooth(sr, 0.5, c.r) });
  return finish(c, 0.08);
};

BEDS.river = (sr, seed) => {
  const c = workbench(sr, 40, seed);
  flowBed(c, 0.6, 120, 3200, 0.35);
  bubbleField(c, { rate: 620, f: [200, 1600], dur: [0.006, 0.03], gain: 0.4, rise: 0.9, mod: new Smooth(sr, 0.7, c.r) });
  return finish(c, 0.1);
};

BEDS.waterfall = (sr, seed) => {
  const c = workbench(sr, 20, seed, 1);
  for (const ch of [c.L, c.R]) {
    const p = new Pink(c.r);
    const b = new Brown(c.r);
    const lp = new Biquad(sr).set('lp', 6500, 0.7);
    const hp = new Biquad(sr).set('hp', 50, 0.7);
    const lb = new Biquad(sr).set('lp', 250, 0.7);
    const mod = new Smooth(sr, 0.6, c.r);
    for (let i = 0; i < c.total; i++) {
      ch[i] = hp.run(lp.run(p.next() * 0.8 + (c.r() * 2 - 1) * 0.12)) * (0.92 + 0.16 * mod.at(i)) + lb.run(b.next()) * 0.6;
    }
  }
  return finish(c, 0.11);
};

BEDS.trickle = (sr, seed) => {
  const c = workbench(sr, 30, seed);
  flowBed(c, 0.05, 900, 5000);
  bubbleField(c, { rate: 110, f: [700, 3200], dur: [0.003, 0.012], gain: 0.5, rise: 1.4, width: 0.4, mod: new Smooth(sr, 0.8, c.r) });
  return finish(c, 0.035);
};

BEDS.waves = (sr, seed) => {
  const c = workbench(sr, 72, seed, 4);
  const { r, total } = c;
  const T = total / sr;
  const waves = [];
  for (let t = rand(r, -6, -2); t < T + 6; t += rand(r, 6.5, 12)) {
    const pan = rand(r, -0.45, 0.45);
    const [gl, gr] = panGains(pan);
    waves.push({ t, I: rand(r, 0.55, 1), gl: gl * 1.41, gr: gr * 1.41, wash: rand(r, 2.2, 3.6), swell: rand(r, 0.9, 1.6) });
  }
  const shape = (x, w) => (x < 0 ? 0.3 * Math.exp(x / w.swell) : (0.3 + 0.7 * (1 - Math.exp(-x / 0.12))) * Math.exp(-x / w.wash));
  const cshape = (x) => (x < 0 ? 0.15 * Math.exp(x / 0.7) : Math.exp(-x / 1.3));
  const fshape = (x, w) => (x > 0.2 ? Math.exp(-(x - 0.2) / (w.wash * 0.8)) * (1 - Math.exp(-(x - 0.2) / 0.4)) : 0);
  const flick = new Smooth(sr, 6, r);
  const chans = [[c.L, 'gl'], [c.R, 'gr']].map(([ch, key]) => ({
    ch,
    key,
    p: new Pink(r),
    b: new Brown(r),
    lp: new Biquad(sr),
    lp2: new Biquad(sr),
    hp: new Biquad(sr).set('hp', 2500, 0.7),
    lb: new Biquad(sr).set('lp', 300, 0.7),
  }));
  let A = [0, 0];
  let F = 0;
  let C = 300;
  for (let i = 0; i < total; i++) {
    if ((i & 31) === 0) {
      const tt = i / sr;
      A = [0, 0];
      F = 0;
      let cc = 0;
      for (const w of waves) {
        const x = tt - w.t;
        if (x < -8 || x > 16) continue;
        const s = w.I * shape(x, w);
        A[0] += s * w.gl;
        A[1] += s * w.gr;
        cc += w.I * cshape(x);
        F += w.I * fshape(x, w);
      }
      C = Math.min(7000, 280 + 4800 * cc);
      for (const k of chans) {
        k.lp.set('lp', C, 0.6);
        k.lp2.set('lp', C * 1.4, 0.6);
      }
    }
    const fl = 0.6 + 0.4 * flick.at(i);
    chans.forEach((k, ci) => {
      const v = k.lp2.run(k.lp.run(k.p.next())) * A[ci] + k.hp.run(r() * 2 - 1) * F * 0.12 * fl + k.lb.run(k.b.next()) * 0.12;
      k.ch[i] = v;
    });
  }
  return finish(c, 0.1);
};

// ── 火 ────────────────────────────────────────────────
BEDS.fire = (sr, seed) => {
  const c = workbench(sr, 40, seed);
  const { r, total } = c;
  for (const ch of [c.L, c.R]) {
    const b = new Brown(r);
    const lp = new Biquad(sr).set('lp', 380, 0.7);
    const hp = new Biquad(sr).set('hp', 2500, 0.7);
    const lp2 = new Biquad(sr).set('lp', 8000, 0.7);
    const f1 = new Smooth(sr, 0.6, r);
    const f2 = new Smooth(sr, 2.5, r);
    for (let i = 0; i < total; i++) {
      ch[i] += lp.run(b.next()) * 0.55 * (0.6 + 0.4 * f1.at(i)) + lp2.run(hp.run(r() * 2 - 1)) * 0.05 * (0.4 + 0.6 * f2.at(i));
    }
  }
  const clicks = [];
  const pops = [];
  for (let k = 0; k < 64; k++) clicks.push(noiseGrain(sr, r, rand(r, 0.15, 1), rand(r, 3000, 8000), 0.5, 0.5, 'hp'));
  for (let k = 0; k < 48; k++) pops.push(noiseGrain(sr, r, rand(r, 0.5, 3), logRand(r, 1200, 4500), rand(r, 2, 5), 6));
  const burst = new Smooth(sr, 0.25, r);
  const block = Math.round(sr * 0.01);
  for (let i = 0; i < total; i += block) {
    const b = burst.at(i);
    const k = poisson(r, (4 + 45 * b * b * b) * 0.01);
    for (let j = 0; j < k; j++) {
      const pos = i + ((r() * block) | 0);
      const pan = rand(r, -0.6, 0.6);
      if (r() < 0.03) {
        // 連続して弾ける
        const m = 4 + ((r() * 6) | 0);
        for (let q = 0; q < m; q++) addPan(c, pick(r, clicks), pos + Math.round(r() * sr * 0.06), rand(r, 0.1, 0.5), pan);
      } else if (r() < 0.7) {
        addPan(c, pick(r, clicks), pos, 0.15 + Math.pow(r(), 4) * 0.9, pan);
      } else {
        addPan(c, pick(r, pops), pos, 0.2 + Math.pow(r(), 5), pan);
      }
    }
  }
  return finish(c, 0.09);
};

// ── 虫・カエル ────────────────────────────────────────
function toneCall(c, start, dur, f, amp, pan, { am = 0, amDepth = 0, glide = 0, attack = 0.01, release = 0.03, harm = 0.05 } = {}) {
  const { sr } = c;
  const s0 = Math.round(start * sr);
  const len = Math.round(dur * sr);
  const [gl, gr] = panGains(pan);
  let ph = 0;
  let pa = 0;
  const amInc = am / sr;
  for (let i = 0; i < len; i++) {
    const idx = s0 + i;
    if (idx < 0) continue;
    if (idx >= c.total) break;
    const t = i / sr;
    ph += (f * (1 + glide * (t / dur))) / sr;
    if (ph >= 1) ph -= 1;
    pa += amInc;
    if (pa >= 1) pa -= 1;
    const env = Math.min(1, t / attack) * Math.min(1, (dur - t) / release);
    const mod = amDepth ? 1 - amDepth * (0.5 - 0.5 * SIN[(((pa + 0.25) % 1) * SIN_N) | 0]) : 1;
    let ph2 = ph * 2;
    if (ph2 >= 1) ph2 -= 1;
    const v = (SIN[(ph * SIN_N) | 0] + harm * SIN[(ph2 * SIN_N) | 0]) * env * mod * amp;
    c.L[idx] += v * gl;
    c.R[idx] += v * gr;
  }
}

BEDS.crickets = (sr, seed) => {
  const c = workbench(sr, 40, seed);
  const { r } = c;
  const T = c.total / sr;
  // スズムシ「リーン」
  for (let k = 0; k < 4; k++) {
    const rr = childRng(r);
    const f = rand(rr, 3900, 4600);
    const pan = rand(rr, -0.8, 0.8);
    const g = rand(rr, 0.35, 1);
    const per = rand(rr, 0.9, 1.5);
    for (let t = rand(rr, 0, 2); t < T; t += per * rand(rr, 0.9, 1.15) + (rr() < 0.06 ? rand(rr, 2, 6) : 0)) {
      toneCall(c, t, rand(rr, 0.35, 0.6), f * rand(rr, 0.995, 1.005), g * 0.4, pan, { am: rand(rr, 28, 40), amDepth: 0.55, glide: -0.01, attack: 0.03, release: 0.08 });
    }
  }
  // エンマコオロギ「コロコロリー」
  for (let k = 0; k < 3; k++) {
    const rr = childRng(r);
    const f = rand(rr, 4200, 5000);
    const pan = rand(rr, -0.9, 0.9);
    const g = rand(rr, 0.2, 0.7);
    for (let t = rand(rr, 0, 3); t < T; t += rand(rr, 2, 3.5)) {
      const n = 3 + ((rr() * 4) | 0);
      for (let q = 0; q < n; q++) toneCall(c, t + q * 0.07, 0.035, f, g * 0.45, pan, { attack: 0.004, release: 0.012 });
      toneCall(c, t + n * 0.07 + 0.02, rand(rr, 0.18, 0.32), f * 0.98, g * 0.4, pan, { am: 45, amDepth: 0.6, attack: 0.01, release: 0.06 });
    }
  }
  // 遠くの虫の合唱
  for (let k = 0; k < 4; k++) {
    const rr = childRng(r);
    toneCall(c, 0, T, rand(rr, 3300, 5500), rand(rr, 0.03, 0.07), rand(rr, -1, 1), { am: rand(rr, 12, 25), amDepth: 0.9, attack: 0.5, release: 0.5, harm: 0 });
  }
  // 夜の空気
  for (const ch of [c.L, c.R]) {
    const b = new Brown(r);
    const lp = new Biquad(sr).set('lp', 250, 0.7);
    for (let i = 0; i < c.total; i++) ch[i] += lp.run(b.next()) * 0.02;
  }
  return finish(c, 0.05);
};

BEDS.frogs = (sr, seed) => {
  const c = workbench(sr, 40, seed);
  const { r } = c;
  const T = c.total / sr;
  for (let k = 0; k < 9; k++) {
    const rr = childRng(r);
    const fc = rand(rr, 1300, 2600);
    const pulse = rand(rr, 90, 220);
    const noteDur = rand(rr, 0.06, 0.14);
    const dist = rand(rr, 0.15, 1);
    const pan = rand(rr, -0.95, 0.95);
    // 1 回分の「ケロッ」を作っておく
    const n = Math.round(noteDur * sr);
    const note = new Float32Array(n);
    const bq = new Biquad(sr).set('bp', fc, 6);
    const bq2 = new Biquad(sr).set('bp', fc * 1.9, 8);
    const period = sr / pulse;
    let next = 0;
    for (let i = 0; i < n; i++) {
      let x = 0;
      if (i >= next) {
        x = 1;
        next += period * rand(rr, 0.97, 1.03);
      }
      const env = Math.min(1, i / (0.008 * sr)) * Math.min(1, (n - i) / (0.3 * n));
      note[i] = (bq.run(x) + bq2.run(x) * 0.4) * env;
    }
    normPeak(note);
    if (dist < 0.5) {
      const op = new OnePole(1500, sr);
      for (let i = 0; i < n; i++) note[i] = op.lp(note[i]);
    }
    const gap = rand(rr, 0.15, 0.32);
    for (let t = rand(rr, 0, 4); t < T; ) {
      const bout = 6 + ((rr() * 20) | 0);
      for (let q = 0; q < bout && t < T; q++) {
        addPan(c, note, Math.round(t * sr), dist * rand(rr, 0.7, 1) * 0.5, pan);
        t += gap * rand(rr, 0.9, 1.1);
      }
      t += rand(rr, 1, 6);
    }
  }
  for (const ch of [c.L, c.R]) {
    const b = new Brown(r);
    const lp = new Biquad(sr).set('lp', 300, 0.7);
    for (let i = 0; i < c.total; i++) ch[i] += lp.run(b.next()) * 0.02;
  }
  return finish(c, 0.07);
};

// ── 喫茶店 ────────────────────────────────────────────
const VOWELS = [
  [750, 1200, 2600], // あ
  [300, 2200, 3000], // い
  [350, 1400, 2500], // う
  [480, 1900, 2600], // え
  [500, 850, 2500], // お
];

// Rosenberg 型の声門波（1 周期ぶんの表）
const GLOTTAL_N = 2048;
const GLOTTAL = new Float32Array(GLOTTAL_N);
for (let i = 0; i < GLOTTAL_N; i++) {
  const ph = i / GLOTTAL_N;
  GLOTTAL[i] = ph < 0.4 ? 0.5 * (1 - Math.cos((Math.PI * ph) / 0.4)) : ph < 0.56 ? Math.cos((Math.PI * (ph - 0.4)) / 0.32) : 0;
}

/** ひとりぶんの話し声（言葉にならない程度にぼかす前提の簡易フォルマント合成） */
function voiceTrack(sr, n, r, f0base, fScale) {
  const out = new Float32Array(n);
  const T = n / sr;
  const syl = [];
  let t = rand(r, 0, 3);
  while (t < T) {
    const uttStart = t;
    const uttEnd = t + rand(r, 0.8, 3.5);
    while (t < uttEnd && t < T) {
      const d = rand(r, 0.09, 0.2);
      const v = VOWELS[(r() * 5) | 0].map((f) => f * fScale * rand(r, 0.92, 1.08));
      syl.push({ s: t, e: t + d, v, amp: rand(r, 0.5, 1), cons: r() < 0.55 ? (r() < 0.5 ? 'f' : 'p') : null, us: uttStart, ue: uttEnd });
      t += d * rand(r, 1.0, 1.25);
    }
    t = uttEnd + rand(r, 0.4, 2.8);
  }
  let si = 0;
  const F = [500, 1500, 2500];
  let A = 0;
  let ph = 0;
  let prevG = 0;
  const res = [new Reson(sr), new Reson(sr), new Reson(sr)];
  const bws = [90, 110, 170];
  const sm = 1 - Math.exp(-1 / (0.018 * sr));
  const into = new Smooth(sr, 2.2, r);
  const fric = new Biquad(sr).set('hp', Math.min(2800, sr * 0.3), 0.7);
  let inton = 0.5;
  let targetA = 0;
  let consN = 0;
  let decl = 1;
  const B = 16;
  const smB = 1 - Math.pow(1 - sm, B);
  for (let i = 0; i < n; i++) {
    if (i % B === 0) {
      // 音節まわりの値は 16 サンプルごとに更新すれば十分
      inton = into.at(i);
      const tt = i / sr;
      while (si < syl.length && syl[si].e < tt) si++;
      const cur = syl[si];
      targetA = 0;
      consN = 0;
      decl = 1;
      if (cur && tt >= cur.s) {
        const x = (tt - cur.s) / (cur.e - cur.s);
        targetA = cur.amp * Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.05)), 0.6);
        for (let k = 0; k < 3; k++) F[k] += (cur.v[k] - F[k]) * smB;
        const dt = tt - cur.s;
        if (cur.cons === 'f' && dt < 0.035) consN = 0.35;
        else if (cur.cons === 'p' && dt < 0.008) consN = 0.8;
        decl = 1.12 - 0.24 * Math.min(1, Math.max(0, (tt - cur.us) / (cur.ue - cur.us)));
      }
      for (let k = 0; k < 3; k++) res[k].set(Math.min(F[k], sr * 0.45), bws[k]);
    }
    A += (targetA - A) * sm;
    const f0 = f0base * decl * (0.88 + 0.24 * inton);
    ph += f0 / sr;
    if (ph >= 1) ph -= 1;
    const g = GLOTTAL[(ph * GLOTTAL_N) | 0];
    const exc = (g - prevG) * 8;
    prevG = g;
    let s = exc * A + (r() * 2 - 1) * A * 0.03;
    s = res[2].run(res[1].run(res[0].run(s)));
    s += fric.run(consN ? r() * 2 - 1 : 0) * consN * 0.25;
    out[i] = s;
  }
  normalize([out], 0.1);
  return out;
}

function babble(c, voices, gain) {
  // 声は 1/3 のサンプルレートで作って足し合わせ、最後にまとめて元のレートへ戻す（速さのため）
  const D = 3;
  const sr2 = c.sr / D;
  const n2 = Math.ceil(c.total / D) + 2;
  const L2 = new Float32Array(n2);
  const R2 = new Float32Array(n2);
  for (let v = 0; v < voices; v++) {
    const r = childRng(c.r);
    const female = r() < 0.5;
    const f0 = female ? rand(r, 175, 250) : rand(r, 95, 140);
    const near = rand(r, 0.25, 1);
    const buf = voiceTrack(sr2, n2, r, f0, female ? 1.15 : 1);
    const cut = Math.min(sr2 * 0.42, 2000 + 2500 * near);
    const lp = new Biquad(sr2).set('lp', cut, 0.7);
    const lp2 = new Biquad(sr2).set('lp', cut, 0.7);
    const [gl, gr] = panGains(rand(r, -0.8, 0.8));
    for (let i = 0; i < n2; i++) {
      const s = lp2.run(lp.run(buf[i])) * near * gain;
      L2[i] += s * gl;
      R2[i] += s * gr;
    }
  }
  for (const [src, dst] of [[L2, c.L], [R2, c.R]]) {
    const aa = new Biquad(c.sr).set('lp', sr2 * 0.42, 0.7);
    for (let i = 0; i < c.total; i++) {
      const x = i / D;
      const k = x | 0;
      dst[i] += aa.run(src[k] + (src[k + 1] - src[k]) * (x - k));
    }
  }
}

export function clink(sr, r, kind) {
  if (kind === 'spoon') {
    return modal(sr, rand(r, 2800, 4200), [[1, 1, 0.08], [2.6, 0.5, 0.04], [5.2, 0.25, 0.02]], 0.25, { r, click: 0.3 });
  }
  return modal(sr, rand(r, 1600, 3000), [[1, 1, 0.18], [2.32, 0.6, 0.09], [3.86, 0.35, 0.05], [5.1, 0.2, 0.03]], 0.45, { r, click: 0.3 });
}

BEDS.cafe = (sr, seed) => {
  const c = workbench(sr, 60, seed);
  const { r, total } = c;
  babble(c, 10, 1);
  const T = total / sr;
  // カップとスプーン
  for (let t = rand(r, 0, 2); t < T; t += rand(r, 0.6, 3.5)) {
    const pan = rand(r, -0.8, 0.8);
    const far = rand(r, 0.25, 1);
    if (r() < 0.3) {
      const m = 4 + ((r() * 6) | 0);
      for (let q = 0; q < m; q++) addPan(c, clink(sr, r, 'spoon'), Math.round((t + q * rand(r, 0.11, 0.16)) * sr), 0.08 * far, pan);
    } else {
      addPan(c, clink(sr, r, 'cup'), Math.round(t * sr), rand(r, 0.12, 0.35) * far, pan);
      if (r() < 0.35) addPan(c, clink(sr, r, 'cup'), Math.round((t + rand(r, 0.08, 0.3)) * sr), rand(r, 0.05, 0.15) * far, pan);
    }
  }
  // 店内の空気
  for (const ch of [c.L, c.R]) {
    const b = new Brown(r);
    const lp = new Biquad(sr).set('lp', 250, 0.7);
    for (let i = 0; i < total; i++) ch[i] += lp.run(b.next()) * 0.04;
  }
  return finish(c, 0.08);
};

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

BEDS.pencil = (sr, seed) => {
  const c = workbench(sr, 40, seed);
  const { r } = c;
  const T = c.total / sr;
  for (let t = rand(r, 0, 1); t < T; ) {
    const len = rand(r, 3, 10);
    writeStrokes(c, t, Math.min(T, t + len), r, 1, rand(r, -0.15, 0.15));
    t += len + rand(r, 1, 4);
  }
  // 机の響き
  for (const ch of [c.L, c.R]) {
    const b = new Brown(r);
    const lp = new Biquad(sr).set('lp', 200, 0.7);
    for (let i = 0; i < c.total; i++) ch[i] += lp.run(b.next()) * 0.01;
  }
  return finish(c, 0.05);
};

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

BEDS.keyboard = (sr, seed) => {
  const c = workbench(sr, 40, seed);
  writeTyping(c, rand(c.r, 0, 1), c.total / sr, c.r, 1, 0);
  return finish(c, 0.05);
};

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

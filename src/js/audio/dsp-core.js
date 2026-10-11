// 音の合成に使う基本部品（Web Audio 非依存。Worker と Node のテストからも使う）

export const TAU = Math.PI * 2;

/** 再現できる乱数（seed が同じなら同じ列） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 正弦波の表（位相は「周期」単位 0〜1）。毎サンプル Math.sin を呼ぶより速い */
export const SIN_N = 4096;
export const SIN = new Float32Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN[i] = Math.sin((TAU * i) / SIN_N);
export const sinCyc = (ph) => SIN[((ph - Math.floor(ph)) * SIN_N) | 0];

export const rand = (r, a, b) => a + (b - a) * r();
export const logRand = (r, a, b) => a * Math.pow(b / a, r());
export const pick = (r, arr) => arr[(r() * arr.length) | 0];
export const childRng = (r) => mulberry32((r() * 4294967296) >>> 0);
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** RBJ クックブックの双二次フィルタ（転置直接形 II） */
export class Biquad {
  constructor(sr) {
    this.sr = sr;
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.z1 = 0;
    this.z2 = 0;
  }
  set(type, f, q = 0.707, gainDb = 0) {
    const fc = Math.min(Math.max(f, 5), this.sr * 0.45);
    const w = (TAU * fc) / this.sr;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (type === 'hp') {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = b0;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else if (type === 'bp') {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cw;
      a2 = 1 - alpha;
    } else {
      // peak
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  process(buf) {
    for (let i = 0; i < buf.length; i++) buf[i] = this.run(buf[i]);
    return buf;
  }
}

/** Klatt 型の共鳴器（直列につないでフォルマントを作る） */
export class Reson {
  constructor(sr) {
    this.T = 1 / sr;
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.y1 = 0;
    this.y2 = 0;
  }
  set(F, BW) {
    this.c = -Math.exp(-TAU * BW * this.T);
    this.b = 2 * Math.exp(-Math.PI * BW * this.T) * Math.cos(TAU * F * this.T);
    this.a = 1 - this.b - this.c;
  }
  run(x) {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export class OnePole {
  constructor(fc, sr) {
    this.k = 1 - Math.exp((-TAU * fc) / sr);
    this.y = 0;
  }
  lp(x) {
    return (this.y += this.k * (x - this.y));
  }
  hp(x) {
    return x - this.lp(x);
  }
}

export class Pink {
  // Paul Kellet の近似
  constructor(r) {
    this.r = r;
    this.b0 = this.b1 = this.b2 = this.b3 = this.b4 = this.b5 = this.b6 = 0;
  }
  next() {
    const w = this.r() * 2 - 1;
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const out = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return out * 0.11;
  }
}

export class Brown {
  constructor(r) {
    this.r = r;
    this.y = 0;
  }
  next() {
    this.y = (this.y + 0.02 * (this.r() * 2 - 1)) / 1.02;
    return this.y * 3.5;
  }
}

/** 0〜1 をなめらかに動く乱数曲線。rate は 1 秒あたりの節の数 */
export class Smooth {
  constructor(sr, rate, r) {
    this.step = sr / rate;
    this.r = childRng(r);
    this.knots = [this.r(), this.r()];
  }
  at(i) {
    const k = i / this.step;
    const k0 = Math.floor(k);
    while (this.knots.length <= k0 + 1) this.knots.push(this.r());
    const w = (1 - Math.cos(Math.PI * (k - k0))) / 2;
    return this.knots[k0] + (this.knots[k0 + 1] - this.knots[k0]) * w;
  }
}

export function panGains(p) {
  const th = ((Math.max(-1, Math.min(1, p)) + 1) * Math.PI) / 4;
  return [Math.cos(th), Math.sin(th)];
}

export function addAt(dst, src, pos, gain) {
  const start = Math.max(0, -pos);
  const end = Math.min(src.length, dst.length - pos);
  for (let i = start; i < end; i++) dst[pos + i] += src[i] * gain;
}

/** ステレオの合成先 c（{L, R}）にモノラルの粒を定位して足す */
export function addPan(c, src, pos, gain, pan) {
  const [gl, gr] = panGains(pan);
  addAt(c.L, src, pos, gain * gl);
  addAt(c.R, src, pos, gain * gr);
}

export function peakOf(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}

export function normPeak(buf, to = 1) {
  const p = peakOf(buf);
  if (p > 0) for (let i = 0; i < buf.length; i++) buf[i] *= to / p;
  return buf;
}

/** 短いノイズを共鳴させた粒（雨粒・葉擦れ・パチパチ音など） */
export function noiseGrain(sr, r, ms, fc, q, ringMs = 3, type = 'bp') {
  const burst = Math.max(3, Math.round((sr * ms) / 1000));
  const len = burst + Math.round((sr * ringMs) / 1000);
  const g = new Float32Array(len);
  const bq = new Biquad(sr).set(type, fc, q);
  const tau = burst * 0.3;
  const atk = Math.max(1, Math.round(sr * 0.0002));
  for (let i = 0; i < len; i++) {
    const x = i < burst ? (r() * 2 - 1) * Math.exp(-i / tau) * Math.min(1, i / atk) : 0;
    g[i] = bq.run(x);
  }
  return normPeak(g);
}

/** 水滴・泡の「ぽちゃ」：上がっていく正弦波 */
export function bubble(sr, f0, dur, rise = 1) {
  const len = Math.round(sr * dur * 1.3);
  const g = new Float32Array(len);
  let ph = 0;
  const atk = 0.0008;
  const tau = dur * 0.3;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = f0 * (1 + (rise * t) / dur);
    ph += (TAU * f) / sr;
    g[i] = Math.sin(ph) * Math.min(1, t / atk) * Math.exp(-t / tau);
  }
  return g;
}

/** 固有振動の和で叩いた音（ベル・陶器・竹など）。modes: [[比, 振幅, 減衰秒], ...] */
export function modal(sr, f0, modes, dur, { click = 0.15, r = Math.random, detune = 0 } = {}) {
  const len = Math.round(sr * dur);
  const g = new Float32Array(len);
  for (const [ratio, amp, decay] of modes) {
    const f = f0 * ratio * (1 + detune * (r() - 0.5));
    if (f >= sr * 0.48) continue;
    const w = (TAU * f) / sr;
    const k = Math.exp(-1 / (decay * sr));
    let e = amp;
    let ph = r() * TAU * 0.1;
    // 鋭い立ち上がり
    for (let i = 0; i < len; i++) {
      const atk = i < 24 ? i / 24 : 1;
      g[i] += Math.sin(ph) * e * atk;
      ph += w;
      e *= k;
    }
  }
  if (click > 0) {
    const n = Math.round(sr * 0.002);
    for (let i = 0; i < n && i < len; i++) g[i] += (r() * 2 - 1) * click * (1 - i / n);
  }
  return g;
}

/**
 * ループ素材の仕上げ：x は n + f サンプル。末尾 f サンプルを先頭へ等パワーで
 * クロスフェードして、つなぎ目の無い n サンプルのループにする。
 */
export function finalizeLoop(chs, n, f) {
  return chs.map((x) => {
    const y = new Float32Array(n);
    y.set(x.subarray(0, n));
    for (let i = 0; i < f; i++) {
      const th = (Math.PI / 2) * (i / f);
      y[i] = x[i] * Math.sin(th) + x[n + i] * Math.cos(th);
    }
    return y;
  });
}

/** RMS をそろえる（ピークは maxPeak で頭打ち）。NaN が出たら無音にする */
export function normalize(chs, targetRms = 0.1, maxPeak = 0.95) {
  let sum = 0;
  let cnt = 0;
  let peak = 0;
  for (const ch of chs) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    cnt += ch.length;
  }
  if (!Number.isFinite(sum)) {
    for (const ch of chs) ch.fill(0);
    return { rms: 0, peak: 0, gain: 0, bad: true };
  }
  const rms = Math.sqrt(sum / Math.max(1, cnt));
  let g = rms > 0 ? targetRms / rms : 1;
  if (peak * g > maxPeak) g = maxPeak / peak;
  for (const ch of chs) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  return { rms: rms * g, peak: peak * g, gain: g };
}

/** ループ素材を作る作業台 */
export function workbench(sr, sec, seed, fade = 2) {
  const n = Math.round(sec * sr);
  const f = Math.round(fade * sr);
  const total = n + f;
  return {
    sr,
    n,
    f,
    total,
    r: mulberry32(seed),
    L: new Float32Array(total),
    R: new Float32Array(total),
  };
}

export function finish(c, rms = 0.1, maxPeak = 0.95) {
  const out = finalizeLoop([c.L, c.R], c.n, c.f);
  normalize(out, rms, maxPeak);
  return out;
}

/** ループの長さに合わせて、ちょうど整数周期になる周波数に丸める */
export const fitHz = (f, n, sr) => (Math.max(1, Math.round((f * n) / sr)) * sr) / n;

/** ポアソン到着の回数（ブロックごとの期待値 lambda から） */
export function poisson(r, lambda) {
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= r();
    } while (p > L);
    return k - 1;
  }
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (r() + r() + r() - 1.5) * 2));
}

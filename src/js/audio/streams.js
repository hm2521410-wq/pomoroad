// 流れ続ける環境音（ストリーム）。ループ素材ではなく、続きを少しずつ作り続ける。
// 雨の強さ・音の明るさ・風の強さなどが数分かけてゆっくり移り変わるので、
// 同じところのくり返しにならず、雰囲気がグラデーションのように変わっていく。
// Worker の中で動かす（Web Audio 非依存）。

import {
  Biquad,
  Pink,
  Brown,
  OnePole,
  mulberry32,
  rand,
  logRand,
  pick,
  childRng,
  panGains,
  normPeak,
  noiseGrain,
  bubble,
  modal,
  poisson,
  SIN,
  SIN_N,
} from './dsp-core.js';
import { clink, keyClick } from './beds.js';

const CARRY_SEC = 3;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** 前にしか進まない、なめらかな乱数曲線（メモリが増えない） */
class Walker {
  constructor(sr, rate, r) {
    this.step = sr / rate;
    this.r = childRng(r);
    this.k = 0;
    this.a = this.r();
    this.b = this.r();
  }
  at(i) {
    const k = i / this.step;
    const k0 = Math.floor(k);
    while (this.k < k0) {
      this.k++;
      this.a = this.b;
      this.b = this.r();
    }
    const w = (1 - Math.cos(Math.PI * (k - k0))) / 2;
    return this.a + (this.b - this.a) * w;
  }
}

/** 雰囲気の移り変わり：数分の大きな波と、数十秒の小さな波を重ねた 0〜1 の値 */
class Drift {
  constructor(sr, r, { center = 0.5, spread = 0.3, period = 150 }, variation) {
    this.slow = new Walker(sr, 1 / period, r);
    this.fast = new Walker(sr, 4 / period, r);
    this.center = center;
    this.spread = spread;
    this.v = variation;
  }
  at(i) {
    const d = (this.slow.at(i) - 0.5) * 1.6 + (this.fast.at(i) - 0.5) * 0.5;
    return clamp01(this.center + d * this.spread * this.v);
  }
}

// ── 土台 ─────────────────────────────────────────
class Stream {
  constructor(sr, seed, opts = {}) {
    this.sr = sr;
    this.r = mulberry32(seed);
    this.pos = 0;
    this.v = opts.variation ?? 1;
    this.drifts = [];
    const cn = Math.round(CARRY_SEC * sr);
    this.cL = new Float32Array(cn);
    this.cR = new Float32Array(cn);
  }
  drift(o) {
    const d = new Drift(this.sr, this.r, o, this.v);
    this.drifts.push(d);
    return d;
  }
  setVariation(v) {
    this.v = v;
    for (const d of this.drifts) d.v = v;
  }
  render(n) {
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    // 前のかたまりからはみ出した音を足す
    const cn = this.cL.length;
    const m = Math.min(n, cn);
    for (let i = 0; i < m; i++) {
      L[i] = this.cL[i];
      R[i] = this.cR[i];
    }
    if (cn > n) {
      this.cL.copyWithin(0, n);
      this.cR.copyWithin(0, n);
      this.cL.fill(0, cn - n);
      this.cR.fill(0, cn - n);
    } else {
      this.cL.fill(0);
      this.cR.fill(0);
    }
    this.fill({ L, R, n, pos: this.pos, s: this });
    if (this.tone) this._applyTone(L, R, n);
    this.pos += n;
    return [L, R];
  }
  /** 近さ（音の明るさ）：遠いとこもって、近いとくっきり。0〜1 の Drift で動かす */
  useTone(o, lo = 3500, hi = 18000) {
    this.tone = this.drift(o);
    this.toneLo = lo;
    this.toneHi = hi;
    this.tz = [0, 0];
  }
  _applyTone(L, R, n) {
    const sr = this.sr;
    for (let c = 0; c < 2; c++) {
      const x = c ? R : L;
      let z = this.tz[c];
      let k = 0;
      for (let i = 0; i < n; i++) {
        if ((i & 255) === 0) {
          const fc = this.toneLo * Math.pow(this.toneHi / this.toneLo, this.tone.at(this.pos + i));
          k = 1 - Math.exp((-2 * Math.PI * fc) / sr);
        }
        z += k * (x[i] - z);
        x[i] = z;
      }
      this.tz[c] = z;
    }
  }
}

/** 粒を定位して書き込む。かたまりの終わりを越えた分は次へ持ち越す */
function put(o, src, at, gain, pan) {
  const [gl, gr] = panGains(pan);
  const s = o.s;
  const cn = s.cL.length;
  for (let i = 0; i < src.length; i++) {
    const j = at + i;
    const v = src[i] * gain;
    if (j < o.n) {
      o.L[j] += v * gl;
      o.R[j] += v * gr;
    } else {
      const c = j - o.n;
      if (c >= cn) break;
      s.cL[c] += v * gl;
      s.cR[c] += v * gr;
    }
  }
}

// ── 部品（レイヤー） ──────────────────────────────
/** フィルターをかけたノイズの層。gainAt・lpAt は絶対サンプル位置の関数 */
class NoiseBed {
  constructor(s, kind, { hp = 0, lp = 0, steep = false, lpQ = 0.7 } = {}) {
    this.sr = s.sr;
    this.ch = [0, 1].map(() => ({
      src: kind === 'brown' ? new Brown(s.r) : kind === 'white' ? { r: s.r, next() { return this.r() * 2 - 1; } } : new Pink(s.r),
      hp: hp ? new Biquad(s.sr).set('hp', hp, 0.7) : null,
      lp: lp ? new Biquad(s.sr).set('lp', lp, lpQ) : null,
      lp2: lp && steep ? new Biquad(s.sr).set('lp', lp, lpQ) : null,
    }));
    this.lpQ = lpQ;
    this.g = null;
  }
  fill(o, gainAt, lpAt = null) {
    const B = 256;
    for (let c = 0; c < 2; c++) {
      const out = c ? o.R : o.L;
      const st = this.ch[c];
      let g0 = gainAt(o.pos);
      for (let b = 0; b < o.n; b += B) {
        const g1 = gainAt(o.pos + b + B);
        if (lpAt) {
          const f = lpAt(o.pos + b);
          st.lp?.set('lp', f, this.lpQ);
          st.lp2?.set('lp', f, this.lpQ);
        }
        const e = Math.min(o.n, b + B);
        for (let i = b; i < e; i++) {
          let v = st.src.next();
          if (st.hp) v = st.hp.run(v);
          if (st.lp) v = st.lp.run(v);
          if (st.lp2) v = st.lp2.run(v);
          out[i] += v * (g0 + ((g1 - g0) * (i - b)) / B);
        }
        g0 = g1;
      }
    }
  }
}

/** 雨粒・葉擦れ・パチパチ音などの粒の集まり */
class GrainField {
  constructor(s, { ms, f, q, ring = 3, bank = 96, metal = false, type = 'bp' }) {
    this.s = s;
    this.bank = [];
    for (let k = 0; k < bank; k++) {
      if (metal) {
        const f0 = logRand(s.r, f[0], f[1]);
        this.bank.push(normPeak(modal(s.sr, f0, [[1, 1, rand(s.r, 0.03, 0.08)], [1.58, 0.6, 0.04], [2.37, 0.4, 0.025], [3.11, 0.25, 0.015]], 0.15, { r: s.r, click: 0.4 })));
      } else {
        this.bank.push(noiseGrain(s.sr, s.r, rand(s.r, ms[0], ms[1]), logRand(s.r, f[0], f[1]), rand(s.r, q[0], q[1]), ring, type));
      }
    }
  }
  /** paramsAt(abs) → { rate（1秒あたり）, gain, skew, width } */
  fill(o, paramsAt) {
    const r = this.s.r;
    const block = Math.round(this.s.sr * 0.01);
    for (let b = 0; b < o.n; b += block) {
      const p = paramsAt(o.pos + b);
      const k = poisson(r, p.rate * 0.01);
      for (let j = 0; j < k; j++) {
        const a = p.gain * (0.06 + Math.pow(r(), p.skew ?? 4));
        put(o, this.bank[(r() * this.bank.length) | 0], b + ((r() * block) | 0), a, (r() * 2 - 1) * (p.width ?? 0.9));
      }
    }
  }
}

/** 水の泡（せせらぎ）。上がっていく短い正弦波をたくさん */
class BubbleField {
  constructor(s, { f, dur, rise = 1, width = 0.8 }) {
    this.s = s;
    this.f = f;
    this.dur = dur;
    this.rise = rise;
    this.width = width;
  }
  fill(o, paramsAt) {
    const { s } = this;
    const r = s.r;
    const sr = s.sr;
    const block = Math.round(sr * 0.01);
    for (let b = 0; b < o.n; b += block) {
      const p = paramsAt(o.pos + b);
      const k = poisson(r, p.rate * 0.01);
      for (let j = 0; j < k; j++) {
        const f0 = logRand(r, this.f[0] * (p.pitch ?? 1), this.f[1] * (p.pitch ?? 1));
        const d = rand(r, this.dur[0], this.dur[1]) * Math.sqrt(900 / f0);
        const a = p.gain * (0.12 + r() * r()) * Math.sqrt(1000 / f0);
        const len = Math.round(sr * d * 1.3);
        const g = new Float32Array(len);
        const kk = Math.exp(-1 / (d * 0.3 * sr));
        const atk = 0.0008 * sr;
        let ph = 0;
        let e = 1;
        for (let i = 0; i < len; i++) {
          ph += (f0 * (1 + (this.rise * i) / (sr * d))) / sr;
          if (ph >= 1) ph -= 1;
          g[i] = SIN[(ph * SIN_N) | 0] * (i < atk ? i / atk : 1) * e;
          e *= kk;
        }
        put(o, g, b + ((r() * block) | 0), a, rand(r, -this.width, this.width));
      }
    }
  }
}

/** 風（強さ strength(abs) が 0〜1 で、突風の大きさと音の高さが変わる） */
class WindLayer {
  constructor(s, { rate = 0.07, lo = 220, hi = 700, whistle = 0.12 } = {}) {
    this.s = s;
    this.gust = new Walker(s.sr, rate, s.r);
    this.gust2 = new Walker(s.sr, rate * 2.3, s.r);
    this.gustR = new Walker(s.sr, rate, s.r);
    this.lo = lo;
    this.hi = hi;
    this.whistle = whistle;
    this.ch = [0, 1].map(() => ({ p: new Pink(s.r), b: new Brown(s.r), bp: new Biquad(s.sr), bw: new Biquad(s.sr), lpr: new Biquad(s.sr).set('lp', 140, 0.7) }));
  }
  fill(o, gain, strengthAt, whistleAt = null) {
    const { s } = this;
    for (let c = 0; c < 2; c++) {
      const out = c ? o.R : o.L;
      const st = this.ch[c];
      const gw = c ? this.gustR : this.gust;
      let g = 0;
      let wh = this.whistle;
      for (let i = 0; i < o.n; i++) {
        if ((i & 31) === 0) {
          const a = o.pos + i;
          const S = strengthAt(a);
          const x = 0.55 * gw.at(a) + 0.45 * this.gust.at(a);
          g = (0.1 + 0.25 * S) + (0.35 + 0.75 * S) * x * x * (0.8 + 0.2 * this.gust2.at(a));
          st.bp.set('bp', this.lo + (this.hi - this.lo) * Math.min(1.3, g), 0.8 + 1.2 * g);
          st.bw.set('bp', 480 + 1100 * g, 14);
          if (whistleAt) wh = this.whistle * whistleAt(a);
        }
        out[i] += gain * (st.bp.run(st.p.next()) * (0.1 + g) * 1.6 + st.bw.run(s.r() * 2 - 1) * wh * g * g + st.lpr.run(st.b.next()) * 0.45 * (0.3 + g));
      }
    }
  }
}

/** 木の葉のざわめき */
class LeavesLayer {
  constructor(s, { rate = 0.12 } = {}) {
    this.s = s;
    this.gust = new Walker(s.sr, rate, s.r);
    this.ch = [0, 1].map(() => ({ hp: new Biquad(s.sr).set('hp', 1500, 0.7), lp: new Biquad(s.sr).set('lp', 8000, 0.7), b: new Brown(s.r), lpb: new Biquad(s.sr).set('lp', 400, 0.7) }));
    this.grains = new GrainField(s, { ms: [0.3, 2], f: [2000, 9000], q: [0.7, 2.5], ring: 1, bank: 64 });
  }
  fill(o, gain, strengthAt, density = 2600) {
    const gAt = (a) => {
      const g = this.gust.at(a);
      const S = strengthAt(a);
      return (0.08 + 0.12 * S) + (0.5 + 0.6 * S) * g * g;
    };
    for (let c = 0; c < 2; c++) {
      const out = c ? o.R : o.L;
      const st = this.ch[c];
      let g = 0;
      for (let i = 0; i < o.n; i++) {
        if ((i & 63) === 0) g = gAt(o.pos + i + c * 9000);
        out[i] += gain * (st.lp.run(st.hp.run(this.s.r() * 2 - 1)) * 0.22 * g + st.lpb.run(st.b.next()) * 0.25 * g);
      }
    }
    this.grains.fill(o, (a) => {
      const g = gAt(a);
      return { rate: 200 + density * g * g, gain: gain * 0.3 * g, skew: 2 };
    });
  }
}

/** 短い音（虫の声・鉛筆など）を作って書き込むための道具 */
function tone(sr, dur, f, { am = 0, amDepth = 0, glide = 0, attack = 0.01, release = 0.03, harm = 0.05 } = {}) {
  const len = Math.round(dur * sr);
  const g = new Float32Array(len);
  let ph = 0;
  let pa = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    ph += (f * (1 + glide * (t / dur))) / sr;
    if (ph >= 1) ph -= 1;
    pa += am / sr;
    if (pa >= 1) pa -= 1;
    const env = Math.min(1, t / attack) * Math.min(1, (dur - t) / release);
    const mod = amDepth ? 1 - amDepth * (0.5 - 0.5 * SIN[(((pa + 0.25) % 1) * SIN_N) | 0]) : 1;
    let ph2 = ph * 2;
    if (ph2 >= 1) ph2 -= 1;
    g[i] = (SIN[(ph * SIN_N) | 0] + harm * SIN[(ph2 * SIN_N) | 0]) * env * mod;
  }
  return g;
}

/** 絶対時刻で予定を組む出来事（その時刻がこのかたまりに入っていたら鳴らす） */
function due(o, t, sr) {
  const at = Math.round(t * sr) - o.pos;
  return at < o.n ? Math.max(0, at) : -1;
}

// ── 雨 ────────────────────────────────────────────
const RAIN = {
  light: {
    I: { center: 0.42, spread: 0.42, period: 160 },
    tone: [3800, 18000],
    bed: { hp: 700, lp: [5500, 8500], gain: [0.12, 0.45] },
    drops: { ms: [0.4, 2.5], f: [1500, 9000], q: [0.8, 3], rate: [60, 620], gain: 1.0, skew: [5.5, 4] },
    plinks: { rate: 1.4, f: [900, 2600], gain: 0.25 },
  },
  heavy: {
    I: { center: 0.5, spread: 0.42, period: 150 },
    tone: [4500, 18000],
    bed: { hp: 250, lp: [7000, 9500], gain: [0.7, 1.25] },
    drops: { ms: [0.3, 2], f: [800, 8000], q: [0.7, 2], rate: [700, 1800], gain: 0.5, skew: [3.5, 2.6] },
    rumble: [0.25, 0.6],
  },
  window: {
    I: { center: 0.45, spread: 0.42, period: 150 },
    tone: [2600, 9000],
    bed: { hp: 150, lp: [1300, 2400], gain: [0.45, 0.95], steep: true },
    drops: { ms: [0.3, 1.5], f: [1800, 4500], q: [5, 12], ring: 8, rate: [30, 170], gain: 0.8, skew: [3.5, 2.8], gusty: true },
    plinks: { rate: 0.5, f: [600, 1400], gain: 0.3 },
    rumble: [0.12, 0.3],
  },
  roof: {
    I: { center: 0.45, spread: 0.42, period: 150 },
    tone: [4000, 18000],
    bed: { hp: 400, lp: [4500, 7000], gain: [0.2, 0.5] },
    drops: { ms: [0.3, 1.5], f: [1500, 6000], q: [1, 3], rate: [50, 200], gain: 0.5, skew: [4, 3] },
    metal: { f: [1100, 3400], rate: [25, 130], gain: 0.35 },
    gutter: 0.45,
  },
  distant: {
    I: { center: 0.5, spread: 0.42, period: 180 },
    bed: { hp: 300, lp: [2500, 4000], gain: [0.3, 0.75], steep: true },
    rumble: [0.3, 0.5],
  },
};

class RainStream extends Stream {
  constructor(sr, seed, opts, variant) {
    super(sr, seed, opts);
    const V = RAIN[variant];
    this.V = V;
    this.I = this.drift(V.I);
    this.B = this.drift({ center: 0.5, spread: 0.45, period: 210 });
    // ザーという音と、ぽつぽつした粒のどちらが前に出るか
    this.mix = this.drift({ center: 0.5, spread: 0.5, period: 190 });
    if (V.tone) this.useTone({ center: 0.55, spread: 0.5, period: 230 }, V.tone[0], V.tone[1]);
    this.gust = new Walker(sr, V.drops?.gusty ? 1 / 9 : 1 / 20, this.r);
    if (V.bed) this.bed = new NoiseBed(this, 'pink', { hp: V.bed.hp, lp: V.bed.lp[1], steep: V.bed.steep });
    if (V.drops) this.drops = new GrainField(this, V.drops);
    if (V.metal) this.metal = new GrainField(this, { f: V.metal.f, metal: true, bank: 40 });
    if (V.rumble) this.rumble = new NoiseBed(this, 'brown', { lp: 160 });
    this.flutter = new Walker(sr, 0.25, this.r);
    this.nextPlink = 0;
    this.nextGutter = rand(this.r, 0, 1);
    this.gutterF = rand(this.r, 650, 900);
    this.gutterPan = rand(this.r, -0.5, 0.5);
  }
  intensity(a) {
    // 長い波（Drift）に、十数秒ごとの「ざっと強まる」揺れを重ねる
    return clamp01(this.I.at(a) + (this.gust.at(a) - 0.5) * 0.3 * Math.max(0.3, this.v));
  }
  fill(o) {
    const V = this.V;
    const sr = this.sr;
    if (this.bed) this.bed.fill(o, (a) => lerp(V.bed.gain[0], V.bed.gain[1], this.intensity(a)) * (0.88 + 0.24 * this.flutter.at(a)) * lerp(1.35, 0.7, this.mix.at(a)), (a) => lerp(V.bed.lp[0], V.bed.lp[1], this.B.at(a)));
    if (this.drops) {
      const D = V.drops;
      this.drops.fill(o, (a) => {
        const i = this.intensity(a);
        let rate = lerp(D.rate[0], D.rate[1], Math.pow(i, 1.3));
        if (D.gusty) {
          const g = this.gust.at(a);
          rate *= 0.3 + 1.4 * g * g;
        }
        rate *= lerp(0.55, 1.5, this.mix.at(a));
        return { rate, gain: D.gain, skew: lerp(D.skew[0], D.skew[1], i) };
      });
    }
    if (this.metal) {
      const M = V.metal;
      this.metal.fill(o, (a) => ({ rate: lerp(M.rate[0], M.rate[1], this.intensity(a)), gain: M.gain, skew: 3, width: 0.8 }));
    }
    if (this.rumble) this.rumble.fill(o, (a) => lerp(V.rumble[0], V.rumble[1], this.intensity(a)));
    if (V.plinks) {
      const P = V.plinks;
      const end = (o.pos + o.n) / sr;
      if (!this.nextPlink) this.nextPlink = o.pos / sr + rand(this.r, 0, 2 / P.rate);
      while (this.nextPlink < end) {
        const at = due(o, this.nextPlink, sr);
        const g = bubble(sr, logRand(this.r, P.f[0], P.f[1]), rand(this.r, 0.012, 0.035), rand(this.r, 0.6, 1.6));
        put(o, g, at, P.gain * rand(this.r, 0.3, 1), rand(this.r, -0.7, 0.7));
        // 雨が弱いときほど、近くのしずくが目立つ
        const rate = P.rate * (1.3 - 0.6 * this.intensity(Math.round(this.nextPlink * sr)));
        this.nextPlink += -Math.log(1 - this.r()) / rate;
      }
    }
    if (V.gutter) {
      const end = (o.pos + o.n) / sr;
      while (this.nextGutter < end) {
        const at = due(o, this.nextGutter, sr);
        put(o, bubble(sr, this.gutterF * rand(this.r, 0.97, 1.03), 0.03, 1.4), at, V.gutter * rand(this.r, 0.7, 1), this.gutterPan);
        const i = this.intensity(Math.round(this.nextGutter * sr));
        this.nextGutter += lerp(1.7, 0.75, i) * rand(this.r, 0.85, 1.15);
      }
    }
  }
}

// ── 風・森・山 ────────────────────────────────────
class WindStream extends Stream {
  constructor(sr, seed, opts) {
    super(sr, seed, opts);
    this.S = this.drift({ center: 0.45, spread: 0.45, period: 170 });
    this.W = this.drift({ center: 0.5, spread: 0.5, period: 230 });
    this.wind = new WindLayer(this);
  }
  fill(o) {
    this.wind.fill(o, 1, (a) => this.S.at(a), (a) => 0.4 + 1.2 * this.W.at(a));
  }
}

class LeavesStream extends Stream {
  constructor(sr, seed, opts) {
    super(sr, seed, opts);
    this.S = this.drift({ center: 0.45, spread: 0.45, period: 160 });
    this.useTone({ center: 0.6, spread: 0.4, period: 220 }, 4500, 18000);
    this.leaves = new LeavesLayer(this);
  }
  fill(o) {
    this.leaves.fill(o, 1, (a) => this.S.at(a));
  }
}

class ForestStream extends Stream {
  constructor(sr, seed, opts, kind) {
    super(sr, seed, opts);
    this.kind = kind;
    this.S = this.drift({ center: 0.4, spread: 0.45, period: 180 });
    this.F = this.drift({ center: 0.5, spread: 0.4, period: 200 });
    this.useTone({ center: 0.6, spread: 0.4, period: 230 }, 4000, 18000);
    this.leaves = new LeavesLayer(this);
    this.wind = new WindLayer(this, kind === 'mountain' ? { rate: 0.05, lo: 180, hi: 500, whistle: 0.05 } : { rate: 0.05, lo: 250, hi: 600, whistle: 0.03 });
    if (kind === 'mountain') this.bubbles = new BubbleField(this, { f: [400, 2000], dur: [0.004, 0.016], rise: 1.1 });
  }
  fill(o) {
    const S = (a) => this.S.at(a);
    if (this.kind === 'forest') {
      this.leaves.fill(o, 0.6, S, 1200);
      this.wind.fill(o, 0.25, S);
    } else if (this.kind === 'mountain') {
      this.wind.fill(o, 0.5, S);
      this.leaves.fill(o, 0.35, S, 800);
      this.bubbles.fill(o, (a) => ({ rate: 120, gain: 0.08 * (0.6 + 0.8 * this.F.at(a)) }));
    } else {
      this.wind.fill(o, 0.6, S);
      this.leaves.fill(o, 0.3, S, 600);
    }
  }
}

// ── 水 ────────────────────────────────────────────
const WATER = {
  stream: { flow: [0.1, 0.36], hp: 300, lp: 2600, bub: { rate: [170, 540], f: [300, 2400], dur: [0.004, 0.02], rise: 1.2, gain: 0.55 } },
  river: { flow: [0.4, 0.85], hp: 120, lp: 3200, rumble: [0.22, 0.5], bub: { rate: [400, 900], f: [200, 1600], dur: [0.006, 0.03], rise: 0.9, gain: 0.4 } },
  trickle: { flow: [0.03, 0.07], hp: 900, lp: 5000, bub: { rate: [60, 160], f: [700, 3200], dur: [0.003, 0.012], rise: 1.4, gain: 0.5, width: 0.4 } },
};

class WaterStream extends Stream {
  constructor(sr, seed, opts, kind) {
    super(sr, seed, opts);
    const W = WATER[kind];
    this.W = W;
    this.F = this.drift({ center: 0.5, spread: 0.45, period: 190 });
    this.P = this.drift({ center: 0.5, spread: 0.45, period: 260 });
    this.useTone({ center: 0.6, spread: 0.45, period: 220 }, 3000, 18000);
    this.ripple = new Walker(sr, 0.5, this.r);
    this.bed = new NoiseBed(this, 'pink', { hp: W.hp, lp: W.lp });
    if (W.rumble) this.rumble = new NoiseBed(this, 'brown', { lp: 280 });
    this.bub = new BubbleField(this, W.bub);
  }
  fill(o) {
    const W = this.W;
    const flow = (a) => clamp01(this.F.at(a) + (this.ripple.at(a) - 0.5) * 0.25);
    this.bed.fill(o, (a) => lerp(W.flow[0], W.flow[1], flow(a)));
    if (this.rumble) this.rumble.fill(o, (a) => lerp(W.rumble[0], W.rumble[1], this.F.at(a)));
    this.bub.fill(o, (a) => ({ rate: lerp(W.bub.rate[0], W.bub.rate[1], flow(a)), gain: W.bub.gain, pitch: lerp(0.8, 1.2, this.P.at(a)) }));
  }
}

class WaterfallStream extends Stream {
  constructor(sr, seed, opts) {
    super(sr, seed, opts);
    this.S = this.drift({ center: 0.5, spread: 0.3, period: 200 });
    this.B = this.drift({ center: 0.5, spread: 0.4, period: 240 });
    this.bed = new NoiseBed(this, 'pink', { hp: 50, lp: 6500 });
    this.hiss = new NoiseBed(this, 'white', { hp: 2000, lp: 9000 });
    this.rumble = new NoiseBed(this, 'brown', { lp: 250 });
    this.flutter = new Walker(sr, 0.6, this.r);
  }
  fill(o) {
    this.bed.fill(o, (a) => lerp(0.75, 0.95, this.S.at(a)) * (0.94 + 0.12 * this.flutter.at(a)), (a) => lerp(4500, 8000, this.B.at(a)));
    this.hiss.fill(o, (a) => lerp(0.03, 0.08, this.B.at(a)));
    this.rumble.fill(o, (a) => lerp(0.45, 0.7, this.S.at(a)));
  }
}

class WavesStream extends Stream {
  constructor(sr, seed, opts) {
    super(sr, seed, opts);
    this.E = this.drift({ center: 0.45, spread: 0.45, period: 240 });
    this.waves = [];
    this.nextWave = rand(this.r, 0.5, 3);
    this.flick = new Walker(sr, 6, this.r);
    this.chans = [0, 1].map(() => ({ p: new Pink(this.r), b: new Brown(this.r), lp: new Biquad(sr), lp2: new Biquad(sr), hp: new Biquad(sr).set('hp', 2500, 0.7), lb: new Biquad(sr).set('lp', 300, 0.7) }));
  }
  _schedule(untilT) {
    while (this.nextWave < untilT) {
      const E = this.E.at(Math.round(this.nextWave * this.sr));
      const [gl, gr] = panGains(rand(this.r, -0.45, 0.45));
      this.waves.push({
        t: this.nextWave,
        I: lerp(0.5, 1.0, E) * rand(this.r, 0.75, 1.1),
        gl: gl * 1.41,
        gr: gr * 1.41,
        wash: lerp(2.0, 3.8, E) * rand(this.r, 0.85, 1.15),
        swell: rand(this.r, 0.9, 1.6),
      });
      this.nextWave += lerp(13, 6.5, E) * rand(this.r, 0.8, 1.25);
    }
  }
  fill(o) {
    const sr = this.sr;
    const t0 = o.pos / sr;
    this._schedule(t0 + o.n / sr + 10);
    this.waves = this.waves.filter((w) => t0 - w.t < 18);
    const shape = (x, w) => (x < 0 ? 0.3 * Math.exp(x / w.swell) : (0.3 + 0.7 * (1 - Math.exp(-x / 0.12))) * Math.exp(-x / w.wash));
    const cshape = (x) => (x < 0 ? 0.15 * Math.exp(x / 0.7) : Math.exp(-x / 1.3));
    const fshape = (x, w) => (x > 0.2 ? Math.exp(-(x - 0.2) / (w.wash * 0.8)) * (1 - Math.exp(-(x - 0.2) / 0.4)) : 0);
    let A = [0, 0];
    let F = 0;
    let bedG = 0.12;
    for (let i = 0; i < o.n; i++) {
      if ((i & 31) === 0) {
        const tt = (o.pos + i) / sr;
        A = [0, 0];
        F = 0;
        let cc = 0;
        for (const w of this.waves) {
          const x = tt - w.t;
          if (x < -8 || x > 16) continue;
          const s = w.I * shape(x, w);
          A[0] += s * w.gl;
          A[1] += s * w.gr;
          cc += w.I * cshape(x);
          F += w.I * fshape(x, w);
        }
        const C = Math.min(7000, 280 + 4800 * cc);
        for (const k of this.chans) {
          k.lp.set('lp', C, 0.6);
          k.lp2.set('lp', C * 1.4, 0.6);
        }
        bedG = lerp(0.08, 0.18, this.E.at(o.pos + i));
      }
      const fl = 0.6 + 0.4 * this.flick.at(o.pos + i);
      for (let c = 0; c < 2; c++) {
        const k = this.chans[c];
        const v = k.lp2.run(k.lp.run(k.p.next())) * A[c] + k.hp.run(this.r() * 2 - 1) * F * 0.12 * fl + k.lb.run(k.b.next()) * bedG;
        (c ? o.R : o.L)[i] += v;
      }
    }
  }
}

// ── 火 ────────────────────────────────────────────
class FireStream extends Stream {
  constructor(sr, seed, opts) {
    super(sr, seed, opts);
    this.I = this.drift({ center: 0.5, spread: 0.45, period: 150 });
    this.useTone({ center: 0.6, spread: 0.45, period: 200 }, 3500, 18000);
    this.roar = new NoiseBed(this, 'brown', { lp: 380 });
    this.hiss = new NoiseBed(this, 'white', { hp: 2500, lp: 8000 });
    this.f1 = new Walker(sr, 0.6, this.r);
    this.f2 = new Walker(sr, 2.5, this.r);
    this.burst = new Walker(sr, 0.25, this.r);
    this.clicks = [];
    this.pops = [];
    for (let k = 0; k < 64; k++) this.clicks.push(noiseGrain(sr, this.r, rand(this.r, 0.15, 1), rand(this.r, 3000, 8000), 0.5, 0.5, 'hp'));
    for (let k = 0; k < 48; k++) this.pops.push(noiseGrain(sr, this.r, rand(this.r, 0.5, 3), logRand(this.r, 1200, 4500), rand(this.r, 2, 5), 6));
  }
  fill(o) {
    const r = this.r;
    this.roar.fill(o, (a) => lerp(0.4, 0.7, this.I.at(a)) * (0.6 + 0.4 * this.f1.at(a)));
    this.hiss.fill(o, (a) => 0.05 * (0.4 + 0.6 * this.f2.at(a)));
    const block = Math.round(this.sr * 0.01);
    for (let b = 0; b < o.n; b += block) {
      const a = o.pos + b;
      const bu = this.burst.at(a);
      const k = poisson(r, (lerp(2.5, 7, this.I.at(a)) + 45 * bu * bu * bu) * 0.01);
      for (let j = 0; j < k; j++) {
        const pos = b + ((r() * block) | 0);
        const pan = rand(r, -0.6, 0.6);
        if (r() < 0.03) {
          const m = 4 + ((r() * 6) | 0);
          for (let q = 0; q < m; q++) put(o, pick(r, this.clicks), pos + Math.round(r() * this.sr * 0.06), rand(r, 0.1, 0.5), pan);
        } else if (r() < 0.7) {
          put(o, pick(r, this.clicks), pos, 0.15 + Math.pow(r(), 4) * 0.9, pan);
        } else {
          put(o, pick(r, this.pops), pos, 0.2 + Math.pow(r(), 5), pan);
        }
      }
    }
  }
}

// ── 虫・カエル ────────────────────────────────────
class InsectsStream extends Stream {
  constructor(sr, seed, opts) {
    super(sr, seed, opts);
    this.A = this.drift({ center: 0.6, spread: 0.4, period: 200 });
    this.useTone({ center: 0.6, spread: 0.4, period: 240 }, 5000, 18000);
    this.insects = [];
    for (let k = 0; k < 4; k++) this.insects.push(this._newInsect('suzu'));
    for (let k = 0; k < 3; k++) this.insects.push(this._newInsect('enma'));
    this.chorus = Array.from({ length: 4 }, () => ({ f: rand(this.r, 3300, 5500), g: rand(this.r, 0.03, 0.07), pan: rand(this.r, -1, 1), ph: 0, pa: 0, am: rand(this.r, 12, 25), w: new Walker(sr, 0.05, this.r) }));
    this.night = new NoiseBed(this, 'brown', { lp: 250 });
  }
  _newInsect(kind, startT = 0) {
    const r = this.r;
    return kind === 'suzu'
      ? { kind, f: rand(r, 3900, 4600), pan: rand(r, -0.8, 0.8), g: rand(r, 0.35, 1), per: rand(r, 0.9, 1.5), next: startT + rand(r, 0, 2), restUntil: 0 }
      : { kind, f: rand(r, 4200, 5000), pan: rand(r, -0.9, 0.9), g: rand(r, 0.2, 0.7), per: rand(r, 2, 3.5), next: startT + rand(r, 0, 3), restUntil: 0 };
  }
  fill(o) {
    const sr = this.sr;
    const r = this.r;
    const end = (o.pos + o.n) / sr;
    for (const ins of this.insects) {
      while (ins.next < end) {
        const a = Math.round(ins.next * sr);
        const act = this.A.at(a);
        const at = due(o, ins.next, sr);
        if (ins.next >= ins.restUntil) {
          if (ins.kind === 'suzu') {
            put(o, tone(sr, rand(r, 0.35, 0.6), ins.f * rand(r, 0.995, 1.005), { am: rand(r, 28, 40), amDepth: 0.55, glide: -0.01, attack: 0.03, release: 0.08 }), at, ins.g * 0.4, ins.pan);
          } else {
            const n = 3 + ((r() * 4) | 0);
            for (let q = 0; q < n; q++) put(o, tone(sr, 0.035, ins.f, { attack: 0.004, release: 0.012 }), at + Math.round(q * 0.07 * sr), ins.g * 0.45, ins.pan);
            put(o, tone(sr, rand(r, 0.18, 0.32), ins.f * 0.98, { am: 45, amDepth: 0.6, attack: 0.01, release: 0.06 }), at + Math.round((n * 0.07 + 0.02) * sr), ins.g * 0.4, ins.pan);
          }
          // 静かな時間帯は鳴きやむ虫も出てくる
          if (r() < 0.04 * (1.3 - act)) ins.restUntil = ins.next + rand(r, 5, 40);
        }
        ins.next += ins.per * rand(r, 0.9, 1.15) / (0.75 + 0.5 * act);
      }
    }
    // ときどき 1 匹が入れ替わる（別の場所・高さの虫）
    if (r() < (o.n / sr) / 150) {
      const i = (r() * this.insects.length) | 0;
      this.insects[i] = this._newInsect(this.insects[i].kind, end);
    }
    for (const c of this.chorus) {
      const [gl, gr] = panGains(c.pan);
      for (let i = 0; i < o.n; i++) {
        c.ph += c.f / sr;
        if (c.ph >= 1) c.ph -= 1;
        c.pa += c.am / sr;
        if (c.pa >= 1) c.pa -= 1;
        let amp = 0;
        if ((i & 255) === 0) c.cur = c.g * (0.4 + 0.8 * c.w.at(o.pos + i)) * (0.5 + this.A.at(o.pos + i));
        amp = c.cur;
        const v = SIN[(c.ph * SIN_N) | 0] * (1 - 0.9 * (0.5 - 0.5 * SIN[(((c.pa + 0.25) % 1) * SIN_N) | 0])) * amp;
        o.L[i] += v * gl;
        o.R[i] += v * gr;
      }
    }
    this.night.fill(o, () => 0.02);
  }
}

class FrogsStream extends Stream {
  constructor(sr, seed, opts) {
    super(sr, seed, opts);
    this.A = this.drift({ center: 0.55, spread: 0.45, period: 180 });
    this.frogs = Array.from({ length: 9 }, () => this._newFrog(0));
    this.night = new NoiseBed(this, 'brown', { lp: 300 });
  }
  _newFrog(t) {
    const r = childRng(this.r);
    const sr = this.sr;
    const fc = rand(r, 1300, 2600);
    const pulse = rand(r, 90, 220);
    const noteDur = rand(r, 0.06, 0.14);
    const dist = rand(r, 0.15, 1);
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
        next += period * rand(r, 0.97, 1.03);
      }
      const env = Math.min(1, i / (0.008 * sr)) * Math.min(1, (n - i) / (0.3 * n));
      note[i] = (bq.run(x) + bq2.run(x) * 0.4) * env;
    }
    normPeak(note);
    if (dist < 0.5) {
      const op = new OnePole(1500, sr);
      for (let i = 0; i < n; i++) note[i] = op.lp(note[i]);
    }
    return { note, dist, pan: rand(r, -0.95, 0.95), gap: rand(r, 0.15, 0.32), next: t + rand(r, 0, 4), left: 0 };
  }
  fill(o) {
    const sr = this.sr;
    const r = this.r;
    const end = (o.pos + o.n) / sr;
    for (const f of this.frogs) {
      while (f.next < end) {
        if (f.left <= 0) {
          // 鳴き始め：にぎやかな時間帯ほど長く鳴き、休みが短い
          const act = this.A.at(Math.round(f.next * sr));
          f.left = Math.round(lerp(4, 24, act) * rand(r, 0.6, 1.2));
        }
        put(o, f.note, due(o, f.next, sr), f.dist * rand(r, 0.7, 1) * 0.5, f.pan);
        f.left--;
        f.next += f.gap * rand(r, 0.9, 1.1);
        if (f.left <= 0) {
          const act = this.A.at(Math.round(f.next * sr));
          f.next += rand(r, 1, 6) * lerp(3, 0.6, act);
        }
      }
    }
    if (r() < (o.n / sr) / 200) {
      const i = (r() * this.frogs.length) | 0;
      this.frogs[i] = this._newFrog(end);
    }
    this.night.fill(o, () => 0.02);
  }
}

// ── 喫茶店（食器の音）・作業音 ─────────────────────
class CafeClatterStream extends Stream {
  constructor(sr, seed, opts) {
    super(sr, seed, opts);
    this.busy = this.drift({ center: 0.5, spread: 0.45, period: 150 });
    this.next = rand(this.r, 0, 2);
    this.room = new NoiseBed(this, 'brown', { lp: 250 });
  }
  fill(o) {
    const sr = this.sr;
    const r = this.r;
    const end = (o.pos + o.n) / sr;
    while (this.next < end) {
      const at = due(o, this.next, sr);
      const pan = rand(r, -0.8, 0.8);
      const far = rand(r, 0.25, 1);
      if (r() < 0.3) {
        const m = 4 + ((r() * 6) | 0);
        const step = rand(r, 0.11, 0.16);
        for (let q = 0; q < m; q++) put(o, clink(sr, r, 'spoon'), at + Math.round(q * step * sr), 0.08 * far, pan);
      } else {
        put(o, clink(sr, r, 'cup'), at, rand(r, 0.12, 0.35) * far, pan);
        if (r() < 0.35) put(o, clink(sr, r, 'cup'), at + Math.round(rand(r, 0.08, 0.3) * sr), rand(r, 0.05, 0.15) * far, pan);
      }
      const busy = this.busy.at(Math.round(this.next * sr));
      this.next += rand(r, 0.6, 3.5) * lerp(2.2, 0.6, busy);
    }
    this.room.fill(o, () => 0.04);
  }
}

class PencilStream extends Stream {
  constructor(sr, seed, opts) {
    super(sr, seed, opts);
    this.A = this.drift({ center: 0.55, spread: 0.45, period: 140 });
    this.next = rand(this.r, 0, 1);
    this.burstEnd = this.next + rand(this.r, 3, 10);
    this.inChar = 0;
    this.bp = new Biquad(sr);
    this.hp = new Biquad(sr).set('hp', 2200, 0.7);
    this.rough = new OnePole(400, sr);
    this.pan = rand(this.r, -0.15, 0.15);
    this.desk = new NoiseBed(this, 'brown', { lp: 200 });
  }
  _stroke() {
    const sr = this.sr;
    const r = this.r;
    const len = rand(r, 0.05, 0.22);
    const n = Math.round(len * sr);
    const g = new Float32Array(n);
    this.bp.set('bp', rand(r, 3000, 6000), 1.2);
    const amp = rand(r, 0.4, 1);
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const env = Math.pow(Math.sin(Math.PI * x), 0.7);
      const rg = 0.6 + 3.2 * Math.abs(this.rough.lp(r() * 2 - 1));
      g[i] = this.bp.run(this.hp.run(r() * 2 - 1)) * env * rg * amp + (i < sr * 0.001 ? (r() * 2 - 1) * 0.3 * amp : 0);
    }
    return { g, len };
  }
  fill(o) {
    const sr = this.sr;
    const r = this.r;
    const end = (o.pos + o.n) / sr;
    while (this.next < end) {
      const act = this.A.at(Math.round(this.next * sr));
      if (this.next >= this.burstEnd) {
        // 考える時間（手が止まる）。集中が乗っている時間帯は短い
        this.next += rand(r, 1, 4) * lerp(2.5, 0.6, act);
        this.burstEnd = this.next + rand(r, 3, 10) * lerp(0.6, 1.6, act);
        continue;
      }
      const { g, len } = this._stroke();
      put(o, g, due(o, this.next, sr), 1, this.pan);
      this.next += len + rand(r, 0.03, 0.12) * lerp(1.4, 0.8, act);
      if (++this.inChar > 4 + r() * 8) {
        this.inChar = 0;
        this.next += rand(r, 0.15, 0.45);
      }
    }
    this.desk.fill(o, () => 0.01);
  }
}

class KeyboardStream extends Stream {
  constructor(sr, seed, opts) {
    super(sr, seed, opts);
    this.A = this.drift({ center: 0.55, spread: 0.45, period: 140 });
    this.keys = Array.from({ length: 30 }, () => keyClick(sr, this.r, 'key'));
    this.space = [keyClick(sr, this.r, 'space'), keyClick(sr, this.r, 'space')];
    this.enter = keyClick(sr, this.r, 'enter');
    this.next = rand(this.r, 0, 1);
    this.word = 0;
  }
  fill(o) {
    const sr = this.sr;
    const r = this.r;
    const end = (o.pos + o.n) / sr;
    while (this.next < end) {
      const act = this.A.at(Math.round(this.next * sr));
      const at = due(o, this.next, sr);
      if (this.word <= 0) {
        if (r() < lerp(0.25, 0.06, act)) {
          this.next += rand(r, 1.2, 5) * lerp(1.8, 0.7, act);
          this.word = 2 + ((r() * 8) | 0);
          continue;
        }
        if (r() < 0.12) {
          put(o, this.enter, at, 1, 0);
          this.next += rand(r, 0.6, 2.2);
        } else {
          put(o, pick(r, this.space), at, 0.9, 0);
          this.next += rand(r, 0.08, 0.2);
        }
        this.word = 2 + ((r() * 8) | 0);
        continue;
      }
      put(o, pick(r, this.keys), at, rand(r, 0.5, 1), rand(r, -0.1, 0.1));
      this.word--;
      this.next += Math.exp(Math.log(lerp(0.15, 0.09, act)) + 0.35 * (r() + r() + r() - 1.5));
    }
  }
}

// ── 一覧 ──────────────────────────────────────────
// norm：音量をそろえる係数（scripts/calibrate-streams.mjs で測った値）
export const STREAMS = {
  'rain-light': { make: (sr, seed, o) => new RainStream(sr, seed, o, 'light'), norm: 1.01 },
  'rain-heavy': { make: (sr, seed, o) => new RainStream(sr, seed, o, 'heavy'), norm: 0.728 },
  'rain-window': { make: (sr, seed, o) => new RainStream(sr, seed, o, 'window'), norm: 0.978 },
  'rain-roof': { make: (sr, seed, o) => new RainStream(sr, seed, o, 'roof'), norm: 1.03 },
  'rain-distant': { make: (sr, seed, o) => new RainStream(sr, seed, o, 'distant'), norm: 0.409 },
  wind: { make: (sr, seed, o) => new WindStream(sr, seed, o), norm: 1.32 },
  leaves: { make: (sr, seed, o) => new LeavesStream(sr, seed, o), norm: 2.09 },
  forest: { make: (sr, seed, o) => new ForestStream(sr, seed, o, 'forest'), norm: 1.32 },
  mountain: { make: (sr, seed, o) => new ForestStream(sr, seed, o, 'mountain'), norm: 1.08 },
  breeze: { make: (sr, seed, o) => new ForestStream(sr, seed, o, 'breeze'), norm: 0.704 },
  stream: { make: (sr, seed, o) => new WaterStream(sr, seed, o, 'stream'), norm: 0.466 },
  river: { make: (sr, seed, o) => new WaterStream(sr, seed, o, 'river'), norm: 0.379 },
  trickle: { make: (sr, seed, o) => new WaterStream(sr, seed, o, 'trickle'), norm: 1.32 },
  waterfall: { make: (sr, seed, o) => new WaterfallStream(sr, seed, o), norm: 0.666 },
  waves: { make: (sr, seed, o) => new WavesStream(sr, seed, o), norm: 1.43 },
  fire: { make: (sr, seed, o) => new FireStream(sr, seed, o), norm: 0.791 },
  crickets: { make: (sr, seed, o) => new InsectsStream(sr, seed, o), norm: 0.488 },
  frogs: { make: (sr, seed, o) => new FrogsStream(sr, seed, o), norm: 1.44 },
  'cafe-clatter': { make: (sr, seed, o) => new CafeClatterStream(sr, seed, o), norm: 1.89 },
  pencil: { make: (sr, seed, o) => new PencilStream(sr, seed, o), norm: 0.972 },
  keyboard: { make: (sr, seed, o) => new KeyboardStream(sr, seed, o), norm: 0.864 },
};

/** ストリームを作る。render(n) は音量をそろえ、大きすぎる山はやわらかく抑えて返す */
export function createStream(name, sr, seed, opts = {}) {
  const def = STREAMS[name];
  if (!def) throw new Error(`unknown stream: ${name}`);
  const s = def.make(sr, seed, opts);
  const norm = def.norm;
  return {
    setVariation: (v) => s.setVariation(v),
    render(n) {
      const chs = s.render(n);
      for (const ch of chs) {
        for (let i = 0; i < ch.length; i++) {
          let v = ch[i] * norm;
          const a = Math.abs(v);
          if (a > 0.8) v = Math.sign(v) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
          ch[i] = Number.isFinite(v) ? v : 0;
        }
      }
      return chs;
    },
  };
}

// テスト用（かたまりの境目の持ち越しを直接確かめる）
export const _internal = { Stream, put };

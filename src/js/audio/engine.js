// 環境音のミキサー（Web Audio）。
// - bed：一定であってほしい音（ノイズなど）。1 回作ってループ
// - stream：雨や自然の音。続きを Worker で少しずつ作り、すき間なく並べて再生（くり返しがない）
// - asset：収録済みの音（喫茶店の話し声）。ランダムな位置へ飛びながらクロスフェードで再生
// - events：鳥・雷などの単発音。鳴る頻度もゆっくり増えたり減ったりする
// 全体の再生／停止はフェード付きの「ゲート」で行う。

import { Emitter } from '../core/util.js';
import { SOUND_MAP } from './catalog.js';
import { renderEvent } from './oneshots.js';
import { mulberry32, finalizeLoop } from './dsp-core.js';
import { getFile } from '../core/idb.js';

const dbToGain = (db) => Math.pow(10, db / 20);
const BED_CACHE_LIMIT = 8;
const CHUNK_SEC = 8;
const LEAD_SEC = 11;
const XF = 3;

const fadeCurve = (up, scale = 1) => {
  const c = new Float32Array(64);
  for (let i = 0; i < 64; i++) {
    const th = (Math.PI / 2) * (i / 63);
    c[i] = (up ? Math.sin(th) : Math.cos(th)) * scale;
  }
  return c;
};

// 響き（インパルス応答）の作り方
const REVERBS = {
  room: { dur: 1.2, decay: 4, pre: 0.008, lp: 5000 },
  hall: { dur: 2.6, decay: 3, pre: 0.02, lp: 4000 },
  forest: { dur: 1.8, decay: 3.5, pre: 0.03, lp: 6000, sparse: 0.25 },
  garden: { dur: 1.6, decay: 3.2, pre: 0.02, lp: 5500, sparse: 0.4 },
  valley: { dur: 4, decay: 2, pre: 0.06, lp: 3500, echoes: [0.38, 0.85, 1.45], sparse: 0.3 },
  outdoor: { dur: 3.5, decay: 2.2, pre: 0.04, lp: 2500 },
};

/** 壁時計で進む、なめらかな乱数（0〜1） */
class WallWalker {
  constructor(period) {
    this.period = period;
    this.k = Math.floor(performance.now() / 1000 / period);
    this.a = Math.random();
    this.b = Math.random();
  }
  at(sec = performance.now() / 1000) {
    const k = sec / this.period;
    const k0 = Math.floor(k);
    while (this.k < k0) {
      this.k++;
      this.a = this.b;
      this.b = Math.random();
    }
    const w = (1 - Math.cos(Math.PI * (k - k0))) / 2;
    return this.a + (this.b - this.a) * w;
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

// ── 流れ続ける音 ───────────────────────────────────
class StreamPlayer {
  constructor(engine, ch, name) {
    this.e = engine;
    this.ch = ch;
    this.sid = ++engine.sidSeq;
    this.queueEnd = 0;
    this.pending = false;
    this.alive = true;
    this.sources = new Set();
    engine._post({ type: 'open', sid: this.sid, name, sr: engine.ctx.sampleRate, seed: (Math.random() * 1e9) | 0, variation: engine.variation });
  }
  async pump() {
    const ctx = this.e.ctx;
    if (!this.alive || this.pending || this.queueEnd - ctx.currentTime > LEAD_SEC) return;
    this.pending = true;
    let chs;
    try {
      chs = await this.e._req({ type: 'render', sid: this.sid, frames: Math.round(CHUNK_SEC * ctx.sampleRate) });
    } catch (err) {
      this.pending = false;
      if (this.alive) throw err;
      return;
    }
    this.pending = false;
    if (!this.alive) return;
    const buf = ctx.createBuffer(2, chs[0].length, ctx.sampleRate);
    chs.forEach((c, i) => buf.copyToChannel(c, i));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ch.gain);
    // 前のかたまりの終わりにぴったり続ける（間に合わなかったときだけ今から）
    const when = this.queueEnd > ctx.currentTime + 0.02 ? this.queueEnd : ctx.currentTime + 0.05;
    src.start(when);
    this.queueEnd = when + buf.length / ctx.sampleRate;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      src.disconnect();
    };
    this.ch.ready = true;
    this.pump();
  }
  stop() {
    this.alive = false;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* noop */
      }
    }
    this.e._post({ type: 'close', sid: this.sid });
  }
}

// ── 収録済みの音（ランダムな位置へ飛びながら再生） ───────
class ShufflePlayer {
  constructor(engine, ch, buffer) {
    this.e = engine;
    this.ch = ch;
    this.buf = buffer;
    this.alive = true;
    this.nextStart = null;
    this.lastOffset = -1;
    this.sources = new Set();
  }
  pump() {
    const ctx = this.e.ctx;
    if (!this.alive) return;
    if (this.nextStart != null && this.nextStart - ctx.currentTime > 6) return;
    const first = this.nextStart == null;
    const start = first ? ctx.currentTime + 0.05 : this.nextStart;
    const total = this.buf.duration;
    const dur = Math.min(total - 1, rnd(25, 70));
    let off = 0;
    for (let tries = 0; tries < 10; tries++) {
      off = Math.random() * (total - dur);
      if (this.lastOffset < 0 || Math.abs(off - this.lastOffset) > dur * 0.6) break;
    }
    this.lastOffset = off;
    // 区切りごとに少しだけ店のにぎやかさを変える
    const level = (1 + (Math.random() - 0.5) * 0.4 * this.e.variation) * dbToGain(this.ch.def.assetGain ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.buf;
    const g = ctx.createGain();
    src.connect(g).connect(this.ch.gain);
    g.gain.setValueAtTime(0, start);
    g.gain.setValueCurveAtTime(fadeCurve(true, level), start, first ? 2 : XF);
    g.gain.setValueCurveAtTime(fadeCurve(false, level), start + dur - XF, XF);
    src.start(start, off, dur);
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      g.disconnect();
    };
    this.nextStart = start + dur - XF;
    this.ch.ready = true;
  }
  stop() {
    this.alive = false;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* noop */
      }
    }
  }
}

// ── 単発音（頻度が移り変わる・鳥は「やって来て、しばらく鳴いて、去る」） ─
class EventScheduler {
  constructor(engine, ch, ev) {
    this.e = engine;
    this.ch = ch;
    this.ev = ev;
    this.act = new WallWalker(ev.period ?? 150);
    this.visitors = [];
    this.nextArrival = 0;
    const now = performance.now() / 1000;
    const [a] = ev.every ?? [5];
    this.nextT = now + a * 0.3 + Math.random() * a;
  }
  /** 0（静か）〜1（にぎやか）。移り変わりが「一定」なら 0.5 */
  activity(now) {
    return Math.min(1, Math.max(0, 0.5 + (this.act.at(now) - 0.5) * 1.4 * this.e.variation));
  }
  tick(playing) {
    const now = performance.now() / 1000;
    const ev = this.ev;
    if (ev.visitors) return this._visitors(now, playing);
    if (now < this.nextT) return;
    if (playing) this.e._fire(this.ch, ev);
    const [a, b] = ev.every;
    let wait = rnd(a, b);
    if (!ev.steady) wait /= 0.35 + 1.3 * this.activity(now);
    this.nextT = now + wait;
  }
  _visitors(now, playing) {
    const V = this.ev.visitors;
    const act = this.activity(now);
    this.visitors = this.visitors.filter((v) => now < v.leaveAt);
    const want = Math.round(V.count[0] + (V.count[1] - V.count[0]) * act);
    if (this.visitors.length < want && now >= this.nextArrival) {
      this.visitors.push({
        seed: (Math.random() * 1e9) | 0,
        pan: rnd(-0.9, 0.9),
        far: Math.random() < 0.45,
        leaveAt: now + rnd(V.stay[0], V.stay[1]),
        next: now + rnd(0.5, V.repeat[0]),
        every: rnd(V.repeat[0], V.repeat[1]),
      });
      this.nextArrival = now + rnd(V.gap[0], V.gap[1]);
    }
    for (const v of this.visitors) {
      if (now < v.next) continue;
      if (playing) this.e._fire(this.ch, this.ev, { seed: v.seed + (Math.random() < 0.25 ? 1 : 0), pan: v.pan, far: v.far });
      v.next = now + v.every * rnd(0.7, 1.4);
    }
  }
}

export class SoundEngine extends Emitter {
  constructor() {
    super();
    this.ctx = null;
    this.channels = new Map();
    this.bedCache = new Map();
    this.bedPending = new Map();
    this.customCache = new Map();
    this.assetCache = new Map();
    this.reverbs = new Map();
    this.custom = new Map(); // id -> { id, name, fileKey }
    this.gateOpen = false;
    this.masterVol = 0.7;
    this.variation = 1;
    this.rng = mulberry32((Math.random() * 1e9) | 0);
    this.seed = (Math.random() * 1e9) | 0;
    this.worker = null;
    this.reqId = 0;
    this.sidSeq = 0;
    this.reqs = new Map();
  }

  // ── 初期化 ──────────────────────────────────────────
  ensure() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.gate = ctx.createGain();
    this.gate.gain.value = 0;
    this.master = ctx.createGain();
    this.master.gain.value = this._masterGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 10;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.3;
    this.bus.connect(this.gate).connect(this.master).connect(this.limiter).connect(ctx.destination);
    // 流れ続ける音の補充と、単発音の予定を回す
    setInterval(() => this._pumpAll(), 500);
    return ctx;
  }

  _pumpAll() {
    const playing = this.gateOpen && this.ctx.state === 'running';
    for (const ch of this.channels.values()) {
      ch.stream?.pump().catch((err) => this._failed(ch, err));
      ch.shuffle?.pump();
      for (const s of ch.events) s.tick(playing);
    }
  }

  _masterGain() {
    return Math.pow(this.masterVol, 2) * 1.6;
  }

  setMaster(v) {
    this.masterVol = v;
    if (this.master) this.master.gain.setTargetAtTime(this._masterGain(), this.ctx.currentTime, 0.05);
  }

  /** 音の移り変わりの大きさ（0 = 一定 〜 1.6 = 大きめ） */
  setVariation(v) {
    this.variation = v;
    if (this.worker) this._post({ type: 'variation', value: v });
  }

  _getWorker() {
    if (this.worker !== null) return this.worker;
    try {
      this.worker = new Worker(new URL('./sound-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const req = this.reqs.get(e.data.id);
        if (!req) return;
        this.reqs.delete(e.data.id);
        if (e.data.error) req.reject(new Error(e.data.error));
        else req.resolve(e.data.chs);
      };
      this.worker.onerror = (e) => console.warn('sound worker error', e.message);
    } catch (err) {
      console.error('Worker を作れませんでした', err);
      this.worker = false;
    }
    return this.worker;
  }

  _post(msg) {
    const w = this._getWorker();
    if (w) w.postMessage(msg);
  }

  _req(msg) {
    const w = this._getWorker();
    if (!w) return Promise.reject(new Error('Worker が使えません'));
    const id = ++this.reqId;
    return new Promise((resolve, reject) => {
      this.reqs.set(id, { resolve, reject });
      w.postMessage({ ...msg, id });
    });
  }

  async _bed(name) {
    if (this.bedCache.has(name)) {
      const buf = this.bedCache.get(name);
      this.bedCache.delete(name);
      this.bedCache.set(name, buf); // 最近使ったものを後ろへ
      return buf;
    }
    if (this.bedPending.has(name)) return this.bedPending.get(name);
    const p = (async () => {
      const ctx = this.ensure();
      const chs = await this._req({ type: 'bed', name, sr: ctx.sampleRate, seed: this.seed + name.length * 7919 });
      const buf = ctx.createBuffer(chs.length, chs[0].length, ctx.sampleRate);
      chs.forEach((c, i) => buf.copyToChannel(c, i));
      this.bedCache.set(name, buf);
      this._trimCache();
      return buf;
    })();
    this.bedPending.set(name, p);
    try {
      return await p;
    } finally {
      this.bedPending.delete(name);
    }
  }

  _trimCache() {
    const inUse = new Set([...this.channels.values()].map((c) => c.def.bed).filter(Boolean));
    for (const key of [...this.bedCache.keys()]) {
      if (this.bedCache.size <= BED_CACHE_LIMIT) break;
      if (!inUse.has(key)) this.bedCache.delete(key);
    }
  }

  async _asset(path) {
    if (this.assetCache.has(path)) return this.assetCache.get(path);
    const p = (async () => {
      const ctx = this.ensure();
      const res = await fetch(new URL(`../../assets/${path}`, import.meta.url));
      if (!res.ok) throw new Error(`${path} を読み込めません（${res.status}）`);
      return ctx.decodeAudioData(await res.arrayBuffer());
    })();
    this.assetCache.set(path, p);
    try {
      return await p;
    } catch (err) {
      this.assetCache.delete(path);
      throw err;
    }
  }

  _reverb(type) {
    if (this.reverbs.has(type)) return this.reverbs.get(type);
    const ctx = this.ctx;
    const o = REVERBS[type] ?? REVERBS.room;
    const sr = ctx.sampleRate;
    const n = Math.round(o.dur * sr);
    const ir = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = new Float32Array(n);
      const k = 1 - Math.exp((-2 * Math.PI * o.lp) / sr);
      let y = 0;
      const pre = Math.round(o.pre * sr);
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / n;
        let x = Math.random() * 2 - 1;
        if (o.sparse && Math.random() < o.sparse) x *= 0.1;
        y += k * (x - y);
        d[i] = y * Math.exp(-o.decay * t * 3) * (1 - t);
      }
      for (const e of o.echoes ?? []) {
        const at = Math.round(e * sr) + (c ? 37 : 0);
        for (let i = 0; i < 2000 && at + i < n; i++) d[at + i] += (Math.random() * 2 - 1) * Math.exp(-i / 300) * 0.5 * Math.exp(-e);
      }
      ir.copyToChannel(d, c);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const out = ctx.createGain();
    out.gain.value = 0.8;
    conv.connect(out).connect(this.bus);
    this.reverbs.set(type, conv);
    return conv;
  }

  // ── 自分の音源 ─────────────────────────────────────
  setCustomList(list) {
    this.custom = new Map(list.map((x) => [x.id, x]));
  }

  defOf(id) {
    if (SOUND_MAP[id]) return SOUND_MAP[id];
    const c = this.custom.get(id);
    if (c) return { id, cat: 'custom', name: c.name, icon: '🎵', customKey: c.fileKey, gain: c.gain ?? 0 };
    return null;
  }

  async _customBuffer(def) {
    if (this.customCache.has(def.customKey)) return this.customCache.get(def.customKey);
    const blob = await getFile(def.customKey);
    if (!blob) throw new Error('音源ファイルが見つかりません');
    const ctx = this.ensure();
    const raw = await ctx.decodeAudioData(await blob.arrayBuffer());
    // 長さがあれば最後の 1 秒を先頭へ重ねて、つなぎ目を目立たなくする
    let buf = raw;
    const f = Math.round(Math.min(1, raw.duration / 6) * raw.sampleRate);
    if (raw.duration > 4 && f > 0) {
      const n = raw.length - f;
      const chs = [];
      for (let c = 0; c < raw.numberOfChannels; c++) chs.push(raw.getChannelData(c));
      const looped = finalizeLoop(chs, n, f);
      buf = ctx.createBuffer(raw.numberOfChannels, n, raw.sampleRate);
      looped.forEach((d, c) => buf.copyToChannel(d, c));
    }
    this.customCache.set(def.customKey, buf);
    return buf;
  }

  // ── ミックス ───────────────────────────────────────
  /** mix: { soundId: 0〜1 } */
  setMix(mix) {
    this.ensure();
    const want = new Map(Object.entries(mix).filter(([id, v]) => v > 0 && this.defOf(id)));
    for (const id of [...this.channels.keys()]) if (!want.has(id)) this._remove(id);
    for (const [id, v] of want) {
      const ch = this.channels.get(id);
      if (ch) this._setVol(ch, v);
      else this._add(id, v);
    }
  }

  _chGain(ch) {
    return Math.pow(ch.vol, 2) * dbToGain(ch.def.gain ?? 0) * 2.2;
  }

  _setVol(ch, v) {
    ch.vol = v;
    ch.gain.gain.setTargetAtTime(this._chGain(ch), this.ctx.currentTime, 0.08);
  }

  async _add(id, vol) {
    const ctx = this.ensure();
    const def = this.defOf(id);
    const ch = { id, def, vol, alive: true, ready: false, sources: [], events: [], stream: null, shuffle: null, gain: ctx.createGain(), send: null };
    ch.gain.gain.value = 0;
    ch.gain.connect(this.bus);
    if (def.reverb) {
      ch.send = ctx.createGain();
      ch.send.gain.value = def.reverb.wet;
      ch.gain.connect(ch.send);
      ch.send.connect(this._reverb(def.reverb.type));
    }
    this.channels.set(id, ch);
    this.emit('loading', id);
    try {
      let buf = null;
      if (def.bed) buf = await this._bed(def.bed);
      else if (def.customKey) buf = await this._customBuffer(def);
      if (!ch.alive) return;
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(ch.gain);
        src.start(0, Math.random() * buf.duration);
        ch.sources.push(src);
        ch.ready = true;
      }
      if (def.asset) {
        // 収録済みの音は読み込み（デコード）に数秒かかることがあるので、ほかの音を待たせない
        this._asset(def.asset)
          .then((abuf) => {
            if (!ch.alive) return;
            ch.shuffle = new ShufflePlayer(this, ch, abuf);
            ch.shuffle.pump();
          })
          .catch((err) => this._failed(ch, err));
      }
      if (def.stream) {
        ch.stream = new StreamPlayer(this, ch, def.stream);
        await ch.stream.pump();
        if (!ch.alive) return;
      }
      if (def.live?.kind === 'binaural') {
        const merger = ctx.createChannelMerger(2);
        const g = ctx.createGain();
        g.gain.value = 0.22;
        [def.live.carrier, def.live.carrier + def.live.beat].forEach((f, i) => {
          const o = ctx.createOscillator();
          o.frequency.value = f;
          o.connect(merger, 0, i);
          o.start();
          ch.sources.push(o);
        });
        merger.connect(g).connect(ch.gain);
        ch.ready = true;
      }
      ch.events = (def.events ?? []).map((ev) => new EventScheduler(this, ch, ev));
      ch.ready = true;
      ch.gain.gain.setTargetAtTime(this._chGain(ch), ctx.currentTime, 0.5);
      this.emit('loaded', id);
    } catch (err) {
      this._failed(ch, err);
    }
  }

  _failed(ch, err) {
    if (!ch.alive) return;
    console.error('sound load failed', ch.id, err);
    this.emit('error', { id: ch.id, message: String(err.message || err) });
    this._remove(ch.id);
  }

  _fire(ch, ev, opts = {}) {
    const ctx = this.ctx;
    const { L, R } = renderEvent(ev.name, ctx.sampleRate, this.rng, opts);
    const buf = ctx.createBuffer(2, L.length, ctx.sampleRate);
    buf.copyToChannel(L, 0);
    buf.copyToChannel(R, 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = dbToGain((ev.gain ?? 0) + 6);
    src.connect(g).connect(ch.gain);
    src.onended = () => g.disconnect();
    src.start();
  }

  _remove(id) {
    const ch = this.channels.get(id);
    if (!ch) return;
    ch.alive = false;
    this.channels.delete(id);
    ch.events = [];
    const now = this.ctx.currentTime;
    ch.gain.gain.cancelScheduledValues(now);
    ch.gain.gain.setValueAtTime(ch.gain.gain.value, now);
    ch.gain.gain.linearRampToValueAtTime(0, now + 0.6);
    setTimeout(() => {
      for (const s of ch.sources) {
        try {
          s.stop();
        } catch {
          /* 既に止まっている */
        }
      }
      ch.stream?.stop();
      ch.shuffle?.stop();
      ch.gain.disconnect();
      ch.send?.disconnect();
    }, 800);
    this.emit('removed', id);
  }

  isLoading(id) {
    const ch = this.channels.get(id);
    return !!ch && !ch.ready;
  }

  // ── 全体の再生・停止 ────────────────────────────────
  async setPlaying(on, fadeSec = 2) {
    const ctx = this.ensure();
    this.gateOpen = on;
    clearTimeout(this._suspendTimer);
    if (on && ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch (err) {
        console.warn('resume failed', err);
      }
    }
    const g = this.gate.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(on ? 1 : 0, now + Math.max(0.05, fadeSec));
    if (!on) {
      // 鳴っていない間は CPU を使わないように止める
      this._suspendTimer = setTimeout(() => {
        if (!this.gateOpen) ctx.suspend().catch(() => {});
      }, (fadeSec + 0.5) * 1000);
    }
    this.emit('playing', on);
  }

  get playing() {
    return this.gateOpen;
  }
}

// 環境音のミキサー（Web Audio）。ループ素材は Worker で作ってキャッシュし、
// 単発音はタイマーでランダムな間隔に鳴らす。全体の再生／停止はフェード付きの「ゲート」で行う。

import { Emitter } from '../core/util.js';
import { SOUND_MAP } from './catalog.js';
import { renderEvent } from './oneshots.js';
import { mulberry32, finalizeLoop } from './dsp-core.js';
import { getFile } from '../core/idb.js';

const dbToGain = (db) => Math.pow(10, db / 20);
const BED_CACHE_LIMIT = 8;

// 響き（インパルス応答）の作り方
const REVERBS = {
  room: { dur: 1.2, decay: 4, pre: 0.008, lp: 5000 },
  hall: { dur: 2.6, decay: 3, pre: 0.02, lp: 4000 },
  forest: { dur: 1.8, decay: 3.5, pre: 0.03, lp: 6000, sparse: 0.25 },
  garden: { dur: 1.6, decay: 3.2, pre: 0.02, lp: 5500, sparse: 0.4 },
  valley: { dur: 4, decay: 2, pre: 0.06, lp: 3500, echoes: [0.38, 0.85, 1.45], sparse: 0.3 },
  outdoor: { dur: 3.5, decay: 2.2, pre: 0.04, lp: 2500 },
};

export class SoundEngine extends Emitter {
  constructor() {
    super();
    this.ctx = null;
    this.channels = new Map();
    this.bedCache = new Map();
    this.bedPending = new Map();
    this.customCache = new Map();
    this.reverbs = new Map();
    this.custom = new Map(); // id -> { id, name, fileKey }
    this.gateOpen = false;
    this.masterVol = 0.7;
    this.rng = mulberry32((Math.random() * 1e9) | 0);
    this.seed = (Math.random() * 1e9) | 0;
    this.worker = null;
    this.reqId = 0;
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
    return ctx;
  }

  _masterGain() {
    return Math.pow(this.masterVol, 2) * 1.6;
  }

  setMaster(v) {
    this.masterVol = v;
    if (this.master) this.master.gain.setTargetAtTime(this._masterGain(), this.ctx.currentTime, 0.05);
  }

  _getWorker() {
    if (this.worker !== null) return this.worker;
    try {
      this.worker = new Worker(new URL('./bed-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const req = this.reqs.get(e.data.id);
        if (!req) return;
        this.reqs.delete(e.data.id);
        if (e.data.error) req.reject(new Error(e.data.error));
        else req.resolve(e.data.chs);
      };
      this.worker.onerror = (e) => {
        console.warn('bed worker error', e.message);
      };
    } catch (err) {
      console.warn('Worker が使えないのでメインスレッドで生成します', err);
      this.worker = false;
    }
    return this.worker;
  }

  async _generate(name, sr) {
    const w = this._getWorker();
    if (w) {
      const id = ++this.reqId;
      return new Promise((resolve, reject) => {
        this.reqs.set(id, { resolve, reject });
        w.postMessage({ id, name, sr, seed: this.seed + name.length * 7919 });
      });
    }
    const { generateBed } = await import('./beds.js');
    return generateBed(name, sr, this.seed);
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
      const chs = await this._generate(name, ctx.sampleRate);
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
    const ch = { id, def, vol, alive: true, sources: [], timers: new Map(), gain: ctx.createGain(), send: null };
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
      }
      (def.events ?? []).forEach((ev, i) => this._schedule(ch, ev, i, true));
      ch.gain.gain.setTargetAtTime(this._chGain(ch), ctx.currentTime, 0.5);
      this.emit('loaded', id);
    } catch (err) {
      console.error('sound load failed', id, err);
      this.emit('error', { id, message: String(err.message || err) });
      this._remove(id);
    }
  }

  _schedule(ch, ev, key, first) {
    const [a, b] = ev.every;
    const wait = first ? a * 0.3 + Math.random() * a : a + Math.random() * (b - a);
    const t = setTimeout(() => {
      if (!ch.alive) return;
      if (this.gateOpen && this.ctx.state === 'running') this._fire(ch, ev);
      this._schedule(ch, ev, key, false);
    }, wait * 1000);
    ch.timers.set(key, t);
  }

  _fire(ch, ev) {
    const ctx = this.ctx;
    const { L, R } = renderEvent(ev.name, ctx.sampleRate, this.rng);
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
    for (const t of ch.timers.values()) clearTimeout(t);
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
      ch.gain.disconnect();
      ch.send?.disconnect();
    }, 800);
    this.emit('removed', id);
  }

  isLoading(id) {
    const ch = this.channels.get(id);
    return !!ch && ch.sources.length === 0 && !ch.def.events?.length;
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

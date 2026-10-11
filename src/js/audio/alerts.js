// 通知音・秒針の音・読み上げ。環境音とは別の AudioContext を使う
// （環境音を止めているときも通知音は鳴らしたいので）

import { renderAlarm, renderTick } from './oneshots.js';
import { mulberry32 } from './dsp-core.js';

export class AlertSounds {
  constructor() {
    this.ctx = null;
    this.cache = new Map();
    this.rng = mulberry32(12345);
    this.tickAlt = false;
    this.current = [];
  }

  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  _buffer(key, make) {
    if (this.cache.has(key)) return this.cache.get(key);
    const ctx = this.ensure();
    const data = make(ctx.sampleRate);
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data, 0);
    this.cache.set(key, buf);
    return buf;
  }

  /** 通知音を鳴らす。戻り値は鳴り終わるまでの秒数 */
  play(name, { volume = 0.7, repeat = 1 } = {}) {
    if (!name || name === 'none') return 0;
    const ctx = this.ensure();
    this.stop();
    const buf = this._buffer(`alarm:${name}`, (sr) => renderAlarm(name, sr, this.rng));
    let t = ctx.currentTime + 0.05;
    const gap = Math.max(0.4, buf.duration * 0.85);
    for (let i = 0; i < Math.max(1, repeat); i++) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = Math.pow(volume, 2);
      src.connect(g).connect(this.out);
      src.start(t);
      this.current.push(src);
      src.onended = () => {
        this.current = this.current.filter((s) => s !== src);
        g.disconnect();
      };
      t += gap;
    }
    return t - ctx.currentTime;
  }

  stop() {
    for (const s of this.current) {
      try {
        s.stop();
      } catch {
        /* noop */
      }
    }
    this.current = [];
  }

  tick(style, volume = 0.3) {
    if (!style || style === 'none') return;
    const ctx = this.ensure();
    this.tickAlt = !this.tickAlt;
    const alt = style === 'clock' || style === 'wood' ? this.tickAlt : false;
    const buf = this._buffer(`tick:${style}:${alt}`, (sr) => renderTick(style, sr, this.rng, alt));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = Math.pow(volume, 2) * 0.8;
    src.connect(g).connect(this.out);
    src.onended = () => g.disconnect();
    src.start();
  }
}

/** 日本語の音声で読み上げる（Windows には日本語の音声が入っている） */
export function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    const ja = speechSynthesis.getVoices().find((v) => v.lang?.startsWith('ja'));
    if (ja) u.voice = ja;
    u.rate = 1.0;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (err) {
    console.warn('speech failed', err);
  }
}

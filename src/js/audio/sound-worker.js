// 環境音を別スレッドで作る（画面が固まらないように）
// - bed: ループ素材を 1 回だけ作る
// - open / render / close: 流れ続ける音（ストリーム）の続きを少しずつ作る
import { generateBed } from './beds.js';
import { createStream } from './streams.js';

const streams = new Map();

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'bed') {
      const chs = generateBed(m.name, m.sr, m.seed);
      self.postMessage({ id: m.id, chs }, chs.map((c) => c.buffer));
    } else if (m.type === 'open') {
      streams.set(m.sid, createStream(m.name, m.sr, m.seed, { variation: m.variation }));
    } else if (m.type === 'render') {
      const s = streams.get(m.sid);
      if (!s) return self.postMessage({ id: m.id, error: 'closed' });
      const chs = s.render(m.frames);
      self.postMessage({ id: m.id, chs }, chs.map((c) => c.buffer));
    } else if (m.type === 'close') {
      streams.delete(m.sid);
    } else if (m.type === 'variation') {
      for (const s of streams.values()) s.setVariation(m.value);
    }
  } catch (err) {
    if (m.id) self.postMessage({ id: m.id, error: String(err?.stack || err) });
    else console.error(err);
  }
};

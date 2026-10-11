// ループ素材を別スレッドで作る（画面が固まらないように）
import { generateBed } from './beds.js';

self.onmessage = (e) => {
  const { id, name, sr, seed } = e.data;
  try {
    const chs = generateBed(name, sr, seed);
    self.postMessage({ id, chs }, chs.map((c) => c.buffer));
  } catch (err) {
    self.postMessage({ id, error: String(err?.stack || err) });
  }
};

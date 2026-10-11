// 開発用：流れ続ける環境音を数分ぶん作って、音量（norm の値）と移り変わりの大きさを測る
// 使い方: node scripts/calibrate-streams.mjs [秒数] [名前...]
import { STREAMS, createStream } from '../src/js/audio/streams.js';

const TARGET = {
  'rain-light': 0.05, 'rain-heavy': 0.1, 'rain-window': 0.07, 'rain-roof': 0.07, 'rain-distant': 0.03,
  wind: 0.09, leaves: 0.065, forest: 0.035, mountain: 0.04, breeze: 0.03,
  stream: 0.06, river: 0.09, trickle: 0.035, waterfall: 0.1, waves: 0.075, fire: 0.06,
  crickets: 0.045, frogs: 0.05, 'cafe-clatter': 0.03, pencil: 0.045, keyboard: 0.045,
};
const SR = 48000;
const secs = Number(process.argv[2]) || 240;
const only = process.argv.slice(3);
console.log('name\tnorm\tpeak@norm\t10s-rms range dB\tms/8s-chunk');
for (const name of Object.keys(STREAMS)) {
  if (only.length && !only.includes(name)) continue;
  const s = createStream(name, SR, 11, { variation: 1 });
  const cur = STREAMS[name].norm;
  let sum = 0, cnt = 0, peak = 0, ms = 0;
  const win = [];
  let wsum = 0, wcnt = 0;
  for (let t = 0; t < secs; t += 8) {
    const t0 = performance.now();
    const [L, R] = s.render(8 * SR);
    ms += performance.now() - t0;
    for (let i = 0; i < L.length; i++) {
      const a = L[i] / cur, b = R[i] / cur;
      const v = a * a + b * b;
      sum += v; cnt += 2; wsum += v; wcnt += 2;
      peak = Math.max(peak, Math.abs(a), Math.abs(b));
      if (wcnt >= 2 * SR * 10) { win.push(Math.sqrt(wsum / wcnt)); wsum = 0; wcnt = 0; }
    }
  }
  const rms = Math.sqrt(sum / cnt);
  const norm = TARGET[name] / rms;
  const db = win.map((w) => 20 * Math.log10(w / rms));
  console.log(`${name}\t${norm.toPrecision(3)}\t${(peak * norm).toFixed(2)}\t${Math.min(...db).toFixed(1)} … +${Math.max(...db).toFixed(1)}\t${(ms / (secs / 8)).toFixed(0)}`);
}

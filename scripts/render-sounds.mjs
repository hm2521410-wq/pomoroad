// 開発用：環境音をすべて WAV に書き出して、音量・ピーク・生成時間・ループのつなぎ目を確認する
// 使い方: node scripts/render-sounds.mjs <出力フォルダ> [名前...]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BEDS } from '../src/js/audio/beds.js';
import { EVENTS, ALARMS, TICKS, renderEvent, renderAlarm, renderTick } from '../src/js/audio/oneshots.js';
import { mulberry32 } from '../src/js/audio/dsp-core.js';

const out = process.argv[2] || 'scratch/sounds';
const only = process.argv.slice(3);
mkdirSync(out, { recursive: true });
const SR = 48000;

function wav(chs, sr) {
  const n = chs[0].length, nc = chs.length;
  const buf = Buffer.alloc(44 + n * nc * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * nc * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * nc * 2, 28); buf.writeUInt16LE(nc * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * nc * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(chs[c][i] * 32767))), o); o += 2; }
  return buf;
}
const stats = (chs) => {
  let s = 0, p = 0, nan = 0, n = 0;
  for (const c of chs) for (const v of c) { if (!Number.isFinite(v)) nan++; s += v * v; p = Math.max(p, Math.abs(v)); n++; }
  // つなぎ目の段差：末尾→先頭の差と、通常の隣接差の比
  let d = 0; for (const c of chs) { let typ = 0; for (let i = 1; i < c.length; i++) typ += Math.abs(c[i] - c[i - 1]); typ /= c.length; d = Math.max(d, Math.abs(c[0] - c[c.length - 1]) / (typ || 1)); }
  return { rms: Math.sqrt(s / n), peak: p, nan, seam: d };
};
const rows = [];
for (const [name, fn] of Object.entries(BEDS)) {
  if (only.length && !only.includes(name)) continue;
  const t0 = performance.now();
  const chs = fn(SR, 7);
  const ms = performance.now() - t0;
  const st = stats(chs);
  // 2 周ぶん書き出してつなぎ目を耳で確認できるように
  const two = chs.map((c) => { const x = new Float32Array(c.length * 2); x.set(c); x.set(c, c.length); return x; });
  writeFileSync(join(out, `bed-${name}.wav`), wav(two, SR));
  rows.push(['bed', name, (chs[0].length / SR).toFixed(1) + 's', ms.toFixed(0) + 'ms', st.rms.toFixed(3), st.peak.toFixed(2), st.nan, st.seam.toFixed(1)]);
}
const r = mulberry32(3);
for (const name of Object.keys(EVENTS)) {
  if (only.length && !only.includes(name)) continue;
  const t0 = performance.now();
  const ev = renderEvent(name, SR, r);
  const ms = performance.now() - t0;
  const st = stats([ev.L, ev.R]);
  writeFileSync(join(out, `ev-${name}.wav`), wav([ev.L, ev.R], SR));
  rows.push(['event', name, (ev.L.length / SR).toFixed(1) + 's', ms.toFixed(0) + 'ms', st.rms.toFixed(3), st.peak.toFixed(2), st.nan, '-']);
}
for (const name of Object.keys(ALARMS)) {
  if (only.length && !only.includes(name)) continue;
  const d = renderAlarm(name, SR, r);
  const st = stats([d]);
  writeFileSync(join(out, `alarm-${name}.wav`), wav([d], SR));
  rows.push(['alarm', name, (d.length / SR).toFixed(1) + 's', '', st.rms.toFixed(3), st.peak.toFixed(2), st.nan, '-']);
}
for (const name of Object.keys(TICKS)) {
  const d = renderTick(name, SR, r);
  const st = stats([d]);
  rows.push(['tick', name, (d.length / SR).toFixed(2) + 's', '', st.rms.toFixed(3), st.peak.toFixed(2), st.nan, '-']);
}
console.log(['kind', 'name', 'len', 'gen', 'rms', 'peak', 'nan', 'seam'].join('\t'));
for (const row of rows) console.log(row.join('\t'));
const bad = rows.filter((x) => x[6] > 0 || Number(x[5]) > 1.0 || (x[7] !== '-' && Number(x[7]) > 8 && x[1] !== 'clock'));
if (bad.length) { console.error('PROBLEMS:', bad.map((x) => x[1]).join(', ')); process.exitCode = 1; }

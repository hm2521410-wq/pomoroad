import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STREAMS, createStream } from '../src/js/audio/streams.js';

const SR = 24000;

for (const name of Object.keys(STREAMS)) {
  test(`ストリーム ${name}: 音が途切れず・壊れず・続きが自然につながる`, () => {
    const s = createStream(name, SR, 3, { variation: 1.6 });
    const chunks = [s.render(SR * 2), s.render(SR * 2), s.render(SR * 3)];
    const L = new Float32Array(SR * 7);
    let o = 0;
    for (const [l, r] of chunks) {
      assert.equal(l.length, r.length);
      L.set(l, o);
      o += l.length;
    }
    let peak = 0;
    const diffs = [];
    for (let i = 0; i < L.length; i++) {
      assert.ok(Number.isFinite(L[i]), `NaN at ${i}`);
      peak = Math.max(peak, Math.abs(L[i]));
      if (i) diffs.push(Math.abs(L[i] - L[i - 1]));
    }
    assert.ok(peak <= 1.0, `peak ${peak}`);
    assert.ok(peak > 0.001, 'ほぼ無音');
    // かたまりの境目の段差が、ふだんの隣り合うサンプルの差の範囲に収まっている
    const sorted = diffs.slice().sort((a, b) => a - b);
    const p999 = sorted[Math.floor(sorted.length * 0.999)];
    for (const b of [SR * 2, SR * 4]) {
      const d = Math.abs(L[b] - L[b - 1]);
      assert.ok(d <= p999 * 1.5 + 1e-6, `境目 ${b} の段差 ${d} > ${p999}`);
    }
  });
}

test('同じ seed なら同じ音（再現できる）', () => {
  const a = createStream('rain-light', SR, 7).render(SR);
  const b = createStream('rain-light', SR, 7).render(SR);
  assert.deepEqual(a[0].slice(0, 2000), b[0].slice(0, 2000));
});

test('かたまりの終わりをまたぐ粒は、次のかたまりへ欠けずに持ち越される', async () => {
  const { _internal } = await import('../src/js/audio/streams.js');
  class Probe extends _internal.Stream {
    fill(o) {
      // 最初のかたまりの終わり 300 サンプル前から、長さ 1000 の山を置く
      if (o.pos === 0) {
        const g = new Float32Array(1000).map((_, i) => Math.sin((Math.PI * i) / 999));
        _internal.put(o, g, o.n - 300, 1, 0);
      }
    }
  }
  const s = new Probe(SR, 1);
  const [a] = s.render(2000);
  const [b] = s.render(2000);
  const joined = [...a, ...b];
  const [gl] = [Math.cos(Math.PI / 4)];
  for (let i = 0; i < 1000; i++) {
    const want = Math.sin((Math.PI * i) / 999) * gl;
    assert.ok(Math.abs(joined[1700 + i] - want) < 1e-6, `位置 ${1700 + i}`);
  }
});

test('近さのフィルターは境目で状態を引き継ぐ（段差が出ない）', async () => {
  const { _internal } = await import('../src/js/audio/streams.js');
  class Dc extends _internal.Stream {
    constructor() {
      super(SR, 1, { variation: 0 });
      this.useTone({ center: 0.2, spread: 0 }, 300, 300);
    }
    fill(o) {
      for (let i = 0; i < o.n; i++) o.L[i] += 1;
    }
  }
  const s = new Dc();
  const [a] = s.render(100);
  const [b] = s.render(100);
  // 1 次のローパスにかけた一定の値は、境目でも単調に増え続ける
  assert.ok(b[0] > a[99], `${b[0]} <= ${a[99]}`);
  assert.ok(b[0] - a[99] < 0.2);
});

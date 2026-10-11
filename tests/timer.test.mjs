import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimerEngine } from '../src/js/core/timer.js';
import { buildSimple, buildCustom } from '../src/js/core/sequence.js';
import { DEFAULTS } from '../src/js/core/store.js';
import { mergeDefaults, fmtClock, dayKey } from '../src/js/core/util.js';

const MIN = 60000;

function setup(patch = {}) {
  const settings = mergeDefaults(DEFAULTS, { timer: patch });
  let t = 1_000_000;
  const records = [];
  const events = [];
  const eng = new TimerEngine({ getSettings: () => settings.timer, now: () => t, getTaskId: () => 'task1' });
  eng.on('record', (r) => records.push(r));
  for (const ev of ['timeup', 'stepstart', 'setdone']) eng.on(ev, (d) => events.push([ev, d]));
  const advance = (ms) => {
    // 250ms ごとに tick を回す（実アプリと同じ）
    const end = t + ms;
    while (t < end) {
      t = Math.min(end, t + 250);
      eng.tick();
    }
  };
  return { eng, settings, records, events, advance, now: () => t };
}

test('シンプル設定: 25分から始まり4回ごとに長休憩', () => {
  const steps = buildSimple(DEFAULTS.timer.simple);
  assert.deepEqual(
    steps.map((s) => s.type),
    ['focus', 'short', 'focus', 'short', 'focus', 'short', 'focus', 'long'],
  );
  assert.equal(steps[0].dur, 25 * 60);
});

test('シンプル設定: 最初に5分休憩してから始める（2周目は省く）', () => {
  const cfg = { ...DEFAULTS.timer.simple, startWith: 'short', warmup: 5 };
  const first = buildSimple(cfg, 0);
  assert.equal(first[0].type, 'short');
  assert.equal(first[0].dur, 300);
  assert.equal(first[1].type, 'focus');
  const second = buildSimple(cfg, 1);
  assert.equal(second[0].type, 'focus');
  const every = buildSimple({ ...cfg, warmupEveryCycle: true }, 1);
  assert.equal(every[0].type, 'short');
});

test('シンプル設定: 長休憩の位置（3回ごと・6回）と長休憩なし', () => {
  const s = buildSimple({ ...DEFAULTS.timer.simple, longEvery: 3, rounds: 6 });
  const longs = s.map((x, i) => (x.type === 'long' ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(longs, [5, 11]);
  const none = buildSimple({ ...DEFAULTS.timer.simple, longEvery: 0, rounds: 3 });
  assert.ok(none.every((x) => x.type !== 'long'));
});

test('カスタム並び: 壊れた要素は捨て、空なら既定の1ステップ', () => {
  const s = buildCustom([{ type: 'focus', min: 10 }, { type: 'bogus', min: 3 }, null, { type: 'long', min: 0 }]);
  assert.equal(s.length, 1);
  assert.deepEqual(buildCustom([]), [{ type: 'focus', dur: 1500 }]);
});

test('時間切れで記録が出て、休憩が自動で始まる', () => {
  const { eng, records, advance } = setup();
  eng.start();
  advance(25 * MIN);
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'focus');
  assert.equal(records[0].counted, true);
  assert.equal(records[0].taskId, 'task1');
  assert.equal(records[0].ms, 25 * MIN);
  assert.equal(eng.step.type, 'short');
  assert.equal(eng.st.status, 'running');
  advance(5 * MIN);
  // 休憩明けの集中は自動開始しない（既定）
  assert.equal(eng.step.type, 'focus');
  assert.equal(eng.st.status, 'ready');
});

test('一時停止中は時間が進まず、記録の実働時間にも入らない', () => {
  const { eng, records, advance } = setup();
  eng.start();
  advance(10 * MIN);
  eng.pause();
  advance(30 * MIN);
  assert.equal(eng.elapsed(), 10 * MIN);
  eng.start();
  advance(15 * MIN);
  assert.equal(records[0].ms, 25 * MIN);
  assert.equal(records[0].segs.length, 2);
});

test('一時停止から切り上げて休憩へ（しきい値未満はポモドーロに数えない）', () => {
  const { eng, records, advance } = setup();
  eng.start();
  advance(12 * MIN);
  eng.pause();
  eng.breakNow();
  assert.equal(records.length, 1);
  assert.equal(records[0].counted, false);
  assert.equal(records[0].ms, 12 * MIN);
  assert.equal(eng.step.type, 'short');
  assert.equal(eng.st.status, 'running');
});

test('今すぐ長い休憩: 次の短い休憩を長い休憩に置き換える', () => {
  const { eng, advance } = setup();
  eng.start();
  advance(21 * MIN);
  eng.breakNow('long');
  assert.equal(eng.step.type, 'long');
  assert.equal(eng.step.dur, 15 * 60);
  // 80% 以上なのでポモドーロに数える
});

test('休憩中に breakNow(long) で休憩の種類を切り替えられる', () => {
  const { eng, advance } = setup();
  eng.start();
  advance(25 * MIN);
  advance(2 * MIN);
  eng.breakNow('long');
  assert.equal(eng.step.type, 'long');
  assert.equal(Math.round(eng.elapsed() / MIN), 2);
});

test('休憩をスキップして次の集中をすぐ始める', () => {
  const { eng, advance } = setup();
  eng.start();
  advance(25 * MIN);
  advance(1 * MIN);
  eng.skip();
  assert.equal(eng.step.type, 'focus');
  assert.equal(eng.st.status, 'running');
  assert.equal(eng.st.index, 2);
});

test('延長: +5分で終了が延びる', () => {
  const { eng, records, advance } = setup();
  eng.start();
  advance(24 * MIN);
  eng.extend(300);
  advance(5 * MIN);
  assert.equal(records.length, 0);
  advance(1 * MIN);
  assert.equal(records.length, 1);
  assert.equal(records[0].ms, 30 * MIN);
});

test('超過カウント: 自動開始しない場合は0を過ぎても数え続ける', () => {
  const { eng, records, events, advance } = setup({ autoStartBreak: false, overtime: true });
  eng.start();
  advance(27 * MIN);
  assert.equal(records.length, 0);
  assert.ok(eng.snapshot().overtime);
  assert.ok(events.some(([e, d]) => e === 'timeup' && d.overtime));
  eng.skip();
  assert.equal(records[0].ms, 27 * MIN);
  assert.equal(records[0].counted, true);
  assert.equal(eng.step.type, 'short');
  assert.equal(eng.st.status, 'running');
});

test('繰り返しなし: 1セット終わると最初に戻って待機', () => {
  const { eng, events, advance } = setup({
    repeat: false,
    autoStartFocus: true,
    simple: { ...DEFAULTS.timer.simple, rounds: 1, lastBreak: 'none' },
  });
  eng.start();
  advance(25 * MIN);
  assert.ok(events.some(([e]) => e === 'setdone'));
  assert.equal(eng.st.status, 'ready');
  assert.equal(eng.st.index, 0);
});

test('繰り返しあり: 周回が進み、ウォームアップは2周目で省かれる', () => {
  const { eng, advance } = setup({
    autoStartFocus: true,
    simple: { ...DEFAULTS.timer.simple, rounds: 1, startWith: 'short', warmup: 5, lastBreak: 'short' },
  });
  eng.start();
  advance(5 * MIN + 25 * MIN + 5 * MIN);
  assert.equal(eng.st.cycle, 1);
  assert.equal(eng.step.type, 'focus');
});

test('フロータイム: 集中時間の1/5を休憩にする', () => {
  const { eng, records, advance } = setup({ mode: 'flow' });
  eng.start();
  advance(40 * MIN);
  eng.breakNow();
  assert.equal(records[0].ms, 40 * MIN);
  assert.equal(eng.step.type, 'short');
  assert.equal(eng.step.dur, 8 * 60);
  advance(8 * MIN);
  assert.equal(eng.step.type, 'focus');
  assert.ok(eng.step.countUp);
});

test('ストップウォッチ: 終了で記録して0に戻る', () => {
  const { eng, records, advance } = setup({ mode: 'stopwatch' });
  eng.start();
  advance(7 * MIN);
  eng.breakNow();
  assert.equal(records.length, 1);
  assert.equal(eng.elapsed(), 0);
  assert.equal(eng.st.status, 'ready');
});

test('1分未満の途中終了は記録しない', () => {
  const { eng, records, advance } = setup();
  eng.start();
  advance(30 * 1000);
  eng.resetStep();
  assert.equal(records.length, 0);
});

test('途中で時間設定を変えても経過時間を保つ', () => {
  const { eng, settings, advance } = setup();
  eng.start();
  advance(10 * MIN);
  settings.timer.simple.focus = 50;
  eng.applySettings();
  assert.equal(eng.step.dur, 50 * 60);
  assert.equal(eng.elapsed(), 10 * MIN);
  assert.equal(eng.st.status, 'running');
});

test('ロードの任意の位置へジャンプ', () => {
  const { eng, advance } = setup();
  eng.start();
  advance(3 * MIN);
  eng.jump(6);
  assert.equal(eng.st.index, 6);
  assert.equal(eng.st.status, 'running');
});

test('保存と復元: 動いていたタイマーは閉じた時点で一時停止として戻る', () => {
  const a = setup();
  a.eng.start();
  a.advance(7 * MIN);
  const saved = JSON.parse(JSON.stringify(a.eng.serialize()));
  const b = setup();
  assert.equal(b.eng.restore(saved), true);
  assert.equal(b.eng.st.status, 'paused');
  assert.equal(b.eng.elapsed(), 7 * MIN);
  assert.equal(b.eng.restore({ v: 1, road: 'broken' }), false);
  assert.equal(b.eng.restore(null), false);
});

test('mergeDefaults: 型の違う保存値は捨てる', () => {
  const m = mergeDefaults(DEFAULTS, { timer: { simple: { focus: 'abc', short: 7 } }, view: 'oops', extra: 1 });
  assert.equal(m.timer.simple.focus, 25);
  assert.equal(m.timer.simple.short, 7);
  assert.equal(typeof m.view, 'object');
});

test('fmtClock / dayKey', () => {
  assert.equal(fmtClock(25 * MIN), '25:00');
  assert.equal(fmtClock(300), '00:01');
  assert.equal(fmtClock(-65000), '+01:05');
  assert.equal(fmtClock(90 * MIN), '1:30:00');
  const ts = new Date(2026, 9, 11, 3, 0).getTime();
  assert.equal(dayKey(ts, 4), '2026-10-10');
  assert.equal(dayKey(ts, 0), '2026-10-11');
});

test('離席: さかのぼって一時停止すると、その分は記録に入らない', () => {
  const { eng, records, advance, now } = setup();
  eng.start();
  advance(20 * MIN);
  eng.pause(now() - 6 * MIN);
  assert.equal(eng.elapsed(), 14 * MIN);
  eng.start();
  advance(11 * MIN);
  assert.equal(records[0].ms, 25 * MIN);
});

test('厳格モードの中断は、しきい値を超えていてもポモドーロに数えない', () => {
  const { eng, records, advance } = setup();
  eng.start();
  advance(24 * MIN);
  eng.abandon();
  assert.equal(records.length, 1);
  assert.equal(records[0].counted, false);
  assert.equal(records[0].reason, 'abandon');
  assert.equal(eng.st.status, 'ready');
});

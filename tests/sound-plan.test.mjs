import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundPlan } from '../src/js/core/sound-plan.js';

const base = { pauseWithTimer: true, status: 'running' };

test('休憩中「鳴らさない」：休憩では鳴らない。休憩用の音も選ばれない', () => {
  assert.deepEqual(soundPlan({ ...base, link: 'focus', type: 'focus' }), { play: true, mixKey: 'focus' });
  for (const type of ['short', 'long']) assert.deepEqual(soundPlan({ ...base, link: 'focus', type }), { play: false, mixKey: 'focus' });
});

test('休憩中「集中と同じ音」と「休憩用の音」', () => {
  assert.deepEqual(soundPlan({ ...base, link: 'same', type: 'short' }), { play: true, mixKey: 'focus' });
  assert.deepEqual(soundPlan({ ...base, link: 'separate', type: 'short' }), { play: true, mixKey: 'break' });
  assert.deepEqual(soundPlan({ ...base, link: 'separate', type: 'focus' }), { play: true, mixKey: 'focus' });
});

test('試し聞きがなければ、休憩用の音は「休憩用の音」のときの休憩中にしか鳴らない', () => {
  for (const link of ['manual', 'focus', 'same', 'separate']) {
    for (const type of ['focus', 'short', 'long']) {
      for (const status of ['ready', 'running', 'paused']) {
        const p = soundPlan({ link, type, status, pauseWithTimer: true, manualPlaying: true });
        if (p.mixKey === 'break') assert.ok(link === 'separate' && type !== 'focus', `${link}/${type}/${status}`);
      }
    }
  }
});

test('一時停止・待機中は止まる（設定で一時停止中も鳴らせる）。連動しないときは手動', () => {
  assert.equal(soundPlan({ link: 'same', type: 'focus', status: 'paused', pauseWithTimer: true }).play, false);
  assert.equal(soundPlan({ link: 'same', type: 'focus', status: 'paused', pauseWithTimer: false }).play, true);
  assert.equal(soundPlan({ link: 'same', type: 'focus', status: 'ready', pauseWithTimer: false }).play, false);
  assert.equal(soundPlan({ ...base, link: 'manual', type: 'short', manualPlaying: true }).play, true);
  assert.equal(soundPlan({ ...base, link: 'manual', type: 'focus', manualPlaying: false }).play, false);
});

test('手動の再生・停止と試し聞き', () => {
  assert.equal(soundPlan({ ...base, link: 'focus', type: 'short', override: true }).play, true);
  assert.equal(soundPlan({ ...base, link: 'same', type: 'focus', override: false }).play, false);
  assert.deepEqual(soundPlan({ ...base, link: 'focus', type: 'short', preview: { key: 'break' } }), { play: true, mixKey: 'break' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenOf, pageTitle, classify, FocusGuard, guardMessage, keywordChoices, studyRatio, remainText, DISTRACT_GROUPS } from '../src/js/core/guard.js';

const sc = (title, exe = 'chrome', desc = '') => screenOf({ title, exe, desc });
const cls = (s, opts) => classify(s, opts).cls;

test('ブラウザの題名からページの題名だけを取り出す', () => {
  assert.equal(pageTitle('線形代数 第3回 - Moodle - Google Chrome'), '線形代数 第3回 - Moodle');
  assert.equal(pageTitle('(3) ホーム / X - 個人 - Microsoft​ Edge'), 'ホーム / X - 個人');
  assert.equal(pageTitle('YouTube と他 2 ページ - 個人 - Microsoft Edge'), 'YouTube');
  assert.equal(pageTitle('材料力学 — Mozilla Firefox'), '材料力学');
  const s = sc('猫の動画 - YouTube - Google Chrome');
  assert.equal(s.browser, true);
  assert.equal(s.page, '猫の動画 - YouTube');
  assert.equal(s.key, 'chrome|猫の動画 - YouTube');
  const w = screenOf({ title: 'レポート.docx - Word', exe: 'WINWORD', desc: 'Microsoft Word' });
  assert.equal(w.key, 'winword');
  assert.equal(w.label, 'Microsoft Word');
});

test('はじめからの分け方：動画・SNS は気が散る、勉強の言葉があれば勉強用', () => {
  assert.equal(cls(sc('猫の動画 - YouTube - Google Chrome')), 'distract');
  assert.equal(cls(sc('【材料力学】はりのたわみ 解説 - YouTube - Google Chrome')), 'study');
  assert.equal(cls(sc('MIT 18.06 Linear Algebra Lecture 3 - YouTube - Google Chrome')), 'study');
  assert.equal(cls(sc('YouTube Music - Google Chrome')), 'neutral');
  assert.equal(cls(sc('ホーム / X - Google Chrome')), 'distract');
  assert.equal(cls(sc('Instagram - Microsoft Edge', 'msedge')), 'distract');
  assert.equal(cls(screenOf({ title: 'Steam', exe: 'steamwebhelper' })), 'distract');
  assert.equal(cls(screenOf({ title: 'LINE', exe: 'LINE' })), 'distract');
  // 「X」1 文字の題名の一部では反応しない
  assert.equal(cls(sc('Xの値を求める - Google Chrome')), 'neutral');
  // 勉強用のアプリ・サイト
  assert.equal(cls(screenOf({ title: 'レポート.docx - Word', exe: 'WINWORD' })), 'study');
  assert.equal(cls(sc('熱力学 第5回 - CoursePower - Google Chrome')), 'study');
  assert.equal(cls(sc('lecture05.pdf - Google Chrome')), 'study');
  // どちらでもない
  assert.equal(cls(screenOf({ title: 'ダウンロード', exe: 'explorer' })), 'neutral');
  assert.equal(cls({ ...sc('猫の動画 - YouTube - Google Chrome'), self: true }), 'self');
});

test('グループを切れば気が散る扱いにならない。ニュースははじめは切ってある', () => {
  const yt = sc('猫の動画 - YouTube - Google Chrome');
  assert.equal(cls(yt, { groups: { video: false } }), 'neutral');
  const news = sc('Yahoo!ニュース - Google Chrome');
  assert.equal(cls(news), 'neutral');
  assert.equal(cls(news, { groups: { news: true } }), 'distract');
  assert.ok(DISTRACT_GROUPS.every((g) => g.rules.length && g.label && g.examples));
});

test('自分で決めた分け方が優先。タスクだけの分け方はそのタスクのときだけ', () => {
  const yt = sc('Python入門 #3 - YouTube - Google Chrome');
  const cat = sc('猫の動画 - YouTube - Google Chrome');
  const rules = [
    { id: 'a', kind: 'title', text: '猫の動画', as: 'study' },
    { id: 'b', kind: 'app', text: 'explorer', as: 'distract' },
    { id: 'c', kind: 'title', text: 'youtube', as: 'study', task: 't1' },
  ];
  assert.equal(cls(cat, { rules }), 'study');
  assert.equal(cls(screenOf({ title: 'ダウンロード', exe: 'explorer' }), { rules }), 'distract');
  const other = sc('ゲーム実況 - YouTube - Google Chrome');
  assert.equal(cls(other, { rules }), 'distract');
  assert.equal(cls(other, { rules, taskId: 't1' }), 'study');
  assert.equal(cls(yt, { rules }), 'study');
  // 全角・半角や大文字・小文字の違いは気にしない
  assert.equal(cls(sc('ＹｏｕＴｕｂｅ'), { rules: [{ kind: 'title', text: 'youtube', as: 'neutral' }] }), 'neutral');
  // 題名の言葉はアプリ単位より優先
  const both = [
    { kind: 'app', text: 'chrome', as: 'distract' },
    { kind: 'title', text: 'Moodle', as: 'study' },
  ];
  assert.equal(cls(sc('課題 - Moodle - Google Chrome'), { rules: both }), 'study');
  assert.equal(cls(sc('ニュース - Google Chrome'), { rules: both }), 'distract');
});

const CFG = { graceSec: 20, speakSec: 60, askMin: 3 };

function drive(guard, plan, start = 0) {
  // plan: [[秒数, 画面, 判定], ...] を 2 秒ごとに流す
  let t = start;
  const events = [];
  for (const [sec, screen, verdict, active = true] of plan) {
    for (let i = 0; i < sec / 2; i++) {
      t += 2000;
      for (const ev of guard.update({ at: t, active, screen, verdict, cfg: CFG })) events.push({ t, ...ev });
    }
  }
  return { t, events };
}

const YT = sc('猫の動画 - YouTube - Google Chrome');
const WORD = screenOf({ title: 'レポート.docx - Word', exe: 'WINWORD', desc: 'Microsoft Word' });
const EXPL = screenOf({ title: 'ダウンロード', exe: 'explorer', desc: 'エクスプローラー' });
const D = { cls: 'distract', name: 'YouTube' };
const S = { cls: 'study', name: 'Word' };
const N = { cls: 'neutral', name: 'エクスプローラー' };
const SELF = { cls: 'self', name: 'Pomoroad' };

test('見張り：20 秒は見逃し、そのあと段階的に声をかける', () => {
  const g = new FocusGuard();
  const { events } = drive(g, [
    [10, WORD, S],
    [16, YT, D],
  ]);
  assert.equal(events.length, 0, '16 秒では何もしない');
  const r = drive(g, [[200, YT, D]], 26_000);
  const lv = r.events.filter((e) => e.type === 'nudge').map((e) => e.level);
  assert.deepEqual(lv, [1, 2, 3]);
  const first = r.events[0];
  // 気が散った画面に切り替わった最初の時点から 20 秒
  assert.ok(first.t - 12_000 >= 20_000 && first.t - 12_000 <= 22_000, `t=${first.t}`);
  assert.equal(first.episode.name, 'YouTube');
});

test('見張り：勉強用に戻るとほめる。少しのぞいただけでは数えない', () => {
  const g = new FocusGuard();
  let r = drive(g, [
    [10, YT, D],
    [10, WORD, S],
  ]);
  assert.equal(r.events.length, 0, '10 秒だけなら何もしない');
  r = drive(g, [
    [30, YT, D],
    [4, WORD, S],
  ], r.t);
  assert.deepEqual(r.events.map((e) => e.type), ['nudge', 'back']);
  const s = g.take(r.t);
  assert.equal(s.count, 1);
  assert.ok(s.distractMs >= 38_000 && s.distractMs <= 42_000, `distractMs=${s.distractMs}`);
  assert.ok(s.studyMs >= 12_000);
  assert.equal(s.screens[0].key, YT.key);
});

test('見張り：どちらでもない画面を少しはさんでも、寄り道は続いている', () => {
  const g = new FocusGuard();
  const r = drive(g, [
    [12, YT, D],
    [4, EXPL, N],
    [12, YT, D],
  ]);
  assert.deepEqual(r.events.map((e) => [e.type, e.level]), [['nudge', 1]]);
  // どちらでもない画面に 10 秒以上いれば戻ったとみなす
  const r2 = drive(g, [[12, EXPL, N]], r.t);
  assert.deepEqual(r2.events.map((e) => e.type), ['back']);
});

test('見張り：Pomoroad を前に出しても寄り道は終わらない（段階が進む）', () => {
  const g = new FocusGuard();
  const r = drive(g, [
    [62, YT, D],
    [10, YT, SELF],
    [130, YT, D],
  ]);
  const lv = r.events.filter((e) => e.type === 'nudge').map((e) => e.level);
  assert.deepEqual(lv, [1, 2, 3]);
  assert.ok(!r.events.some((e) => e.type === 'back'));
});

test('見張り：休憩中・一時停止中は見ないし、続きもつなげない', () => {
  const g = new FocusGuard();
  let r = drive(g, [[14, YT, D]]);
  r = drive(g, [[60, YT, D, false]], r.t);
  assert.equal(r.events.length, 0);
  r = drive(g, [[14, YT, D]], r.t);
  assert.equal(r.events.length, 0, '止めている間の時間は足さない');
  assert.ok(g.distractedMs <= 14_000);
});

test('見張り：「これは勉強用」で今の寄り道をなかったことにする', () => {
  const g = new FocusGuard();
  const r = drive(g, [[30, YT, D]]);
  assert.equal(r.events.length, 1);
  const removed = g.forgive(() => false);
  assert.equal(removed, 1);
  assert.equal(g.distractedMs, 0);
  const s = g.take(r.t, () => ({ cls: 'study' }));
  assert.equal(s.count, 0);
  assert.equal(s.distractMs, 0);
  assert.ok(s.studyMs > 25_000);
  assert.equal(studyRatio(s), 1);
});

test('見張り：スマホの知らせも記録する', () => {
  const g = new FocusGuard();
  g.phone(1000, 'Instagram');
  assert.equal(g.empty, false);
  const s = g.take(2000);
  assert.deepEqual(s.phone.map((p) => p.app), ['Instagram']);
  assert.equal(g.empty, true);
});

test('声かけの言葉：差し込む値がない文は選ばない', () => {
  for (const tone of ['gentle', 'coach', 'strict']) {
    for (const kind of ['nudge', 'speak', 'ask', 'back', 'phone']) {
      for (let i = 0; i < 20; i++) {
        const m = guardMessage(kind, tone, { app: 'YouTube', task: '', remainMs: null, done: 0, min: 3 }, { random: () => i / 20 });
        assert.ok(!/\{|\}/.test(m.body), m.body);
        assert.ok(!/あと、|あとです|もう できて/.test(m.body), `${tone}/${kind}: ${m.body}`);
        assert.ok(m.title);
      }
    }
  }
  const m = guardMessage('nudge', 'coach', { app: 'YouTube', task: '線形代数', remainMs: 12.5 * 60000, done: 3 }, { random: () => 0 });
  assert.equal(m.body, 'あと12分！ここが踏ん張りどころ。線形代数に戻ろう');
  // 前回と同じ文は避ける
  const again = guardMessage('nudge', 'coach', { app: 'YouTube', task: '線形代数', remainMs: 12.5 * 60000, done: 3 }, { random: () => 0, avoid: m.tpl });
  assert.notEqual(again.tpl, m.tpl);
  assert.equal(remainText(30_000), '1分足らず');
});

test('覚えるときの言葉の候補', () => {
  const c = keywordChoices(sc('線形代数 第3回 講義 - Moodle - Google Chrome'));
  assert.ok(c.includes('線形代数 第3回 講義'));
  assert.ok(c.includes('Moodle'));
  assert.ok(c.includes('線形代数 第3回 講義 - Moodle'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startNtfyMock } from './ntfy-mock.mjs';

const require = createRequire(import.meta.url);
const { PhoneLink, parsePhoneMessage } = require('../electron/phone.js');

const TOPIC = 'pomoroad-test1234abcd';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(20);
  }
  return false;
}

test('スマホからの文の読み取り：形式がばらばらでもアプリ名を取り出す', () => {
  assert.equal(parsePhoneMessage('Instagram'), 'Instagram');
  assert.equal(parsePhoneMessage('open:YouTube'), 'YouTube');
  assert.equal(parsePhoneMessage('アプリ起動: TikTok'), 'TikTok');
  assert.equal(parsePhoneMessage('アプリの起動/終了: YouTube'), 'YouTube');
  assert.equal(parsePhoneMessage('Application Launched (Instagram)'), 'Instagram');
  assert.equal(parsePhoneMessage('{"app":"X"}'), 'X');
  assert.equal(parsePhoneMessage('app=LINE&x=1'), 'LINE');
  // MacroDroid の変数が置き換わらずに届いたとき（POST の本文では置き換わらないことがある）
  assert.equal(parsePhoneMessage('{app_name}'), '');
  assert.equal(parsePhoneMessage('[trigger_that_fired]'), '');
  assert.equal(parsePhoneMessage('triggered'), '');
  assert.equal(parsePhoneMessage(''), '');
});

test('ntfy：集中の知らせを送り、スマホからの知らせを受け取る。切れてもつなぎ直して取りこぼさない', async () => {
  const mock = await startNtfyMock();
  const got = [];
  const states = [];
  const link = new PhoneLink({ fetch, onMessage: (m) => got.push(m), onStatus: (s) => states.push(s.state) });
  try {
    link.configure({ enabled: true, server: `${mock.url}/`, topic: TOPIC });
    assert.ok(await until(() => mock.subscribers(`${TOPIC}-pc`) === 1), 'スマホ → パソコンのトピックを受信している');
    assert.equal(link.status().state, 'connected');

    // パソコン → スマホ
    assert.equal(await link.publish({ message: '集中開始：あと25分', tags: ['tomato'] }), true);
    const sent = mock.topics.get(TOPIC);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].message, '集中開始：あと25分');
    assert.equal(sent[0].priority, 2);

    // スマホ → パソコン（MacroDroid は URL のクエリで送る）
    await fetch(`${mock.url}/${TOPIC}-pc/publish?message=${encodeURIComponent('Instagram')}`);
    assert.ok(await until(() => got.length === 1));
    assert.equal(got[0].app, 'Instagram');

    // 切れている間に届いた知らせも、つなぎ直したときに受け取る（同じものを 2 回数えない）
    mock.dropAll();
    assert.ok(await until(() => states.includes('error')));
    mock.publish(`${TOPIC}-pc`, { message: 'YouTube' });
    assert.ok(await until(() => got.length === 2, 6000), 'つなぎ直して受け取る');
    assert.equal(got[1].app, 'YouTube');
    await wait(200);
    assert.equal(got.length, 2);

    // 古い知らせ（パソコンが寝ていた間など）は数えない
    mock.publish(`${TOPIC}-pc`, { message: 'TikTok', time: Math.floor(Date.now() / 1000) - 600 });
    await wait(200);
    assert.equal(got.length, 2);

    // 切ったら受信をやめる
    link.configure({ enabled: false, server: mock.url, topic: TOPIC });
    assert.ok(await until(() => mock.subscribers(`${TOPIC}-pc`) === 0));
    assert.equal(link.status().state, 'off');
    assert.equal(await link.publish({ message: 'x' }), false);
  } finally {
    link.stop();
    await mock.close();
  }
});

test('ntfy：トピック名やサーバーがおかしいときは受信しない', () => {
  const link = new PhoneLink({ fetch });
  link.configure({ enabled: true, server: 'ntfy.sh', topic: TOPIC });
  assert.equal(link.status().state, 'error');
  link.configure({ enabled: true, server: 'https://ntfy.sh', topic: 'a b' });
  assert.equal(link.status().state, 'error');
  link.stop();
});

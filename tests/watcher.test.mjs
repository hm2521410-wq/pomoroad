import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { ForegroundWatcher, PS_SCRIPT } = require('../electron/watcher.js');

test('PowerShell の台本：予約済みの変数 $pid に代入していない', () => {
  // $pid は PowerShell の自動変数で、代入するとエラーで止まる
  assert.ok(!/\$pid\s*=/i.test(PS_SCRIPT));
  assert.ok(!/\[ref\]\s*\$pid\b/i.test(PS_SCRIPT));
  // 1 行目に準備完了を知らせる（Node 側はこれを待ってから聞く）
  assert.ok(PS_SCRIPT.includes('{"ready":true}'));
});

test('Windows 以外では「使えない」と答える', async () => {
  const w = new ForegroundWatcher({ platform: 'linux', fakeFile: null });
  assert.equal(w.supported, false);
  assert.deepEqual(await w.sample(), { unsupported: true });
});

test('確かめ用のファイルから前の画面を読む', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomoroad-fg-'));
  const file = path.join(dir, 'fg.json');
  fs.writeFileSync(file, JSON.stringify({ title: '猫の動画 - YouTube - Google Chrome', exe: 'chrome', desc: 'Google Chrome' }));
  const w = new ForegroundWatcher({ fakeFile: file });
  assert.equal(w.supported, true);
  const s = await w.sample();
  assert.equal(s.exe, 'chrome');
  assert.equal(s.title, '猫の動画 - YouTube - Google Chrome');
  fs.rmSync(dir, { recursive: true });
});

test('Windows：PowerShell から前の画面と日本語が届く', { skip: process.platform !== 'win32' && 'Windows だけ' }, async () => {
  const w = new ForegroundWatcher({ fakeFile: null });
  try {
    assert.equal(await w.echo(), 'テスト：日本語の題名「」');
    const s = await w.sample();
    assert.ok(!s.error, s.error);
    assert.equal(typeof s.title, 'string');
    assert.equal(typeof s.exe, 'string');
    assert.equal(typeof s.pid, 'number');
    // 続けて聞いても同じ PowerShell が答える
    const again = await w.sample();
    assert.ok(!again.error, again.error);
    assert.equal(w.status().running, true);
  } finally {
    w.stop();
  }
  assert.equal(w.status().running, false);
});

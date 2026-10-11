'use strict';
// 前に出ているウィンドウの「アプリ名」と「題名」を調べる（Windows だけ）。
// PowerShell を 1 つ起動したままにして、1 行送るたびに 1 行（JSON）で答えてもらう。
// 追加のソフトやネイティブモジュールはいらない。画面の中身は見ないし、結果はこのパソコンの中だけで使う。
//
// テストや Windows 以外での確認用に、環境変数 POMOROAD_FAKE_FG に JSON ファイルを指定すると、
// その中身（{ "title": "...", "exe": "chrome", "desc": "Google Chrome" }）を前の画面として返す。

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// 注意：PowerShell では $pid が予約済みの変数なので、プロセス番号は $procId に入れる（tests/watcher.test.mjs で確かめている）
const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PomoroadForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  public static string Title(IntPtr h) { var sb = new StringBuilder(1024); GetWindowText(h, sb, 1024); return sb.ToString(); }
  public static uint ProcessOf(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
}
'@
$cache = @{}
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null -or $line -eq 'q') { break }
  if ($line -eq 'e') {
    [Console]::Out.WriteLine((@{ t = 'テスト：日本語の題名「」' } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    continue
  }
  $h = [PomoroadForeground]::GetForegroundWindow()
  $procId = [PomoroadForeground]::ProcessOf($h)
  if ($cache.Count -gt 300) { $cache = @{} }
  if (-not $cache.ContainsKey($procId)) {
    $proc = Get-Process -Id $procId
    $desc = ''
    try { $desc = $proc.MainModule.FileVersionInfo.FileDescription } catch {}
    $cache[$procId] = @{ e = [string]$proc.ProcessName; d = [string]$desc }
  }
  $o = @{ t = [PomoroadForeground]::Title($h); p = [int]$procId; e = $cache[$procId].e; d = $cache[$procId].d }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
`;

function powershellPath() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const p = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(p) ? p : 'powershell.exe';
}

class ForegroundWatcher {
  constructor({ fakeFile = process.env.POMOROAD_FAKE_FG, idleStopMs = 90_000, platform = process.platform } = {}) {
    this.fakeFile = fakeFile || null;
    this.platform = platform;
    this.idleStopMs = idleStopMs;
    this.proc = null;
    this.ready = null;
    this.buf = '';
    this.waiters = [];
    this.pending = null;
    this.failures = 0;
    this.retryAt = 0;
    this.lastError = '';
    this.idleTimer = null;
  }

  get supported() {
    return !!this.fakeFile || this.platform === 'win32';
  }

  status() {
    return { supported: this.supported, running: !!this.proc, error: this.lastError, fake: !!this.fakeFile };
  }

  /** 今の前の画面。{ title, exe, desc, pid } か、使えないときは { unsupported } / { error } */
  sample() {
    if (this.fakeFile) return this._fake();
    if (this.platform !== 'win32') return Promise.resolve({ unsupported: true });
    if (this.pending) return this.pending;
    this.pending = this._ask('n')
      .then((o) => ({ title: String(o.t ?? ''), exe: String(o.e ?? ''), desc: String(o.d ?? ''), pid: Number(o.p) || 0 }))
      .catch((err) => ({ error: err.message }))
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  /** 日本語が文字化けせずに届くかの確認用 */
  echo() {
    return this._ask('e').then((o) => o.t);
  }

  stop() {
    clearTimeout(this.idleTimer);
    const p = this.proc;
    this.proc = null;
    this.ready = null;
    for (const w of this.waiters.splice(0)) w.reject(new Error('stopped'));
    if (p) {
      try {
        p.stdin.end('q\n');
      } catch {
        /* もう終わっている */
      }
      setTimeout(() => {
        if (p.exitCode == null) p.kill();
      }, 1500).unref?.();
    }
  }

  async _fake() {
    try {
      const o = JSON.parse(await fs.promises.readFile(this.fakeFile, 'utf8'));
      return { title: String(o.title ?? ''), exe: String(o.exe ?? ''), desc: String(o.desc ?? ''), pid: Number(o.pid) || 0 };
    } catch (err) {
      return { error: err.message };
    }
  }

  _start() {
    if (this.proc) return this.ready;
    if (Date.now() < this.retryAt) return Promise.reject(new Error(this.lastError || 'PowerShell を起動できませんでした'));
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
    const p = spawn(powershellPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = p;
    this.buf = '';
    let errText = '';
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d) => this._onData(d));
    p.stderr.on('data', (d) => {
      errText = (errText + d).slice(-2000);
    });
    const fail = (msg) => {
      if (this.proc !== p) return;
      this.proc = null;
      this.ready = null;
      this.failures++;
      this.retryAt = Date.now() + Math.min(60_000, this.failures * 10_000);
      this.lastError = msg;
      for (const w of this.waiters.splice(0)) w.reject(new Error(msg));
    };
    p.on('error', (err) => fail(`PowerShell を起動できませんでした（${err.message}）`));
    p.on('exit', (code) => fail(`PowerShell が終了しました（${code}）${errText ? `：${errText.trim().split('\n')[0]}` : ''}`));
    // 1 行目の {"ready":true} を待つ（C# のコンパイルに数秒かかる）
    this.ready = this._next(20_000).then(() => {
      this.failures = 0;
      this.lastError = '';
    });
    this.ready.catch(() => {
      if (this.proc === p) {
        p.kill();
        fail(this.lastError || 'PowerShell が応答しませんでした');
      }
    });
    return this.ready;
  }

  _onData(d) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/^\uFEFF/, '').trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      const w = this.waiters.shift();
      if (!w) continue;
      try {
        w.resolve(JSON.parse(line));
      } catch {
        w.reject(new Error(`読めない返事：${line.slice(0, 80)}`));
      }
    }
  }

  _next(timeoutMs) {
    return new Promise((resolve, reject) => {
      const w = {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      };
      const t = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error('PowerShell が応答しませんでした'));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  async _ask(cmd) {
    await this._start();
    const p = this.proc;
    if (!p) throw new Error(this.lastError || 'PowerShell が動いていません');
    const answer = this._next(5000);
    p.stdin.write(`${cmd}\n`);
    try {
      return await answer;
    } catch (err) {
      // 固まったら作り直す
      if (this.proc === p) {
        this.lastError = err.message;
        this.stop();
      }
      throw err;
    } finally {
      // しばらく聞かれなければ PowerShell を止めておく（休憩中などに余計な処理をしない）
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.stop(), this.idleStopMs);
      this.idleTimer.unref?.();
    }
  }
}

module.exports = { ForegroundWatcher, PS_SCRIPT };

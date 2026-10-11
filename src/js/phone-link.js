// スマホ連携：集中の始まり・終わりをスマホに知らせ、スマホで気が散るアプリを開いたら見守りに伝える。
// 通信そのものは Windows アプリのメインプロセス（electron/phone.js）が ntfy を通して行う。

import { toast } from './ui/widgets.js';

/** 推測されにくいトピック名（ntfy では、トピック名を知っている人だけが読み書きできる） */
export function newTopic() {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(16));
  return `pomoroad-${[...r].map((x) => abc[x % abc.length]).join('')}`;
}

/** 一時停止してから「集中終了」を送るまでの猶予（すぐ再開したときにスマホ側を切り替えないため） */
const END_DELAY_MS = 8000;

export class PhoneController {
  constructor(app) {
    this.app = app;
    this.status = { state: 'off', error: '' };
    this.focusOn = false;
    this.endT = null;
    this.received = []; // 最近届いた知らせ（設定画面で確かめる用）
    this.onChange = null;
  }

  get desktop() {
    return this.app.desktop;
  }
  get available() {
    return !!this.desktop?.phone;
  }
  get cfg() {
    return this.app.settings.phone;
  }

  start() {
    if (!this.available) return;
    const d = this.desktop;
    d.phone.onMessage((m) => this.onMessage(m));
    d.phone.onStatus((s) => {
      this.status = s;
      this.onChange?.();
    });
    this.apply();
  }

  /** 設定が変わったら呼ぶ */
  apply() {
    if (!this.available) return;
    const p = this.cfg;
    if (p.enabled && !p.topic) this.app.set('phone.topic', newTopic());
    this.desktop.phone.configure({ enabled: p.enabled, server: p.server, topic: p.topic });
    if (!p.enabled) {
      this.focusOn = false;
      clearTimeout(this.endT);
      this.endT = null;
    }
    this.sync();
  }

  /** タイマーが変わるたびに呼ぶ。集中の始まりと終わりをスマホへ */
  sync() {
    if (!this.available) return;
    const p = this.cfg;
    const e = this.app.engine;
    const on = p.enabled && p.sendFocus && e.running && e.step.type === 'focus';
    if (on) {
      if (this.endT) {
        // すぐ再開した：スマホはそのまま
        clearTimeout(this.endT);
        this.endT = null;
      }
      if (!this.focusOn) {
        this.focusOn = true;
        const snap = e.snapshot();
        const task = this.app.data.currentTask?.title;
        const remain = snap.countUp ? '' : `あと${Math.max(1, Math.round(snap.remaining / 60000))}分`;
        this._send('start', `集中開始${remain || task ? '：' : ''}${remain}${task ? `（${task}）` : ''}`, ['tomato']);
      }
    } else if (this.focusOn && !this.endT) {
      this.endT = setTimeout(() => {
        this.endT = null;
        this.focusOn = false;
        const t = this.app.engine.step.type;
        this._send('end', t === 'focus' ? '集中終了（一時停止）' : '集中終了：休憩です。おつかれさまでした', ['white_check_mark']);
      }, END_DELAY_MS);
    }
  }

  _send(kind, message, tags) {
    this.desktop.phone.publish({ kind, message, tags, title: 'Pomoroad', priority: 2 }).then((ok) => {
      if (!ok) this.onChange?.();
    });
  }

  /** スマホの ntfy アプリに試しに送る（ntfy アプリでトピックを登録しているときだけ、スマホに通知が出る） */
  async test() {
    const ok = await this.desktop.phone.publish({ message: 'Pomoroad からのテストです。届いていれば、パソコン → スマホはつながっています', title: 'Pomoroad', priority: 3, tags: ['wave'] });
    this.lastCheck = { kind: 'phone', ok, at: Date.now() };
    this.onChange?.();
    return ok;
  }

  /**
   * パソコンだけで、中継サービスまでのつながりを確かめる。
   * スマホ → パソコンのトピックに自分で送り、受け取れるかを見る。返り値：'ok' | 'send' | 'receive'
   */
  async selfCheck() {
    const nonce = Math.random().toString(36).slice(2, 10);
    const got = new Promise((resolve) => {
      this._selfWait = { nonce, resolve };
      setTimeout(() => resolve(false), 15000);
    });
    const sent = await this.desktop.phone.publish({ message: `pomoroad-selftest:${nonce}`, toPc: true, priority: 1 });
    const result = !sent ? 'send' : (await got) ? 'ok' : 'receive';
    this._selfWait = null;
    this.lastCheck = { kind: 'self', result, at: Date.now() };
    this.onChange?.();
    return result;
  }

  onMessage(m) {
    // パソコンだけの確かめで自分が送ったもの
    if (String(m.raw ?? '').startsWith('pomoroad-selftest:')) {
      if (this._selfWait && m.raw.endsWith(this._selfWait.nonce)) this._selfWait.resolve(true);
      return;
    }
    const app = m.app || 'スマホのアプリ';
    const counted = this.app.guard.onPhone({ app, at: m.at });
    // 設定を開いて確かめている最中なら、集中中でなくても届いたことを知らせる
    if (!counted && this.app.drawer === 'settings' && this.app.drawerTab === 'guard') toast(`スマホから届きました：${app}（集中中ではないので数えていません）`, { timeout: 6000 });
    this.received.unshift({ app, raw: m.raw, at: m.at, counted });
    this.received.length = Math.min(this.received.length, 5);
    this.onChange?.();
  }
}

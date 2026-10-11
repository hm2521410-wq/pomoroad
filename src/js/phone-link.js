// スマホ連携：集中の始まり・終わりをスマホに知らせ、スマホで気が散るアプリを開いたら見守りに伝える。
// 通信そのものは Windows アプリのメインプロセス（electron/phone.js）が ntfy を通して行う。

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

  /** スマホに試しに送る */
  test() {
    return this.desktop.phone.publish({ message: 'Pomoroad からのテストです。届いていれば、パソコン → スマホはつながっています', title: 'Pomoroad', priority: 3, tags: ['wave'] });
  }

  onMessage(m) {
    const app = m.app || 'スマホのアプリ';
    const counted = this.app.guard.onPhone({ app, at: m.at });
    this.received.unshift({ app, raw: m.raw, at: m.at, counted });
    this.received.length = Math.min(this.received.length, 5);
    this.onChange?.();
  }
}

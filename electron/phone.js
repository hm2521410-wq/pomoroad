'use strict';
// スマホ連携：ntfy（無料の中継サービス）を通して、パソコンとスマホで知らせ合う。
// - パソコン → スマホ：トピック <topic> に「集中開始」「集中終了」を送る（スマホの ntfy アプリが受け取り、MacroDroid が反応する）
// - スマホ → パソコン：MacroDroid がトピック <topic>-pc に「開いたアプリ名」を送る。ここで受け取って画面に伝える
// トピック名を知っている人だけが読み書きできるので、トピック名は推測されにくい長さにする。

const TOPIC_RE = /^[-_A-Za-z0-9]{8,64}$/;

/** 受け取った文から「開いたアプリ名」を取り出す。MacroDroid の変数が置き換わらずに届いたときは空にする */
function parsePhoneMessage(raw) {
  let text = String(raw ?? '').trim();
  // JSON・フォーム形式・「open:アプリ名」のどれでも受け付ける
  if (text.startsWith('{')) {
    try {
      const o = JSON.parse(text);
      text = String(o.app ?? o.message ?? o.text ?? '').trim();
    } catch {
      /* ただの文として扱う */
    }
  } else if (/^(app|message|text)=/.test(text)) {
    const p = new URLSearchParams(text);
    text = (p.get('app') ?? p.get('message') ?? p.get('text') ?? '').trim();
  }
  text = text.replace(/^(open|app)\s*[:：]\s*/i, '').trim();
  // MacroDroid の「トリガー」の文（例：「アプリの起動/終了: YouTube」「アプリ起動 (YouTube)」）からアプリ名だけを取り出す
  const paren = text.match(/(?:アプリ|App)[^()（）]*[（(]([^()（）]+)[)）]\s*$/i);
  if (paren) text = paren[1].trim();
  else text = text.replace(/^.*(?:アプリ|App|Application)[^:：]*[:：]\s*/i, '').trim();
  // 置き換わらなかった MacroDroid の変数（{app_name} や [trigger_that_fired] など）
  if (/^[[{][\w ]+[\]}]$/.test(text) || /\{[a-z_]+\}|\[[a-z_]+\]/.test(text)) text = '';
  // ntfy は本文なしで送られると「triggered」にする
  if (/^triggered$/i.test(text)) text = '';
  return text.slice(0, 60);
}

function normServer(s) {
  const v = String(s ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/.test(v) ? v : '';
}

class PhoneLink {
  constructor({ fetch, onMessage = () => {}, onStatus = () => {}, now = () => Date.now(), staleMs = 3 * 60_000, idleMs = 120_000 } = {}) {
    this.fetch = fetch;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.now = now;
    this.staleMs = staleMs;
    this.idleMs = idleMs;
    this.cfg = { enabled: false, server: '', topic: '' };
    this.gen = 0;
    this.ctrl = null;
    this.lastId = null;
    this.seen = new Set();
    this.state = { state: 'off', error: '', lastAt: 0 };
  }

  status() {
    return { ...this.state };
  }

  _status(state, error = '') {
    this.state = { ...this.state, state, error };
    this.onStatus(this.status());
  }

  /** 設定を変えたら呼ぶ。有効でトピックが正しければ受信を（つなぎ直して）始める */
  configure({ enabled, server, topic }) {
    const next = { enabled: !!enabled, server: normServer(server), topic: String(topic ?? '') };
    const same = next.enabled === this.cfg.enabled && next.server === this.cfg.server && next.topic === this.cfg.topic;
    this.cfg = next;
    if (same && this.state.state !== 'off') return;
    this.stop();
    if (!next.enabled) return;
    if (!next.server) return this._status('error', 'サーバーの URL が正しくありません');
    if (!TOPIC_RE.test(next.topic)) return this._status('error', 'トピック名が正しくありません');
    this.lastId = null;
    this._loop(++this.gen);
  }

  stop() {
    this.gen++;
    this.ctrl?.abort();
    this.ctrl = null;
    if (this.state.state !== 'off') this._status('off');
  }

  /** スマホへ送る（パソコン → スマホのトピック） */
  async publish({ message, title = 'Pomoroad', priority = 2, tags = [] }) {
    const { enabled, server, topic } = this.cfg;
    if (!enabled || !server || !TOPIC_RE.test(topic)) return false;
    try {
      const res = await this.fetch(`${server}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, message, title, priority, tags }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    } catch (err) {
      this.state.error = `送れませんでした（${err.message}）`;
      this.onStatus(this.status());
      return false;
    }
  }

  async _loop(gen) {
    let delay = 2000;
    while (this.gen === gen) {
      const ctrl = new AbortController();
      this.ctrl = ctrl;
      let idle = null;
      const kick = () => {
        clearTimeout(idle);
        // ntfy は 45 秒ごとに keepalive を送ってくる。しばらく何も来なければ切れたとみなす
        idle = setTimeout(() => ctrl.abort(), this.idleMs);
        idle.unref?.();
      };
      try {
        this._status('connecting');
        const { server, topic } = this.cfg;
        const url = `${server}/${topic}-pc/json${this.lastId ? `?since=${encodeURIComponent(this.lastId)}` : ''}`;
        kick();
        const res = await this.fetch(url, { signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        this._status('connected');
        delay = 2000;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          kick();
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (line) this._line(line);
          }
        }
        throw new Error('接続が切れました');
      } catch (err) {
        clearTimeout(idle);
        if (this.gen !== gen) return;
        this._status('error', err.name === 'AbortError' ? '応答がないのでつなぎ直しています' : err.message);
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 60_000);
      }
    }
  }

  _line(line) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (ev.event !== 'message' || !ev.id || this.seen.has(ev.id)) return;
    this.seen.add(ev.id);
    if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-200));
    this.lastId = ev.id;
    const at = Number(ev.time) * 1000 || this.now();
    // パソコンが寝ていた間などの古い知らせは数えない
    if (this.now() - at > this.staleMs) return;
    this.state.lastAt = at;
    this.onMessage({ app: parsePhoneMessage(ev.message), raw: String(ev.message ?? '').slice(0, 200), at });
  }
}

module.exports = { PhoneLink, parsePhoneMessage, TOPIC_RE };

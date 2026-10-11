// 見守りをアプリにつなぐ：前の画面を 2 秒ごとに調べて分け、段階に応じて声をかける。
// スマホから「気が散るアプリを開いた」と届いたときの声かけもここで扱う。

import { screenOf, classify, FocusGuard, guardMessage } from './core/guard.js';
import { uid } from './core/util.js';
import { speak } from './audio/alerts.js';
import { toast } from './ui/widgets.js';
import { renderGuardCard, learnDialog } from './ui/guard-view.js';

const POLL_MS = 2000;
const PRAISE_MS = 5000;

export class GuardController {
  constructor(app) {
    this.app = app;
    this.core = new FocusGuard();
    this.current = null; // いま前にある画面 { screen, verdict, at }
    this.lastOther = null; // 直前の Pomoroad 以外の画面
    this.recent = new Map(); // このアプリを起動してから見た画面
    this.alert = null; // 表示中の声かけ { kind, level, title, body, episode }
    this.preview = false; // 設定の「見守り」を開いている間は、集中していなくても調べる
    this.onPreview = null;
    this.status = null;
    this.lastTpl = null;
    this.prompted = new Set();
    this.busy = false;
  }

  get cfg() {
    return this.app.settings.guard;
  }
  get desktop() {
    return this.app.desktop;
  }
  /** パソコンの画面を見られるか（Windows アプリのときだけ） */
  get available() {
    return !!this.desktop?.foreground;
  }

  start() {
    if (!this.available) return;
    this.desktop.foreground.status().then((s) => {
      if (!s?.supported) this.status = { unsupported: true };
    });
    setInterval(() => this.poll(), POLL_MS);
  }

  active() {
    const e = this.app.engine;
    return !!this.cfg.enabled && e.running && e.step.type === 'focus';
  }

  verdictOf(screen) {
    return classify(screen, { rules: this.cfg.rules, groups: this.cfg.groups, taskId: this.app.data.currentTaskId });
  }

  async poll() {
    const active = this.active();
    // 一時停止・休憩に入ったら、出ていた声かけはしまう（ためしの表示とほめる表示は時間で消える）
    if (!active && this.alert && !this.alert.trial && this.alert.kind !== 'back') this.clearAlert();
    if (!active && !this.preview) {
      this._handle(this.core.update({ at: Date.now(), active: false }));
      return;
    }
    if (this.busy || this.status?.unsupported) return;
    this.busy = true;
    let s;
    try {
      s = await this.desktop.foreground.sample();
    } catch (err) {
      s = { error: err.message };
    } finally {
      this.busy = false;
    }
    if (!s || s.unsupported || s.error) {
      this.status = s ?? { error: '応答がありません' };
      this.onPreview?.();
      return;
    }
    this.status = { ok: true };
    const at = Date.now();
    const screen = screenOf(s);
    const verdict = this.verdictOf(screen);
    this.current = { screen, verdict, at };
    if (!screen.self) {
      this.lastOther = this.current;
      this.recent.delete(screen.key);
      this.recent.set(screen.key, screen);
      if (this.recent.size > 60) this.recent.delete(this.recent.keys().next().value);
    }
    this.onPreview?.();
    this._handle(this.core.update({ at, active: this.active(), screen, verdict, cfg: this.cfg }));
  }

  _handle(events) {
    for (const ev of events) {
      if (ev.type === 'nudge') this.nudge(ev.level, ev.episode);
      else if (ev.type === 'back') this.back(ev.episode);
    }
  }

  ctx(app) {
    const snap = this.app.engine.snapshot();
    return {
      app,
      task: this.app.data.currentTask?.title ?? '',
      remainMs: snap.countUp ? null : snap.remaining,
      done: this.app.data.summary(this.app.data.todayKey()).pomos,
      min: Math.max(1, Math.round(this.core.distractedMs / 60000)),
    };
  }

  _message(kind, name) {
    const m = guardMessage(kind, this.cfg.tone, this.ctx(name), { avoid: this.lastTpl });
    this.lastTpl = m.tpl;
    return m;
  }

  /** 段階ごとの声かけ。1：通知とミニ表示 / 2：読み上げと前に出す / 3：一時停止をたずねる */
  nudge(level, ep, { trial = false } = {}) {
    const c = this.cfg;
    if (level === 1 && !trial) this.app.engine.interruption();
    const m = this._message(level >= 3 ? 'ask' : 'nudge', ep.name);
    this.alert = { kind: level >= 3 ? 'ask' : 'nudge', level, title: m.title, body: m.body, episode: ep, trial };
    if (level === 1) {
      if (c.notify) this.app.notify(m.title, m.body);
      if (c.mini) this.desktop?.mini.flash(true);
    } else if (level === 2) {
      if (c.voice) speak(this._message('speak', ep.name).body);
      if (c.front) this.desktop?.attention({ focus: true });
      else if (c.notify) this.app.notify(m.title, m.body);
    } else {
      if (c.voice) speak(m.title);
      if (c.front) this.desktop?.attention({ focus: true });
      else if (c.notify) this.app.notify(m.title, m.body);
    }
    this.render();
  }

  /** 勉強用の画面に戻ってきたとき */
  back(ep) {
    if (!this.cfg.praise) {
      this.clearAlert();
      return;
    }
    const m = this._message('back', ep.name);
    this.alert = { kind: 'back', level: 0, title: m.title, body: m.body, episode: ep };
    this.render();
    toast(`${m.title}　${m.body}`, { timeout: PRAISE_MS });
    clearTimeout(this._praiseT);
    this._praiseT = setTimeout(() => {
      if (this.alert?.kind === 'back') this.clearAlert();
    }, PRAISE_MS);
  }

  clearAlert() {
    this.alert = null;
    this.desktop?.mini.flash(false);
    this.render();
  }

  render() {
    renderGuardCard(this);
    this.app._sendState(true);
  }

  /** 声かけの見え方を試す（記録には残さない） */
  trial() {
    const name = 'YouTube';
    this.nudge(1, { name, key: 'trial', start: Date.now(), ms: 25_000, screen: null }, { trial: true });
    setTimeout(() => {
      if (this.alert?.trial) this.clearAlert();
    }, 12_000);
  }

  // ── 声かけのボタン ─────────────────────────────────
  dismiss() {
    this.clearAlert();
  }

  /** 寄り道を始めた時刻で一時停止して、寄り道した時間を記録から外す */
  pauseHere() {
    const ep = this.alert?.episode ?? this.core.episode;
    const e = this.app.engine;
    if (e.running) {
      e.pause(ep?.start ?? null);
      if (ep?.ms) toast(`寄り道した ${Math.max(1, Math.round(ep.ms / 60000))} 分を記録から外して、一時停止しました`, { timeout: 6000 });
    }
    this.clearAlert();
  }

  takeBreak() {
    this.clearAlert();
    this.app.breakNow();
  }

  /** 「これは勉強用」など：分け方を教えてもらう */
  async teach(screen, as = 'study') {
    const rule = await learnDialog(this.app, screen, as);
    if (!rule) return false;
    this.addRule(rule);
    return true;
  }

  addRule(rule) {
    const rules = this.cfg.rules.filter((r) => !(r.kind === rule.kind && r.text === rule.text && (r.task ?? null) === (rule.task ?? null)));
    rules.push({ id: uid(), ...rule });
    this.app.set('guard.rules', rules);
    // 教えた分け方で、今の寄り道を数え直す
    const still = (key) => {
      const u = this.core.session.usage.get(key);
      return u ? this.verdictOf(u.screen).cls === 'distract' : true;
    };
    const removed = this.core.forgive(still);
    if (removed > 0) this.app.engine.interruption(-removed);
    if (this.alert && this.alert.kind !== 'back' && !still(this.alert.episode?.key)) this.clearAlert();
    const label = { study: '勉強用', distract: '気が散るもの', neutral: 'どちらでもない' }[rule.as];
    toast(`覚えました：「${rule.text}」は${rule.task ? 'このタスクのとき' : ''}${label}です`, { timeout: 4000 });
  }

  removeRule(id) {
    this.app.set(
      'guard.rules',
      this.cfg.rules.filter((r) => r.id !== id),
    );
  }

  // ── 記録 ─────────────────────────────────────────
  /** 集中の記録に、見守りのまとめを付ける */
  attach(rec) {
    if (rec.type !== 'focus' || this.core.empty) return;
    rec.guard = this.core.take(rec.end, (sc) => this.verdictOf(sc));
    this.clearAlert();
    this._suggestSorting(rec.guard);
  }

  /** 新しい集中が始まったら、前のぶんは捨てる */
  reset() {
    if (!this.core.empty) this.core.take(Date.now());
  }

  _suggestSorting(g) {
    if (!this.cfg.sortPrompt || !this.available) return;
    const fresh = g.screens.filter((s) => s.cls === 'neutral' && s.ms >= 120_000 && !this.prompted.has(s.key));
    if (!fresh.length) return;
    for (const s of fresh) this.prompted.add(s.key);
    toast(`今回は「${fresh[0].label}」などを使いました。勉強用かどうかを教えると、見守りが正確になります`, {
      action: '仕分ける',
      onAction: () => this.app.openDrawer('settings', 'guard'),
      timeout: 9000,
    });
  }

  // ── スマホ ────────────────────────────────────────
  /** スマホから「気が散るアプリを開いた」と届いた */
  onPhone({ app: name, at = Date.now() }) {
    if (!this.active()) return false;
    this.core.phone(at, name);
    this.app.engine.interruption();
    if (!this.app.settings.phone.nudge) return true;
    const m = this._message('phone', name || 'アプリ');
    this.alert = { kind: 'phone', level: 1, title: m.title, body: m.body, episode: { name, start: at, ms: 0 } };
    if (this.cfg.notify) this.app.notify(m.title, m.body);
    if (this.cfg.voice) speak(m.body);
    if (this.cfg.mini) this.desktop?.mini.flash(true);
    this.render();
    clearTimeout(this._phoneT);
    this._phoneT = setTimeout(() => {
      if (this.alert?.kind === 'phone') this.clearAlert();
    }, 12_000);
    return true;
  }

  /** ミニ表示に出す短い文 */
  miniAlert() {
    const a = this.alert;
    if (!a) return null;
    return { title: a.title, text: a.body, kind: a.kind };
  }
}

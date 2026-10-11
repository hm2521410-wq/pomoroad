// 見守り：集中中に「気が散る画面」を開いていないかを見て、声をかける
// - 画面の分け方（勉強用 / 気が散る / どちらでもない）
// - 声かけの段階（見逃す → 通知 → 読み上げ → 一時停止をたずねる）
// - 声かけの言葉
// DOM を使わないので Node のテストからも読み込める。

// ── 画面の情報 ───────────────────────────────────────

export const BROWSERS = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc', 'whale', 'iexplore', 'browser', 'thorium', 'floorp', 'librewolf', 'waterfox'];

const BROWSER_SUFFIX = /\s+[-—–]\s+(?:Google Chrome|Microsoft\s*Edge|Mozilla Firefox|Firefox|Brave|Opera|Vivaldi|Arc|Whale|Floorp|LibreWolf|Waterfox|Thorium|Yandex)$/i;

/** 比べるための正規化（全角・半角や大文字・小文字の違いをなくす） */
export const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().trim();

function cleanTitle(t) {
  return String(t ?? '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ブラウザの題名からブラウザ名などを取り除いて、ページの題名だけにする */
export function pageTitle(title) {
  let t = cleanTitle(title);
  t = t.replace(BROWSER_SUFFIX, '');
  t = t.replace(/\s+と他\s*\d+\s*ページ.*$/, '').replace(/\s+and \d+ more pages?.*$/i, '');
  t = t.replace(/^\(\d+\+?\)\s*/, ''); // 「(3) ホーム / X」の未読数
  return t.trim();
}

const prettyExe = (exe) => (exe ? exe.charAt(0).toUpperCase() + exe.slice(1) : '不明なアプリ');

/**
 * 前の画面の調べた結果（{ title, exe, desc, self }）を、分けやすい形にする。
 * key は「同じ画面」をまとめるための名前（アプリはアプリ単位、ブラウザはページの題名単位）
 */
export function screenOf(s) {
  const exe = norm(s?.exe).replace(/\.exe$/, '');
  const title = cleanTitle(s?.title);
  const browser = BROWSERS.includes(exe);
  const uwp = exe === 'applicationframehost';
  const page = browser ? pageTitle(title) : title;
  const app = uwp ? page || 'Windows のアプリ' : cleanTitle(s?.desc) || prettyExe(exe);
  const byPage = browser || uwp;
  return {
    exe,
    title,
    page,
    app,
    browser,
    self: !!s?.self,
    key: byPage ? `${exe}|${page}` : exe,
    label: byPage ? page || app : app,
  };
}

// ── はじめから入っている分け方 ───────────────────────────

/** 気が散るもの（グループごとに入り切りできる）。t は題名、a はアプリ名（exe） */
export const DISTRACT_GROUPS = [
  {
    id: 'video',
    label: '動画',
    examples: 'YouTube・Netflix・Prime Video・ABEMA・TVer・ニコニコ・Twitch など',
    rules: [
      { name: 'YouTube', t: /YouTube/i, not: /YouTube Music/i },
      { name: 'Netflix', t: /Netflix/i, a: ['netflix'] },
      { name: 'Prime Video', t: /Prime Video|プライム・?ビデオ/i, a: ['primevideo'] },
      { name: 'ABEMA', t: /ABEMA/ },
      { name: 'TVer', t: /TVer/ },
      { name: 'ニコニコ', t: /ニコニコ|niconico/i },
      { name: 'Twitch', t: /Twitch/i },
      { name: '動画配信', t: /Hulu|U-NEXT|Disney\+|ディズニープラス|DMM TV|Lemino|dアニメストア|FOD/ },
    ],
  },
  {
    id: 'sns',
    label: 'SNS',
    examples: 'X（Twitter）・Instagram・TikTok・Facebook・Threads・Reddit・5ちゃんねる など',
    rules: [
      { name: 'X', t: /\/ X$|^X$|Twitter/ },
      { name: 'Instagram', t: /Instagram/i, a: ['instagram'] },
      { name: 'TikTok', t: /TikTok/i, a: ['tiktok'] },
      { name: 'Facebook', t: /Facebook/i },
      { name: 'Threads', t: /Threads$/ },
      { name: 'Reddit', t: /Reddit/i },
      { name: '5ちゃんねる', t: /5ちゃんねる|5ch\.net|2ちゃんねる/ },
      { name: 'Bluesky', t: /Bluesky/ },
      { name: 'Pinterest', t: /Pinterest/i },
    ],
  },
  {
    id: 'game',
    label: 'ゲーム',
    examples: 'Steam・Epic Games・Minecraft・原神・VALORANT・LoL・Roblox など',
    rules: [
      { name: 'Steam', a: ['steam', 'steamwebhelper'] },
      { name: 'Epic Games', a: ['epicgameslauncher'] },
      { name: 'Minecraft', t: /^Minecraft/, a: ['minecraft.windows', 'minecraftlauncher'] },
      { name: 'Riot Games', a: ['riotclientservices', 'riotclientux', 'leagueclient', 'leagueclientux', 'league of legends', 'valorant', 'valorant-win64-shipping'] },
      { name: '原神', a: ['genshinimpact', 'yuanshen', 'starrail', 'zenlesszonezero'] },
      { name: 'ゲーム', a: ['robloxplayerbeta', 'r5apex', 'fortniteclient-win64-shipping', 'overwatch', 'osu!', 'umamusume', 'dmmgameplayer', 'battle.net', 'gamelauncher'] },
    ],
  },
  {
    id: 'shop',
    label: '買い物',
    examples: 'Amazon・楽天市場・メルカリ・Yahoo!ショッピング・ZOZOTOWN など',
    rules: [
      { name: 'Amazon', t: /Amazon\.co\.jp|Amazon\.com|^Amazon \|/i },
      { name: '楽天市場', t: /楽天市場|Rakuten Ichiba/i },
      { name: 'メルカリ', t: /メルカリ|Mercari/i },
      { name: 'ネットショッピング', t: /Yahoo!ショッピング|ZOZOTOWN|SHEIN|Qoo10|ヨドバシ|価格\.com/ },
    ],
  },
  {
    id: 'chat',
    label: 'チャット',
    examples: 'LINE・Discord',
    rules: [
      { name: 'LINE', a: ['line'] },
      { name: 'Discord', a: ['discord'], t: /Discord$/ },
    ],
  },
  {
    id: 'news',
    label: 'ニュース',
    examples: 'Yahoo!ニュース・ライブドアニュース・ねとらぼ など',
    off: true,
    rules: [{ name: 'ニュース', t: /Yahoo!ニュース|Yahoo! JAPAN$|ライブドアニュース|ねとらぼ|SmartNews|NewsPicks/ }],
  },
];

/** 動画サイトなどでも、題名にこれが入っていれば勉強用とみなす */
export const STUDY_WORDS = /講義|授業|解説|講座|演習|入門|勉強|学習|lecture|tutorial|course|explained|study with me/i;

/** はじめから勉強用とみなすもの（統計の「勉強用の画面にいた割合」に使う） */
export const STUDY_APPS = [
  'winword', 'excel', 'powerpnt', 'onenote', 'onenoteim', 'acrobat', 'acrord32', 'sumatrapdf', 'foxitpdfreader', 'foxitreader', 'pdfxedit',
  'matlab', 'code', 'obsidian', 'anki', 'zotero', 'mendeley', 'texstudio', 'texworks', 'scilab', 'octave', 'wolfram', 'mathematica',
  'sldworks', 'fusion360', 'acad', 'inventor', 'labview', 'rstudio', 'spyder', 'pycharm64', 'idea64', 'devenv', 'python', 'pythonw', 'jupyter-lab',
];
export const STUDY_TITLES = /Moodle|CoursePower|manaba|WebClass|青山学院|Google Scholar|J-STAGE|CiNii|arXiv|Overleaf|Jupyter|Wolfram|Desmos|Kaggle|Qiita|Zenn|Stack Overflow|Google ドキュメント|Google Docs|Google スプレッドシート|Google Sheets|Google スライド|Google Slides|DeepL|Google 翻訳|\.pdf\b/i;

// ── 分ける ────────────────────────────────────────────

const KIND_ORDER = { title: 0, app: 1 };

/** 自分で決めた分け方が、この画面に当てはまるか */
export function ruleMatches(rule, sc) {
  const text = norm(rule.text);
  if (!text) return false;
  if (rule.kind === 'app') return norm(sc.exe) === text.replace(/\.exe$/, '') || norm(sc.app) === text;
  return norm(sc.page).includes(text) || (!sc.browser && norm(sc.title).includes(text));
}

/**
 * 画面を分ける。
 * 返り値：{ cls: 'study' | 'distract' | 'neutral' | 'self', name: 声かけに使う短い名前, why: 理由, rule? }
 * 優先順：Pomoroad 自身 → このタスクだけの分け方 → 自分で決めた分け方 → 気が散るもの（勉強の言葉が入っていれば勉強用） → 勉強用 → どちらでもない
 */
export function classify(sc, { rules = [], groups = {}, taskId = null } = {}) {
  if (sc.self) return { cls: 'self', name: 'Pomoroad', why: 'このアプリ' };
  const mine = rules
    .filter((r) => (!r.task || r.task === taskId) && ruleMatches(r, sc))
    .sort((a, b) => (b.task ? 1 : 0) - (a.task ? 1 : 0) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || norm(b.text).length - norm(a.text).length);
  if (mine.length) {
    const r = mine[0];
    return { cls: r.as, name: r.kind === 'app' ? sc.app : r.text, why: r.task ? 'このタスクで決めた分け方' : '自分で決めた分け方', rule: r };
  }
  const page = sc.page || sc.title;
  for (const g of DISTRACT_GROUPS) {
    const on = groups[g.id] ?? !g.off;
    if (!on) continue;
    for (const r of g.rules) {
      const hitApp = r.a?.includes(sc.exe);
      const hitTitle = r.t?.test(page) && !r.not?.test(page);
      if (!hitApp && !hitTitle) continue;
      if (STUDY_WORDS.test(page)) return { cls: 'study', name: r.name, why: `${r.name}（題名に勉強の言葉があるため勉強用）` };
      return { cls: 'distract', name: r.name, why: `${g.label}（はじめからの分け方）`, group: g.id };
    }
  }
  if (STUDY_APPS.includes(sc.exe) || STUDY_TITLES.test(page)) return { cls: 'study', name: sc.label, why: '勉強用（はじめからの分け方）' };
  return { cls: 'neutral', name: sc.label, why: '決まっていない画面' };
}

/** 「これは勉強用」で覚えるときの、言葉の候補（題名の区切りごと） */
export function keywordChoices(sc) {
  const src = sc.page || sc.title;
  const parts = src
    .split(/\s+[-|｜—–•]\s+|\s*[|｜]\s*|：|:\s|\s\/\s/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && x.length <= 60);
  const out = [];
  for (const p of [...parts, src]) if (p && !out.includes(p)) out.push(p);
  return out.slice(0, 6);
}

// ── 声かけの段階 ──────────────────────────────────────

export const GUARD_STEPS = [
  { level: 1, label: '通知とミニ表示で知らせる' },
  { level: 2, label: '読み上げて、Pomoroad を前に出す' },
  { level: 3, label: '一時停止するかたずねる' },
];

const newSession = () => ({ studyMs: 0, neutralMs: 0, distractMs: 0, selfMs: 0, episodes: [], phone: [], usage: new Map() });

/**
 * 集中中の見張りの状態。2 秒ごとくらいに update() を呼ぶ。
 * 返り値は起きたこと（声かけ・戻ってきた）の一覧。
 */
export class FocusGuard {
  constructor() {
    this.session = newSession();
    this.last = null;
    this.episode = null;
  }

  /** いまの気が散っている時間（ミリ秒） */
  get distractedMs() {
    return this.episode?.ms ?? 0;
  }

  /**
   * @param {{ at:number, active:boolean, screen?:object, verdict?:object, cfg:{graceSec:number, speakSec:number, askMin:number, returnSec?:number, selfReturnSec?:number} }} o
   */
  update({ at, active, screen, verdict, cfg }) {
    const out = [];
    if (!active || !screen || !verdict) {
      // 休憩中・一時停止中は見ない。続きの時間もつなげない
      this._close(at, out, false);
      this.last = null;
      return out;
    }
    const s = this.session;
    if (this.last) {
      const dt = Math.max(0, Math.min(5000, at - this.last.at));
      const prev = this.last;
      s[`${prev.cls}Ms`] = (s[`${prev.cls}Ms`] ?? 0) + dt;
      const u = s.usage.get(prev.key);
      if (u) u.ms += dt;
      if (prev.cls === 'distract' && this.episode) this.episode.ms += dt;
    }
    if (!s.usage.has(screen.key)) s.usage.set(screen.key, { screen: { ...screen, self: undefined }, ms: 0 });
    this.last = { at, cls: verdict.cls, key: screen.key };

    const ep = this.episode;
    if (verdict.cls === 'distract') {
      if (!ep) this.episode = { start: at, ms: 0, level: 0, name: verdict.name, key: screen.key, lastAt: at, screen };
      else Object.assign(ep, { lastAt: at, name: verdict.name, key: screen.key, screen });
      const e = this.episode;
      const steps = [
        [1, cfg.graceSec * 1000],
        [2, cfg.speakSec > 0 ? cfg.speakSec * 1000 : Infinity],
        [3, cfg.askMin > 0 ? cfg.askMin * 60000 : Infinity],
      ];
      let reached = e.level;
      for (const [lv, ms] of steps) if (e.ms >= ms && lv > reached) reached = lv;
      if (reached > e.level) {
        e.level = reached;
        out.push({ type: 'nudge', level: reached, episode: { ...e } });
      }
    } else if (ep) {
      const away = at - ep.lastAt;
      const back =
        verdict.cls === 'study' ||
        (verdict.cls === 'neutral' && away >= (cfg.returnSec ?? 10) * 1000) ||
        (verdict.cls === 'self' && away >= (cfg.selfReturnSec ?? 45) * 1000);
      if (back) this._close(at, out, true);
    }
    return out;
  }

  _close(at, out, praise) {
    const e = this.episode;
    if (!e) return;
    this.episode = null;
    if (e.level >= 1) {
      this.session.episodes.push({ start: e.start, end: e.lastAt, ms: e.ms, name: e.name, key: e.key, level: e.level });
      if (praise) out.push({ type: 'back', episode: { ...e } });
    }
  }

  /** いまの寄り道を、なかったことにする（「これは勉強用」と教えてもらったとき） */
  forgive(isStillDistract) {
    const before = this.session.episodes.length + (this.episode?.level >= 1 ? 1 : 0);
    if (this.episode && !isStillDistract(this.episode.key)) this.episode = null;
    this.session.episodes = this.session.episodes.filter((e) => isStillDistract(e.key));
    const after = this.session.episodes.length + (this.episode?.level >= 1 ? 1 : 0);
    return before - after;
  }

  /** スマホで気が散るアプリを開いたと届いたとき */
  phone(at, app) {
    this.session.phone.push({ at, app: String(app || 'スマホ').slice(0, 60) });
  }

  /**
   * 集中 1 回分のまとめを返して、次の集中のために空にする。
   * reclassify を渡すと、使った画面を今の分け方で数え直す（途中で「勉強用」と教えた分を反映するため）
   */
  take(at, reclassify = null) {
    this._close(at, [], false);
    const s = this.session;
    this.session = newSession();
    this.last = null;
    const screens = [...s.usage.values()]
      .filter((u) => u.ms >= 1000)
      .map((u) => ({ ...u.screen, ms: u.ms, cls: reclassify ? reclassify(u.screen).cls : undefined }))
      .sort((a, b) => b.ms - a.ms);
    const sum = { studyMs: s.studyMs, neutralMs: s.neutralMs, distractMs: s.distractMs, selfMs: s.selfMs };
    if (reclassify) {
      for (const k of Object.keys(sum)) sum[k] = 0;
      for (const sc of screens) sum[`${sc.cls}Ms`] = (sum[`${sc.cls}Ms`] ?? 0) + sc.ms;
    }
    return {
      ...sum,
      count: s.episodes.length,
      episodes: s.episodes,
      phone: s.phone,
      screens: screens.slice(0, 12).map(({ exe, title, page, app, browser, key, label, ms, cls }) => ({ exe, title: title.slice(0, 160), page: page.slice(0, 160), app, browser, key, label: label.slice(0, 160), ms, cls })),
    };
  }

  /** 何も見ていないか（記録に付けるほどのものがないか） */
  get empty() {
    const s = this.session;
    return !s.usage.size && !s.phone.length;
  }
}

/** 勉強用の画面にいた割合（Pomoroad 自身は勉強用として数える） */
export function studyRatio(g) {
  const total = (g.studyMs || 0) + (g.neutralMs || 0) + (g.distractMs || 0) + (g.selfMs || 0);
  return total > 0 ? ((g.studyMs || 0) + (g.selfMs || 0)) / total : null;
}

// ── 声かけの言葉 ──────────────────────────────────────

export const TONES = [
  ['gentle', 'やさしい'],
  ['coach', 'コーチ'],
  ['strict', 'きびしめ'],
];

const LINES = {
  gentle: {
    nudge: [
      '{app}が開いています。あと{remain}、{task}に戻りましょう',
      'ちょっと寄り道していますね。{task}をもう少しだけ進めましょう',
      '休憩まであと{remain}です。{app}は休憩のときの楽しみにとっておきましょう',
      '今日はもう{done}できています。この調子で{task}に戻りましょう',
    ],
    speak: ['{app}を見ているようです。{task}に戻りましょう', '休憩まであと{remain}です。いったん戻りましょう'],
    ask: ['{app}を{min}分見ています。いったん一時停止して、寄り道した時間を記録から外しますか？'],
    back: ['おかえりなさい。あと{remain}、このまま進めましょう', 'おかえりなさい。{task}の続きをいきましょう'],
    phone: ['スマホで{app}を開きました。スマホは手の届かないところに置いて、{task}に戻りましょう', 'スマホは休憩のときに。あと{remain}です'],
  },
  coach: {
    nudge: [
      'あと{remain}！ここが踏ん張りどころ。{task}に戻ろう',
      '今日はもう{done}。いい流れを切らさずにいこう',
      '{app}は休憩でゆっくり見られる。今は{task}に集中！',
      '手が止まっているよ。まずは 1 行だけでも{task}を進めよう',
    ],
    speak: ['{app}はあとで。{task}に戻ろう。あと{remain}！', 'ここで戻れたら勝ち。{task}に集中しよう'],
    ask: ['{app}を{min}分見ています。一時停止して、寄り道した時間を記録から外しますか？'],
    back: ['よく戻った！あと{remain}、一気にいこう', 'ナイス切り替え！{task}、この勢いで進めよう'],
    phone: ['スマホで{app}を開いたね。スマホは裏返して、{task}に戻ろう', 'スマホはあと{remain}がまん！'],
  },
  strict: {
    nudge: ['{app}を閉じて、{task}に戻ってください', '集中の時間です。あと{remain}残っています', '{app}は休憩になってから。今は{task}の時間です'],
    speak: ['{app}を閉じましょう。今は{task}の時間です', 'まだ集中の時間です。すぐに戻ってください'],
    ask: ['{app}を{min}分見ています。この集中を一時停止して、寄り道した時間を記録から外しますか？'],
    back: ['戻りましたね。あと{remain}、続けてください', '戻りましたね。{task}を続けましょう'],
    phone: ['スマホで{app}を開きました。スマホを置いて、{task}に戻ってください', 'スマホは休憩になってから。あと{remain}です'],
  },
};

const TITLES = {
  nudge: { gentle: '集中に戻りましょう', coach: '集中に戻ろう！', strict: '集中の時間です' },
  ask: { gentle: '一時停止しますか？', coach: '一時停止しますか？', strict: '一時停止しますか？' },
  back: { gentle: 'おかえりなさい', coach: 'ナイス！', strict: '戻りましたね' },
  phone: { gentle: 'スマホを開きました', coach: 'スマホを開いたね', strict: 'スマホを開きました' },
};

/** 残り時間を「12分」「1分足らず」のように言う */
export function remainText(ms) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '';
  const m = Math.floor(ms / 60000);
  return m >= 1 ? `${m}分` : '1分足らず';
}

/**
 * 声かけの言葉を作る。ctx：{ app, task, remainMs, done, min }。
 * 値が無い差し込み（例：ストップウォッチで残り時間がない）を含む文は選ばない。前回と同じ文はなるべく避ける
 */
export function guardMessage(kind, tone, ctx, { random = Math.random, avoid = null } = {}) {
  const set = LINES[tone] ?? LINES.coach;
  const lines = set[kind === 'speak' ? 'speak' : kind] ?? set.nudge;
  const vals = {
    app: ctx.app || 'ほかの画面',
    task: ctx.task || '勉強',
    remain: remainText(ctx.remainMs),
    done: ctx.done > 0 ? `ポモドーロ${ctx.done}回` : '',
    min: ctx.min ? String(ctx.min) : '',
  };
  const usable = lines.filter((l) => [...l.matchAll(/\{(\w+)\}/g)].every(([, k]) => vals[k]));
  const pool = usable.length > 1 && avoid ? usable.filter((l) => l !== avoid) : usable;
  const tpl = pool.length ? pool[Math.floor(random() * pool.length)] : lines[lines.length - 1];
  const body = tpl.replace(/\{(\w+)\}/g, (_, k) => vals[k] || '');
  const title = (TITLES[kind === 'speak' ? 'nudge' : kind] ?? TITLES.nudge)[tone] ?? TITLES.nudge.coach;
  return { title, body, tpl };
}

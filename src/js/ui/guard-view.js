// 見守りの画面：声かけのカード、「勉強用」などを覚えさせる画面、設定のタブ、統計

import { h, $, clear } from './dom.js';
import { icon } from './icons.js';
import { row, switchCtl, select, segmented, toast, textInput, confirmDialog } from './widgets.js';
import { DISTRACT_GROUPS, TONES, keywordChoices, screenOf, studyRatio } from '../core/guard.js';
import { fmtDuration, fmtTime, addDays } from '../core/util.js';
import { newTopic } from '../phone-link.js';

const CLS_LABEL = { study: '勉強用', distract: '気が散る', neutral: 'どちらでもない', self: 'Pomoroad' };
const CLS_OPTIONS = [
  ['study', '勉強用'],
  ['neutral', 'どちらでもない'],
  ['distract', '気が散る'],
];
/** 1 分に満たない時間も「0分」にしない */
const dur = (ms) => (ms > 0 && ms < 60000 ? '1分未満' : fmtDuration(ms));
const section = (title, ...children) => h('div', { class: 'section' }, title ? h('h3', null, title) : null, ...children);

// ── 声かけのカード（メイン画面のタイマーの上） ───────────────

export function renderGuardCard(ctl) {
  let host = $('#guard-card');
  if (!host) {
    host = h('div', { id: 'guard-card', role: 'alert' });
    $('#stage')?.append(host);
  }
  clear(host);
  const a = ctl.alert;
  host.className = a ? `show k-${a.kind}` : '';
  if (!a) return;
  const ep = a.episode ?? {};
  const sc = ep.screen;
  const btn = (label, fn, cls = '') => h('button', { class: `btn ${cls}`, onclick: fn }, label);
  const teach = sc ? btn('これは勉強用', () => ctl.teach(sc, 'study')) : null;
  let buttons;
  if (a.kind === 'ask') {
    buttons = [btn('一時停止する', () => ctl.pauseHere(), 'primary'), btn('勉強に戻る', () => ctl.dismiss()), teach];
  } else if (a.kind === 'nudge') {
    buttons = [btn('勉強に戻る', () => ctl.dismiss(), 'primary'), teach, btn('今は休憩にする', () => ctl.takeBreak())];
  } else {
    buttons = [btn('閉じる', () => ctl.dismiss())];
  }
  const where = sc ? `${sc.browser ? sc.app : ''}${sc.browser ? '「' : ''}${sc.label}${sc.browser ? '」' : ''}` : ep.name || '';
  host.append(
    h('div', { class: 'gc-head' }, icon(a.kind === 'phone' ? 'phone' : a.kind === 'back' ? 'check' : 'eye', 18), h('b', null, a.title), h('span', { class: 'spacer' }), h('button', { class: 'icon-btn', 'aria-label': '閉じる', onclick: () => ctl.dismiss() }, icon('close', 16))),
    h('p', { class: 'gc-body' }, a.body),
    where && a.kind !== 'back' ? h('p', { class: 'gc-where' }, a.trial ? 'ためしの表示です（記録には残りません）' : where) : null,
    h('div', { class: 'btn-row' }, buttons),
  );
}

// ── 分け方を覚えさせる画面 ──────────────────────────────

/**
 * 画面（または空）から、分け方を 1 つ作ってもらう。返り値は rule か null
 * rule：{ kind: 'title' | 'app', text, as, task }
 */
export function learnDialog(app, screen, as = 'study') {
  const sc = screen ?? null;
  const task = app.data.currentTask;
  const state = {
    as,
    kind: sc && !sc.browser && sc.exe !== 'applicationframehost' ? 'app' : 'title',
    text: sc ? (sc.browser || sc.exe === 'applicationframehost' ? sc.page || sc.title : '') : '',
    taskOnly: false,
  };
  return new Promise((resolve) => {
    const close = (v) => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
    };
    const input = h('input', { class: 'txt', value: state.text, placeholder: '例：線形代数、Moodle、講義', oninput: () => (state.text = input.value) });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
      e.stopPropagation();
    });
    const appInput = h('input', { class: 'txt', placeholder: '例：chrome、discord（アプリの名前）' });
    const chips = sc
      ? h('div', { class: 'learn-chips' }, keywordChoices(sc).map((k) => h('button', { class: 'chip-btn', type: 'button', onclick: () => { input.value = k; state.text = k; pick('title'); } }, k)))
      : null;
    const kindBox = h('div', { class: 'learn-kind' });
    const pick = (k) => {
      state.kind = k;
      renderKind();
    };
    const renderKind = () => {
      clear(kindBox);
      const opt = (k, label, extra) => h('label', { class: ['learn-opt', state.kind === k && 'on'] }, h('input', { type: 'radio', name: 'learn-kind', checked: state.kind === k, onchange: () => pick(k) }), h('span', null, label), extra);
      kindBox.append(opt('title', '題名にこの言葉が入っているとき', state.kind === 'title' ? h('div', { class: 'learn-sub' }, input, chips) : null));
      if (sc) {
        kindBox.append(opt('app', `このアプリ（${sc.app}）のときはいつも`, sc.browser && state.kind === 'app' ? h('small', { class: 'hint' }, 'ブラウザ全体が対象になります。サイトごとに分けるなら上の「題名」を使ってください') : null));
      } else {
        kindBox.append(opt('app', 'このアプリのとき', state.kind === 'app' ? h('div', { class: 'learn-sub' }, appInput) : null));
      }
    };
    renderKind();
    const save = () => {
      const text = state.kind === 'app' ? (sc ? sc.exe : appInput.value.trim()) : input.value.trim();
      if (!text) {
        toast(state.kind === 'app' ? 'アプリの名前を入れてください' : '言葉を入れてください');
        return;
      }
      close({ kind: state.kind, text, as: state.as, task: state.taskOnly && task ? task.id : null });
    };
    const back = h(
      'div',
      { class: 'modal-back', onclick: (e) => e.target === back && close(null) },
      h(
        'div',
        { class: 'modal learn' },
        h('h3', null, sc ? 'この画面の分け方を覚える' : '分け方を追加'),
        sc ? h('p', { class: 'learn-screen' }, h('b', null, sc.app), h('br'), sc.title || '（題名なし）') : null,
        h('div', { class: 'learn-row' }, h('span', null, '分け方'), segmented(state.as, CLS_OPTIONS, (v) => (state.as = v))),
        kindBox,
        task ? h('label', { class: 'learn-task' }, h('input', { type: 'checkbox', onchange: (e) => (state.taskOnly = e.target.checked) }), `「${task.title}」のときだけ`) : null,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => close(null) }, 'キャンセル'), h('button', { class: 'btn primary', onclick: save }, '覚える')),
      ),
    );
    document.body.append(back);
    document.addEventListener('keydown', onKey, true);
    (state.kind === 'title' ? input : back.querySelector('.btn.primary'))?.focus();
  });
}

// ── 設定の「見守り」タブ ───────────────────────────────

export function guardTab(body, s, set, app, rerender) {
  const g = s.guard;
  const ctl = app.guard;
  const desktop = ctl.available;
  body.append(
    section(
      '見守り',
      row('集中中に気が散る画面を見張る', switchCtl(g.enabled, (v) => { set('guard.enabled', v); rerender(); }), {
        hint: '集中しているあいだだけ、2 秒ごとに「前に出ているアプリの名前」と「画面の題名」を見ます。画面の中身は見ません。記録はこのパソコンの中だけに残ります。休憩中は見ません。',
      }),
      desktop ? null : h('p', { class: 'hint' }, 'パソコンの画面の見張りは Windows アプリで使えます（スマホ連携は下の「スマホ」から）。'),
      ctl.status?.unsupported ? h('p', { class: 'hint' }, 'この環境では前の画面を調べられません（Windows だけ）。') : null,
      ctl.status?.error ? h('p', { class: 'hint warn' }, `前の画面を調べられませんでした：${ctl.status.error}`) : null,
    ),
  );
  if (desktop) body.append(liveSection(app));

  const dis = !g.enabled;
  body.append(
    section(
      '声かけ',
      row('口調', segmented(g.tone, TONES, (v) => set('guard.tone', v)), { disabled: dis }),
      row('見逃す時間', select(g.graceSec, [[10, '10秒'], [20, '20秒'], [30, '30秒'], [60, '1分'], [120, '2分']], (v) => set('guard.graceSec', Number(v))), { hint: 'ちょっと調べ物をしただけ、などで声をかけないように', disabled: dis }),
      row('2 回目の声かけ', select(g.speakSec, [[0, 'しない'], [45, '45秒たったら'], [60, '1分たったら'], [90, '1分半たったら'], [120, '2分たったら'], [300, '5分たったら']], (v) => set('guard.speakSec', Number(v))), { hint: '読み上げて、Pomoroad を前に出します', disabled: dis }),
      row('一時停止をたずねる', select(g.askMin, [[0, 'たずねない'], [2, '2分たったら'], [3, '3分たったら'], [5, '5分たったら'], [10, '10分たったら']], (v) => set('guard.askMin', Number(v))), { hint: '一時停止すると、寄り道した時間は集中の記録から外れます', disabled: dis }),
      row('Windows の通知', switchCtl(g.notify, (v) => set('guard.notify', v)), { disabled: dis }),
      row('ミニ表示に出す', switchCtl(g.mini, (v) => set('guard.mini', v)), { hint: 'ミニ表示を消していても、声をかけるあいだだけ出します', disabled: dis }),
      row('読み上げる', switchCtl(g.voice, (v) => set('guard.voice', v)), { hint: '2 回目の声かけから', disabled: dis }),
      row('Pomoroad を前に出す', switchCtl(g.front, (v) => set('guard.front', v)), { hint: '2 回目の声かけから', disabled: dis }),
      row('戻ったらほめる', switchCtl(g.praise, (v) => set('guard.praise', v)), { disabled: dis }),
      row('集中のあと、使った画面の仕分けをすすめる', switchCtl(g.sortPrompt, (v) => set('guard.sortPrompt', v)), { disabled: dis }),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => ctl.trial(), disabled: dis }, icon('eye', 15), '声かけを試す')),
    ),
  );

  body.append(
    section(
      '気が散るもの（はじめから入っている分け方）',
      DISTRACT_GROUPS.map((gr) => row(gr.label, switchCtl(g.groups[gr.id] ?? !gr.off, (v) => set(`guard.groups.${gr.id}`, v)), { hint: gr.examples, disabled: dis })),
      h('p', { class: 'hint' }, '題名に「講義」「解説」「授業」「lecture」などが入っている動画は、勉強用として扱います。Word・Excel・PDF・MATLAB・VS Code・CoursePower なども勉強用です。'),
    ),
  );

  body.append(rulesSection(app, rerender));
  body.append(recentSection(app, rerender));
  body.append(phoneSection(app, rerender));
}

/** いま（直前）の画面がどう分けられるか。設定を開いている間、2 秒ごとに更新 */
function liveSection(app) {
  const ctl = app.guard;
  const box = h('div', { class: 'guard-live' });
  const draw = () => {
    clear(box);
    const cur = ctl.lastOther;
    if (!cur) {
      box.append(h('p', { class: 'hint' }, ctl.status?.error ? `調べられませんでした：${ctl.status.error}` : '別の画面に切り替えてから、ここに戻ってきてください。その画面がどう分けられるかを表示します。'));
      return;
    }
    const v = ctl.verdictOf(cur.screen);
    box.append(
      h('div', { class: 'gl-main' },
        h('span', { class: `cls-badge c-${v.cls}` }, CLS_LABEL[v.cls]),
        h('div', { class: 'gl-text' }, h('b', null, cur.screen.app), h('div', { class: 'gl-title' }, cur.screen.title || '（題名なし）'), h('small', null, v.why)),
      ),
      h('div', { class: 'btn-row' },
        CLS_OPTIONS.filter(([k]) => k !== v.cls).map(([k, label]) => h('button', { class: 'btn', onclick: () => ctl.teach(cur.screen, k).then((ok) => ok && draw()) }, `${label}にする`)),
      ),
    );
  };
  draw();
  ctl.onPreview = () => {
    if (box.isConnected) draw();
  };
  return section('直前に使った画面', box, h('p', { class: 'hint' }, 'ほかのアプリやタブに切り替えて戻ってくると、ここで分け方を確かめられます。'));
}

function rulesSection(app, rerender) {
  const ctl = app.guard;
  const rules = app.settings.guard.rules;
  const taskName = (id) => app.data.tasks.find((t) => t.id === id)?.title ?? '（削除したタスク）';
  const list = rules.length
    ? h('div', { class: 'rule-list' }, rules.map((r) => h('div', { class: 'rule' },
      h('span', { class: `cls-badge c-${r.as}` }, CLS_LABEL[r.as]),
      h('span', { class: 'rule-text' }, r.kind === 'app' ? `アプリ：${r.text}` : `題名に「${r.text}」`),
      r.task ? h('span', { class: 'rule-task' }, `${taskName(r.task)} のとき`) : null,
      h('button', { class: 'icon-btn', 'aria-label': '消す', onclick: () => { ctl.removeRule(r.id); rerender(); } }, icon('trash', 14)),
    )))
    : h('p', { class: 'hint' }, 'まだありません。声かけの「これは勉強用」や、下の「最近使った画面」から追加できます。');
  return section('自分で決めた分け方', list, h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: async () => { if (await ctl.teach(null, 'study')) rerender(); } }, icon('plus', 15), '追加…')));
}

/** 最近の集中で使った画面（この 7 日間の記録と、いま起動してから見た画面） */
function recentSection(app, rerender) {
  const ctl = app.guard;
  const today = app.data.todayKey();
  const keys = new Set(Array.from({ length: 7 }, (_, i) => addDays(today, -i)));
  const map = new Map();
  for (const r of app.data.records) {
    if (!r.guard?.screens || !keys.has(app.data.keyOf(r.start))) continue;
    for (const sc of r.guard.screens) {
      const m = map.get(sc.key) ?? { screen: sc, ms: 0 };
      m.ms += sc.ms;
      map.set(sc.key, m);
    }
  }
  for (const sc of ctl.recent.values()) if (!map.has(sc.key)) map.set(sc.key, { screen: sc, ms: 0 });
  const items = [...map.values()].sort((a, b) => b.ms - a.ms).slice(0, 20);
  if (!items.length) return section('最近使った画面', h('p', { class: 'hint' }, '集中中に使った画面が、ここに並びます。'));
  return section(
    '最近使った画面',
    h('p', { class: 'hint' }, '集中中に使った画面です（この 7 日間）。分け方を変えると、次からその分け方で見張ります。'),
    h('div', { class: 'screen-list' }, items.map(({ screen, ms }) => {
      const sc = screenOf({ title: screen.title, exe: screen.exe, desc: screen.app });
      const v = ctl.verdictOf(sc);
      return h('div', { class: 'screen-row' },
        h('div', { class: 'sr-text' }, h('b', null, sc.label), h('small', null, `${sc.browser ? `${sc.app}・` : ''}${ms ? dur(ms) : 'いま起動してから'}`)),
        segmented(v.cls === 'self' ? 'study' : v.cls, CLS_OPTIONS, async (k) => {
          await ctl.teach(sc, k);
          rerender();
        }),
      );
    })),
  );
}

// ── 統計 ──────────────────────────────────────────

/** 統計パネルの「見守り」。記録が無ければ null */
export function guardStats(app) {
  const data = app.data;
  const today = data.todayKey();
  const week = new Set(Array.from({ length: 7 }, (_, i) => addDays(today, -i)));
  const sum = (recs) => {
    const o = { studyMs: 0, neutralMs: 0, distractMs: 0, selfMs: 0, count: 0, phone: 0, n: 0 };
    for (const r of recs) {
      const g = r.guard;
      if (!g) continue;
      o.n++;
      for (const k of ['studyMs', 'neutralMs', 'distractMs', 'selfMs']) o[k] += g[k] || 0;
      o.count += g.count || 0;
      o.phone += g.phone?.length || 0;
    }
    return o;
  };
  const focus = data.records.filter((r) => r.type === 'focus' && r.guard);
  const recsWeek = focus.filter((r) => week.has(data.keyOf(r.start)));
  if (!recsWeek.length) return null;
  const t = sum(recsWeek.filter((r) => data.keyOf(r.start) === today));
  const w = sum(recsWeek);
  const pct = (g) => {
    const r = studyRatio(g);
    return r == null ? '—' : `${Math.round(r * 100)}%`;
  };
  // よく開いた気が散るもの
  const top = new Map();
  for (const r of recsWeek) for (const sc of r.guard.screens ?? []) if (sc.cls === 'distract') top.set(sc.label, (top.get(sc.label) || 0) + sc.ms);
  const topList = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const tile = (label, value, sub) => h('div', { class: 'stat-tile' }, h('div', { class: 'l' }, label), h('div', { class: 'v' }, value), sub ? h('div', { class: 'l', style: { marginTop: '4px' } }, sub) : null);
  return h('div', { class: 'section' },
    h('h3', null, '見守り'),
    h('div', { class: 'stat-tiles' },
      tile('今日の寄り道', dur(t.distractMs), `声かけ ${t.count} 回・スマホ ${t.phone} 回`),
      tile('この7日間の寄り道', dur(w.distractMs), `声かけ ${w.count} 回・スマホ ${w.phone} 回`),
      tile('勉強用の画面にいた割合', pct(t), `この7日間 ${pct(w)}`),
    ),
    topList.length ? h('div', { class: 'guard-top' }, h('small', null, 'よく開いた気が散るもの（7日間）'), topList.map(([label, ms]) => h('div', { class: 'gt-row' }, h('span', null, label), h('span', { class: 'num' }, dur(ms))))) : null,
  );
}

// ── スマホ連携 ────────────────────────────────────────

const copy = (text) =>
  navigator.clipboard.writeText(text).then(
    () => toast('コピーしました'),
    () => toast('コピーできませんでした'),
  );

const copyable = (text) => h('div', { class: 'copy-box' }, h('code', null, text), h('button', { class: 'btn', onclick: () => copy(text) }, 'コピー'));

/** つながりを順に確かめるボタン（① パソコン ↔ 中継サービス、② パソコン → スマホ） */
function checkBox(ctl) {
  const c = ctl.lastCheck;
  let result = null;
  if (c?.kind === 'self') {
    result = {
      ok: 'パソコン側は正常です（中継サービスに送れて、受け取れました）。あとはスマホ側の設定です',
      send: '中継サービスに送れませんでした。インターネットにつながっているか、「詳しい設定」の中継サーバーを確かめてください',
      receive: '送れましたが、受け取れませんでした。少し待ってからもう一度試してください',
    }[c.result];
  } else if (c?.kind === 'phone') {
    result = c.ok ? 'スマホの ntfy アプリに送りました。通知が出なければ、ntfy アプリにトピック名を登録しているか（手順 6）を確かめてください' : '送れませんでした。インターネットとトピック名を確かめてください';
  }
  const busy = h('span');
  return h('div', { class: 'phone-check' },
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onclick: async (e) => { e.currentTarget.disabled = true; busy.textContent = '確かめています…（15 秒ほど）'; await ctl.selfCheck(); } }, icon('check', 15), '① パソコン側を確かめる'),
      h('button', { class: 'btn', onclick: () => ctl.test() }, icon('phone', 15), '② スマホの ntfy アプリに送る'),
      busy,
    ),
    h('small', null, '② は、スマホの ntfy アプリでトピック名を登録している（手順 6）ときだけ通知が出ます。「かんたん」の手順だけなら、スマホには何も出ないのがふつうです。'),
    result ? h('p', { class: ['phone-result', c.kind === 'self' && c.result !== 'ok' && 'warn', c.kind === 'phone' && !c.ok && 'warn'] }, `${fmtTime(c.at)}　${result}`) : null,
  );
}

const STATUS_TEXT = { off: '止まっています', connecting: 'つないでいます…', connected: 'つながっています', error: 'つながっていません' };

function phoneSection(app, rerender) {
  const p = app.settings.phone;
  const ctl = app.phone;
  const set = (k, v) => app.set(`phone.${k}`, v);
  const box = h('div');
  const intro = h('p', { class: 'hint' }, 'Android の MacroDroid と、無料の中継サービス ntfy を使います。スマホで気が散るアプリを開いたら、パソコンでも声をかけて記録します。集中中はスマホをおやすみモードにもできます。送るのは「集中開始・集中終了」と「開いたアプリの名前」だけです。');
  if (!ctl.available) return section('スマホ（Android）', intro, h('p', { class: 'hint' }, 'Windows アプリで使えます。'));
  const draw = () => {
    clear(box);
    box.append(row('スマホと連携する', switchCtl(p.enabled, (v) => { set('enabled', v); draw(); })));
    if (!p.enabled) return;
    const st = ctl.status ?? { state: 'off' };
    box.append(
      h('p', { class: ['phone-status', `s-${st.state}`] }, h('span', { class: 'dot' }), STATUS_TEXT[st.state] ?? st.state, st.error ? `（${st.error}）` : ''),
      row('集中の始まりと終わりをスマホに知らせる', switchCtl(p.sendFocus, (v) => set('sendFocus', v)), { hint: 'スマホをおやすみモードにするのに使います（手順の「しっかり」）' }),
      row('スマホでアプリを開いたら、パソコンでも声をかける', switchCtl(p.nudge, (v) => set('nudge', v)), { hint: 'オフでも回数は記録します' }),
      checkBox(ctl),
    );
    const recv = ctl.received;
    box.append(
      h('div', { class: 'phone-recv' },
        h('small', null, 'スマホから届いた知らせ'),
        recv.length
          ? recv.map((r) => h('div', { class: 'pr-row' }, h('span', null, fmtTime(r.at)), h('b', null, r.app), h('small', null, r.counted ? '集中中なので記録しました' : '集中中ではないので数えていません')))
          : h('div', { class: 'pr-row' }, h('small', null, 'まだ届いていません')),
        h('small', null, 'スマホで、MacroDroid に登録したアプリを開くと、ここに出ます（集中中でなくても出ます。数えるのは集中中だけ）。出ないときは、MacroDroid の HTTP リクエストの URL（最後が -pc/publish?message=…）と、方式が GET かを確かめてください。'),
      ),
    );
    box.append(setupGuide(app));
    box.append(
      h('details', { class: 'phone-adv' },
        h('summary', null, '詳しい設定'),
        row('トピック名', h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: async () => {
          if (!(await confirmDialog({ title: 'トピック名を作り直しますか？', message: 'スマホの ntfy アプリと MacroDroid の URL も、新しいトピック名に直す必要があります。', ok: '作り直す' }))) return;
          set('topic', newTopic());
          draw();
        } }, '作り直す')), { hint: 'トピック名を知っている人は知らせを読み書きできます。他の人に教えないでください' }),
        row('中継サーバー', textInput(p.server, (v) => set('server', v.trim() || 'https://ntfy.sh'), { placeholder: 'https://ntfy.sh' }), { hint: 'ふつうは https://ntfy.sh のまま' }),
      ),
    );
  };
  draw();
  ctl.onChange = () => {
    if (box.isConnected) draw();
  };
  return section('スマホ（Android）', intro, box);
}

/** スマホ側の設定のしかた（トピック名と URL を入れて表示する） */
function setupGuide(app) {
  const p = app.settings.phone;
  const server = (p.server || 'https://ntfy.sh').replace(/\/+$/, '');
  const url = `${server}/${p.topic}-pc/publish?message=`;
  const step = (n, ...children) => h('li', null, h('b', { class: 'step-n' }, n), h('div', null, ...children));
  return h('details', { class: 'phone-guide' },
    h('summary', null, 'スマホの設定のしかた'),
    h('h4', null, 'かんたん：気が散るアプリを開いたら、パソコンに知らせる'),
    h('ol', null,
      step('1', 'スマホに ', h('b', null, 'MacroDroid'), ' を入れます（Polaris の家計取り込みで使っているもので大丈夫です）。'),
      step('2', 'マクロを追加して、名前を「Pomoroad 気が散るアプリ」にします。'),
      step('3', h('b', null, 'トリガー'), '：「アプリケーション」→「アプリの起動/終了」→「起動時」で、気が散るアプリ（YouTube・Instagram・X・TikTok・ゲームなど）を選びます。'),
      step('4', h('b', null, 'アクション'), '：「Web 連携」→「HTTP リクエスト」。方式は ', h('b', null, 'GET'), '、URL に次を貼り付けます。', copyable(url),
        h('small', null, 'URL の最後（message= のあと）に、入力欄の右の「…」→ マジックテキストから「アプリ名」に当たるもの（なければ「トリガー」）を入れると、どのアプリかがパソコンに出ます。入れなくても動きます。本文（ボディ）に入れた変数は置き換わらないことがあるので、URL に入れてください。')),
      step('5', 'パソコンで集中しているときにそのアプリを開くと、Pomoroad が声をかけて記録します。集中中でないときは何もしません。'),
    ),
    h('h4', null, 'しっかり：集中中はスマホもおやすみモードにする'),
    h('ol', null,
      step('6', 'スマホに ', h('b', null, 'ntfy'), ' アプリを入れ、「＋」で次のトピック名を登録します（サーバーは ntfy.sh のまま）。', copyable(p.topic)),
      step('7', 'MacroDroid でマクロ「Pomoroad 集中開始」を作ります。トリガー：「通知」→「通知を受信」、アプリは ntfy、文字に「集中開始」を含む。アクション：「音量」→「優先モード/通知のミュート」→「優先通知のみ許可」（電話も止めたいなら「全通知をブロック」）、続けて変数 pomoroad_focus をオン（true）。',
        h('small', null, 'MacroDroid には「おやすみモード」という名前のアクションはなく、「優先モード/通知のミュート」（英語表示では Priority Mode / Do Not Disturb）がそれに当たります。見つからないときは、アクションを追加する画面の虫めがねで「優先」や「Priority」と検索してください。初めて使うときに「サイレントモードへのアクセス（Do Not Disturb access）」の許可を求められるので、MacroDroid を許可します。Android 15 以降では、MacroDroid 専用のモード（MacroDroid Do Not Disturb）が使われます。')),
      step('8', 'マクロ「Pomoroad 集中終了」を作ります。トリガー：同じく「集中終了」を含む。アクション：「音量」→「優先モード/通知のミュート」→「全通知を許可」、pomoroad_focus をオフ（false）。'),
      step('9', '手順 2 のマクロに、制約「変数 pomoroad_focus がオン」を足し、HTTP リクエストのあとに「ホーム画面を表示」と「読み上げ：今は集中の時間です」を足します。'),
    ),
    h('p', { class: 'hint' }, '無料版の MacroDroid はマクロが 5 つまでです。足りないときは 7 と 8 を 1 つにまとめられます（トリガーを 2 つにして「もし〜なら」で分ける）。時計を見るためにスマホを点けるだけなら数えません。'),
  );
}


// 見守りの画面：声かけのカード、「勉強用」などを覚えさせる画面、設定のタブ、統計

import { h, $, clear } from './dom.js';
import { icon } from './icons.js';
import { row, switchCtl, select, segmented, toast } from './widgets.js';
import { DISTRACT_GROUPS, TONES, keywordChoices, screenOf, studyRatio } from '../core/guard.js';
import { fmtDuration, addDays } from '../core/util.js';

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

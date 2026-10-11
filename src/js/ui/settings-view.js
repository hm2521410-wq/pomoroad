// 設定パネル（タブごと）

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { row, switchCtl, stepper, select, segmented, slider, colorPick, keyRecorder, codeLabel, confirmDialog, promptDialog, toast } from './widgets.js';
import { BUILTIN_PRESETS, buildRoad, STEP_TYPES, roadMinutes, focusCount } from '../core/sequence.js';
import { ALARMS, TICKS } from '../audio/oneshots.js';
import { BACKGROUNDS, EFFECTS } from './background.js';
import { DEFAULTS } from '../core/store.js';
import { putFile, deleteFile } from '../core/idb.js';
import { fmtDuration } from '../core/util.js';

export const SETTINGS_TABS = [
  ['timer', 'タイマー', 'hourglass'],
  ['alerts', '通知・音', 'bell'],
  ['view', '表示', 'palette'],
  ['mini', 'ミニ表示', 'pip'],
  ['keys', 'ショートカット', 'keyboard'],
  ['system', 'システム', 'window'],
  ['data', 'データ', 'database'],
];

const section = (title, ...children) => h('div', { class: 'section' }, title ? h('h3', null, title) : null, ...children);

export function renderSettings(body, tab, app) {
  clear(body);
  const s = app.settings;
  const set = (path, v, opts) => app.set(path, v, opts);
  const rerender = () => renderSettings(body, tab, app);
  const fn = { timer: timerTab, alerts: alertsTab, view: viewTab, mini: miniTab, keys: keysTab, system: systemTab, data: dataTab }[tab] ?? timerTab;
  fn(body, s, set, app, rerender);
}

// ── タイマー ──────────────────────────────────────
export function roadPreview(road, colors) {
  const total = road.reduce((a, x) => a + x.dur, 0) || 1;
  return h(
    'div',
    { class: 'p-road', style: { marginTop: '8px' } },
    road.map((x) => h('i', { style: { flex: `${x.dur / total} 1 0`, minWidth: '3px', background: colors[x.type], opacity: x.type === 'focus' ? 1 : 0.7 }, title: `${STEP_TYPES[x.type].label} ${Math.round(x.dur / 60)}分` })),
  );
}

function presetMatches(p, t) {
  const pt = p.patch;
  if (pt.mode !== t.mode) return false;
  if (pt.mode !== 'pomodoro') return true;
  if (t.planKind !== 'simple') return false;
  return Object.entries(pt.simple).every(([k, v]) => t.simple[k] === v || (k === 'warmup' && t.simple.startWith === 'focus'));
}

function timerTab(body, s, set, app, rerender) {
  const t = s.timer;
  const colors = s.view.colors;
  body.append(
    section(
      'モード',
      segmented(t.mode, [['pomodoro', 'ポモドーロ'], ['flow', 'フロータイム'], ['stopwatch', 'ストップウォッチ']], (v) => {
        set('timer.mode', v);
        rerender();
      }),
      h('p', { class: 'hint', style: { marginTop: '10px' } },
        t.mode === 'pomodoro' ? '決めた時間で集中と休憩をくり返します。並び方は下で自由に変えられます。'
          : t.mode === 'flow' ? '集中は時間を決めずに計り、「休憩する」を押すと集中した長さに合わせた休憩が始まります。'
            : '経過時間だけを測ります。「終了して記録」で記録して 0 に戻ります。'),
    ),
  );

  if (t.mode === 'pomodoro') {
    body.append(
      section(
        'プリセット',
        h('div', { class: 'preset-list' },
          BUILTIN_PRESETS.filter((p) => p.patch.mode === 'pomodoro').map((p) => {
            const road = buildRoad({ ...structuredClone(DEFAULTS.timer), ...p.patch, simple: { ...DEFAULTS.timer.simple, ...p.patch.simple } }, 0);
            return h('button', { class: ['preset', presetMatches(p, t) && 'on'], onclick: () => { app.applyPreset(p.patch); rerender(); } },
              h('div', { class: 'p-main' }, h('div', { class: 'p-name' }, p.name), h('div', { class: 'p-desc' }, p.desc), roadPreview(road, colors)));
          }),
        ),
      ),
    );

    const plan = section(
      '並び方',
      segmented(t.planKind, [['simple', 'シンプル（回数と間隔で決める）'], ['custom', 'カスタム（1つずつ並べる）']], (v) => {
        if (v === 'custom' && JSON.stringify(t.custom.steps) === JSON.stringify(DEFAULTS.timer.custom.steps)) {
          // 今のシンプル設定をカスタムの出発点にする
          const road = buildRoad({ ...t, planKind: 'simple' }, 0);
          set('timer.custom.steps', road.map((x) => ({ type: x.type, min: x.dur / 60, label: x.label || '' })), { silent: true });
        }
        set('timer.planKind', v);
        rerender();
      }),
    );
    body.append(plan);

    if (t.planKind === 'simple') {
      const sp = t.simple;
      body.append(
        section(
          '時間と回数',
          row('集中', stepper(sp.focus, (v) => set('timer.simple.focus', v), { min: 1, max: 240, unit: '分' })),
          row('短い休憩', stepper(sp.short, (v) => set('timer.simple.short', v), { min: 1, max: 120, unit: '分' })),
          row('長い休憩', stepper(sp.long, (v) => set('timer.simple.long', v), { min: 1, max: 180, unit: '分' })),
          row('長い休憩をとる間隔', stepper(sp.longEvery, (v) => { set('timer.simple.longEvery', v); }, { min: 0, max: 12, unit: '回ごと' }), { hint: '0 にすると長い休憩なし' }),
          row('1セットの集中の回数', stepper(sp.rounds, (v) => set('timer.simple.rounds', v), { min: 1, max: 24, unit: '回' })),
          row('最初のステップ', select(sp.startWith, [['focus', 'すぐ集中から'], ['short', '短い休憩から（準備運動）'], ['long', '長い休憩から']], (v) => { set('timer.simple.startWith', v); rerender(); }), { hint: '「休憩から」にすると、準備の時間をとってから集中を始められます' }),
          sp.startWith !== 'focus' ? row('最初の休憩の長さ', stepper(sp.warmup, (v) => set('timer.simple.warmup', v), { min: 1, max: 60, unit: '分' })) : null,
          sp.startWith !== 'focus' ? row('2周目以降も最初の休憩を入れる', switchCtl(sp.warmupEveryCycle, (v) => set('timer.simple.warmupEveryCycle', v))) : null,
          row('セットの最後', select(sp.lastBreak, [['auto', '自動'], ['long', '長い休憩'], ['short', '短い休憩'], ['none', '休憩なし']], (v) => set('timer.simple.lastBreak', v)), { hint: '自動：長い休憩を使う設定なら長い休憩で終わる' }),
        ),
      );
    } else {
      body.append(customEditor(t, set, rerender, colors));
    }

    const road = buildRoad(t, 0);
    body.append(
      section(
        'このセットの流れ',
        roadPreview(road, colors),
        h('p', { class: 'hint', style: { marginTop: '8px' } }, `集中 ${focusCount(road)} 回・合計 ${fmtDuration(roadMinutes(road) * 60000)}。タイマー画面の下の点（ロード）をクリックすると、その場で種類や時間を変えたり、好きなステップへ移動できます。`),
        row('セットが終わったらくり返す', switchCtl(t.repeat, (v) => set('timer.repeat', v))),
      ),
    );
  }

  if (t.mode === 'flow') {
    body.append(
      section(
        'フロータイム',
        row('休憩の長さ ＝ 集中時間 ÷', stepper(t.flow.ratio, (v) => set('timer.flow.ratio', v), { min: 2, max: 10, unit: '' }), { hint: '5 なら 50分集中で 10分休憩' }),
        row('休憩の最短', stepper(t.flow.minBreak, (v) => set('timer.flow.minBreak', v), { min: 1, max: 30, unit: '分' })),
        row('休憩の最長', stepper(t.flow.maxBreak, (v) => set('timer.flow.maxBreak', v), { min: 2, max: 90, unit: '分' })),
        row('休憩のあと自動で集中を始める', switchCtl(t.flow.autoStartFocus, (v) => set('timer.flow.autoStartFocus', v))),
      ),
    );
  }

  body.append(
    section(
      '進め方',
      t.mode === 'pomodoro' ? row('休憩を自動で始める', switchCtl(t.autoStartBreak, (v) => set('timer.autoStartBreak', v))) : null,
      t.mode === 'pomodoro' ? row('集中を自動で始める', switchCtl(t.autoStartFocus, (v) => set('timer.autoStartFocus', v)), { hint: 'オフなら休憩のあと、開始ボタンを押すまで待ちます' }) : null,
      row('時間切れのあとも数え続ける', switchCtl(t.overtime, (v) => set('timer.overtime', v)), { hint: '次を自動で始めない設定のとき、0 を過ぎた分を「+01:23」のように数え、記録にも入れます' }),
      row('スキップしたら次をすぐ始める', switchCtl(t.startAfterSkip, (v) => set('timer.startAfterSkip', v))),
      row('スキップ・切り上げの前に確認する', switchCtl(t.confirmSkip, (v) => set('timer.confirmSkip', v))),
      row('途中で切り上げてもポモドーロに数える割合', stepper(t.countThreshold, (v) => set('timer.countThreshold', v), { min: 10, max: 100, step: 5, unit: '%' }), { hint: '予定の何％以上集中したら 1 回に数えるか' }),
      row('記録する最短の時間', stepper(t.minRecordSec, (v) => set('timer.minRecordSec', v), { min: 0, max: 600, step: 30, unit: '秒' })),
      row('厳格モード', switchCtl(t.strict, (v) => set('timer.strict', v)), { hint: '集中中は一時停止・スキップを隠します。やめるときは確認のうえ「中断」' }),
    ),
    section(
      '目標',
      row('1日の目標', stepper(s.goal.daily, (v) => set('goal.daily', v), { min: 1, max: 40, unit: 'ポモドーロ' })),
      row('1日の区切り', stepper(s.goal.dayStartHour, (v) => set('goal.dayStartHour', v), { min: 0, max: 12, unit: '時' }), { hint: '夜ふかしした分を前の日に数えるための区切り（例：4時）' }),
    ),
    userPresets(app, rerender),
  );
}

function customEditor(t, set, rerender, colors) {
  const steps = t.custom.steps.map((x) => ({ ...x }));
  const commit = () => {
    set('timer.custom.steps', steps.map((x) => ({ ...x })));
    rerender();
  };
  const list = h('div', { class: 'step-list' });
  steps.forEach((st, i) => {
    list.append(
      h('div', { class: 'step-row' },
        h('span', { class: 'bar', style: { background: colors[st.type] } }),
        h('span', { class: 'no' }, i + 1),
        select(st.type, Object.entries(STEP_TYPES).map(([k, v]) => [k, v.label]), (v) => { st.type = v; commit(); }),
        stepper(st.min, (v) => { st.min = v; set('timer.custom.steps', steps.map((x) => ({ ...x }))); }, { min: 1, max: 240, unit: '分' }),
        h('input', { class: 'txt', size: 4, placeholder: 'メモ', value: st.label || '', onchange: (e) => { st.label = e.target.value; commit(); }, onkeydown: (e) => e.stopPropagation() }),
        h('button', { class: 'icon-btn', title: '上へ', onclick: () => { if (i > 0) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; commit(); } } }, icon('up', 16)),
        h('button', { class: 'icon-btn', title: '下へ', onclick: () => { if (i < steps.length - 1) { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; commit(); } } }, icon('down', 16)),
        h('button', { class: 'icon-btn', title: '削除', onclick: () => { if (steps.length > 1) { steps.splice(i, 1); commit(); } } }, icon('trash', 16)),
      ),
    );
  });
  const addBtn = (type, label, min) => h('button', { class: 'btn', onclick: () => { steps.push({ type, min }); commit(); } }, icon('plus', 14), label);
  return section(
    'ステップ（上から順に進みます）',
    h('p', { class: 'hint' }, '好きな順番・長さで並べられます。例：休憩5分 → 集中25分 → … → 長い休憩20分。'),
    list,
    h('div', { class: 'btn-row', style: { marginTop: '10px' } }, addBtn('focus', '集中', 25), addBtn('short', '短い休憩', 5), addBtn('long', '長い休憩', 15)),
  );
}

function userPresets(app, rerender) {
  const list = h('div', { class: 'preset-list' });
  for (const p of app.data.presets) {
    const road = buildRoad(p.timer, 0);
    list.append(
      h('div', { class: 'preset' },
        h('div', { class: 'p-main' }, h('div', { class: 'p-name' }, p.name), roadPreview(road, app.settings.view.colors)),
        h('button', { class: 'btn', onclick: () => { app.applyPreset(structuredClone(p.timer)); rerender(); toast(`「${p.name}」にしました`); } }, '使う'),
        h('button', { class: 'icon-btn', title: '削除', onclick: () => { app.data.deletePreset(p.id); rerender(); } }, icon('trash', 16)),
      ),
    );
  }
  return section(
    'マイプリセット',
    h('p', { class: 'hint' }, '今のタイマー設定（モード・並び・自動開始など）に名前を付けて保存できます。'),
    list,
    h('div', { class: 'btn-row', style: { marginTop: '10px' } },
      h('button', { class: 'btn', onclick: async () => {
        const name = await promptDialog({ title: 'プリセットの名前', placeholder: '例：英語の長文読解' });
        if (!name) return;
        app.data.savePreset(name, app.settings.timer);
        rerender();
      } }, icon('save', 15), '今の設定を保存'),
    ),
  );
}

// ── 通知・音 ──────────────────────────────────────
function alertsTab(body, s, set, app, rerender) {
  const a = s.alerts;
  const alarmOpts = Object.entries(ALARMS).map(([k, v]) => [k, v.label]);
  const preview = (name) => h('button', { class: 'icon-btn', title: '試しに鳴らす', onclick: () => app.alerts.play(name, { volume: a.volume / 100, repeat: 1 }) }, icon('play', 16));
  body.append(
    section(
      '終わりの合図',
      row('集中が終わったとき', h('div', { class: 'ctl' }, select(a.focusEndSound, alarmOpts, (v) => { set('alerts.focusEndSound', v); rerender(); }), preview(a.focusEndSound))),
      row('休憩が終わったとき', h('div', { class: 'ctl' }, select(a.breakEndSound, alarmOpts, (v) => { set('alerts.breakEndSound', v); rerender(); }), preview(a.breakEndSound))),
      row('音量', slider(a.volume, (v) => set('alerts.volume', v, { silent: true }))),
      row('くり返す回数', stepper(a.repeat, (v) => set('alerts.repeat', v), { min: 1, max: 5, unit: '回' })),
      row('終わる前の予告', select(a.warnBefore, [[0, 'なし'], [1, '1分前'], [2, '2分前'], [3, '3分前'], [5, '5分前']], (v) => set('alerts.warnBefore', Number(v))), { hint: '残り時間が少なくなったら小さな音で知らせます' }),
      row('予告の音', h('div', { class: 'ctl' }, select(a.warnSound, alarmOpts, (v) => { set('alerts.warnSound', v); rerender(); }), preview(a.warnSound))),
      row('音声で読み上げる', switchCtl(a.voice, (v) => set('alerts.voice', v)), { hint: '「集中おつかれさまでした。5分休憩しましょう」のように話します' }),
    ),
    section(
      '秒針の音',
      row('種類', select(a.tick, [['none', 'なし'], ...Object.entries(TICKS).map(([k, v]) => [k, v.label])], (v) => set('alerts.tick', v))),
      row('鳴らすとき', select(a.tickWhen, [['focus', '集中中だけ'], ['always', '集中も休憩も'], ['lastMinute', '最後の1分だけ']], (v) => set('alerts.tickWhen', v))),
      row('音量', slider(a.tickVolume, (v) => set('alerts.tickVolume', v, { silent: true }))),
    ),
    section(
      '画面での知らせ',
      row('デスクトップ通知', switchCtl(a.notify, (v) => { set('alerts.notify', v); if (v) app.requestNotify(); })),
      app.desktop ? row('タスクバーを点滅させる', switchCtl(a.flashTaskbar, (v) => set('alerts.flashTaskbar', v))) : null,
      app.desktop ? row('終わったらウィンドウを前に出す', switchCtl(a.bringToFront, (v) => set('alerts.bringToFront', v)), { hint: '休憩を忘れないように、強めに知らせたいとき' }) : null,
      row('タブ・タイトルに残り時間を出す', switchCtl(s.view.titleTimer, (v) => set('view.titleTimer', v))),
    ),
  );
}

// ── 表示 ──────────────────────────────────────────
function viewTab(body, s, set, app, rerender) {
  const v = s.view;
  const imgInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  imgInput.addEventListener('change', async () => {
    const f = imgInput.files?.[0];
    if (!f) return;
    await putFile('bg-image', f);
    set('view.background', 'image');
    await app.reloadBackgroundImage();
    rerender();
  });
  body.append(
    section(
      'テーマ',
      row('配色', segmented(v.theme, [['dark', 'ダーク'], ['light', 'ライト']], (x) => set('view.theme', x))),
      row('集中の色', colorPick(v.colors.focus, (x) => set('view.colors.focus', x, { silent: true }))),
      row('短い休憩の色', colorPick(v.colors.short, (x) => set('view.colors.short', x, { silent: true }))),
      row('長い休憩の色', colorPick(v.colors.long, (x) => set('view.colors.long', x, { silent: true }))),
      row('色を元に戻す', h('button', { class: 'btn', onclick: () => { set('view.colors', { ...DEFAULTS.view.colors }); rerender(); } }, '元に戻す')),
    ),
    section(
      '背景',
      row('背景', select(v.background, BACKGROUNDS, (x) => { if (x === 'image') imgInput.click(); else set('view.background', x); rerender(); })),
      v.background === 'image'
        ? row('画像', h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => imgInput.click() }, icon('image', 15), '変更'), h('button', { class: 'btn', onclick: async () => { await deleteFile('bg-image'); set('view.background', 'forest'); rerender(); } }, '外す')))
        : null,
      imgInput,
      row('暗さ', slider(v.bgDim, (x) => set('view.bgDim', x, { silent: true }), { max: 90 })),
      row('ぼかし', slider(v.bgBlur, (x) => set('view.bgBlur', x, { silent: true }), { max: 30 })),
      row('演出', select(v.fx, EFFECTS, (x) => set('view.fx', x)), { hint: '「サウンドに合わせる」：雨の音なら雨、虫やカエルならホタル' }),
      row('パネルの不透明度', slider(v.cardOpacity, (x) => set('view.cardOpacity', x, { silent: true }), { min: 30, max: 100 })),
    ),
    section(
      'タイマーの見た目',
      row('数字の書体', select(v.font, [['slim', '細い（Segoe UI Light）'], ['bahnschrift', 'Bahnschrift'], ['mono', '等幅（Cascadia / Consolas）'], ['round', 'やわらかい（BIZ UDP ゴシック）']], (x) => set('view.font', x))),
      row('リング', select(v.ring, [['ticks', '目盛り'], ['line', '線'], ['dots', '点'], ['none', 'なし']], (x) => set('view.ring', x))),
      row('目盛りの数', stepper(v.tickCount, (x) => set('view.tickCount', x), { min: 24, max: 180, step: 6 })),
      row('リングの向き', segmented(v.ringDirection, [['elapsed', '経過で増える'], ['remaining', '残りが減る']], (x) => set('view.ringDirection', x))),
      row('秒を表示する', switchCtl(v.showSeconds, (x) => set('view.showSeconds', x)), { hint: 'オフにすると「25分」のように分だけ。秒が気になる人向け' }),
      row('終わる時刻を表示する', switchCtl(v.showEndTime, (x) => set('view.showEndTime', x))),
      row('ロード（ステップの点）を表示する', switchCtl(v.showRoad, (x) => set('view.showRoad', x))),
    ),
  );
}

// ── ミニ表示 ──────────────────────────────────────
function miniTab(body, s, set, app) {
  const m = s.mini;
  body.append(
    section(
      'ミニ表示（常に手前に出る小さなタイマー）',
      h('p', { class: 'hint' }, app.desktop ? '他のアプリの上に小さく表示します。ドラッグで好きな位置へ動かせます。' : 'ブラウザのピクチャーインピクチャーで表示します（Chrome / Edge）。'),
      row('形', segmented(m.layout, [['bar', '横長'], ['circle', '円'], ['text', '数字だけ']], (x) => set('mini.layout', x))),
      app.desktop ? row('大きさ', slider(Math.round(m.scale * 100), (x) => set('mini.scale', x / 100, { silent: true }), { min: 60, max: 200, step: 5 })) : null,
      app.desktop ? row('ウィンドウの不透明度', slider(m.opacity, (x) => set('mini.opacity', x, { silent: true }), { min: 20, max: 100 })) : null,
      row('背景の濃さ', slider(m.glass, (x) => set('mini.glass', x, { silent: true }), { min: 0, max: 100 })),
      row('タスク名を表示', switchCtl(m.showTask, (x) => set('mini.showTask', x))),
      row('ボタン', segmented(m.controls, [['hover', 'マウスを乗せたとき'], ['always', '常に'], ['never', '出さない']], (x) => set('mini.controls', x))),
      app.desktop ? row('全画面のアプリより手前に出す', switchCtl(m.onTop, (x) => set('mini.onTop', x))) : null,
      app.desktop ? row('メイン画面を最小化したら自動でミニ表示', switchCtl(m.autoOnMinimize, (x) => set('mini.autoOnMinimize', x))) : null,
      app.desktop ? row('メイン画面を開いているときはミニ表示を隠す', switchCtl(m.hideWhenMainFocused, (x) => set('mini.hideWhenMainFocused', x))) : null,
      h('div', { class: 'btn-row', style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => app.toggleMini() }, icon('pip', 15), 'ミニ表示を開く / 閉じる')),
    ),
  );
}

// ── ショートカット ─────────────────────────────────
const KEY_ACTIONS = [
  ['toggle', '開始 / 一時停止'],
  ['skip', '次へスキップ'],
  ['breakNow', '今すぐ休憩'],
  ['reset', 'このステップをやり直す'],
  ['plus', '1分のばす（Shift で5分）'],
  ['minus', '1分へらす'],
  ['distract', '気が散ったを記録'],
  ['fullscreen', '全画面'],
  ['mini', 'ミニ表示'],
  ['sounds', 'ホワイトノイズのパネル'],
  ['stats', '統計'],
];
const GLOBAL_ACTIONS = [
  ['toggle', '開始 / 一時停止'],
  ['skip', '次へスキップ'],
  ['mini', 'ミニ表示の切り替え'],
  ['show', 'メイン画面を表示 / 隠す'],
];

function keysTab(body, s, set, app, rerender) {
  body.append(
    section(
      'アプリの中のショートカット',
      h('p', { class: 'hint' }, 'ボタンを押してから、使いたいキーを押します。Delete で解除、Esc でやめる。'),
      KEY_ACTIONS.map(([k, label]) => row(label, keyRecorder(s.keys[k], (v) => set(`keys.${k}`, v), { display: codeLabel }))),
      h('div', { class: 'btn-row', style: { marginTop: '10px' } }, h('button', { class: 'btn', onclick: () => { set('keys', { ...DEFAULTS.keys }); rerender(); } }, '元に戻す')),
    ),
    app.desktop
      ? section(
          'どのアプリを使っていても効くショートカット',
          h('p', { class: 'hint' }, '他のアプリを使っている最中でも効きます。Ctrl や Alt と組み合わせてください。'),
          GLOBAL_ACTIONS.map(([k, label]) => row(label, keyRecorder(s.globalKeys[k], (v) => set(`globalKeys.${k}`, v), { format: 'accel' }))),
          app.shortcutFailures?.length ? h('p', { class: 'hint', style: { color: '#ff8a8a' } }, `登録できなかったキー：${app.shortcutFailures.join('、')}（他のアプリが使っている可能性があります）`) : null,
          h('div', { class: 'btn-row', style: { marginTop: '10px' } }, h('button', { class: 'btn', onclick: () => { set('globalKeys', { ...DEFAULTS.globalKeys }); rerender(); } }, '元に戻す')),
        )
      : null,
  );
}

// ── システム ──────────────────────────────────────
function systemTab(body, s, set, app) {
  const sy = s.system;
  if (!app.desktop) {
    body.append(section('システム', h('p', { class: 'hint' }, 'Windows アプリ版で使える設定です（スタートアップ・トレイ・離席の検出など）。')));
    return;
  }
  body.append(
    section(
      'Windows',
      row('Windows の起動時に開く', switchCtl(sy.openAtLogin, (v) => set('system.openAtLogin', v))),
      row('×ボタンでトレイにしまう', switchCtl(sy.closeToTray, (v) => set('system.closeToTray', v)), { hint: 'オフにすると×で終了します。トレイのアイコンからいつでも開けます' }),
      row('メイン画面を常に手前に表示', switchCtl(sy.mainOnTop, (v) => set('system.mainOnTop', v))),
    ),
    section(
      '自動で一時停止',
      row('画面をロックしたら一時停止', switchCtl(sy.pauseOnLock, (v) => set('system.pauseOnLock', v))),
      row('スリープしたら一時停止', switchCtl(sy.pauseOnSleep, (v) => set('system.pauseOnSleep', v))),
      row('離席を検出して一時停止', select(sy.idlePauseMin, [[0, 'しない'], [3, '3分操作がなければ'], [5, '5分操作がなければ'], [10, '10分操作がなければ'], [15, '15分操作がなければ']], (v) => set('system.idlePauseMin', Number(v))), { hint: '集中中にマウスもキーボードも触っていない時間は記録から除きます' }),
    ),
    section('アプリ', h('div', { class: 'btn-row' }, h('button', { class: 'btn danger', onclick: () => app.desktop.quit() }, '終了する'))),
  );
}

// ── データ ────────────────────────────────────────
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dataTab(body, s, set, app) {
  const file = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const ok = await confirmDialog({ title: 'バックアップを読み込みますか？', message: '今の記録・タスク・設定は、ファイルの内容に置き換わります。', ok: '読み込む', danger: true });
      if (!ok) return;
      app.data.importAll(data);
      if (data.settings) app.replaceSettings(data.settings);
      toast('読み込みました');
    } catch (err) {
      toast(`読み込めませんでした：${err.message}`);
    }
    file.value = '';
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const t = app.data.totals();
  body.append(
    section(
      'これまでの記録',
      h('p', { class: 'hint' }, `合計 ${fmtDuration(t.focusMs)}・ポモドーロ ${t.pomos} 回・記録 ${app.data.records.length} 件`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => download(`pomoroad-backup-${stamp}.json`, JSON.stringify(app.data.exportAll(app.settings), null, 1), 'application/json') }, icon('download', 15), 'バックアップを保存'),
        h('button', { class: 'btn', onclick: () => file.click() }, icon('upload', 15), 'バックアップを読み込む'),
        h('button', { class: 'btn', onclick: () => download(`pomoroad-records-${stamp}.csv`, app.data.toCSV(), 'text/csv') }, icon('download', 15), '記録を CSV で保存'),
        file,
      ),
      h('p', { class: 'hint', style: { marginTop: '10px' } }, 'CSV は Excel でそのまま開けます（日付・時刻・種類・分・タスク）。'),
    ),
    section(
      'リセット',
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: async () => { if (await confirmDialog({ title: '設定を初期状態に戻しますか？', message: '記録とタスクは残ります。', ok: '戻す', danger: true })) { app.replaceSettings(structuredClone(DEFAULTS)); toast('設定を初期状態に戻しました'); } } }, '設定を初期状態に戻す'),
        h('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog({ title: 'すべての記録を消しますか？', message: '元に戻せません。先にバックアップを保存するのがおすすめです。', ok: '消す', danger: true })) { app.data.importAll({ app: 'pomoroad', records: [] }); toast('記録を消しました'); } } }, '記録をすべて消す'),
      ),
    ),
  );
}

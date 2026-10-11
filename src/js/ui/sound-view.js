// ホワイトノイズ（環境音）のパネル

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { segmented, slider, promptDialog, toast, row, switchCtl, stepper } from './widgets.js';
import { CATEGORIES, SOUNDS, SCENES } from '../audio/catalog.js';
import { putFile, deleteFile } from '../core/idb.js';
import { uid } from '../core/util.js';

export function renderSounds(body, app) {
  clear(body);
  const s = app.settings.sound;
  const editing = s.link === 'separate' ? app.ui.mixTab || 'focus' : 'focus';
  const mix = s.mixes[editing] ?? {};
  const rerender = () => renderSounds(body, app);

  // 再生ボタンと全体の音量
  const playing = app.sound.playing;
  const top = h(
    'div',
    { class: 'sound-top' },
    h('button', { class: 'play-all', title: playing ? '止める' : '鳴らす', onclick: () => { app.toggleSoundPlayback(); rerender(); } }, icon(playing ? 'pause' : 'play', 22)),
    h('div', { style: { minWidth: '0' } },
      h('div', { style: { fontWeight: 600 } }, playing ? '再生中' : '停止中'),
      h('div', { style: { fontSize: '12px', color: 'var(--muted)' } }, linkHint(s.link))),
    h('div', { class: 'vol' }, icon('volume', 18), slider(s.master, (v) => { app.set('sound.master', v, { silent: true }); }, { width: '100%' })),
  );
  body.append(top);

  body.append(
    h('div', { class: 'section' },
      h('h3', null, 'タイマーとの連動'),
      segmented(s.link, [['manual', '連動しない'], ['focus', '集中中だけ鳴らす'], ['separate', '集中と休憩で別の音']], (v) => { app.set('sound.link', v); rerender(); }),
      s.link === 'separate'
        ? h('div', { style: { marginTop: '10px' } }, segmented(editing, [['focus', '集中用のミックスを編集'], ['break', '休憩用のミックスを編集']], (v) => { app.ui.mixTab = v; rerender(); }))
        : null,
    ),
  );

  // シーン
  const sceneList = h('div', { class: 'scene-list' });
  for (const sc of SCENES) {
    sceneList.append(h('button', { class: 'scene', onclick: () => { app.setMix(editing, { ...sc.mix }, true); rerender(); } }, sc.icon, ' ', sc.name));
  }
  for (const m of app.data.mixes) {
    sceneList.append(
      h('span', { class: 'scene' },
        h('button', { onclick: () => { app.setMix(editing, { ...m.mix }, true); rerender(); } }, `${m.icon || '⭐'} ${m.name}`),
        h('button', { class: 'x', title: '削除', onclick: () => { app.data.deleteMix(m.id); rerender(); } }, '×')),
    );
  }
  const activeCount = Object.values(mix).filter((v) => v > 0).length;
  body.append(
    h('div', { class: 'section' },
      h('h3', null, 'シーン', h('span', { class: 'spacer' }),
        h('button', { class: 'btn', style: { height: '28px' }, disabled: !activeCount, onclick: async () => {
          const name = await promptDialog({ title: 'ミックスに名前を付けて保存', placeholder: '例：雨の日の図書館' });
          if (name) { app.data.saveMix(name, '⭐', mix); rerender(); }
        } }, icon('save', 14), '今のミックスを保存'),
        h('button', { class: 'btn', style: { height: '28px' }, disabled: !activeCount, onclick: () => { app.setMix(editing, {}); rerender(); } }, 'すべて消す')),
      sceneList),
  );

  // 音の一覧
  const custom = app.data.customSounds.map((c) => ({ id: c.id, cat: 'custom', name: c.name, icon: '🎵', custom: true }));
  for (const cat of CATEGORIES) {
    const items = cat.id === 'custom' ? custom : SOUNDS.filter((x) => x.cat === cat.id);
    const grid = h('div', { class: 'sound-grid' });
    for (const snd of items) grid.append(tile(snd, mix, editing, app, rerender));
    if (cat.id === 'custom') grid.append(addTile(app, rerender));
    body.append(h('div', { class: 'section' }, h('h3', null, cat.label), cat.id === 'custom' ? h('p', { class: 'hint' }, '手元の音声ファイル（mp3 / wav / ogg / m4a）を追加して、ほかの音と重ねられます。ファイルはこのパソコンの中だけに保存されます。') : null, grid));
  }

  body.append(
    h('div', { class: 'section' },
      h('h3', null, '細かい設定'),
      row(
        '音の移り変わり',
        segmented(s.variation, [[0, '一定'], [0.5, 'ひかえめ'], [1, 'ふつう'], [1.6, '大きめ']], (v) => app.set('sound.variation', Number(v))),
        { hint: '雨の強さ・風・川の流れ・鳥の多さなどが、数分かけてゆっくり変わる大きさ。「一定」にするとほぼ変わりません' },
      ),
      row('切り替えのフェード', stepper(s.fadeSec, (v) => app.set('sound.fadeSec', v), { min: 0, max: 15, unit: '秒' })),
      row('タイマーを一時停止したら音も止める', switchCtl(s.pauseWithTimer, (v) => app.set('sound.pauseWithTimer', v))),
      h('p', { class: 'hint', style: { marginTop: '10px' } }, '雨や自然の音はアプリの中で続きを作り続けているので、同じところのくり返しになりません。ネットにつながっていなくても使えます。喫茶店の話し声は、音声合成（Open JTalk・声：Mei）で作った会話を重ねたものです。'),
    ),
  );
}

function linkHint(link) {
  if (link === 'focus') return '集中中だけ自動で鳴ります';
  if (link === 'separate') return '集中と休憩でミックスを切り替えます';
  return 'タイマーとは関係なく鳴らします';
}

function tile(snd, mix, editing, app, rerender) {
  const vol = mix[snd.id] ?? 0;
  const on = vol > 0;
  const loading = app.sound.isLoading(snd.id);
  const el = h('div', {
    class: ['sound', on && 'on', loading && 'loading'],
    title: snd.desc || snd.name,
    role: 'button',
    tabindex: 0,
    onclick: (e) => {
      if (e.target.closest('input, .del')) return;
      const next = { ...app.settings.sound.mixes[editing] };
      if (on) delete next[snd.id];
      else next[snd.id] = 0.5;
      app.setMix(editing, next, !on);
      rerender();
    },
  },
  h('span', { class: 'emo' }, snd.icon),
  h('span', { class: 'nm' }, snd.name),
  on ? slider(Math.round(vol * 100), (v) => { const next = { ...app.settings.sound.mixes[editing], [snd.id]: Math.max(0.01, v / 100) }; app.setMix(editing, next, false, true); }, { min: 1, max: 100 }) : null,
  snd.custom ? h('button', { class: 'del', title: 'この音源を削除', onclick: async (e) => { e.stopPropagation(); await removeCustom(app, snd.id); rerender(); } }, icon('close', 13)) : null);
  return el;
}

function addTile(app, rerender) {
  const input = h('input', { type: 'file', accept: 'audio/*', multiple: true, style: { display: 'none' } });
  input.addEventListener('change', async () => {
    for (const f of input.files ?? []) {
      if (f.size > 80 * 1024 * 1024) {
        toast(`${f.name} は大きすぎます（80MB まで）`);
        continue;
      }
      const id = `custom:${uid()}`;
      const fileKey = `sound:${id}`;
      await putFile(fileKey, f);
      app.data.addCustomSound({ id, name: f.name.replace(/\.[^.]+$/, ''), fileKey });
    }
    app.sound.setCustomList(app.data.customSounds);
    input.value = '';
    rerender();
  });
  return h('button', { class: 'sound add-sound', onclick: () => input.click() }, icon('plus', 22), h('span', { class: 'nm' }, '音源を追加'), input);
}

async function removeCustom(app, id) {
  const entry = app.data.customSounds.find((c) => c.id === id);
  if (!entry) return;
  for (const k of ['focus', 'break']) {
    const m = { ...app.settings.sound.mixes[k] };
    if (m[id]) {
      delete m[id];
      app.setMix(k, m);
    }
  }
  app.data.removeCustomSound(id);
  app.sound.setCustomList(app.data.customSounds);
  await deleteFile(entry.fileKey).catch(() => {});
}

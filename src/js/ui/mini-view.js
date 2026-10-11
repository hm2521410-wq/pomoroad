// ミニ表示（常に手前に出る小さなタイマー）の中身。
// Electron のミニウィンドウと、ブラウザのピクチャーインピクチャーの両方で使う。

import { iconSvg } from './icons.js';

export const MINI_SIZES = {
  bar: [300, 64],
  circle: [156, 156],
  text: [200, 74],
};

export class MiniView {
  constructor(root, onCommand) {
    this.root = root;
    this.doc = root.ownerDocument;
    this.onCommand = onCommand;
    this.layout = '';
    this.root.classList.add('mini');
  }

  _btn(cmd, iconName, title) {
    const b = this.doc.createElement('button');
    b.className = 'mbtn';
    b.title = title;
    b.dataset.cmd = cmd;
    b.innerHTML = iconSvg(iconName, 16);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onCommand({ type: cmd });
    });
    return b;
  }

  _build(layout) {
    this.layout = layout;
    const r = this.root;
    r.innerHTML = '';
    r.dataset.layout = layout;
    const btns = this.doc.createElement('div');
    btns.className = 'mbtns';
    this.toggleBtn = this._btn('toggle', 'play', '開始 / 一時停止');
    btns.append(this.toggleBtn, this._btn('skip', 'skip', '次へスキップ'), this._btn('openMain', 'open', 'メイン画面を開く'), this._btn('closeMini', 'close', 'ミニ表示を閉じる'));
    this.btns = btns;
    const time = this.doc.createElement('div');
    time.className = 'mtime';
    this.timeEl = time;
    const label = this.doc.createElement('div');
    label.className = 'mlabel';
    this.labelEl = label;
    const task = this.doc.createElement('div');
    task.className = 'mtask';
    this.taskEl = task;
    if (layout === 'circle') {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = this.doc.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.classList.add('mring');
      const bg = this.doc.createElementNS(NS, 'circle');
      bg.setAttribute('cx', 50);
      bg.setAttribute('cy', 50);
      bg.setAttribute('r', 44);
      bg.setAttribute('class', 'mring-bg');
      const arc = this.doc.createElementNS(NS, 'circle');
      arc.setAttribute('cx', 50);
      arc.setAttribute('cy', 50);
      arc.setAttribute('r', 44);
      arc.setAttribute('class', 'mring-arc');
      arc.setAttribute('transform', 'rotate(-90 50 50)');
      arc.setAttribute('stroke-dasharray', String(2 * Math.PI * 44));
      svg.append(bg, arc);
      this.arc = arc;
      const center = this.doc.createElement('div');
      center.className = 'mcenter';
      center.append(label, time);
      r.append(svg, center, btns);
    } else if (layout === 'text') {
      const bar = this.doc.createElement('div');
      bar.className = 'mbar';
      this.barEl = bar;
      r.append(time, bar, btns);
    } else {
      const dot = this.doc.createElement('div');
      dot.className = 'mdot';
      const info = this.doc.createElement('div');
      info.className = 'minfo';
      info.append(label, task);
      const bar = this.doc.createElement('div');
      bar.className = 'mbar';
      this.barEl = bar;
      r.append(dot, time, info, btns, bar);
    }
  }

  update(s) {
    if (!s) return;
    if (s.layout !== this.layout) this._build(s.layout);
    const r = this.root;
    r.style.setProperty('--mc', s.color);
    r.style.setProperty('--glass', String((s.glass ?? 70) / 100));
    r.dataset.controls = s.controls;
    r.dataset.theme = s.theme;
    r.classList.toggle('running', !!s.running);
    r.classList.toggle('overtime', !!s.overtime);
    this.timeEl.textContent = s.time;
    // 見守りの声かけ中は、ラベルとタスクの代わりに声かけを出す
    const a = s.alert;
    r.classList.toggle('alert', !!a);
    r.dataset.alert = a?.kind ?? '';
    r.title = a ? a.text : '';
    this.labelEl.textContent = a ? a.title : s.label;
    this.taskEl.textContent = a ? a.text : s.showTask && s.task ? s.task : s.sub || '';
    this.taskEl.style.display = this.taskEl.textContent ? '' : 'none';
    if (this.barEl) this.barEl.style.setProperty('--p', `${(s.progress * 100).toFixed(2)}%`);
    if (this.arc) {
      const len = 2 * Math.PI * 44;
      this.arc.setAttribute('stroke-dashoffset', String(len * (1 - s.progress)));
    }
    this.toggleBtn.innerHTML = iconSvg(s.running ? 'pause' : 'play', 16);
    this.toggleBtn.title = s.running ? '一時停止' : '開始';
  }
}

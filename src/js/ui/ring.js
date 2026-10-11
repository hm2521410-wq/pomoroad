// 円形の目盛り（Focus To-Do 風）。経過した目盛りに色が付き、先端に針が出る

const NS = 'http://www.w3.org/2000/svg';
const C = 200;

export class Ring {
  constructor(el) {
    this.el = el;
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('viewBox', '0 0 400 400');
    el.append(this.svg);
    this.key = '';
  }

  _build(style, count) {
    const key = `${style}:${count}`;
    if (key === this.key) return;
    this.key = key;
    this.svg.innerHTML = '';
    this.ticks = [];
    this.arc = null;
    this.needle = null;
    if (style === 'none') return;
    if (style === 'line') {
      const R = 182;
      const bg = document.createElementNS(NS, 'circle');
      bg.setAttribute('cx', C);
      bg.setAttribute('cy', C);
      bg.setAttribute('r', R);
      bg.setAttribute('fill', 'none');
      bg.setAttribute('stroke', 'var(--line-strong)');
      bg.setAttribute('stroke-width', '6');
      const arc = document.createElementNS(NS, 'circle');
      arc.setAttribute('cx', C);
      arc.setAttribute('cy', C);
      arc.setAttribute('r', R);
      arc.setAttribute('fill', 'none');
      arc.setAttribute('stroke-width', '6');
      arc.setAttribute('stroke-linecap', 'round');
      arc.setAttribute('transform', `rotate(-90 ${C} ${C})`);
      arc.style.transition = 'stroke-dashoffset 0.4s linear, stroke 0.3s';
      const len = 2 * Math.PI * R;
      arc.setAttribute('stroke-dasharray', String(len));
      this.arcLen = len;
      this.svg.append(bg, arc);
      this.arc = arc;
      return;
    }
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const sin = Math.sin(a);
      const cos = -Math.cos(a);
      let el;
      if (style === 'dots') {
        el = document.createElementNS(NS, 'circle');
        el.setAttribute('cx', C + sin * 182);
        el.setAttribute('cy', C + cos * 182);
        el.setAttribute('r', 3.4);
      } else {
        el = document.createElementNS(NS, 'line');
        const r1 = 168;
        const r2 = 190;
        el.setAttribute('x1', C + sin * r1);
        el.setAttribute('y1', C + cos * r1);
        el.setAttribute('x2', C + sin * r2);
        el.setAttribute('y2', C + cos * r2);
        el.setAttribute('stroke-width', count > 120 ? 3 : 4.2);
      }
      el.setAttribute('class', 'tick');
      this.svg.append(el);
      this.ticks.push(el);
    }
    const nd = document.createElementNS(NS, 'line');
    nd.setAttribute('class', 'needle');
    nd.setAttribute('stroke-width', 5);
    nd.setAttribute('stroke-linecap', 'round');
    this.svg.append(nd);
    this.needle = nd;
  }

  /** progress: 0〜1（経過の割合）, color: 段階の色 */
  update({ progress, color, style = 'ticks', count = 90, direction = 'elapsed', running = true }) {
    this._build(style, Math.max(24, Math.min(180, count | 0)));
    const p = Math.min(1, Math.max(0, progress));
    if (style === 'none') return;
    if (this.arc) {
      const shown = direction === 'remaining' ? 1 - p : p;
      this.arc.setAttribute('stroke', color);
      this.arc.setAttribute('stroke-dashoffset', String(this.arcLen * (1 - shown)));
      return;
    }
    const n = this.ticks.length;
    const pos = p * n;
    const base = 'var(--line-strong)';
    for (let i = 0; i < n; i++) {
      const t = this.ticks[i];
      let lit;
      let alpha = 1;
      if (direction === 'remaining') {
        lit = i >= pos;
        alpha = lit ? 0.55 + 0.45 * Math.min(1, (i - pos) / Math.max(4, n * 0.25)) : 1;
      } else {
        lit = i < pos;
        // 針の近くほど濃く、始まりに近いほど薄く（尾を引くように）
        const behind = pos - i;
        alpha = lit ? Math.max(0.28, 1 - behind / Math.max(6, n * 0.35)) : 1;
      }
      const attr = style === 'dots' ? 'fill' : 'stroke';
      t.setAttribute(attr, lit ? color : base);
      t.style.opacity = lit ? alpha : 1;
    }
    if (this.needle) {
      const show = p > 0 && p < 1;
      this.needle.style.display = show ? '' : 'none';
      if (show) {
        const a = p * Math.PI * 2;
        const sin = Math.sin(a);
        const cos = -Math.cos(a);
        this.needle.setAttribute('x1', C + sin * 150);
        this.needle.setAttribute('y1', C + cos * 150);
        this.needle.setAttribute('x2', C + sin * 194);
        this.needle.setAttribute('y2', C + cos * 194);
        this.needle.setAttribute('stroke', color);
        this.needle.style.opacity = running ? 1 : 0.6;
      }
    }
  }
}

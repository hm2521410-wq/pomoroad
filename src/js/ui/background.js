// 背景（グラデーション・オーロラ・星空・自分の画像）と、雨・雪・ホタルの演出

export const BACKGROUNDS = [
  ['forest', '森（深い緑）'],
  ['night', '夜空'],
  ['aurora', 'オーロラ（動く）'],
  ['stars', '星空（動く）'],
  ['ocean', '深い海'],
  ['sunset', '夕暮れ'],
  ['mono', '無地'],
  ['paper', '和紙（明るい）'],
  ['image', '自分の画像'],
];

export const EFFECTS = [
  ['none', 'なし'],
  ['auto', 'サウンドに合わせる'],
  ['rain', '雨'],
  ['snow', '雪'],
  ['fireflies', 'ホタル'],
];

export class Background {
  constructor(bg, fx, dim) {
    this.bg = bg;
    this.fx = fx;
    this.dim = dim;
    this.ctx = fx.getContext('2d');
    this.bgCanvas = null;
    this.mode = '';
    this.effect = 'none';
    this.particles = [];
    this.raf = 0;
    this.last = 0;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => this._loop());
    this._resize();
  }

  _resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    for (const c of [this.fx, this.bgCanvas].filter(Boolean)) {
      c.width = innerWidth * dpr;
      c.height = innerHeight * dpr;
    }
    this.dpr = dpr;
    this._seed();
  }

  apply(view, imageUrl) {
    const mode = view.background === 'image' && !imageUrl ? 'forest' : view.background;
    if (mode !== this.mode) {
      this.mode = mode;
      this.bg.className = `bg-${mode}`;
      this.bg.style.backgroundImage = '';
      this.bgCanvas?.remove();
      this.bgCanvas = null;
      if (mode === 'aurora' || mode === 'stars') {
        this.bgCanvas = document.createElement('canvas');
        this.bgCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
        this.bg.append(this.bgCanvas);
        this._resize();
      }
    }
    if (mode === 'image' && imageUrl) this.bg.style.backgroundImage = `url("${imageUrl}")`;
    this.bg.style.filter = view.bgBlur ? `blur(${view.bgBlur}px)` : '';
    this.bg.style.inset = view.bgBlur ? `-${view.bgBlur * 2}px` : '0';
    this.dim.style.opacity = String((view.bgDim ?? 35) / 100);
    this._loop();
  }

  setEffect(kind) {
    if (kind === this.effect) return;
    this.effect = kind;
    this._seed();
    this._loop();
  }

  _seed() {
    const W = this.fx.width;
    const H = this.fx.height;
    const n = { rain: 140, snow: 90, fireflies: 26 }[this.effect] ?? 0;
    this.particles = Array.from({ length: n }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      v: 0.5 + Math.random(),
      p: Math.random() * Math.PI * 2,
      s: Math.random(),
    }));
    if (this.bgCanvas && this.mode === 'stars') {
      this.stars = Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.2, p: Math.random() * 6.28 }));
    }
    this.ctx.clearRect(0, 0, W, H);
  }

  _loop() {
    cancelAnimationFrame(this.raf);
    const animated = (this.effect !== 'none' && this.effect !== 'auto') || this.bgCanvas;
    if (!animated || document.hidden || this.reduce) {
      if (this.effect === 'none' || this.effect === 'auto' || this.reduce) this.ctx.clearRect(0, 0, this.fx.width, this.fx.height);
      if (this.bgCanvas && this.reduce) this._drawBg(0);
      return;
    }
    const step = (t) => {
      this.raf = requestAnimationFrame(step);
      if (t - this.last < 33) return; // 30fps で十分
      const dt = Math.min(100, t - this.last) / 16.7;
      this.last = t;
      this._drawFx(dt);
      if (this.bgCanvas) this._drawBg(t);
    };
    this.raf = requestAnimationFrame(step);
  }

  _drawFx(dt) {
    const c = this.ctx;
    const W = this.fx.width;
    const H = this.fx.height;
    const d = this.dpr;
    c.clearRect(0, 0, W, H);
    if (this.effect === 'rain') {
      c.strokeStyle = 'rgba(190,210,235,0.28)';
      c.lineWidth = 1 * d;
      c.beginPath();
      for (const p of this.particles) {
        p.y += (14 + p.v * 10) * dt * d;
        p.x -= 2 * dt * d;
        if (p.y > H) {
          p.y = -20 * d;
          p.x = Math.random() * W * 1.1;
        }
        c.moveTo(p.x, p.y);
        c.lineTo(p.x - 3 * d, p.y + (12 + p.v * 10) * d);
      }
      c.stroke();
    } else if (this.effect === 'snow') {
      c.fillStyle = 'rgba(255,255,255,0.75)';
      for (const p of this.particles) {
        p.y += (0.6 + p.v * 0.8) * dt * d;
        p.p += 0.02 * dt;
        p.x += Math.sin(p.p) * 0.6 * d;
        if (p.y > H) {
          p.y = -5;
          p.x = Math.random() * W;
        }
        c.beginPath();
        c.arc(p.x, p.y, (1 + p.s * 2.2) * d, 0, Math.PI * 2);
        c.fill();
      }
    } else if (this.effect === 'fireflies') {
      for (const p of this.particles) {
        p.p += 0.015 * dt;
        p.x += Math.cos(p.p * 1.3 + p.s * 6) * 0.5 * d;
        p.y += Math.sin(p.p + p.s * 4) * 0.4 * d;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;
        const a = 0.25 + 0.75 * Math.max(0, Math.sin(p.p * 2 + p.s * 10));
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, 10 * d);
        g.addColorStop(0, `rgba(220,255,140,${a * 0.9})`);
        g.addColorStop(1, 'rgba(220,255,140,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(p.x, p.y, 10 * d, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  _drawBg(t) {
    const cv = this.bgCanvas;
    const c = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    c.clearRect(0, 0, W, H);
    if (this.mode === 'aurora') {
      const s = t / 9000;
      const blobs = [
        [0.3 + 0.12 * Math.sin(s), 0.3 + 0.08 * Math.cos(s * 1.3), 'rgba(40,200,150,0.35)'],
        [0.7 + 0.1 * Math.cos(s * 0.8), 0.25 + 0.1 * Math.sin(s * 1.1), 'rgba(80,120,255,0.3)'],
        [0.5 + 0.15 * Math.sin(s * 0.6 + 2), 0.55 + 0.08 * Math.cos(s * 0.9), 'rgba(160,80,220,0.22)'],
      ];
      for (const [x, y, col] of blobs) {
        const g = c.createRadialGradient(x * W, y * H, 0, x * W, y * H, Math.max(W, H) * 0.5);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, W, H);
      }
    } else if (this.mode === 'stars') {
      for (const st of this.stars ?? []) {
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 900 + st.p));
        c.fillStyle = `rgba(255,255,255,${a})`;
        c.beginPath();
        c.arc(st.x * W, st.y * H, st.r * this.dpr, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
}

/** 鳴っている環境音から背景演出を選ぶ（「サウンドに合わせる」のとき） */
export function effectForMix(mix) {
  const on = Object.entries(mix).filter(([, v]) => v > 0).map(([k]) => k);
  if (on.some((k) => k.startsWith('rain') || k === 'thunder')) return 'rain';
  if (on.some((k) => ['frogs', 'crickets', 'higurashi', 'furin'].includes(k))) return 'fireflies';
  if (on.includes('fire')) return 'snow';
  return 'none';
}

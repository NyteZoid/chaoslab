// Draws the lab in a light pseudo-3D style: oblique-projected slabs and boxes, shaded spheres,
// floor shadows, a space backdrop with the metre grid, and impact effects.
import { WIDTH, HEIGHT, FLOOR_PX, PX_PER_M, fmt } from './lab.js';
import { materialOf } from './materials.js';

const DEPTH_DIR = { x: Math.cos(0.6), y: -Math.sin(0.6) }; // receding axis, up and to the right
const DEPTH_SCALE = 0.4;      // cabinet-style foreshortening
const SLAB_DEPTH = 110;       // px depth of the floor and ramps
const LIGHT = norm({ x: -0.55, y: -0.85 }); // light from the top left

const SURFACE = '#2a2a2a';    // fixed ramps
const FLOOR_TOP = '#161616';
const FLOOR_FRONT = '#0a0a0a';
const GRID = 'rgba(239, 68, 68, 0.09)';
const AMBER = '#f2b84b';
const ACCENT = '#ef4444';

const EFFECT_MIN_SPEED = 4;   // m/s
const MAX_BURSTS = 6;
const SHAKE_MIN_SPEED = 6;
const FLASH_MIN_SPEED = 7;

function norm(v) { const l = Math.hypot(v.x, v.y); return { x: v.x / l, y: v.y / l }; }
const depthOffset = (d) => ({ x: DEPTH_DIR.x * d * DEPTH_SCALE, y: DEPTH_DIR.y * d * DEPTH_SCALE });
const FLOOR_OFF = depthOffset(SLAB_DEPTH);

export class Renderer {
  constructor(lab, canvas) {
    this.lab = lab;
    this.ctx = canvas.getContext('2d');
    this.showTrails = true;
    this.showVectors = false;
    this.effects = true;
    this.hover = null;        // mouse position in px for the spawn ghost
    this.spawnPreview = null; // function returning a spec to preview, or null
    this.selectedId = null;   // spec id of the ramp being edited
    this.showValues = false;  // label moving objects with their speed (PhET's "Values")
    this.trails = new Map();  // Matter body id -> [{x,y}]
    this.bursts = [];
    this.dust = [];  // cosmetic specks when something shatters (the real fragments are physics bodies)
    this.shake = { amp: 0, until: 0 };
    this.flashUntil = 0;
    this.backdrop = makeBackdrop();
    this.view = { zoom: 1, cx: WIDTH / 2, cy: HEIGHT / 2 }; // camera: centre of view in world px
    this.gridStep = 1;                                       // metres between grid lines (0 = off)
    this.marker = null;                                      // highlighted point (e.g. a pulley under the cursor)

    lab.on('reset', () => { this.trails.clear(); this.bursts = []; this.dust = []; });
    lab.on('step', () => this._recordTrails());
    lab.on('collision', (c) => this._onCollision(c));
    lab.on('break', (b) => this._onBreak(b));

    const loop = (now) => { this.draw(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  _recordTrails() {
    if (!this.showTrails) return;
    this._trailTick = (this._trailTick || 0) + 1;
    if (this._trailTick % 2) return;
    for (const b of this.lab.allBodies()) {
      if (b.isStatic || !b.plugin.specId) continue;
      const trail = this.trails.get(b.id) || [];
      trail.push({ x: b.position.x, y: b.position.y });
      if (trail.length > 60) trail.shift();
      this.trails.set(b.id, trail);
    }
  }

  _onCollision({ speed, x, y, materials }) {
    if (!this.effects || speed < EFFECT_MIN_SPEED) return;
    const now = performance.now();
    if (this.bursts.length >= MAX_BURSTS) return;
    this.bursts.push({
      x, y, t0: now,
      strength: Math.min(1, (speed - EFFECT_MIN_SPEED) / 7),
      color: materialOf(materials[0]).color,
      spin: Math.random() * Math.PI,
    });
    if (speed >= SHAKE_MIN_SPEED) {
      this.shake = { amp: Math.min(5, (speed - SHAKE_MIN_SPEED) * 0.6 + 1.5), until: now + 180, t0: now };
    }
    if (speed >= FLASH_MIN_SPEED) this.flashUntil = now + 45;
  }

  // A shatter always gets an effect (it is rare and meaningful), plus a spray of dust specks.
  _onBreak({ x, y, material }) {
    if (!this.effects) return;
    const now = performance.now();
    const color = materialOf(material).color;
    this.bursts.push({ x, y, t0: now, strength: 1, color, spin: Math.random() * Math.PI });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 160; // px/s
      this.dust.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, t0: now, color });
    }
    if (this.dust.length > 120) this.dust.splice(0, this.dust.length - 120);
  }

  _drawDust(now) {
    const { ctx } = this;
    this.dust = this.dust.filter((d) => now - d.t0 < 600);
    for (const d of this.dust) {
      const t = (now - d.t0) / 1000;
      ctx.fillStyle = rgba(d.color, 0.8 * (1 - t / 0.6));
      ctx.fillRect(d.x + d.vx * t - 1.5, d.y + d.vy * t + 300 * t * t - 1.5, 3, 3);
    }
  }

  // ---------- camera ----------

  // canvas pixel -> world pixel (the units Matter uses)
  toWorld(p) {
    const v = this.view;
    return { x: (p.x - WIDTH / 2) / v.zoom + v.cx, y: (p.y - HEIGHT / 2) / v.zoom + v.cy };
  }

  setZoom(zoom, around = null) {
    const v = this.view;
    const z = Math.min(6, Math.max(0.5, zoom));
    if (around) { // keep the point under the cursor fixed
      const w = this.toWorld(around);
      v.cx = w.x - (around.x - WIDTH / 2) / z;
      v.cy = w.y - (around.y - HEIGHT / 2) / z;
    }
    v.zoom = z;
    if (z === 1 && !around) { v.cx = WIDTH / 2; v.cy = HEIGHT / 2; }
    this._syncMouse();
  }

  pan(dx, dy) {
    this.view.cx -= dx / this.view.zoom;
    this.view.cy -= dy / this.view.zoom;
    this._syncMouse();
  }

  resetView() {
    this.view = { zoom: 1, cx: WIDTH / 2, cy: HEIGHT / 2 };
    this._syncMouse();
  }

  // Matter's mouse (used for grabbing) must see the same world coordinates we draw.
  _syncMouse() {
    const v = this.view, m = this.lab.mouse;
    Matter.Mouse.setScale(m, { x: 1 / v.zoom, y: 1 / v.zoom });
    Matter.Mouse.setOffset(m, { x: v.cx - WIDTH / (2 * v.zoom), y: v.cy - HEIGHT / (2 * v.zoom) });
  }

  _drawGrid() {
    if (!this.gridStep) return;
    const { ctx } = this;
    const step = this.gridStep * PX_PER_M;
    const back = FLOOR_PX + FLOOR_OFF.y;
    ctx.lineWidth = 1 / this.view.zoom;
    for (const major of [false, true]) {
      ctx.strokeStyle = major ? 'rgba(239, 68, 68, 0.16)' : GRID;
      ctx.beginPath();
      for (let x = 0; x <= WIDTH + 0.1; x += step) {
        const isMajor = Math.abs(x / PX_PER_M - Math.round(x / PX_PER_M)) < 1e-6 && this.gridStep < 1;
        if (isMajor !== major) continue;
        ctx.moveTo(x, 0); ctx.lineTo(x, back);
      }
      for (let y = FLOOR_PX; y >= 0; y -= step) {
        const isMajor = Math.abs((FLOOR_PX - y) / PX_PER_M - Math.round((FLOOR_PX - y) / PX_PER_M)) < 1e-6 && this.gridStep < 1;
        if (isMajor !== major) continue;
        ctx.moveTo(0, y); ctx.lineTo(WIDTH, y);
      }
      ctx.stroke();
    }
  }

  draw(now) {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    if (this.effects && now < this.shake.until) {
      const k = (this.shake.until - now) / 180;
      ctx.translate((Math.random() - 0.5) * 2 * this.shake.amp * k, (Math.random() - 0.5) * 2 * this.shake.amp * k);
    }
    // camera
    const v = this.view;
    ctx.translate(WIDTH / 2, HEIGHT / 2);
    ctx.scale(v.zoom, v.zoom);
    ctx.translate(-v.cx, -v.cy);

    ctx.drawImage(this.backdrop, 0, 0);
    this._drawGrid();
    this._drawFloor();

    const bodies = this.lab.allBodies().filter((b) => !b.plugin.wall && b.plugin.specId);
    for (const b of bodies) if (b.isStatic) drawSolid(ctx, b);
    for (const b of bodies) if (b.isStatic) drawRampLabel(ctx, b, b.plugin.specId === this.selectedId);
    for (const l of this.lab.linker.drawable()) drawLink(ctx, l);
    this._drawShadows(bodies);
    if (this.showTrails) this._drawTrails();
    for (const b of bodies) if (!b.isStatic) drawSolid(ctx, b);

    if (this.showVectors) {
      for (const b of bodies) {
        if (b.isStatic) continue;
        const v = b.velocity;
        arrow(ctx, b.position.x, b.position.y, b.position.x + v.x * 6, b.position.y + v.y * 6, AMBER);
      }
    }

    if (this.showValues) this._drawValues(bodies);
    this._drawGhost();
    if (this.marker) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2 / v.zoom;
      ctx.beginPath();
      ctx.arc(this.marker.x, this.marker.y, 12 / v.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.pending) drawPending(ctx, this.pending, this.hover);
    if (this.effects) { this._drawBursts(now); this._drawDust(now); }
    ctx.restore();

    if (this.effects && now < this.flashUntil) {
      ctx.fillStyle = 'rgba(235, 242, 255, 0.10)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  _drawFloor() {
    const { ctx } = this;
    const o = FLOOR_OFF;
    // top face, receding from the contact line
    const top = ctx.createLinearGradient(0, FLOOR_PX + o.y, 0, FLOOR_PX);
    top.addColorStop(0, '#0f0f0f');
    top.addColorStop(1, FLOOR_TOP);
    ctx.fillStyle = top;
    ctx.fillRect(0, FLOOR_PX + o.y, WIDTH, -o.y);

    // metre lines running into the depth, plus two depth bands
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= WIDTH; x += PX_PER_M) {
      ctx.moveTo(x + 0.5, FLOOR_PX);
      ctx.lineTo(x + 0.5 + o.x, FLOOR_PX + o.y);
    }
    for (const f of [1 / 3, 2 / 3]) {
      ctx.moveTo(0, FLOOR_PX + o.y * f);
      ctx.lineTo(WIDTH, FLOOR_PX + o.y * f);
    }
    ctx.stroke();

    // front face
    const front = ctx.createLinearGradient(0, FLOOR_PX, 0, HEIGHT);
    front.addColorStop(0, '#141414');
    front.addColorStop(1, FLOOR_FRONT);
    ctx.fillStyle = front;
    ctx.fillRect(0, FLOOR_PX, WIDTH, HEIGHT - FLOOR_PX);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.7)';
    ctx.fillRect(0, FLOOR_PX, WIDTH, 1);

    // scale ticks along the front edge, one per metre
    ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let m = 1; m < WIDTH / PX_PER_M; m++) {
      ctx.fillRect(m * PX_PER_M, FLOOR_PX + 1, 1, 6);
      ctx.fillText(`${m} m`, m * PX_PER_M, FLOOR_PX + 12);
    }
  }

  _drawShadows(bodies) {
    const { ctx } = this;
    for (const b of bodies) {
      if (b.isStatic) continue;
      const extent = (b.bounds.max.x - b.bounds.min.x) / 2;
      const height = Math.max(0, FLOOR_PX - b.bounds.max.y);
      const k = 1 / (1 + height / 220);
      ctx.fillStyle = `rgba(0, 0, 0, ${0.45 * k})`;
      ctx.beginPath();
      ctx.ellipse(b.position.x + FLOOR_OFF.x * 0.35, FLOOR_PX + FLOOR_OFF.y * 0.35, extent * (0.6 + 0.5 * k), Math.abs(FLOOR_OFF.y) * 0.22 * (0.5 + 0.5 * k), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawTrails() {
    const { ctx } = this;
    for (const [id, trail] of this.trails) {
      if (trail.length < 2) continue;
      const body = this.lab.allBodies().find((b) => b.id === id);
      if (!body) continue;
      const color = materialOf(body.plugin.material).color;
      ctx.lineWidth = 2;
      for (let i = 1; i < trail.length; i++) {
        ctx.strokeStyle = rgba(color, (i / trail.length) * 0.45);
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
    }
  }

  _drawValues(bodies) {
    const { ctx } = this;
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const b of bodies) {
      if (b.isStatic) continue;
      const v = (Math.hypot(b.velocity.x, b.velocity.y) * 60) / PX_PER_M;
      const text = `${v < 0.005 ? '0' : fmt(Math.round(v * 100) / 100)} m/s`;
      const w = ctx.measureText(text).width + 10;
      const x = b.position.x, y = b.bounds.min.y - 6;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(x - w / 2, y - 17, w, 17);
      ctx.fillStyle = '#f2f2f2';
      ctx.fillText(text, x, y - 2);
    }
  }

  _drawGhost() {
    if (!this.hover || !this.spawnPreview) return;
    const { ctx } = this;
    const s = this.spawnPreview();
    const p = this.hover;
    const color = s.shape === 'plank' ? '#f2f2f2' : materialOf(s.material).color;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((-(s.angle || 0) * Math.PI) / 180);
    ctx.strokeStyle = rgba(color, 0.8);
    ctx.fillStyle = rgba(color, 0.12);
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const r = s.size * PX_PER_M;
    if (s.shape === 'ball') ctx.arc(0, 0, r, 0, Math.PI * 2);
    else if (s.shape === 'box') ctx.rect(-r / 2, -r / 2, r, r);
    else ctx.rect((-s.length * PX_PER_M) / 2, -r / 2, s.length * PX_PER_M, r);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (s.shape !== 'plank' && (s.vx || s.vy)) arrow(ctx, p.x, p.y, p.x + s.vx * 10, p.y - s.vy * 10, rgba(AMBER, 0.85));
  }

  _drawBursts(now) {
    const { ctx } = this;
    this.bursts = this.bursts.filter((b) => now - b.t0 < 320);
    for (const b of this.bursts) {
      const t = (now - b.t0) / 320;
      const ease = 1 - (1 - t) ** 3;
      const radius = 4 + (12 + 28 * b.strength) * ease;
      ctx.strokeStyle = rgba('#eef3ff', (1 - t) * (0.35 + 0.4 * b.strength));
      ctx.lineWidth = 1.5 + 2 * b.strength * (1 - t);
      ctx.beginPath();
      ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      if (t < 0.55) {
        const lines = 8;
        ctx.strokeStyle = rgba(b.color, (1 - t / 0.55) * 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < lines; i++) {
          const a = b.spin + (i / lines) * Math.PI * 2;
          const r0 = radius * 0.7, r1 = radius * (1.1 + 0.4 * b.strength);
          ctx.moveTo(b.x + Math.cos(a) * r0, b.y + Math.sin(a) * r0);
          ctx.lineTo(b.x + Math.cos(a) * r1, b.y + Math.sin(a) * r1);
        }
        ctx.stroke();
      }
    }
  }
}

// ---------- solids ----------

function drawSolid(ctx, body) {
  if (body.circleRadius) return drawSphere(ctx, body);
  const fixed = body.isStatic;
  const mat = materialOf(body.plugin.material);
  const base = fixed ? SURFACE : mat.color;
  const size = Math.min(body.bounds.max.x - body.bounds.min.x, body.bounds.max.y - body.bounds.min.y);
  const off = depthOffset(fixed ? SLAB_DEPTH : Math.max(size, 24));
  const v = body.vertices;
  const cx = body.position.x, cy = body.position.y;
  const alpha = fixed ? 1 : mat.alpha || 1;

  // side faces that point toward the viewer's raised eye
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    let n = norm({ x: b.y - a.y, y: -(b.x - a.x) });
    const mid = { x: (a.x + b.x) / 2 - cx, y: (a.y + b.y) / 2 - cy };
    if (n.x * mid.x + n.y * mid.y < 0) n = { x: -n.x, y: -n.y };
    if (n.x * off.x + n.y * off.y <= 0) continue;
    const lit = 0.5 * (n.x * -LIGHT.x + n.y * -LIGHT.y) + 0.5;
    ctx.fillStyle = rgba(shade(base, -0.45 + 0.4 * lit), alpha);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x + off.x, b.y + off.y);
    ctx.lineTo(a.x + off.x, a.y + off.y);
    ctx.closePath();
    ctx.fill();
  }

  // front face
  const g = ctx.createLinearGradient(body.bounds.min.x, body.bounds.min.y, body.bounds.max.x, body.bounds.max.y);
  g.addColorStop(0, rgba(shade(base, 0.12 + (fixed ? 0 : 0.2 * mat.shine)), alpha));
  g.addColorStop(1, rgba(shade(base, -0.18), alpha));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(v[0].x, v[0].y);
  for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = fixed ? 'rgba(239, 68, 68, 0.55)' : rgba(shade(base, -0.5), 0.9);
  ctx.lineWidth = 1;
  ctx.stroke();

  if (!fixed) {
    ctx.save();
    ctx.clip();
    drawTexture(ctx, body, mat, size);
    ctx.restore();
    label(ctx, body, Math.sqrt(body.area) / 2, base);
  }
}

// A link being built with a tool: the points clicked so far, then a line to the cursor.
function drawPending(ctx, pending, hover) {
  const pts = [...pending.points];
  if (hover) pts.push(hover);
  ctx.save();
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = ACCENT;
  for (const p of pending.points) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// ---------- springs, strings and pulleys ----------

function drawLink(ctx, l) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (l.type === 'pulley') {
    // stand-alone pulley disc on a short bracket
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(l.centre.x, l.centre.y);
    ctx.lineTo(l.centre.x, l.centre.y - l.r - 10);
    ctx.stroke();
    drawWheel(ctx, l.centre, l.r);
    ctx.fillStyle = 'rgba(242, 242, 242, 0.8)';
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`P${l.id}`, l.centre.x, l.centre.y - l.r - 12);
  } else if (l.type === 'spring') {
    if (l.fixedA) drawAnchor(ctx, l.a);
    drawCoil(ctx, l.a, l.b);
  } else if (l.type === 'rod') {
    if (l.fixedA) drawAnchor(ctx, l.a);
    ctx.strokeStyle = 'rgba(230, 230, 230, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(l.a.x, l.a.y);
    ctx.lineTo(l.b.x, l.b.y);
    ctx.stroke();
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(l.a.x, l.a.y, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (l.type === 'rope') {
    ctx.strokeStyle = l.slack ? 'rgba(230, 230, 230, 0.45)' : 'rgba(240, 240, 240, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash(l.slack ? [4, 4] : []);
    ctx.beginPath();
    l.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    if (l.points.length && !l.pulleys.length) return ctx.restore(); // only disc pulleys: drawn on their own
    // fixed end of a rope (ceiling hook)
    const first = l.points[0];
    if (first && l.pulleys.length && !l.pulleys[0].movable && Math.hypot(first.x - l.pulleys[0].x, first.y - l.pulleys[0].y) > 40) drawAnchor(ctx, first);
    // neighbouring fixed points close together are the two sides of one wheel
    for (const fixed of [l.pulleys.filter((p) => !p.movable), l.pulleys.filter((p) => p.movable)])
    for (let i = 0; i < fixed.length; i++) {
      const p = fixed[i], q = fixed[i + 1];
      if (q && Math.hypot(q.x - p.x, q.y - p.y) < 90) {
        drawWheel(ctx, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, Math.hypot(q.x - p.x, q.y - p.y) / 2);
        i++;
      } else {
        drawWheel(ctx, { x: p.x, y: p.y + 10 }, 10);
      }
    }
  }
  ctx.restore();
}

function drawCoil(ctx, a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const nx = -uy, ny = ux;
  const coils = 12, lead = Math.min(14, len * 0.1), width = 9;
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(a.x + ux * lead, a.y + uy * lead);
  const body = len - 2 * lead;
  for (let i = 1; i <= coils * 2; i++) {
    const t = lead + (body * i) / (coils * 2);
    const side = i === coils * 2 ? 0 : i % 2 ? 1 : -1;
    ctx.lineTo(a.x + ux * t + nx * width * side, a.y + uy * t + ny * width * side);
  }
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawWheel(ctx, c, r) {
  ctx.fillStyle = '#1c1c1c';
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c.x, c.y, Math.max(6, r), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e5e5e5';
  ctx.beginPath();
  ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

// A short hatched bar for a fixed support (ceiling hook or wall mount).
function drawAnchor(ctx, p) {
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(p.x - 18, p.y - 6, 36, 6);
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -18; x < 18; x += 6) { ctx.moveTo(p.x + x, p.y - 6); ctx.lineTo(p.x + x + 6, p.y - 12); }
  ctx.stroke();
}

// Every ramp shows its slope; the selected one is outlined.
function drawRampLabel(ctx, body, selected) {
  if (selected) {
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    const v = body.vertices;
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  let deg = (((body.angle * 180) / Math.PI) % 180 + 180) % 180; // 0..180
  if (deg > 90) deg -= 180;
  const slope = Math.abs(deg);
  if (slope >= 85) return; // walls: the angle is not interesting
  const rounded = Math.round(slope * 10) / 10;
  const text = `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}°`;
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  const x = body.position.x, y = body.bounds.min.y - 12;
  ctx.fillStyle = selected ? ACCENT : 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(x - w / 2, y - 9, w, 18);
  ctx.fillStyle = selected ? '#0a0000' : '#f2f2f2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function drawSphere(ctx, body) {
  const mat = materialOf(body.plugin.material);
  const { x, y } = body.position;
  const r = body.circleRadius;
  const alpha = mat.alpha || 1;
  const g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r * 1.05);
  g.addColorStop(0, rgba(shade(mat.color, 0.25 + 0.4 * mat.shine), alpha));
  g.addColorStop(0.55, rgba(mat.color, alpha));
  g.addColorStop(1, rgba(shade(mat.color, -0.6), alpha));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // a meridian that widens and narrows as the ball turns, so rolling reads as 3D
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = rgba(shade(mat.color, -0.55), 0.45);
  ctx.lineWidth = Math.max(1, r * 0.06);
  const phase = body.angle;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.abs(Math.cos(phase)) * r, r, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y, Math.abs(Math.sin(phase)) * r, r, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  if (mat.shine > 0.4) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.55 * mat.shine})`;
    ctx.beginPath();
    ctx.ellipse(x - r * 0.35, y - r * 0.42, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = rgba(shade(mat.color, -0.65), 0.8);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  label(ctx, body, r, mat.color);
}

// Small, body-fixed surface details so materials read at a glance.
function drawTexture(ctx, body, mat, size) {
  const key = body.plugin.material;
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  const h = size / 2;
  if (key === 'wood') {
    ctx.strokeStyle = rgba(shade(mat.color, -0.4), 0.35);
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(-h * 2, i * h * 0.38);
      ctx.bezierCurveTo(-h * 0.4, i * h * 0.38 + 3, h * 0.4, i * h * 0.38 - 3, h * 2, i * h * 0.38);
      ctx.stroke();
    }
  } else if (key === 'stone' || key === 'foam') {
    ctx.fillStyle = rgba(shade(mat.color, key === 'stone' ? -0.35 : -0.15), 0.5);
    let seed = body.plugin.specId * 97;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.arc((rnd() - 0.5) * size, (rnd() - 0.5) * size, 1 + rnd() * (key === 'foam' ? 2.5 : 1.5), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (key === 'steel' || key === 'ice') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-h * 0.7, -h * 0.2);
    ctx.lineTo(-h * 0.2, -h * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

function label(ctx, body, extent, base) {
  if (extent < 22) return;
  ctx.fillStyle = luminance(base) > 0.45 ? 'rgba(10, 14, 22, 0.85)' : 'rgba(245, 247, 252, 0.92)';
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${fmt(body.mass)} kg`, body.position.x, body.position.y);
}

function arrow(ctx, x1, y1, x2, y2, color) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 3) return;
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 8 * Math.cos(a - 0.4), y2 - 8 * Math.sin(a - 0.4));
  ctx.lineTo(x2 - 8 * Math.cos(a + 0.4), y2 - 8 * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fill();
}

// ---------- backdrop ----------

function makeBackdrop() {
  const c = document.createElement('canvas');
  c.width = WIDTH;
  c.height = HEIGHT;
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, FLOOR_PX);
  sky.addColorStop(0, '#000000');
  sky.addColorStop(1, '#050505');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // faint dust clouds for depth
  for (const [x, y, r, color] of [[880, 160, 420, 'rgba(130, 20, 20, 0.10)'], [260, 420, 360, 'rgba(90, 10, 10, 0.08)']]) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WIDTH, FLOOR_PX);
  }

  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const big = rnd() < 0.06;
    ctx.fillStyle = rnd() < 0.3 ? `rgba(255, 200, 200, ${0.2 + rnd() * 0.5})` : `rgba(255, 255, 255, ${0.15 + rnd() * (big ? 0.7 : 0.4)})`;
    ctx.beginPath();
    ctx.arc(rnd() * WIDTH, rnd() * FLOOR_PX, big ? 1 + rnd() * 0.6 : 0.3 + rnd() * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  return c; // the grid is drawn live (its spacing can change)
}

// ---------- colour helpers ----------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// amt > 0 mixes toward white, < 0 toward black
function shade(color, amt) {
  const rgb = color.startsWith('#') ? hexToRgb(color) : color.match(/\d+/g).slice(0, 3).map(Number);
  const target = amt > 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(amt));
  const [r, g, b] = rgb.map((c) => Math.round(c + (target - c) * k));
  return `rgb(${r}, ${g}, ${b})`;
}

function rgba(color, a) {
  const rgb = color.startsWith('#') ? hexToRgb(color) : color.match(/\d+/g).slice(0, 3).map(Number);
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
}

function luminance(color) {
  const [r, g, b] = color.startsWith('#') ? hexToRgb(color) : color.match(/\d+/g).slice(0, 3).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

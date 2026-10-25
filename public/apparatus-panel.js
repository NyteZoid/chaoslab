// The Apparatus panel: pick a Class 11 setup, set every parameter, load it, and compare the
// textbook prediction with what the simulation measures live.
import { APPARATUS, defaults, buildApparatus } from './apparatus.js';
import { fmt } from './lab.js';

// What to measure for each apparatus: which body (by builder key) and which quantity.
const MEASURE = {
  spring_mass: { key: 'm', kind: 'period' },
  pendulum: { key: 'b1', kind: 'period', axis: 'vx' },
  atwood: { key: 'm1', kind: 'accel' },
  table_pulley: { key: 'm2', kind: 'accel' },
  incline_pulley: { key: 'm2', kind: 'accel' },
  movable_pulley: { key: 'M', kind: 'accel' },
  incline_block: { key: 'm', kind: 'accel' },
  collision_1d: { kind: 'after_collision' },
  projectile: { key: 'ball', kind: 'range' },
};

export class ApparatusPanel {
  constructor({ lab, makeSlider, els }) {
    this.lab = lab;
    this.makeSlider = makeSlider;
    this.els = els;
    this.type = 'spring_mass';
    this.values = defaults(this.type);
    this.loaded = null; // { type, reason } of the apparatus currently in the lab
    this.measure = null;

    for (const [key, a] of Object.entries(APPARATUS)) els.select.add(new Option(a.name, key));
    els.select.addEventListener('change', () => this.setType(els.select.value));
    els.load.addEventListener('click', () => this.load());
    // an apparatus stays "loaded" through reruns, until a scene without its parts replaces it
    lab.on('reset', () => { if (!lab.bodies.some((b) => b.key)) this.loaded = null; this.startMeasure(); });
    lab.on('step', (t) => this.sample(t));
    this.setType(this.type);
  }

  setType(type, values = null) {
    this.type = type;
    this.els.select.value = type;
    this.values = { ...defaults(type), ...(values || {}) };
    this.els.sliders.replaceChildren();
    for (const def of APPARATUS[type].params) {
      this.makeSlider(this.els.sliders, { ...def, exact: true }, this.values[def.key],
        (v) => { this.values[def.key] = v; this.renderTheory(); },
        () => { if (this.loaded && this.loaded.type === this.type) this.load(); }); // live: re-run on release
    }
    this.renderTheory();
  }

  // Build the apparatus into the lab (replacing the scene) and run it.
  load(values = null, label = null) {
    if (values) this.setType(this.type, values);
    const built = buildApparatus(this.type, this.values, { gravity: this.lab.world.gravity });
    const summary = APPARATUS[this.type].params.map((q) => `${q.key} ${fmt(built.values[q.key])}`).join(', ');
    const reason = label || `${built.name}: ${summary}`;
    this.loaded = { type: this.type, reason };
    this.lab.loadScene({ world: { ...this.lab.world, ...built.world }, bodies: built.bodies, links: built.links }, reason);
    this.renderTheory(built.theory);
    return built;
  }

  renderTheory(theory) {
    const t = theory || buildApparatus(this.type, this.values, { gravity: this.lab.world.gravity }).theory;
    this.els.theory.innerHTML = t.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    this.renderMeasured();
  }

  // ---------- live measurement ----------

  startMeasure() {
    const m = this.loaded && MEASURE[this.loaded.type];
    const axis = m?.axis || (this.loaded?.type === 'spring_mass' && this.values.orientation < 0.5 ? 'vx' : 'vy');
    this.measure = m ? { ...m, axis, prev: null, crossings: [], v0: null, result: null, hit: null } : null;
    this.renderMeasured();
  }

  body(key) {
    const spec = this.lab.bodies.find((s) => s.key === key);
    return spec ? this.lab.liveBodies().find((b) => b.id === spec.id && !b.fragment) : null;
  }

  sample(t) {
    const m = this.measure;
    if (!m || m.done) return;
    if (m.kind === 'period') {
      const b = this.body(m.key);
      if (!b) return;
      const v = b[m.axis];
      if (m.prev !== null && m.prev < 0 && v >= 0) m.crossings.push(t);
      m.prev = v;
      if (m.crossings.length >= 2) {
        const c = m.crossings;
        m.result = `T = ${fmt((c[c.length - 1] - c[0]) / (c.length - 1))} s (${c.length - 1} cycle${c.length > 2 ? 's' : ''})`;
        if (c.length >= 5) m.done = true;
      }
    } else if (m.kind === 'accel') {
      const b = this.body(m.key);
      if (!b) return;
      if (m.v0 === null && t >= 0.2) m.v0 = { t, v: Math.hypot(b.vx, b.vy) };
      if (m.v0 && t >= 0.8) {
        m.result = `a = ${fmt(Math.abs(Math.hypot(b.vx, b.vy) - m.v0.v) / (t - m.v0.t))} m/s²`;
        m.done = true;
      }
    } else if (m.kind === 'after_collision') {
      const bodies = ['a', 'b'].map((k) => this.body(k));
      if (bodies.some((b) => !b)) return;
      const [a, b] = bodies;
      // after the impact the gap starts opening (or they move together); measure just after
      const approaching = a.vx - b.vx > 0.01;
      if (m.hit === null && !approaching && t > 0.05) m.hit = t;
      if (m.hit !== null && t - m.hit > 0.1) {
        m.result = `after: v₁ = ${fmt(a.vx)} m/s, v₂ = ${fmt(b.vx)} m/s`;
        m.done = true;
      }
    } else if (m.kind === 'range') {
      const b = this.body(m.key);
      if (!b) return;
      // landing: the bounce flips vy within one step, so look for falling → not falling near the floor
      if (t > 0.1 && m.prev !== null && m.prev < -0.5 && b.vy > m.prev * 0.5 && b.y < 0.3) {
        m.result = `lands at x = ${fmt(b.x)} m after ${fmt(t)} s`;
        m.done = true;
      }
      m.prev = b.vy;
    }
    if (m.result !== m.shown) { m.shown = m.result; this.renderMeasured(); }
  }

  renderMeasured() {
    const m = this.measure;
    this.els.measured.textContent = !this.loaded ? 'Load the apparatus to measure it.'
      : m?.result ? `Measured: ${m.result}` : 'Measuring…';
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

// Records what actually happened in each run, so explanations can quote real numbers.
// A "run" starts every time the scene is rebuilt (rerun, preset, auto-rerun after a slider change).
import { WORLD_H, fmt } from './lab.js';
import { materialOf, combine } from './materials.js';

const SAMPLE_EVERY = 0.1;   // seconds of sim time
const MAX_RUN_SECONDS = 120;
const SETTLE_SPEED = 0.05;  // m/s average
const SETTLE_HOLD = 1;      // seconds below SETTLE_SPEED to count as settled
const HIT_THRESHOLD = 0.3;  // m/s relative speed for a collision to count
const KEEP_RUNS = 12;

let nextRunId = 1;

export class Telemetry {
  constructor(lab) {
    this.lab = lab;
    this.runs = [];
    this.current = null;
    this.listeners = [];
    lab.on('reset', (e) => this._startRun(e));
    lab.on('step', (t) => this._onStep(t));
    lab.on('collision', (c) => this._onCollision(c));
    lab.on('break', (b) => {
      if (!this.current) return;
      this.current.breaks.push({ t: round(b.t), id: b.id, impact_energy_J: Math.round(b.energy), threshold_J: Math.round(b.threshold), pieces: b.pieces });
      this.current.events.push({ t: round(b.t), what: `#${b.id} ${b.material} shattered into ${b.pieces} pieces` });
    });
    lab.on('change', (c) => {
      if (!this.current) return;
      this.current.events.push({ t: round(c.t), what: c.reason });
      this.current.scene = lab.getScene(); // objects dropped mid-run belong to this run too
    });
  }

  onUpdate(fn) { this.listeners.push(fn); }
  _notify() { this.listeners.forEach((fn) => fn(this.current)); }

  _startRun({ reason, world }) {
    // an immediate restart of the same setup (e.g. after fixing overlaps) replaces the run
    const prev = this.current;
    if (prev && prev.reason === reason && (this.latest(prev)?.t ?? 0) < 0.5) this.runs.pop();
    this.current = {
      id: nextRunId++,
      reason,
      world: { ...world },
      bodies: this.lab.bodies.length,
      scene: this.lab.getScene(),
      objects: new Map(), // spec id -> per-object outcome
      breaks: [],
      samples: [],
      events: [],
      collisions: 0,
      wallHits: 0,
      hardestHit: 0,
      settledAt: null,
      peakSpeed: 0,
      peakHeight: 0,
      _calmSince: null,
      _nextSample: 0,
    };
    this.runs.push(this.current);
    if (this.runs.length > KEEP_RUNS) this.runs.shift();
    this._notify();
  }

  _onStep(t) {
    const run = this.current;
    if (!run || t > MAX_RUN_SECONDS) return;
    const live = this.lab.liveBodies();
    // peaks and bounces are tracked every physics step; 10 Hz samples would miss them
    for (const b of live) {
      const speed = Math.hypot(b.vx, b.vy);
      run.peakSpeed = Math.max(run.peakSpeed, speed);
      run.peakHeight = Math.max(run.peakHeight, b.y);
      this._trackObject(run, b, speed, t);
    }
    if (t < run._nextSample) return;
    run._nextSample = t + SAMPLE_EVERY;

    const g = 9.81 * this.lab.world.gravity;
    let ke = 0, pe = 0, px = 0, py = 0, speedSum = 0, maxSpeed = 0, maxHeight = 0;
    for (const b of live) {
      const v2 = b.vx * b.vx + b.vy * b.vy;
      const speed = Math.sqrt(v2);
      ke += 0.5 * b.mass * v2 + 0.5 * b.inertia * b.spin * b.spin; // moving + spinning
      pe += b.mass * g * b.y;
      px += b.mass * b.vx;
      py += b.mass * b.vy;
      speedSum += speed;
      maxSpeed = Math.max(maxSpeed, speed);
      maxHeight = Math.max(maxHeight, b.y);
    }
    pe += this.lab.linker.springEnergy(); // elastic energy counts as potential energy
    const avgSpeed = live.length ? speedSum / live.length : 0;
    run.samples.push({
      t: round(t),
      ke, pe, energy: ke + pe,
      momentum: Math.hypot(px, py),
      avgSpeed, maxSpeed, maxHeight,
      collisions: run.collisions,
    });

    if (run.settledAt === null && live.length) {
      if (avgSpeed < SETTLE_SPEED) {
        run._calmSince ??= t;
        if (t - run._calmSince >= SETTLE_HOLD) run.settledAt = round(run._calmSince);
      } else {
        run._calmSince = null;
      }
    }
    this._notify();
  }

  // Per-object outcomes: peak speed, first impact, bounce heights, distance travelled.
  _trackObject(run, b, speed, t) {
    let o = run.objects.get(b.id);
    if (b.fragment) { // pieces of a shattered object: only their top speed still means something
      if (o) o.peakSpeed = Math.max(o.peakSpeed, speed);
      return;
    }
    if (!o) {
      o = { peakSpeed: 0, firstImpact: null, bounces: [], rising: false, peak: 0, distance: 0, last: { x: b.x, y: b.y }, prevVy: b.vy };
      run.objects.set(b.id, o);
    }
    o.peakSpeed = Math.max(o.peakSpeed, speed);
    o.distance += Math.hypot(b.x - o.last.x, b.y - o.last.y);
    o.last = { x: b.x, y: b.y };
    if (o.prevVy < -0.3 && b.vy > 0.05) {      // falling, then rising: a bounce
      o.firstImpact ??= round(t);
      o.rising = true;
      o.peak = b.y;
    }
    if (o.rising) {
      o.peak = Math.max(o.peak, b.y);
      if (b.vy <= 0) {
        o.rising = false;
        if (o.bounces.length < 4) o.bounces.push(round(o.peak));
      }
    }
    o.prevVy = b.vy;
  }

  _onCollision({ speed, withWall }) {
    const run = this.current;
    if (!run || speed < HIT_THRESHOLD) return;
    run.collisions++;
    if (withWall) run.wallHits++;
    run.hardestHit = Math.max(run.hardestHit, speed);
  }

  latest(run = this.current) {
    return run && run.samples[run.samples.length - 1];
  }

  previous(run = this.current) {
    const i = this.runs.indexOf(run);
    return i > 0 ? this.runs[i - 1] : null;
  }

  // Compact, number-first summary of a run. This is what gets handed to Gemma.
  // upTo (seconds) cuts the run short so two runs can be compared over the same window.
  summarize(run = this.current, upTo = Infinity) {
    if (!run || !run.samples.length) return null;
    const s = run.samples.filter((x, i) => i === 0 || x.t <= upTo);
    const first = s[0], last = s[s.length - 1];
    const whole = upTo === Infinity;
    const peak = (key) => s.reduce((m, x) => Math.max(m, x[key]), 0);
    const at = (sec) => s.find((x) => x.t >= sec) || last;
    return {
      run: run.id,
      reason: run.reason,
      world: run.world,
      bodies: run.bodies,
      duration_s: last.t,
      start_energy_J: round(first.energy),
      end_energy_J: round(last.energy),
      energy_lost_pct: first.energy > 0 ? round((1 - last.energy / first.energy) * 100) : 0,
      peak_kinetic_J: round(peak('ke')),
      // whole-run peaks come from every physics step; a cut-short window only has 10 Hz samples, so leave them out
      ...(whole ? { peak_speed_mps: round(run.peakSpeed), max_height_m: round(run.peakHeight) } : {}),
      collisions: whole ? run.collisions : last.collisions,
      ...(whole ? { wall_hits: run.wallHits, hardest_hit_mps: round(run.hardestHit) } : {}),
      settled_at_s: run.settledAt !== null && run.settledAt <= last.t ? run.settledAt : null,
      still_moving: run.settledAt === null || run.settledAt > last.t,
      avg_speed_at: { '1s': round(at(1).avgSpeed), '3s': round(at(3).avgSpeed), '5s': round(at(5).avgSpeed) },
      events: run.events.slice(0, 20),
      ...(run.breaks.length ? { objects_shattered: run.breaks.filter((x) => x.t <= last.t).length } : {}),
    };
  }

  // What each object was and what it did, for Gemma. Capped so big scenes stay small.
  objectReport(run, limit = 14) {
    const out = [];
    for (const spec of run.scene.bodies) {
      if (out.length >= limit) break;
      const o = run.objects.get(spec.id);
      const item = {
        id: spec.id,
        shape: spec.shape,
        start: { x: round(spec.x), y: round(spec.y) },
      };
      if (spec.shape === 'plank') {
        Object.assign(item, { length: spec.length, angle: spec.angle, fixed: spec.static });
      } else {
        const m = materialOf(spec.material);
        Object.assign(item, {
          material: spec.material,
          mass_kg: spec.mass,
          size_m: spec.size,
          material_bounce: m.bounce,
          material_friction: m.friction,
          // what actually applies against the floor and ramps
          floor_contact: { bounce: round(combine(m.bounce, run.world.bounciness)), friction: round(combine(m.friction, run.world.friction)) },
        });
        if (spec.vx || spec.vy) item.launch_mps = { vx: spec.vx, vy: spec.vy };
      }
      if (o) {
        Object.assign(item, {
          end: { x: round(o.last.x), y: round(o.last.y) },
          peak_speed_mps: round(o.peakSpeed),
          distance_m: round(o.distance),
        });
        if (o.firstImpact !== null) item.first_bounce_at_s = o.firstImpact;
        if (o.bounces.length) item.bounce_heights_m = o.bounces;
      }
      if (spec.breakable) {
        item.break_threshold_J = spec.breakEnergy;
        const broke = run.breaks.find((x) => x.id === spec.id);
        item.shattered = broke ? { at_s: broke.t, impact_energy_J: broke.impact_energy_J, pieces: broke.pieces } : false;
      }
      out.push(item);
    }
    if (run.scene.bodies.length > limit) out.push({ note: `${run.scene.bodies.length - limit} more objects not listed` });
    return out;
  }

  // Everything Gemma needs to explain one run, or the difference between two.
  reportFor(run, base) {
    // compare both runs over the same stretch of time, or the shorter one skews every total
    const window = base ? Math.min(this.latest(run)?.t ?? 0, this.latest(base)?.t ?? 0) : Infinity;
    const pack = (r) => {
      const s = this.summarize(r, window);
      if (!s) return null;
      delete s.reason;
      return { ...s, objects: this.objectReport(r) };
    };
    const current = pack(run);
    if (!base) return { change: run.reason, run: current };
    const before = pack(base);
    const worldChanges = Object.keys(run.world)
      .filter((k) => base.world[k] !== run.world[k])
      .map((k) => `${k}: ${fmt(base.world[k])} → ${fmt(run.world[k])}`);
    const ids = (r) => new Set(r.scene.bodies.map((b) => b.id));
    const beforeIds = ids(base), afterIds = ids(run);
    const sceneChanges = [
      ...run.scene.bodies.filter((b) => !beforeIds.has(b.id)).map((b) => `added #${b.id} ${b.material || ''} ${b.shape}`.replace('  ', ' ')),
      ...base.scene.bodies.filter((b) => !afterIds.has(b.id)).map((b) => `removed #${b.id} ${b.material || ''} ${b.shape}`.replace('  ', ' ')),
    ];
    return {
      change: run.reason,
      compared_over_first_s: window,
      world_changes: worldChanges,
      scene_changes: sceneChanges,
      before,
      after: current,
    };
  }

  // Side-by-side difference between two runs, for "why did this change?"
  compare(a, b) {
    const sa = this.summarize(a), sb = this.summarize(b);
    if (!sa || !sb) return null;
    const worldChanges = Object.keys(sb.world)
      .filter((k) => sa.world[k] !== sb.world[k])
      .map((k) => `${k}: ${fmt(sa.world[k])} → ${fmt(sb.world[k])}`);
    return { before: sa, after: sb, world_changes: worldChanges };
  }
}

export const METRICS = {
  energy: { label: 'Total energy', unit: 'J', key: 'energy' },
  ke: { label: 'Kinetic energy', unit: 'J', key: 'ke' },
  avgSpeed: { label: 'Average speed', unit: 'm/s', key: 'avgSpeed' },
  momentum: { label: 'Momentum', unit: 'kg·m/s', key: 'momentum' },
  maxHeight: { label: 'Highest object', unit: 'm', key: 'maxHeight', max: WORLD_H },
  collisions: { label: 'Collisions', unit: '', key: 'collisions' },
};

function round(n) { return Math.round(n * 100) / 100; }

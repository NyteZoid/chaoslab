// The physics lab: owns the Matter.js engine and the scene spec. Drawing lives in render.js.
// Scene specs use physics units so Gemma can read and write them directly:
// metres, kilograms, m/s, degrees; x grows right, y grows UP from the floor.
import { MATERIALS, DEFAULT_MATERIAL, materialOf, massFor, combine, breakEnergyFor } from './materials.js';
import { Linker } from './links.js';

const { Engine, Runner, Bodies, Body, Composite, Events, Mouse, MouseConstraint, Query } = Matter;

export const PX_PER_M = 100;
export const WIDTH = 1200;
export const HEIGHT = 720;
export const FLOOR_PX = 640;
export const WORLD_W = WIDTH / PX_PER_M;   // 12 m
export const WORLD_H = FLOOR_PX / PX_PER_M; // 6.4 m to the ceiling
const STEP_TO_SEC = 60; // Matter velocities are px per 1/60 s step
const G = 9.81;

// friction and bounciness describe the fixed surfaces (floor, walls, ramps);
// each object brings its own values from its material.
export const DEFAULT_WORLD = { gravity: 1, friction: 0.1, bounciness: 0.4, airDensity: 1.2, timeScale: 1 };

export const toPx = (x, y) => ({ x: x * PX_PER_M, y: FLOOR_PX - y * PX_PER_M });
export const toM = (px, py) => ({ x: px / PX_PER_M, y: (FLOOR_PX - py) / PX_PER_M });

let nextSpecId = 1;
const BALL_SIDES = 160; // rolls within ~3% of an ideal disc; ~2 ms/step for the 36-object rain preset

export class Lab {
  static ballSides = BALL_SIDES;

  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    this.engine = Engine.create({ enableSleeping: false });
    this.engine.gravity.scale = G / 1e4; // 1 g ≈ 9.81 m/s² at 100 px per metre
    this.runner = Runner.create();
    this.world = { ...DEFAULT_WORLD };
    this.bodies = [];         // spec bodies, in physics units
    this.listeners = {};
    this.paused = false;
    this.runStart = 0;
    this._breakQueue = new Map();

    this.mouse = Mouse.create(canvas);
    this.mouseConstraint = MouseConstraint.create(this.engine, {
      mouse: this.mouse,
      constraint: { stiffness: 0.2, render: { visible: false } },
    });
    Composite.add(this.engine.world, this.mouseConstraint);

    this.links = [];           // springs, rods and ropes between bodies (see links.js)
    this.linker = new Linker(this);
    Events.on(this.engine, 'beforeUpdate', () => { this._applyFriction(); this._applyAirDrag(); this.linker.beforeStep(); });
    Events.on(this.engine, 'afterUpdate', () => { this.linker.afterStep(); this._processBreaks(); this.emit('step', this.time); });
    Events.on(this.engine, 'collisionStart', (e) => { this._mixBounce(e.pairs); this._onCollisions(e.pairs); this._resolveImpacts(e.pairs); });
    Events.on(this.engine, 'collisionActive', (e) => this._mixBounce(e.pairs));

    this._buildWalls();
    Runner.run(this.runner, this.engine);
  }

  on(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, data) {
    if (this.muted) return; // dry runs are invisible: no telemetry, sounds or effects
    (this.listeners[name] || []).forEach((fn) => fn(data));
  }

  // Run the current scene ahead invisibly and report what each loose object did, then restart it.
  // Used to check that an AI-built scene does what was asked (e.g. the ball reaches the bottom).
  dryRun(seconds = 10) {
    const wasRunning = this.runner.enabled;
    this.runner.enabled = false;
    this.muted = true;
    const report = new Map();
    const steps = Math.round(seconds * STEP_TO_SEC);
    try {
      for (let i = 0; i < steps; i++) {
        Engine.update(this.engine, 1000 / STEP_TO_SEC);
        const t = (i + 1) / STEP_TO_SEC;
        for (const b of this.liveBodies()) {
          const spec = this.bodies.find((s) => s.id === b.id);
          let r = report.get(b.id);
          if (!r) {
            r = { id: b.id, start: spec ? { x: spec.x, y: spec.y } : { x: b.x, y: b.y }, minY: Infinity, floorAt: null, bounce: 0, shattered: false };
            report.set(b.id, r);
          }
          if (b.fragment) { r.shattered = true; continue; }
          const rest = spec ? (spec.shape === 'ball' ? spec.size : spec.size / 2) : 0.2;
          r.minY = Math.min(r.minY, b.y);
          r.end = { x: b.x, y: b.y };
          if (r.floorAt === null && b.y < rest + 0.08) r.floorAt = Math.round(t * 100) / 100;
          // first bounce: highest point reached in the 3 s after first touching the floor
          if (r.floorAt !== null && t - r.floorAt < 3) r.bounce = Math.max(r.bounce, b.y - rest);
        }
      }
    } finally {
      this.muted = false;
      this.runner.enabled = wasRunning && !this.paused;
    }
    // fragments carry their parent's id; an object that shattered keeps its last whole position
    for (const r of report.values()) {
      if (!r.end) r.end = { ...r.start };
      r.distance = Math.round(Math.abs(r.end.x - r.start.x) * 100) / 100;
      r.bounce = Math.round(r.bounce * 100) / 100;
    }
    this.rerun(this.lastReason);
    return [...report.values()];
  }

  get time() { return (this.engine.timing.timestamp - this.runStart) / 1000; }

  // ---- Public API (also what Gemma's tool calls will drive) ----

  getScene() {
    return { world: { ...this.world }, bodies: this.bodies.map((b) => ({ ...b })), links: this.links.map((l) => structuredClone(l)) };
  }

  loadScene(scene, reason = 'Loaded scene') {
    this.world = normalizeWorld({ ...DEFAULT_WORLD, ...(scene.world || {}) });
    this.bodies = (scene.bodies || []).map((b) => normalizeSpec(b));
    // links may name bodies by the temporary key an apparatus builder gave them
    const idOf = new Map(this.bodies.filter((b) => b.key).map((b) => [b.key, b.id]));
    const ref = (r) => (r && r.body != null ? { ...r, body: idOf.get(r.body) ?? r.body } : r); // keep dx/dy offsets
    this.links = (scene.links || []).map((l) => (l.type === 'rope'
      ? { ...l, points: l.points.map(ref) }
      : { ...l, a: ref(l.a), b: ref(l.b) }));
    this.rerun(reason);
  }

  // Rebuild every body from the spec so runs start from identical conditions.
  rerun(reason = 'Rerun') {
    this.lastReason = reason;
    for (const body of this.allBodies()) {
      if (!body.plugin.wall) Composite.remove(this.engine.world, body);
    }
    this._breakQueue.clear();
    this._applyWorld();
    for (const spec of this.bodies) this._spawn(spec);
    this.linker.build();
    this.runStart = this.engine.timing.timestamp;
    this.emit('reset', { reason, world: { ...this.world }, bodies: this.bodies.length });
  }

  // silent: apply without logging (used while a slider is being dragged).
  setWorld(partial, { rerun = false, silent = false } = {}) {
    const before = { ...this.world };
    this.world = normalizeWorld({ ...this.world, ...partial });
    this._applyWorld();
    if (silent) return;
    const changes = Object.keys(partial)
      .filter((k) => before[k] !== this.world[k])
      .map((k) => ({ key: k, from: before[k], to: this.world[k] }));
    if (!changes.length) return;
    const reason = changes.map((c) => `${c.key} ${fmt(c.from)} → ${fmt(c.to)}`).join(', ');
    if (rerun) this.rerun(reason);
    else this.emit('change', { t: this.time, reason });
  }

  // Lift any loose object that starts inside another one until it is clear, then restart.
  // AI-written scenes often place objects inside ramps or each other.
  resolveOverlaps(reason) {
    const step = 0.05;
    const placed = this.allBodies().filter((b) => b.isStatic && b.plugin.specId); // ramps; walls are handled by normalizeSpec
    let moved = 0;
    for (const body of this.allBodies().filter((b) => b.plugin.specId && !b.isStatic)) {
      let lifts = 0;
      const overlapping = () => Query.collides(body, placed).some((c) => c.depth > 2); // touching is fine
      while (overlapping() && body.position.y > 0 && lifts < 140) {
        Body.translate(body, { x: 0, y: -step * PX_PER_M });
        lifts++;
      }
      if (lifts) {
        const spec = this.bodies.find((s) => s.id === body.plugin.specId);
        spec.y = Math.min(WORLD_H - spec.size, Math.round((spec.y + lifts * step + 0.02) * 100) / 100);
        moved++;
      }
      placed.push(body);
    }
    if (moved) this.rerun(reason);
    return moved;
  }

  addBody(spec) {
    const s = normalizeSpec(spec);
    this.bodies.push(s);
    this._spawn(s);
    this.emit('change', { t: this.time, reason: `added ${describe(s)}` });
    return s.id;
  }

  spec(id) { return this.bodies.find((s) => s.id === id) || null; }

  // ---- springs, strings and ropes added by hand ----

  addLink(link) {
    this.links.push(link);
    this.linker.build();
    const what = link.type === 'rope' ? `pulley rope over ${link.points.length - 2} pulley${link.points.length === 3 ? '' : 's'}` : link.type === 'rod' ? 'string' : `spring k = ${fmt(link.k)} N/m`;
    this.emit('change', { t: this.time, reason: `added ${what}` });
  }

  // Make what is on screen the new starting layout (objects where they are now, at rest).
  // Used before hand-building strings and ropes, so lengths measured now still hold after a rerun.
  captureState() {
    for (const s of this.bodies) {
      if (s.static) continue;
      const b = this.allBodies().find((x) => x.plugin.specId === s.id && !x.plugin.fragment);
      if (!b) continue;
      const p = toM(b.position.x, b.position.y);
      s.x = Math.round(p.x * 1000) / 1000;
      s.y = Math.round(p.y * 1000) / 1000;
      s.angle = Math.round((-b.angle * 180) / Math.PI * 10) / 10;
      s.vx = 0;
      s.vy = 0;
    }
  }

  // ---- stand-alone pulley discs ----

  addPulley(x, y, r = 0.15) {
    const id = Math.max(0, ...this.links.filter((l) => l.type === 'pulley').map((l) => l.id)) + 1;
    this.links.push({ type: 'pulley', id, x, y, r });
    this.linker.build();
    this.emit('change', { t: this.time, reason: `added pulley P${id}` });
    return id;
  }

  removePulley(id) {
    // ropes over it go too
    this.links = this.links.filter((l) => !(l.type === 'pulley' && l.id === id) && !(l.type === 'rope' && l.points.some((p) => p.pulley === id)));
    this.linker.build();
    this.emit('change', { t: this.time, reason: `removed pulley P${id}` });
  }

  pulleyAt(px) {
    for (const l of this.links) {
      if (l.type !== 'pulley') continue;
      if (Math.hypot(l.x * PX_PER_M - px.x, this.toPxY(l.y) - px.y) <= (l.r + 0.12) * PX_PER_M) return l;
    }
    return null;
  }

  // where a rope passing over pulley id touches it (world px): the top of the wheel
  pulleyTop(id) {
    const l = this.links.find((x) => x.type === 'pulley' && x.id === id);
    return l ? { x: l.x * PX_PER_M, y: this.toPxY(l.y + l.r) } : null;
  }

  // Fixed points of links (supports, pulleys, spring anchors) with where they sit, in world px.
  linkPoints() {
    const out = [];
    this.links.forEach((l, i) => {
      if (l.type === 'pulley') {
        out.push({ link: i, slot: 'c', kind: `Pulley P${l.id}`, pulleyId: l.id, x: l.x, y: l.y, px: { x: l.x * PX_PER_M, y: this.toPxY(l.y) } });
        return;
      }
      const slots = l.type === 'rope' ? l.points.map((p, j) => [j, p]) : [['a', l.a], ['b', l.b]];
      for (const [slot, p] of slots) {
        if (!p || p.body != null || p.pulley != null) continue;
        const kind = l.type === 'rope' ? (slot === 0 || slot === l.points.length - 1 ? 'Rope support' : 'Pulley') : l.type === 'rod' ? 'String support' : 'Spring anchor';
        out.push({ link: i, slot, kind, x: p.x, y: p.y, px: { x: p.x * PX_PER_M, y: this.toPxY(p.y) } });
      }
    });
    return out;
  }

  linkPointAt(px, radius = 14) {
    let best = null, bestD = radius;
    for (const p of this.linkPoints()) {
      const d = Math.hypot(p.px.x - px.x, p.px.y - px.y);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  // Drag a pulley or anchor to a new place (metres). Ropes re-take their length from the new layout.
  moveLinkPoint(index, slot, x, y) {
    const l = this.links[index];
    if (!l) return;
    const p = { x: Math.round(clamp(x, 0, WORLD_W) * 100) / 100, y: Math.round(clamp(y, 0, WORLD_H) * 100) / 100 };
    if (l.type === 'pulley') { l.x = p.x; l.y = p.y; for (const r of this.links) if (r.type === 'rope' && r.points.some((q) => q.pulley === l.id)) delete r.length; }
    else if (l.type === 'rope') { l.points[slot] = p; delete l.length; } else l[slot] = p;
    this.linker.build();
  }

  // Change a fixed piece (ramp, wall) in place without restarting the run, e.g. while dragging
  // its angle slider. Returns the updated spec.
  patchFixed(id, patch) {
    const i = this.bodies.findIndex((s) => s.id === id);
    if (i < 0 || !this.bodies[i].static) return null;
    const next = normalizeSpec({ ...this.bodies[i], ...patch, id });
    this.bodies[i] = next;
    for (const body of this.allBodies()) {
      if (body.plugin.specId === id) Composite.remove(this.engine.world, body);
    }
    this._spawn(next);
    return next;
  }

  // After a ramp turns or changes length, objects that were resting on it keep their place on its
  // surface (same distance along it, same height above it) instead of being left in mid-air or inside it.
  carryRiders(before, after) {
    const frame = (p) => {
      const a = (p.angle * Math.PI) / 180;
      return { c: { x: p.x, y: p.y }, dir: { x: Math.cos(a), y: Math.sin(a) }, nrm: { x: -Math.sin(a), y: Math.cos(a) } };
    };
    const f0 = frame(before), f1 = frame(after);
    let moved = 0;
    for (const s of this.bodies) {
      if (s.static) continue;
      const dx = s.x - f0.c.x, dy = s.y - f0.c.y;
      const u = dx * f0.dir.x + dy * f0.dir.y;  // distance along the old ramp
      const v = dx * f0.nrm.x + dy * f0.nrm.y;  // height above its centre line
      const reach = (s.shape === 'ball' ? s.size : s.size * 0.71) + before.size / 2 + 0.35;
      if (Math.abs(u) > before.length / 2 || v < 0 || v > reach) continue;
      const uu = Math.max(-after.length / 2, Math.min(after.length / 2, u));
      s.x = Math.round((f1.c.x + uu * f1.dir.x + v * f1.nrm.x) * 1000) / 1000;
      s.y = Math.round((f1.c.y + uu * f1.dir.y + v * f1.nrm.y) * 1000) / 1000;
      moved++;
    }
    return moved;
  }

  removeBody(id) {
    const i = this.bodies.findIndex((b) => b.id === id);
    if (i < 0) return false;
    // links attached to it go too
    const uses = (r) => r && r.body === id;
    this.links = this.links.filter((l) => !(l.type === 'rope' ? l.points.some(uses) : uses(l.a) || uses(l.b)));
    const [s] = this.bodies.splice(i, 1);
    for (const body of this.allBodies()) {
      if (body.plugin.specId === id) Composite.remove(this.engine.world, body);
    }
    this.linker.build();
    this.emit('change', { t: this.time, reason: `removed ${describe(s)}` });
    return true;
  }

  clear() {
    this.bodies = [];
    this.links = [];
    this.rerun('Cleared');
  }

  setPaused(paused) {
    this.paused = paused;
    this.runner.enabled = !paused;
    this.emit('pause', paused);
  }

  allBodies() { return Composite.allBodies(this.engine.world); }

  // Live bodies with their current state, in physics units.
  liveBodies() {
    return this.allBodies()
      .filter((b) => b.plugin.specId && !b.isStatic)
      .map((b) => {
        const p = toM(b.position.x, b.position.y);
        return {
          id: b.plugin.specId,
          mass: b.mass,
          x: p.x, y: p.y,
          vx: (b.velocity.x * STEP_TO_SEC) / PX_PER_M,
          vy: (-b.velocity.y * STEP_TO_SEC) / PX_PER_M,
          inertia: b.inertia / (PX_PER_M * PX_PER_M), // kg·m²
          spin: b.angularVelocity * STEP_TO_SEC,       // rad/s
          fragment: !!b.plugin.fragment,
        };
      });
  }

  specAtPoint(px, py) {
    const hits = Query.point(this.allBodies(), { x: px, y: py });
    const hit = hits.find((b) => b.plugin.specId);
    return hit ? hit.plugin.specId : null;
  }

  setGrabEnabled(enabled) {
    this.mouseConstraint.collisionFilter.mask = enabled ? 0xffffffff : 0;
  }

  // ---- Internals ----

  _buildWalls() {
    const t = 200; // thick walls so fast objects don't tunnel through
    const opts = { isStatic: true, plugin: { wall: true } };
    Composite.add(this.engine.world, [
      Bodies.rectangle(WIDTH / 2, FLOOR_PX + t / 2, WIDTH + 2 * t, t, opts),
      Bodies.rectangle(WIDTH / 2, -t / 2, WIDTH + 2 * t, t, opts),
      Bodies.rectangle(-t / 2, HEIGHT / 2, t, HEIGHT * 2, opts),
      Bodies.rectangle(WIDTH + t / 2, HEIGHT / 2, t, HEIGHT * 2, opts),
    ]);
  }

  _applyWorld() {
    const w = this.world;
    this.engine.gravity.y = w.gravity;
    this.engine.timing.timeScale = w.timeScale;
    for (const body of this.allBodies()) {
      body.friction = 0; // see _applyFriction
      body.frictionStatic = 0;
      body.frictionAir = 0; // see _applyAirDrag
      if (body.isStatic) body.restitution = w.bounciness;
    }
  }

  _surface(body) {
    if (body.isStatic) return { friction: this.world.friction, bounce: this.world.bounciness };
    const m = materialOf(body.plugin.material);
    // an object can override its material, e.g. a frictionless block or a collision with a set e
    return { friction: body.plugin.friction ?? m.friction, bounce: body.plugin.bounce ?? m.bounce };
  }

  toPxY(y) { return FLOOR_PX - y * PX_PER_M; }

  // Matter.js loses restitution when two flat faces meet (moving blocks stick together even at e = 1).
  // For impacts between two moving objects we apply the textbook impulse ourselves, along the contact
  // normal: J = (1 + e)·v_closing / (1/m₁ + 1/m₂). Matter then sees them separating and adds nothing.
  _resolveImpacts(pairs) {
    for (const pair of pairs) {
      const A = pair.bodyA.parent, B = pair.bodyB.parent;
      if (A.isStatic || B.isStatic || pair.isSensor) continue;
      let n = pair.collision.normal;
      if ((B.position.x - A.position.x) * n.x + (B.position.y - A.position.y) * n.y < 0) n = { x: -n.x, y: -n.y };
      const closing = (A.velocity.x - B.velocity.x) * n.x + (A.velocity.y - B.velocity.y) * n.y;
      if (closing <= 0) continue;
      const j = ((1 + pair.restitution) * closing) / (A.inverseMass + B.inverseMass);
      Body.setVelocity(A, { x: A.velocity.x - j * A.inverseMass * n.x, y: A.velocity.y - j * A.inverseMass * n.y });
      Body.setVelocity(B, { x: B.velocity.x + j * B.inverseMass * n.x, y: B.velocity.y + j * B.inverseMass * n.y });
    }
  }

  // Matter takes the max restitution of a pair; use the geometric mean of both surfaces instead.
  _mixBounce(pairs) {
    for (const pair of pairs) {
      pair.restitution = combine(this._surface(pair.bodyA.parent).bounce, this._surface(pair.bodyB.parent).bounce);
    }
  }

  // Coulomb friction, applied by us instead of Matter (whose friction isn't proportional to
  // the normal force and is ~4× too sticky on slopes). For each resting contact we cancel the
  // sliding speed at the contact point, capped at μ·N per step, with N ≈ the upper body's
  // weight along the contact normal. Same μ for static and kinetic; rolling falls out of the torque.
  _applyFriction() {
    const gStep = (this.world.gravity * G * PX_PER_M) / (STEP_TO_SEC * STEP_TO_SEC); // px/step²
    if (!gStep) return;
    const cross = (ax, ay, bx, by) => ax * by - ay * bx;
    for (const pair of this.engine.pairs.list) {
      if (!pair.isActive || pair.isSensor) continue;
      const A = pair.collision.parentA, B = pair.collision.parentB;
      if (A.isStatic && B.isStatic) continue;
      const mu = combine(this._surface(A).friction, this._surface(B).friction);
      const n = pair.collision.normal;
      const top = A.isStatic ? B : B.isStatic ? A : (A.position.y < B.position.y ? A : B);
      const jMax = mu * top.mass * Math.abs(gStep * n.y);
      if (!jMax) continue;

      let cx = 0, cy = 0;
      const count = pair.contactCount || pair.contacts.length;
      for (let i = 0; i < count; i++) { cx += pair.contacts[i].vertex.x; cy += pair.contacts[i].vertex.y; }
      cx /= count; cy /= count;

      const tx = -n.y, ty = n.x;
      const rAx = cx - A.position.x, rAy = cy - A.position.y;
      const rBx = cx - B.position.x, rBy = cy - B.position.y;
      const vA = A.velocity, vB = B.velocity, wA = A.angularVelocity, wB = B.angularVelocity;
      const vt = (vA.x - wA * rAy - (vB.x - wB * rBy)) * tx + (vA.y + wA * rAx - (vB.y + wB * rBx)) * ty;
      const rAt = cross(rAx, rAy, tx, ty), rBt = cross(rBx, rBy, tx, ty);
      const k = A.inverseMass + B.inverseMass + A.inverseInertia * rAt * rAt + B.inverseInertia * rBt * rBt;
      if (!k) continue;
      const j = Math.max(-jMax, Math.min(jMax, vt / k));

      if (!A.isStatic) {
        Body.setVelocity(A, { x: vA.x - j * A.inverseMass * tx, y: vA.y - j * A.inverseMass * ty });
        Body.setAngularVelocity(A, wA - j * A.inverseInertia * rAt);
      }
      if (!B.isStatic) {
        Body.setVelocity(B, { x: vB.x + j * B.inverseMass * tx, y: vB.y + j * B.inverseMass * ty });
        Body.setAngularVelocity(B, wB + j * B.inverseInertia * rBt);
      }
    }
  }

  // Quadratic air drag, F = ½·ρ·Cd·A·v², so light, wide objects slow down more than heavy ones
  // (Matter's frictionAir slows everything by the same fraction regardless of mass).
  _applyAirDrag() {
    const rho = this.world.airDensity;
    if (!rho) return;
    const dt = this.engine.timing.timeScale / STEP_TO_SEC;
    for (const b of this.allBodies()) {
      if (b.isStatic || !b.plugin.dragArea) continue;
      const v = Math.hypot(b.velocity.x, b.velocity.y) * STEP_TO_SEC / PX_PER_M; // m/s
      if (v < 1e-4) continue;
      const dv = Math.min(v, (0.5 * rho * b.plugin.dragCoef * b.plugin.dragArea * v * v / b.mass) * dt);
      const k = 1 - dv / v;
      Body.setVelocity(b, { x: b.velocity.x * k, y: b.velocity.y * k });
    }
  }

  _spawn(s) {
    const p = toPx(s.x, s.y);
    const opts = {
      isStatic: s.static,
      angle: (-s.angle * Math.PI) / 180,
      friction: 0,
      frictionStatic: 0,
      restitution: s.static ? this.world.bounciness : materialOf(s.material).bounce,
      frictionAir: 0,
      plugin: {
        specId: s.id,
        material: s.material,
        // frontal area of the 3D solid (sphere or cube) and its drag coefficient
        dragArea: s.shape === 'ball' ? Math.PI * s.size * s.size : s.size * s.size,
        dragCoef: s.shape === 'ball' ? 0.47 : 1.05,
        shape: s.shape,
        size: s.size,
        breakPerKg: s.breakable ? s.breakEnergy / s.mass : 0, // J/kg, so fragments inherit the toughness
        friction: s.friction,  // per-object overrides of the material (may be undefined)
        bounce: s.bounce,
      },
    };
    if (s.bounce != null && !s.static) opts.restitution = s.bounce;
    let body;
    // Matter's circles have only `radius px` sides, so small balls roll like polygons and bleed
    // speed at every corner. A many-sided polygon rolls smoothly; circleRadius keeps it a circle elsewhere.
    if (s.shape === 'ball') body = Bodies.polygon(p.x, p.y, Lab.ballSides, s.size * PX_PER_M, { ...opts, circleRadius: s.size * PX_PER_M });
    else if (s.shape === 'box') body = Bodies.rectangle(p.x, p.y, s.size * PX_PER_M, s.size * PX_PER_M, opts);
    else body = Bodies.rectangle(p.x, p.y, s.length * PX_PER_M, s.size * PX_PER_M, opts);
    if (!s.static) {
      Body.setMass(body, s.mass);
      Body.setInertia(body, s.fixedRotation ? Infinity : body.inertia / Body._inertiaScale); // Matter inflates inertia 4×; use the real moment so balls roll correctly
      Body.setVelocity(body, { x: (s.vx * PX_PER_M) / STEP_TO_SEC, y: (-s.vy * PX_PER_M) / STEP_TO_SEC });
    }
    Composite.add(this.engine.world, body);
    return body;
  }

  // Shatter queued bodies after the physics step (removing bodies mid-step upsets the solver).
  _processBreaks() {
    if (!this._breakQueue.size) return;
    for (const { body, energy, threshold } of this._breakQueue.values()) this._shatter(body, energy, threshold);
    this._breakQueue.clear();
  }

  // Split a box into four smaller boxes, or a ball into four wedge shards. The pieces share the
  // parent's mass, velocity and spin, plus a small outward kick from part of the excess energy.
  _shatter(body, energy, threshold) {
    const { shape, size, material, specId } = body.plugin;
    const pieceSize = size / 2;
    const pieces = [];
    const c = body.position, angle = body.angle;
    const rot = (x, y) => ({ x: c.x + x * Math.cos(angle) - y * Math.sin(angle), y: c.y + x * Math.sin(angle) + y * Math.cos(angle) });
    const sizePx = size * PX_PER_M;
    if (shape === 'box') {
      for (const [ox, oy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const p = rot((ox * sizePx) / 4, (oy * sizePx) / 4);
        pieces.push(Bodies.rectangle(p.x, p.y, sizePx / 2 - 1, sizePx / 2 - 1, { angle }));
      }
    } else {
      for (let q = 0; q < 4; q++) {
        const verts = [{ x: c.x, y: c.y }];
        for (let k = 0; k <= 6; k++) {
          const t = angle + (q + k / 6) * (Math.PI / 2);
          verts.push({ x: c.x + Math.cos(t) * (sizePx - 1), y: c.y + Math.sin(t) * (sizePx - 1) });
        }
        const centre = Matter.Vertices.centre(verts);
        pieces.push(Bodies.fromVertices(centre.x, centre.y, [verts]));
      }
    }
    const pieceMass = body.mass / pieces.length;
    const kick = Math.min(6, Math.sqrt((2 * 0.15 * Math.max(0, energy - threshold)) / body.mass)); // m/s
    const mat = materialOf(material);
    const canBreakAgain = pieceSize >= 0.08;
    for (const piece of pieces) {
      const out = { x: piece.position.x - c.x, y: piece.position.y - c.y };
      const len = Math.hypot(out.x, out.y) || 1;
      Object.assign(piece, { friction: 0, frictionStatic: 0, frictionAir: 0, restitution: mat.bounce });
      piece.plugin = {
        specId, material, fragment: true,
        shape: 'box', size: pieceSize,
        dragArea: pieceSize * pieceSize, dragCoef: 1.05,
        breakPerKg: canBreakAgain ? body.plugin.breakPerKg : 0,
        breakableFrom: this.time + 0.15, // let the pieces separate before they can break again
      };
      Body.setMass(piece, pieceMass);
      Body.setInertia(piece, piece.inertia / Body._inertiaScale);
      const k = (kick * PX_PER_M) / STEP_TO_SEC;
      Body.setVelocity(piece, { x: body.velocity.x + (out.x / len) * k, y: body.velocity.y + (out.y / len) * k });
      Body.setAngularVelocity(piece, body.angularVelocity + (Math.random() - 0.5) * 0.1);
    }
    Composite.remove(this.engine.world, body);
    Composite.add(this.engine.world, pieces);
    const p = toM(c.x, c.y);
    this.emit('break', { t: this.time, id: specId, material, energy, threshold, pieces: pieces.length, x: c.x, y: c.y, pos: p });
  }

  _onCollisions(pairs) {
    for (const pair of pairs) {
      const a = pair.bodyA.parent, b = pair.bodyB.parent;
      if (a.isStatic && b.isStatic) continue;
      // closing speed along the contact normal; sliding or rolling contact is not an impact
      const n = pair.collision.normal;
      const dvx = a.velocity.x - b.velocity.x;
      const dvy = a.velocity.y - b.velocity.y;
      const speed = (Math.abs(dvx * n.x + dvy * n.y) * STEP_TO_SEC) / PX_PER_M;
      const point = pair.collision.supports[0] || pair.contacts[0]?.vertex || a.position;
      // impact energy in the collision: ½·μ·v², with μ the reduced mass (a fixed surface counts as infinitely heavy)
      const reduced = a.isStatic ? b.mass : b.isStatic ? a.mass : (a.mass * b.mass) / (a.mass + b.mass);
      const energy = 0.5 * reduced * speed * speed;
      for (const body of [a, b]) {
        const perKg = body.plugin.breakPerKg;
        if (perKg && !body.isStatic && energy > perKg * body.mass && this.time >= (body.plugin.breakableFrom || 0)) {
          this._breakQueue.set(body.id, { body, energy, threshold: perKg * body.mass });
        }
      }
      this.emit('collision', {
        t: this.time,
        speed,
        withWall: !!(a.plugin.wall || b.plugin.wall || a.isStatic || b.isStatic),
        x: point.x,
        y: point.y,
        materials: [a, b].filter((x) => !x.isStatic).map((x) => x.plugin.material),
      });
    }
  }
}

export function fmt(n) {
  if (typeof n !== 'number') return String(n);
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return Number(n.toFixed(Math.abs(n) < 0.1 ? 3 : 2)).toString();
}

export function describe(s) {
  if (s.shape === 'plank') return `ramp ${fmt(s.length)} m at ${fmt(s.angle)}°`;
  return `${fmt(s.mass)} kg ${materialOf(s.material).name.toLowerCase()} ${s.shape}`;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// Keep only known world keys, within the slider ranges.
export function normalizeWorld(w) {
  const d = DEFAULT_WORLD;
  return {
    gravity: clamp(num(w.gravity, d.gravity), -1, 3),
    friction: clamp(num(w.friction, d.friction), 0, 1),
    bounciness: clamp(num(w.bounciness, d.bounciness), 0, 1),
    airDensity: clamp(num(w.airDensity, d.airDensity), 0, 10),
    timeScale: clamp(num(w.timeScale, d.timeScale), 0.1, 2),
  };
}

// Fill defaults and clamp to sane ranges; bad values from AI tool calls shouldn't break the world.
// Mass defaults to what the material and size imply; an explicit mass overrides it.
export function normalizeSpec(b, assignId = true) {
  const shape = ['ball', 'box', 'plank'].includes(b.shape) ? b.shape : 'ball';
  const material = MATERIALS[b.material] ? b.material : DEFAULT_MATERIAL;
  const size = clamp(num(b.size, shape === 'plank' ? 0.16 : 0.2), 0.05, 1.5);
  const s = {
    id: b.id || (assignId ? nextSpecId++ : 0),
    shape,
    material,
    x: clamp(num(b.x, WORLD_W / 2), 0.05, WORLD_W - 0.05),
    y: clamp(num(b.y, WORLD_H / 2), 0.02, WORLD_H - 0.05),
    size,
    mass: clamp(num(b.mass, massFor(shape, size, material)), 0.05, 5000),
    vx: clamp(num(b.vx, 0), -40, 40),
    vy: clamp(num(b.vy, 0), -40, 40),
    angle: clamp(num(b.angle, 0), -90, 90),
    static: shape === 'plank' ? b.static !== false : !!b.static,
  };
  s.mass = Math.round(s.mass * 100) / 100;
  if (shape === 'plank') {
    s.length = clamp(num(b.length, 4), 0.3, WORLD_W);
    if (b.name) s.name = String(b.name).slice(0, 12);
  } else {
    if (b.key) s.key = String(b.key);
    if (b.fixedRotation) s.fixedRotation = true; // e.g. a pulley block that should hang level
    if (b.friction != null) s.friction = clamp(num(b.friction, 0.5), 0, 2);
    if (b.bounce != null) s.bounce = clamp(num(b.bounce, 0.5), 0, 1);
    if (b.breakable) {
      s.breakable = true;
      // explicit threshold, or what the material's toughness implies for this mass
      s.breakEnergy = Math.round(clamp(num(b.breakEnergy, breakEnergyFor(material, s.mass)), 1, 1e7));
    }
    // keep loose objects fully inside the walls, floor and ceiling
    const r = shape === 'ball' ? size : size / 2;
    s.x = clamp(s.x, r + 0.01, WORLD_W - r - 0.01);
    s.y = clamp(s.y, r, WORLD_H - r - 0.01);
  }
  if (b.id && b.id >= nextSpecId) nextSpecId = b.id + 1;
  return s;
}

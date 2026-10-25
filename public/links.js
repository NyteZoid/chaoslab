// Connections between objects: springs (Hooke's law), rods (pendulums) and ropes over pulleys.
// Link specs use physics units and refer to bodies by spec id, or to fixed points {x, y} in metres:
//   { type: 'spring', a, b, k (N/m), rest (m), damping (N·s/m) }
//   { type: 'rod',    a, b, length (m, optional: taken from the starting positions) }
//   { type: 'rope',   points: [ref, ...], length (optional) }  ideal, massless, can go slack;
//                     intermediate fixed points are frictionless pulleys, a body in the middle is a movable pulley.
const { Body, Composite, Constraint } = Matter;

const PX = 100;          // px per metre (matches lab.js)
const STEP = 60;         // steps per second at the base time step
const ROPE_ITERATIONS = 4;

export class Linker {
  constructor(lab) {
    this.lab = lab;
    this.live = [];        // resolved links for the current run
    this.constraints = []; // Matter constraints we created (rods)
  }

  // Resolve link specs to live bodies after the scene is (re)spawned.
  build() {
    const world = this.lab.engine.world;
    for (const c of this.constraints) Composite.remove(world, c);
    this.constraints = [];
    const bodyOf = (id) => this.lab.allBodies().find((b) => b.plugin.specId === id && !b.plugin.fragment) || null;
    const end = (ref) => (ref && ref.body != null ? { body: bodyOf(ref.body) } : { fixed: { x: ref.x * PX, y: this.lab.toPxY(ref.y) } });

    this.live = [];
    for (const spec of this.lab.links) {
      if (spec.type === 'rope') {
        const points = spec.points.map(end);
        if (points.some((p) => p.body === null)) continue;
        const length = spec.length != null ? spec.length * PX : ropeLength(points);
        this.live.push({ spec, points, length });
        continue;
      }
      const a = end(spec.a), b = end(spec.b);
      if (a.body === null || b.body === null) continue;
      if (spec.type === 'rod') {
        const pa = pos(a), pb = pos(b);
        const c = Constraint.create({
          ...(a.body ? { bodyA: a.body } : { pointA: { ...a.fixed } }),
          ...(b.body ? { bodyB: b.body } : { pointB: { ...b.fixed } }),
          length: spec.length != null ? spec.length * PX : Math.hypot(pb.x - pa.x, pb.y - pa.y),
          stiffness: 1,
          damping: 0,
          render: { visible: false },
        });
        Composite.add(world, c);
        this.constraints.push(c);
        this.live.push({ spec, a, b, constraint: c });
      } else if (spec.type === 'spring') {
        this.live.push({ spec, a, b });
      }
    }
  }

  // Spring forces and rope velocity constraints, before Matter integrates the step.
  beforeStep() {
    const dt = this.lab.engine.timing.timeScale / STEP; // seconds
    for (const l of this.live) {
      if (l.spec.type === 'spring') applySpring(l, dt);
      else if (l.spec.type === 'rope') for (let i = 0; i < ROPE_ITERATIONS; i++) solveRopeVelocity(l);
    }
  }

  // Pull ropes back to length after integration so they never stretch.
  afterStep() {
    for (const l of this.live) if (l.spec.type === 'rope') for (let i = 0; i < ROPE_ITERATIONS; i++) solveRopePosition(l);
  }

  // Elastic energy stored in springs, J (counted as potential energy in telemetry).
  springEnergy() {
    let e = 0;
    for (const l of this.live) {
      if (l.spec.type !== 'spring') continue;
      const pa = pos(l.a), pb = pos(l.b);
      const x = Math.hypot(pb.x - pa.x, pb.y - pa.y) / PX - l.spec.rest;
      e += 0.5 * l.spec.k * x * x;
    }
    return e;
  }

  // Current tension in a rope or spring, N, for readouts.
  forceIn(index) {
    const l = this.live[index];
    if (!l) return null;
    if (l.spec.type === 'spring') {
      const pa = pos(l.a), pb = pos(l.b);
      return l.spec.k * (Math.hypot(pb.x - pa.x, pb.y - pa.y) / PX - l.spec.rest);
    }
    return null;
  }

  // Geometry for drawing.
  drawable() {
    return this.live.map((l) => (l.spec.type === 'rope'
      ? { type: 'rope', points: l.points.map(pos), pulleys: l.points.slice(1, -1).map((p) => ({ ...pos(p), movable: !!p.body })), slack: ropeLength(l.points) < l.length - 2 }
      : { type: l.spec.type, a: pos(l.a), b: pos(l.b), fixedA: !l.a.body, fixedB: !l.b.body, rest: l.spec.rest }));
  }
}

const pos = (end) => (end.body ? end.body.position : end.fixed);

function ropeLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i++) {
    const a = pos(points[i - 1]), b = pos(points[i]);
    L += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return L;
}

// d(length)/d(position) for every body on the rope: the sum of unit vectors pointing away from
// its neighbours. A movable pulley gets two contributions, which is where 2:1 advantage comes from.
function ropeGradients(points) {
  const grads = new Map();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p.body || p.body.isStatic) continue;
    const g = grads.get(p.body) || { x: 0, y: 0 };
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= points.length) continue;
      const a = pos(p), b = pos(points[j]);
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      g.x += (a.x - b.x) / d;
      g.y += (a.y - b.y) / d;
    }
    grads.set(p.body, g);
  }
  return grads;
}

// Inextensible but slack-able: only remove velocity that would lengthen a taut rope.
function solveRopeVelocity(l) {
  if (ropeLength(l.points) < l.length - 0.5) return;
  const grads = ropeGradients(l.points);
  let rate = 0, denom = 0;
  for (const [body, g] of grads) {
    rate += g.x * body.velocity.x + g.y * body.velocity.y;
    denom += (g.x * g.x + g.y * g.y) * body.inverseMass;
  }
  if (rate <= 0 || !denom) return;
  const lambda = rate / denom;
  for (const [body, g] of grads) {
    Body.setVelocity(body, { x: body.velocity.x - lambda * g.x * body.inverseMass, y: body.velocity.y - lambda * g.y * body.inverseMass });
  }
}

function solveRopePosition(l) {
  const excess = ropeLength(l.points) - l.length;
  if (excess <= 0) return;
  const grads = ropeGradients(l.points);
  let denom = 0;
  for (const [body, g] of grads) denom += (g.x * g.x + g.y * g.y) * body.inverseMass;
  if (!denom) return;
  const lambda = excess / denom;
  for (const [body, g] of grads) {
    // move without adding velocity (setPosition shifts the previous position along with it)
    const dx = -lambda * g.x * body.inverseMass, dy = -lambda * g.y * body.inverseMass;
    Body.setPosition(body, { x: body.position.x + dx, y: body.position.y + dy }, false);
  }
}

// Hooke's law plus linear damping along the spring, applied as a velocity change (symplectic Euler).
function applySpring(l, dt) {
  const { k, rest, damping = 0 } = l.spec;
  const pa = pos(l.a), pb = pos(l.b);
  const dx = (pb.x - pa.x) / PX, dy = -(pb.y - pa.y) / PX; // metres, y up
  const d = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / d, uy = dy / d;
  const va = l.a.body ? vel(l.a.body) : { x: 0, y: 0 };
  const vb = l.b.body ? vel(l.b.body) : { x: 0, y: 0 };
  const closing = (vb.x - va.x) * ux + (vb.y - va.y) * uy;
  const F = -k * (d - rest) - damping * closing; // N, positive pushes b away from a
  for (const [end, sign] of [[l.b, 1], [l.a, -1]]) {
    if (!end.body || end.body.isStatic) continue;
    const dv = (sign * F * dt) / end.body.mass; // m/s
    const v = vel(end.body);
    setVel(end.body, { x: v.x + dv * ux, y: v.y + dv * uy });
  }
}

const vel = (b) => ({ x: (b.velocity.x * STEP) / PX, y: (-b.velocity.y * STEP) / PX });
const setVel = (b, v) => Body.setVelocity(b, { x: (v.x * PX) / STEP, y: (-v.y * PX) / STEP });

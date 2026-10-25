// Turns Gemma's descriptive scene plan ("3 wooden boxes stacked at the bottom of ramp A")
// into exact positions. Language models are good at intent and bad at coordinate maths,
// so all geometry lives here.
import { WORLD_W, WORLD_H } from './lab.js';

const SIDES = { left: 2.5, 'center-left': 4.25, center: 6, 'center-right': 7.75, right: 9.5 };
const PLANK_T = 0.16;
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ---------- ramps ----------

// A ramp is described by where its high end is and which way it slopes.
export function layoutRamp(r) {
  const length = clamp(num(r.length, 4), 1, 10);
  const slope = clamp(Math.abs(num(r.angle, 25)), 3, 70);
  const downRight = r.direction !== 'down_left';
  const topHeight = clamp(num(r.top_height, 3), 0.4, WORLD_H - 0.4);
  const dx = (length / 2) * Math.cos(slope * DEG);
  const dy = (length / 2) * Math.sin(slope * DEG);
  let cx = r.x != null ? num(r.x, 6) : SIDES[r.side] ?? 6;
  cx = clamp(cx, dx + 0.2, WORLD_W - dx - 0.2);
  const cy = Math.max(topHeight - dy, dy + 0.05); // keep the low end above the floor
  return {
    shape: 'plank',
    name: r.name || r.id,
    x: round(cx),
    y: round(cy),
    length,
    size: PLANK_T,
    angle: downRight ? -slope : slope, // negative falls to the right
  };
}

// Geometry helpers for a plank spec.
function rampFrame(p) {
  const a = (-p.angle) * DEG;                   // angle below horizontal when falling right
  const dir = { x: Math.cos(a), y: -Math.sin(a) }; // along the plank, left to right
  const ends = [
    { x: p.x - dir.x * p.length / 2, y: p.y - dir.y * p.length / 2 },
    { x: p.x + dir.x * p.length / 2, y: p.y + dir.y * p.length / 2 },
  ];
  const [high, low] = ends[0].y >= ends[1].y ? ends : [ends[1], ends[0]];
  const down = norm({ x: low.x - high.x, y: low.y - high.y });
  let normal = { x: -down.y, y: down.x };
  if (normal.y < 0) normal = { x: -normal.x, y: -normal.y }; // point up, away from the surface
  return { high, low, down, normal };
}

// ---------- structures ----------
// Multi-part builds whose pieces must line up exactly. Each returns plank specs (fixed pieces);
// ramps get names so groups can be placed on them (e.g. "path1" is the top ramp of "path").

const plank = (x1, y1, x2, y2, extra = {}) => {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI; // positive rises to the right
  return { shape: 'plank', x: round((x1 + x2) / 2), y: round((y1 + y2) / 2), length: round(length), size: PLANK_T, angle: round(clampAngle(angle)), ...extra };
};
const clampAngle = (a) => (a > 90 ? a - 180 : a < -90 ? a + 180 : a);

function zoneSpan(s, width) {
  const cx = s.x != null ? num(s.x, 6) : SIDES[s.side] ?? 6;
  const half = Math.min(width, WORLD_W - 1.4) / 2;
  const c = clamp(cx, half + 0.7, WORLD_W - half - 0.7);
  return [c - half, c + half];
}

// Zigzag marble run: ramps alternate direction, each one catching the ball from the one above.
// A short bumper wall at every turn stops the ball overshooting and drops it onto the next ramp.
function rampPath(s) {
  const name = s.name || 'path';
  const levels = clamp(Math.round(num(s.levels, 4)), 2, 7);
  const top = clamp(num(s.top_height, 5.8), 1.5, WORLD_H - 0.5);
  const ball = clamp(num(s.ball_size, 0.15), 0.08, 0.3);
  const gap = 2 * ball + 0.22;  // vertical gap between a ramp's low end and the next: room for the ball to drop through
  const reach = 0.5;            // how far each lower ramp extends past the end of the one above
  const drop = Math.max(0.15, (top - 0.35 - (levels - 1) * gap) / levels);
  // keep the slope steep enough to roll briskly: narrow the path rather than flatten the ramps
  const slope = clamp(num(s.angle, 15), 5, 45);
  const span = clamp(drop / Math.tan(slope * DEG), 1.6, Math.min(num(s.width, 10), 10));
  const [x0, x1] = zoneSpan(s, span);
  const startRight = s.first_direction !== 'down_left';
  // Variety: a seed shapes each maze (a new one every build unless a seed is given).
  // complexity 1 = uneven ramp lengths, 2 = also holes the ball drops through, 3 = more of both.
  const complexity = clamp(Math.round(num(s.complexity, 1)), 1, 3);
  let seed = Math.round(num(s.seed, Math.random() * 1e6)) || 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const jitter = span * (0.12 + 0.12 * complexity);
  const holeChance = complexity === 1 ? 0 : complexity === 2 ? 0.35 : 0.6;
  const pieces = [];
  let entry = null; // x where the ball arrives from the level above
  for (let i = 0; i < levels; i++) {
    const right = (i % 2 === 0) === startRight;
    const hi = top - i * (drop + gap);
    const lo = hi - drop;
    // the end the ball arrives at reaches past the previous exit; the far end varies with the seed
    const start = entry === null ? (right ? x0 : x1) : entry + (right ? -reach : reach);
    const exit = right ? x1 - rnd() * jitter : x0 + rnd() * jitter;
    const [ax, ay, bx, by] = right ? [start, hi, exit, lo] : [exit, lo, start, hi];
    const label = { name: `${name}${i + 1}` };
    if (i > 0 && i < levels - 1 && rnd() < holeChance && Math.abs(bx - ax) > 1.6) {
      // a hole: the ball drops through it onto the ramp below, skipping the rest of this one
      const f = 0.35 + rnd() * 0.3, w = 0.45 / Math.abs(bx - ax);
      const mx = (t) => ax + (bx - ax) * t, my = (t) => ay + (by - ay) * t;
      pieces.push(plank(ax, ay, mx(f - w / 2), my(f - w / 2), right ? label : {}));
      pieces.push(plank(mx(f + w / 2), my(f + w / 2), bx, by, right ? {} : label));
    } else {
      pieces.push(plank(ax, ay, bx, by, label));
    }
    if (i < levels - 1) {
      // bumper on the outside of the turn, from just above the next ramp to above this ramp's low end
      const wx = right ? exit + reach + 0.2 : exit - reach - 0.2;
      pieces.push(plank(wx, lo - gap - 0.05, wx, lo + 0.7));
    }
    entry = exit;
  }
  pieces[0].name ||= `${name}1`;
  return pieces;
}

// Stairs: flat steps going down, each starting where the last one ends.
function staircase(s) {
  const steps = clamp(Math.round(num(s.steps, 5)), 2, 10);
  const top = clamp(num(s.top_height, 3), 0.6, WORLD_H - 0.6);
  const rise = top / steps;
  const [x0, x1] = zoneSpan(s, clamp(num(s.width, 6), 2, 10));
  const run = (x1 - x0) / steps;
  const right = s.direction !== 'down_left';
  const pieces = [];
  for (let i = 0; i < steps; i++) {
    const y = top - i * rise;
    const a = right ? x0 + i * run : x1 - (i + 1) * run;
    pieces.push(plank(a, y, a + run, y, i === 0 ? { name: `${s.name || 'stairs'}1` } : {}));
  }
  return pieces;
}

function wall(s) {
  const x = clamp(s.x != null ? num(s.x, 6) : SIDES[s.side] ?? 6, 0.3, WORLD_W - 0.3);
  const h = clamp(num(s.height, 1.5), 0.3, WORLD_H - 0.2);
  const base = clamp(num(s.base_height, 0), 0, WORLD_H - h);
  return [plank(x, base, x, base + h)];
}

// Open-topped box that catches objects.
function cup(s) {
  const w = clamp(num(s.width, 1.6), 0.6, 4);
  const h = clamp(num(s.height, 0.8), 0.3, 2);
  const [x0, x1] = zoneSpan(s, w);
  const base = clamp(num(s.base_height, 0), 0, WORLD_H - h);
  return [plank(x0, base + 0.08, x1, base + 0.08), plank(x0, base, x0, base + h), plank(x1, base, x1, base + h)];
}

// V-shaped funnel with an opening at the bottom.
function funnel(s) {
  const w = clamp(num(s.width, 3), 1.2, 8);
  const opening = clamp(num(s.opening, 0.6), 0.3, w - 0.4);
  const y = clamp(num(s.height, 3), 0.8, WORLD_H - 0.8);
  const [x0, x1] = zoneSpan(s, w);
  const c = (x0 + x1) / 2;
  const depth = clamp(num(s.depth, 1), 0.3, 2.5);
  return [plank(x0, y + depth, c - opening / 2, y), plank(c + opening / 2, y, x1, y + depth)];
}

const STRUCTURES = { ramp_path: rampPath, staircase, wall, cup, funnel };

export function layoutStructure(s) {
  const build = STRUCTURES[s.type];
  return build ? build(s) : [];
}

// ---------- object groups ----------

function extent(g) { return g.shape === 'ball' ? g.size : g.size / 2; }

// direction: "left" | "right" | "up" | "down" | degrees (0 = right, 90 = up)
export function launchVelocity(speed, direction) {
  speed = num(speed, 0);
  if (speed < 0 && direction == null) { speed = -speed; direction = 'left'; } // "-5 m/s" means leftward
  speed = Math.abs(speed) > 100 ? 5 : clamp(Math.abs(speed), 0, 30); // absurd values are garbage, not a request for 30 m/s
  if (!speed) return { vx: 0, vy: 0 };
  const named = { right: 0, left: 180, up: 90, down: -90 };
  const key = String(direction ?? 'right').trim().toLowerCase();
  const deg = key in named ? named[key] : num(parseFloat(key), 0);
  return { vx: round(speed * Math.cos(deg * DEG)), vy: round(speed * Math.sin(deg * DEG)) };
}

const velocity = (g) => launchVelocity(g.speed, g.direction ?? g.angle);

// Positions for `count` objects in an arrangement, relative to (0, 0) = bottom centre of the group.
function arrange(g) {
  const n = clamp(Math.round(num(g.count, 1)), 1, 40);
  const d = g.shape === 'ball' ? g.size * 2 : g.size;
  const gap = g.arrangement === 'touching_row' ? 0.002 : clamp(num(g.gap, 0.25), 0.002, 3);
  const e = extent(g);
  const pts = [];
  switch (g.arrangement) {
    case 'stack':
      for (let i = 0; i < n; i++) pts.push({ x: 0, y: e + i * (d + 0.004) });
      break;
    case 'pyramid': {
      let rows = 1;
      while ((rows * (rows + 1)) / 2 < n) rows++;
      let placed = 0;
      for (let row = 0; row < rows && placed < n; row++) {
        const inRow = rows - row;
        for (let i = 0; i < inRow && placed < n; i++, placed++) {
          pts.push({ x: (i - (inRow - 1) / 2) * (d + 0.004), y: e + row * (d + 0.004) });
        }
      }
      break;
    }
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(n));
      for (let i = 0; i < n; i++) {
        const c = i % cols, r = Math.floor(i / cols);
        pts.push({ x: (c - (cols - 1) / 2) * (d + gap), y: e + r * (d + gap) });
      }
      break;
    }
    case 'scattered': {
      let seed = 17 + n;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < n; i++) pts.push({ x: (rnd() - 0.5) * Math.min(8, n * (d + 0.4)), y: e + rnd() * 2 });
      break;
    }
    default: // single, row, touching_row
      for (let i = 0; i < n; i++) pts.push({ x: (i - (n - 1) / 2) * (d + gap), y: e });
  }
  return pts;
}

// Resolve one group into body specs. ramps: name -> plank spec.
export function layoutGroup(raw, ramps) {
  const g = {
    shape: raw.shape === 'box' ? 'box' : 'ball',
    material: raw.material,
    size: clamp(num(raw.size, 0.2), 0.08, 0.6),
    count: raw.count,
    arrangement: raw.arrangement || (num(raw.count, 1) > 1 ? 'row' : 'single'),
    gap: raw.gap,
    speed: raw.speed,
    direction: raw.direction,
    angle: raw.angle,
  };
  const place = raw.place || 'floor';
  if (num(g.speed, 0) < 0 && g.direction == null) { g.speed = -g.speed; g.direction = 'left'; }
  if (num(g.speed, 0) > 0 && g.direction == null && g.angle == null && !place.includes('ramp')) {
    // launched with no direction given: send it toward the middle of the lab
    g.direction = (raw.x != null ? num(raw.x, 6) : SIDES[raw.side] ?? 6) <= 6 ? 'right' : 'left';
  }
  const pts = arrange(g);
  const e = extent(g);
  const { vx, vy } = velocity(g);
  const ramp = ramps[raw.ramp] || Object.values(ramps)[0];
  const halfWidth = Math.max(...pts.map((p) => Math.abs(p.x))) + e;

  let toWorld;
  if ((place === 'top_of_ramp' || place === 'on_ramp') && ramp) {
    // On the ramp surface: rows run along the slope, stacks rise off it.
    const f = rampFrame(ramp);
    const inset = place === 'top_of_ramp'
      ? Math.min(0.3 + halfWidth, ramp.length * 0.45)
      : clamp(num(raw.position_along, 0.5), 0.05, 0.95) * ramp.length;
    const lift = PLANK_T / 2 + 0.01;
    const base = { x: f.high.x + f.down.x * inset + f.normal.x * lift, y: f.high.y + f.down.y * inset + f.normal.y * lift };
    toWorld = (p) => ({ x: base.x + f.down.x * p.x + f.normal.x * p.y, y: base.y + f.down.y * p.x + f.normal.y * p.y });
  } else {
    let x, height = 0;
    if (place === 'bottom_of_ramp' && ramp) {
      // on the floor just past the low end, where things rolling off the ramp will arrive
      const f = rampFrame(ramp);
      const sign = Math.sign(f.down.x) || 1;
      x = f.low.x + sign * (num(raw.distance, 0.8) + halfWidth);
    } else {
      x = raw.x != null ? num(raw.x, 6) : SIDES[raw.side] ?? 6;
      if (place === 'air') height = clamp(num(raw.height, 3), 0, WORLD_H - 0.5);
    }
    x = clamp(x, halfWidth + 0.05, WORLD_W - halfWidth - 0.05);
    toWorld = (p) => ({ x: x + p.x, y: height + p.y });
  }

  return pts.map((p) => {
    const { x, y } = toWorld(p);
    return {
      shape: g.shape,
      material: raw.material,
      size: g.size,
      ...(raw.mass != null ? { mass: num(raw.mass, undefined) } : {}),
      ...(raw.breakable != null ? { breakable: !!raw.breakable } : {}),
      x: round(x),
      y: round(y),
      vx,
      vy,
    };
  });
}

// Whole plan -> scene spec. prompt is the user's own words, used to fill details the plan left out.
export function layoutPlan(plan, existingRamps = {}, prompt = '') {
  plan = applyPromptHints(plan, prompt);
  const ramps = { ...existingRamps };
  const rampSpecs = [];
  const usedNames = new Set(Object.keys(ramps));
  for (const [i, r] of (plan.ramps || []).slice(0, 8).entries()) {
    const spec = layoutRamp({ ...r, name: r.name || String.fromCharCode(65 + i) });
    if (usedNames.has(spec.name)) continue; // the model sometimes repeats a ramp
    usedNames.add(spec.name);
    ramps[spec.name] = spec;
    rampSpecs.push(spec);
  }
  const extraGroups = [];
  for (const s of (plan.structures || []).slice(0, 4)) {
    const pieces = layoutStructure(s);
    for (const spec of pieces) {
      if (spec.name) ramps[spec.name] = spec;
      rampSpecs.push(spec);
    }
    // a ramp path or staircase can come with its own ball, placed at the top
    if (s.ball_material && pieces[0]?.name) {
      const ball = { shape: 'ball', material: s.ball_material, size: s.ball_size ?? 0.15, place: 'top_of_ramp', ramp: pieces[0].name };
      // stairs are flat, so the ball needs a nudge toward the way down
      if (s.type === 'staircase') Object.assign(ball, { speed: 1.5, direction: s.direction === 'down_left' ? 'left' : 'right' });
      extraGroups.push(ball);
    }
  }
  // The model often also adds the same ball as a separate group on the path; keep just one.
  const structureRamps = new Set(extraGroups.map((g) => g.ramp));
  const others = (plan.groups || []).filter((g) => !(extraGroups.length && g.shape !== 'box'
    && String(g.place || '').includes('ramp') && (!g.ramp || structureRamps.has(g.ramp) || !ramps[g.ramp])
    && num(g.count, 1) <= 1));
  plan = { ...plan, groups: [...extraGroups, ...others] };
  const bodies = [...rampSpecs];
  for (const g of tidyGroups(plan.groups || [])) bodies.push(...layoutGroup(g, ramps));
  return { world: plan.world, bodies: bodies.slice(0, 60), ramps };
}

// The model sometimes drops details the user stated plainly. Recover the common ones from the text.
function applyPromptHints(plan, prompt) {
  const text = String(prompt).toLowerCase();
  const angle = text.match(/(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees?)\b/);
  const height = text.match(/(?:from|at|height of)\s*(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)\b/);
  const wantsBreaking = /shatter|break|smash|fragile|crack|crush/.test(text);
  // "a 32 degree ramp": make sure ramps and paths use the stated angle
  const mentionsRamp = /ramp|slope|incline|path|track/.test(text);
  const ramps = (plan.ramps || []).map((r) => (mentionsRamp && angle && r.angle == null ? { ...r, angle: Math.abs(Number(angle[1])) } : r));
  const structures = (plan.structures || []).map((s) => (mentionsRamp && angle && s.type === 'ramp_path' && s.angle == null ? { ...s, angle: Math.abs(Number(angle[1])) } : s));
  const groups = (plan.groups || []).map((g) => {
    const out = { ...g };
    const moving = num(out.speed, 0) > 0;
    if (moving && out.direction == null && out.angle == null && angle && !/ramp/.test(text)) out.direction = angle[1];
    if (out.place === 'air' && out.height == null && height) out.height = Number(height[1]);
    if (wantsBreaking && out.breakable == null && !moving) out.breakable = true;
    return out;
  });
  const world = { ...(plan.world || {}) };
  if (Number(world.gravity) > 3) world.gravity = Number(world.gravity) / 9.81; // given in m/s² instead of multiples of g
  return { ...plan, world, ramps, structures, groups };
}

// Safety nets for sloppy plans: drop exact duplicate groups, and give every free-standing group
// a side of its own (movers start on the side they move away from) so groups don't pile up in the middle.
function tidyGroups(groups) {
  // Groups describing the same objects in the same spot (often repeated with small variations)
  // collapse into one, preferring the most specific description.
  const what = (g) => [g.shape, g.material, g.place || 'floor', g.ramp || ''].join('|');
  const specificity = (g) => (g.arrangement ? 2 : 0) + (g.count ? 1 : 0) + (g.direction != null ? 1 : 0);
  const best = new Map();
  for (const g of groups.slice(0, 12)) {
    const key = `${what(g)}|${g.side || ''}`;
    if (!best.has(key) || specificity(g) > specificity(best.get(key))) best.set(key, g);
  }
  // a group with no side duplicates any sided group of the same kind
  const sided = new Set([...best.values()].filter((g) => g.side).map(what));
  const unique = [...best.values()].filter((g) => g.side || !sided.has(what(g)));
  const free = unique.filter((g) => !String(g.place || 'floor').includes('ramp') && g.x == null);
  const used = new Set(free.filter((g) => SIDES[g.side] != null).map((g) => g.side));
  const take = (prefs) => {
    const side = prefs.find((s) => !used.has(s)) || prefs[0];
    used.add(side);
    return side;
  };
  return unique.map((g) => {
    if (!free.includes(g) || SIDES[g.side] != null) return g;
    const { vx } = launchVelocity(g.speed, g.direction ?? g.angle);
    const side = vx > 0.1 ? take(['left', 'center-left'])
      : vx < -0.1 ? take(['right', 'center-right'])
      : take(['center', 'center-left', 'center-right', 'left', 'right']);
    return { ...g, side };
  });
}

function norm(v) { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; }
function round(n) { return Math.round(n * 1000) / 1000; }

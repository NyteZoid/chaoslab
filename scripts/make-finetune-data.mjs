// Generates synthetic fine-tuning data for Gemma: a JEE-style sentence -> the build_scene call that
// loads the right apparatus, plus the textbook answer from apparatus.js. Every example is labelled
// by construction, so the set can be as large as needed.
//
//   node scripts/make-finetune-data.mjs [count] > data/finetune.jsonl
//
// Each line: {"prompt": "...", "call": {"name": "build_scene", "args": {...}}, "answer": [[label, value], ...]}
import fs from 'fs';

// public/ is browser code (ES modules) but package.json has no "type": "module", so load it as one
const source = fs.readFileSync(new URL('../public/apparatus.js', import.meta.url), 'utf8');
const { APPARATUS, buildApparatus } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const N = Number(process.argv[2] || 2000);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
// a "nice" textbook number inside the parameter's range
function nice(key, lo, hi) {
  const q = APPARATUS_RANGES[key] || [lo, hi];
  const steps = [1, 0.5, 0.1, 0.05].filter((s) => (q[1] - q[0]) / s >= 4);
  const s = steps[0] || 0.01;
  const v = q[0] + Math.round((Math.random() * (q[1] - q[0])) / s) * s;
  return Math.round(v * 1000) / 1000;
}
// ranges typical of textbook problems (narrower than the sliders)
const APPARATUS_RANGES = { mass: [0.5, 20], m1: [1, 20], m2: [1, 20], m3: [1, 20], k: [10, 500], mu: [0.1, 0.6], angle: [15, 60], length: [0.5, 3], load: [4, 60], effort: [2, 30], force: [5, 100], speed: [2, 25], height: [0, 30], u1: [1, 10], u2: [-8, 0], e: [0, 1], stretch: [0.02, 0.2], pulleys: [2, 6] };
const kg = (m) => (m < 1 && Math.random() < 0.6 ? `${Math.round(m * 1000)} g` : `${m} kg`);
const smooth = (mu) => (mu ? pick([`a rough surface (coefficient of friction ${mu})`, `a floor with mu = ${mu}`]) : pick(['a smooth floor', 'a frictionless surface']));

// sentence templates per apparatus: values -> text
const TEMPLATES = {
  spring_mass: (v) => (v.orientation
    ? `A ${kg(v.mass)} mass hangs from a vertical spring of stiffness ${v.k} N/m and is pulled down ${Math.round(v.stretch * 100)} cm and released.`
    : `A block of mass ${kg(v.mass)} attached to a spring of force constant ${v.k} N/m oscillates on a smooth horizontal surface. Find its time period.`),
  pendulum: (v) => (v.double ? `Show a double pendulum with arms of ${v.length} m released at ${v.angle} degrees.`
    : pick([`A simple pendulum of length ${v.length} m is released from ${v.angle} degrees. Find its time period.`, `A bob of mass ${kg(v.mass)} hangs from a ${v.length} m string and is pulled aside by ${v.angle} degrees and released.`])),
  atwood: (v) => pick([`Two masses ${v.m1} kg and ${v.m2} kg are connected by a light string over a smooth pulley. Find the acceleration and tension.`, `An Atwood machine with masses ${v.m1} kg and ${v.m2} kg.`]),
  force_block: (v) => (v.angle ? `A ${v.mass} kg block on ${smooth(v.mu)} is pulled by ${v.force} N at ${v.angle} degrees above the horizontal. Find the acceleration.`
    : `A ${v.mass} kg crate on ${smooth(v.mu)} is pushed with a horizontal force of ${v.force} N. Find the acceleration.`),
  contact_blocks: (v) => `Two blocks of ${v.m1} kg and ${v.m2} kg are in contact on ${smooth(v.mu)}. A ${v.force} N force pushes the ${v.m1} kg block. Find the contact force.`,
  table_pulley: (v) => `A ${v.m1} kg block on ${v.mu ? `a rough table (coefficient of friction ${v.mu})` : 'a smooth table'} is tied by a string over a pulley at the edge to a hanging ${v.m2} kg block.`,
  two_pulley_table: (v) => `Three blocks: ${v.m1} kg hangs on the left, ${v.m2} kg is on a table${v.mu ? ` with friction ${v.mu}` : ''}, ${v.m3} kg hangs on the right, connected over two pulleys at the table edges.`,
  incline_pulley: (v) => `A ${v.m1} kg box is on a ${v.angle} degree ${v.mu ? `ramp with mu = ${v.mu}` : 'frictionless ramp'} connected by a rope over a pulley at the top to a hanging ${v.m2} kg weight.`,
  movable_pulley: (v) => `A ${v.load} kg load hangs from a movable pulley and is lifted by a ${v.effort} kg mass on the other side over a fixed pulley.`,
  pulley_system: (v) => `A block and tackle with ${v.pulleys} pulleys lifts a ${v.load} kg load using a ${v.effort} kg effort mass.`,
  collision_1d: (v) => `A ${v.m1} kg block moving at ${v.u1} m/s collides head-on with a ${v.m2} kg block moving at ${v.u2} m/s. The coefficient of restitution is ${v.e}.`,
  projectile: (v) => (v.height ? `A ball is thrown at ${v.speed} m/s at ${v.angle} degrees from the top of a ${v.height} m building.` : `A projectile is launched at ${v.speed} m/s at ${v.angle} degrees to the horizontal. Find its range.`),
  incline_block: (v) => `A ${v.mass} kg block is placed on a ${v.angle} degree incline with coefficient of friction ${v.mu}.`,
};
// which keys each template states (the rest keep the apparatus defaults)
const STATED = {
  spring_mass: (v) => (v.orientation ? ['mass', 'k', 'orientation', 'stretch'] : ['mass', 'k', 'orientation']),
  pendulum: (v) => (v.double ? ['length', 'angle', 'double'] : ['length', 'angle', 'mass']),
  atwood: () => ['m1', 'm2'], force_block: (v) => ['mass', 'force', 'mu', ...(v.angle ? ['angle'] : [])],
  contact_blocks: () => ['m1', 'm2', 'force', 'mu'], table_pulley: () => ['m1', 'm2', 'mu'], two_pulley_table: () => ['m1', 'm2', 'm3', 'mu'],
  incline_pulley: () => ['m1', 'm2', 'angle', 'mu'], movable_pulley: () => ['load', 'effort'], pulley_system: () => ['pulleys', 'load', 'effort'],
  collision_1d: () => ['m1', 'm2', 'u1', 'u2', 'e'], projectile: (v) => ['speed', 'angle', ...(v.height ? ['height'] : [])], incline_block: () => ['mass', 'angle', 'mu'],
};

const types = Object.keys(TEMPLATES).filter((t) => APPARATUS[t]);
for (let i = 0; i < N; i++) {
  const type = types[i % types.length];
  const v = {};
  for (const q of APPARATUS[type].params) v[q.key] = q.value;
  for (const q of APPARATUS[type].params) {
    if (['orientation', 'double'].includes(q.key)) v[q.key] = Math.random() < 0.5 ? 1 : 0;
    else if (q.key === 'pulleys') v[q.key] = 2 + Math.floor(Math.random() * 5);
    else if (q.key === 'mu') v[q.key] = Math.random() < 0.4 ? 0 : nice('mu');
    else if (q.key === 'angle' && type === 'force_block') v[q.key] = Math.random() < 0.5 ? 0 : nice('angle');
    else if (q.key === 'height' && type === 'projectile') v[q.key] = Math.random() < 0.5 ? 0 : nice('height');
    else if (q.key === 'speed' && type === 'force_block') v[q.key] = 0;
    else if (APPARATUS_RANGES[q.key]) v[q.key] = Math.min(q.max, Math.max(q.min, nice(q.key)));
  }
  if (type === 'pendulum' && v.double) v.angle = Math.min(v.angle, 90);
  const values = Object.fromEntries(STATED[type](v).map((k) => [k === 'force' ? 'effort' : k, v[k]])); // the schema carries force as effort
  const built = buildApparatus(type, v, { gravity: 1 });
  console.log(JSON.stringify({ prompt: TEMPLATES[type](v), call: { name: 'build_scene', args: { checklist: [`${APPARATUS[type].name} apparatus`], apparatus: { type, values } } }, answer: built.theory }));
}

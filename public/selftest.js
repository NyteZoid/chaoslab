// Self-test: random textbook problems for every apparatus, simulation vs formula.
// Run from the browser console: (await import('/selftest.js')).run(200)
import { APPARATUS } from './apparatus.js';

const rnd = (lo, hi, step = 0.1) => Math.round((lo + Math.random() * (hi - lo)) / step) * step;
const num = (s) => { const m = String(s).match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

// Realistic JEE-style parameter ranges per apparatus.
const GEN = {
  spring_mass: () => ({ orientation: Math.random() < 0.5 ? 1 : 0, k: rnd(20, 800, 5), mass: rnd(0.2, 5), stretch: rnd(0.05, 0.4, 0.05), damping: 0, mu: 0 }),
  pendulum: () => ({ length: rnd(0.5, 4, 0.05), mass: rnd(0.1, 5), angle: rnd(3, 25, 1), double: 0 }),
  atwood: () => ({ m1: rnd(0.5, 20), m2: rnd(0.5, 20) }),
  table_pulley: () => ({ m1: rnd(0.5, 20), m2: rnd(0.5, 20), mu: rnd(0, 0.6, 0.05) }),
  two_pulley_table: () => ({ m1: rnd(0.5, 10), m2: rnd(0.5, 10), m3: rnd(0.5, 10), mu: rnd(0, 0.5, 0.05) }),
  incline_pulley: () => ({ angle: rnd(15, 60, 1), m1: rnd(0.5, 15), m2: rnd(0.5, 15), mu: rnd(0, 0.5, 0.05) }),
  movable_pulley: () => ({ load: rnd(1, 20), effort: rnd(0.5, 15) }),
  pulley_system: () => ({ pulleys: Math.round(rnd(2, 6, 1)), load: rnd(2, 40), effort: rnd(0.5, 15) }),
  collision_1d: () => ({ m1: rnd(0.5, 10), m2: rnd(0.5, 10), u1: rnd(1, 8), u2: rnd(-6, 0), e: rnd(0, 1, 0.05) }),
  projectile: () => ({ speed: rnd(3, 10), angle: rnd(10, 80, 1), height: rnd(0, 3) }),
  incline_block: () => ({ angle: rnd(10, 60, 1), mu: rnd(0, 0.6, 0.05), mass: rnd(0.5, 10) }),
};

// Which theory row and which measured number to compare.
const CHECK = {
  spring_mass: { row: 0, read: (m) => num(m) },
  pendulum: { row: 1, read: (m) => num(m) },
  atwood: { row: 0, read: (m) => num(m) },
  table_pulley: { row: 1, read: (m) => num(m) },
  two_pulley_table: { row: 1, read: (m) => num(m) },
  incline_pulley: { row: 1, read: (m) => num(m) },
  movable_pulley: { row: 1, read: (m) => num(m) },
  pulley_system: { row: 2, read: (m) => num(m) },
  incline_block: { row: 1, read: (m) => num(m) },
  projectile: { row: 1, read: (m) => num(m), theory: (t) => num(String(t).split('x = ')[1]) },
  collision_1d: { both: true },
};

export async function run(n = 200, { types = Object.keys(GEN) } = {}) {
  const { lab, apparatus } = window.ChaosLab;
  const results = [];
  lab.setPaused(true);
  for (let i = 0; i < n; i++) {
    const type = types[i % types.length];
    const values = GEN[type]();
    apparatus.setType(type, values);
    const built = apparatus.load();
    lab.setPaused(true);
    let steps = 0;
    while (!apparatus.measure?.done && steps < 60 * 12) { Matter.Engine.update(lab.engine, 1000 / 60); steps++; }
    const measured = apparatus.measure?.result || '';
    const c = CHECK[type];
    let ok, expected, got;
    if (c.both) {
      const [v1, v2] = [num(built.theory[0][1]), num(built.theory[1][1])];
      const m = measured.match(/v₁ = (-?[\d.]+).*v₂ = (-?[\d.]+)/);
      got = m ? [Number(m[1]), Number(m[2])] : null;
      expected = [v1, v2];
      ok = !!got && Math.abs(got[0] - v1) <= 0.15 + 0.05 * Math.abs(v1) && Math.abs(got[1] - v2) <= 0.15 + 0.05 * Math.abs(v2);
    } else {
      expected = c.theory ? c.theory(built.theory[c.row][1]) : num(built.theory[c.row][1]);
      got = measured ? c.read(measured) : null;
      ok = got != null && Math.abs(got - expected) <= 0.08 + 0.08 * Math.abs(expected);
    }
    results.push({ type, values, expected, got, measured, ok });
    if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  lab.setPaused(false);
  const byType = {};
  for (const r of results) {
    byType[r.type] ||= { pass: 0, total: 0, fails: [] };
    byType[r.type].total++;
    if (r.ok) byType[r.type].pass++; else byType[r.type].fails.push(r);
  }
  return { passed: results.filter((r) => r.ok).length, total: results.length, byType };
}

// Class 11 mechanics apparatus. Each one has adjustable parameters, builds a scene (bodies + links)
// and states the textbook prediction so students can compare it with what the simulation measures.
// Units: metres, kilograms, seconds, degrees; y is height above the floor. g is 9.81 m/s² × gravity.
const G = 9.81;
const DEG = Math.PI / 180;
const r2 = (n) => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const BOX = 0.3; // side of the blocks used as masses (m)

const p = (key, label, min, max, step, unit, value) => ({ key, label, min, max, step, unit, value });

export const APPARATUS = {
  spring_mass: {
    name: 'Spring–block oscillator',
    params: [
      p('orientation', 'Vertical (1) or horizontal (0)', 0, 1, 1, '', 1),
      p('k', 'Spring stiffness k', 5, 2000, 5, 'N/m', 50),
      p('mass', 'Block mass m', 0.1, 20, 0.1, 'kg', 2),
      p('rest', 'Natural length', 0.4, 3, 0.05, 'm', 1.2),
      p('stretch', 'Initial pull from equilibrium', -1, 1, 0.05, 'm', 0.4),
      p('damping', 'Damping c', 0, 20, 0.1, 'N·s/m', 0),
      p('mu', 'Floor friction μ (horizontal)', 0, 1, 0.01, '', 0),
    ],
    build(v, g) {
      const k = v.k, m = v.mass;
      const theory = [['Period T = 2π√(m/k)', `${r2(2 * Math.PI * Math.sqrt(m / k))} s`], ['Angular frequency ω = √(k/m)', `${r2(Math.sqrt(k / m))} rad/s`], ['Max speed = Aω', `${r2(Math.abs(v.stretch) * Math.sqrt(k / m))} m/s`]];
      if (v.orientation >= 0.5) {
        const sag = (m * G * g) / k; // static extension at equilibrium
        const top = 6.1;
        const y = clamp(top - v.rest - sag - v.stretch, BOX / 2 + 0.05, top - 0.3);
        theory.push(['Static extension mg/k', `${r2(sag)} m`]);
        return {
          bodies: [{ key: 'm', shape: 'box', material: 'steel', size: BOX, mass: m, x: 6, y, friction: 0 }],
          links: [{ type: 'spring', a: { x: 6, y: top }, b: { body: 'm' }, k, rest: v.rest, damping: v.damping }],
          theory,
        };
      }
      const wallX = 2.5;
      const x = clamp(wallX + v.rest + v.stretch, wallX + 0.3, 11.5);
      return {
        world: { friction: 1 },
        bodies: [{ key: 'm', shape: 'box', material: 'steel', size: BOX, mass: m, x, y: BOX / 2, friction: v.mu ** 2 }],
        links: [{ type: 'spring', a: { x: wallX, y: BOX / 2 }, b: { body: 'm' }, k, rest: v.rest, damping: v.damping }],
        theory,
      };
    },
  },

  pendulum: {
    name: 'Pendulum (single or double)',
    params: [
      p('length', 'String length L', 0.3, 5, 0.05, 'm', 2.5),
      p('mass', 'Bob mass', 0.1, 20, 0.1, 'kg', 1),
      p('angle', 'Release angle θ₀', 1, 170, 1, '°', 20),
      p('double', 'Double pendulum (1 = yes)', 0, 1, 1, '', 0),
    ],
    build(v, g) {
      const pivot = { x: 6, y: 6.2 };
      const L = clamp(v.length, 0.3, v.double >= 0.5 ? 3 : 5.9);
      const a = v.angle * DEG;
      const b1 = { x: pivot.x + L * Math.sin(a), y: pivot.y - L * Math.cos(a) };
      const bodies = [{ key: 'b1', shape: 'ball', material: 'steel', size: 0.15, mass: v.mass, ...b1 }];
      const links = [{ type: 'rod', a: { ...pivot }, b: { body: 'b1' }, length: L }];
      const T = 2 * Math.PI * Math.sqrt(L / (G * g));
      const theory = [['Small-angle period T = 2π√(L/g)', `${r2(T)} s`], ['With amplitude correction', `${r2(T * (1 + (a * a) / 16))} s`], ['Speed at the bottom √(2gL(1−cos θ₀))', `${r2(Math.sqrt(2 * G * g * L * (1 - Math.cos(a))))} m/s`]];
      if (v.double >= 0.5) {
        bodies.push({ key: 'b2', shape: 'ball', material: 'steel', size: 0.15, mass: v.mass, x: b1.x + L * Math.sin(a), y: b1.y - L * Math.cos(a) });
        links.push({ type: 'rod', a: { body: 'b1' }, b: { body: 'b2' }, length: L });
        return { world: { airDensity: 0 }, bodies, links, theory: [['Double pendulum', 'chaotic: tiny changes in θ₀ give very different motion']] };
      }
      return { world: { airDensity: 0 }, bodies, links, theory };
    },
  },

  atwood: {
    name: 'Atwood machine (fixed pulley)',
    params: [
      p('m1', 'Left mass m₁', 0.1, 50, 0.1, 'kg', 3),
      p('m2', 'Right mass m₂', 0.1, 50, 0.1, 'kg', 2),
      p('height', 'Starting height of both masses', 0.5, 4.5, 0.1, 'm', 2.5),
    ],
    build(v, g) {
      const P = { x: 6, y: 5.8 }, r = 0.3;
      const a = ((v.m1 - v.m2) / (v.m1 + v.m2)) * G * g;
      return {
        world: { airDensity: 0 },
        bodies: [
          { key: 'm1', shape: 'box', material: 'steel', size: BOX, mass: v.m1, x: P.x - r, y: v.height },
          { key: 'm2', shape: 'box', material: 'steel', size: BOX, mass: v.m2, x: P.x + r, y: v.height },
        ],
        links: [{ type: 'rope', points: [{ body: 'm1' }, { x: P.x - r, y: P.y }, { x: P.x + r, y: P.y }, { body: 'm2' }] }],
        theory: [['Acceleration a = (m₁−m₂)g/(m₁+m₂)', `${r2(Math.abs(a))} m/s² (${a >= 0 ? 'm₁' : 'm₂'} goes down)`], ['Tension T = 2m₁m₂g/(m₁+m₂)', `${r2((2 * v.m1 * v.m2 * G * g) / (v.m1 + v.m2))} N`]],
      };
    },
  },

  table_pulley: {
    name: 'Block on table + hanging mass',
    params: [
      p('m1', 'Block on table m₁', 0.1, 50, 0.1, 'kg', 4),
      p('m2', 'Hanging mass m₂', 0.1, 50, 0.1, 'kg', 2),
      p('mu', 'Table friction μ', 0, 1, 0.01, '', 0.2),
    ],
    build(v, g) {
      const tableY = 3, edge = 8;
      const net = v.m2 * G * g - v.mu * v.m1 * G * g;
      const a = net > 0 ? net / (v.m1 + v.m2) : 0;
      return {
        world: { airDensity: 0, friction: 1 },
        bodies: [
          { key: 'table', shape: 'plank', x: (2 + edge) / 2, y: tableY - 0.08, length: edge - 2, size: 0.16, angle: 0 },
          { key: 'm1', shape: 'box', material: 'wood', size: BOX, mass: v.m1, x: 3.2, y: tableY + BOX / 2 + 0.01, friction: v.mu ** 2 },
          { key: 'm2', shape: 'box', material: 'steel', size: BOX, mass: v.m2, x: edge + 0.35, y: tableY - 1.2 },
        ],
        links: [{ type: 'rope', points: [{ body: 'm1' }, { x: edge + 0.05, y: tableY + BOX / 2 }, { x: edge + 0.35, y: tableY + 0.05 }, { body: 'm2' }] }],
        theory: [['Moves if m₂ > μm₁', net > 0 ? 'yes' : 'no, friction holds it'], ['Acceleration a = (m₂ − μm₁)g/(m₁+m₂)', `${r2(a)} m/s²`], ['Tension T = m₂(g − a)', `${r2(v.m2 * (G * g - a))} N`]],
      };
    },
  },

  two_pulley_table: {
    name: 'Two pulleys, three blocks (table)',
    params: [
      p('m1', 'Left hanging mass m₁', 0.1, 50, 0.1, 'kg', 2),
      p('m2', 'Block on table m₂', 0.1, 50, 0.1, 'kg', 3),
      p('m3', 'Right hanging mass m₃', 0.1, 50, 0.1, 'kg', 5),
      p('mu', 'Table friction μ', 0, 1, 0.01, '', 0.1),
    ],
    // m₁ ← pulley ← m₂ on the table → pulley → m₃
    build(v, g) {
      const tableY = 4.4, left = 3.5, right = 8.5, gg = G * g; // high table: room for both masses to move
      const drive = (v.m3 - v.m1) * gg, fr = v.mu * v.m2 * gg;
      const a = Math.abs(drive) > fr ? (Math.abs(drive) - fr) / (v.m1 + v.m2 + v.m3) : 0;
      const rightward = drive > 0;
      // tensions: the side going down has T = m(g − a), the side going up T = m(g + a)
      const T1 = v.m1 * (gg + (rightward ? a : -a));
      const T2 = v.m3 * (gg - (rightward ? a : -a));
      return {
        world: { airDensity: 0, friction: 1 },
        bodies: [
          { key: 'table', shape: 'plank', x: (left + right) / 2, y: tableY - 0.08, length: right - left, size: 0.16, angle: 0 },
          { key: 'm1', shape: 'box', material: 'steel', size: BOX, mass: v.m1, x: left - 0.35, y: tableY - 2.2 },
          { key: 'm2', shape: 'box', material: 'wood', size: BOX, mass: v.m2, x: 6, y: tableY + BOX / 2 + 0.01, friction: v.mu ** 2 },
          { key: 'm3', shape: 'box', material: 'steel', size: BOX, mass: v.m3, x: right + 0.35, y: tableY - 2.2 },
        ],
        links: [
          { type: 'rope', points: [{ body: 'm2' }, { x: left - 0.05, y: tableY + BOX / 2 }, { x: left - 0.35, y: tableY + 0.05 }, { body: 'm1' }] },
          { type: 'rope', points: [{ body: 'm2' }, { x: right + 0.05, y: tableY + BOX / 2 }, { x: right + 0.35, y: tableY + 0.05 }, { body: 'm3' }] },
        ],
        theory: [
          ['Direction', a === 0 ? 'stays at rest (friction holds)' : rightward ? 'm₃ goes down, m₂ slides right' : 'm₁ goes down, m₂ slides left'],
          ['Acceleration (|m₃ − m₁|g − μm₂g)/(m₁+m₂+m₃)', `${r2(a)} m/s²`],
          ['Left rope tension T₁', `${r2(T1)} N`],
          ['Right rope tension T₂', `${r2(T2)} N`],
        ],
      };
    },
  },

  incline_pulley: {
    name: 'Block on incline + hanging mass',
    params: [
      p('angle', 'Incline angle θ', 5, 70, 0.5, '°', 30),
      p('m1', 'Block on incline m₁', 0.1, 50, 0.1, 'kg', 3),
      p('m2', 'Hanging mass m₂', 0.1, 50, 0.1, 'kg', 2),
      p('mu', 'Incline friction μ', 0, 1, 0.01, '', 0.1),
    ],
    build(v, g) {
      const th = v.angle * DEG, L = 5;
      const top = { x: 8, y: 4.6 };
      const low = { x: top.x - L * Math.cos(th), y: top.y - L * Math.sin(th) };
      const c = { x: (top.x + low.x) / 2, y: (top.y + low.y) / 2 };
      const along = { x: Math.cos(th), y: Math.sin(th) }, normal = { x: -Math.sin(th), y: Math.cos(th) };
      const s = 1.6; // block's distance from the low end, along the incline
      const lift = 0.08 + BOX / 2 + 0.01;
      const block = { x: low.x + along.x * s + normal.x * lift, y: low.y + along.y * s + normal.y * lift };
      const gg = G * g;
      const drive = v.m2 * gg - v.m1 * gg * Math.sin(th); // >0: m₂ pulls the block up the slope
      const fr = v.mu * v.m1 * gg * Math.cos(th);
      const a = Math.abs(drive) > fr ? (Math.abs(drive) - fr) / (v.m1 + v.m2) : 0;
      return {
        world: { airDensity: 0, friction: 1 },
        bodies: [
          { key: 'ramp', shape: 'plank', x: c.x, y: c.y, length: L, size: 0.16, angle: v.angle },
          { key: 'm1', shape: 'box', material: 'wood', size: BOX, mass: v.m1, x: block.x, y: block.y, angle: v.angle, friction: v.mu ** 2 },
          { key: 'm2', shape: 'box', material: 'steel', size: BOX, mass: v.m2, x: top.x + 0.45, y: top.y - 1.5 },
        ],
        links: [{ type: 'rope', points: [{ body: 'm1' }, { x: top.x + 0.05, y: top.y + 0.28 }, { x: top.x + 0.45, y: top.y + 0.1 }, { body: 'm2' }] }],
        theory: [['Direction', a === 0 ? 'stays at rest (friction holds)' : drive > 0 ? 'block slides up the incline' : 'block slides down the incline'], ['Acceleration', `${r2(a)} m/s²`], ['m₁g sin θ', `${r2(v.m1 * gg * Math.sin(th))} N`], ['Max friction μm₁g cos θ', `${r2(fr)} N`]],
      };
    },
  },

  movable_pulley: {
    name: 'Movable pulley (2:1)',
    params: [
      p('load', 'Load on the movable pulley M', 0.1, 50, 0.1, 'kg', 4),
      p('effort', 'Hanging effort mass m', 0.1, 50, 0.1, 'kg', 3),
    ],
    build(v, g) {
      const ceiling = 6.1, anchor = { x: 5.5, y: ceiling }, fixed = { x: 6.3, y: ceiling - 0.3 };
      const gg = G * g;
      // constraint: the effort moves twice as far as the load. a_load = (2m − M)g / (M + 4m)
      const aLoad = ((2 * v.effort - v.load) * gg) / (v.load + 4 * v.effort);
      return {
        world: { airDensity: 0 },
        bodies: [
          { key: 'M', shape: 'ball', material: 'steel', size: 0.25, mass: v.load, x: 5.75, y: 3 },
          { key: 'm', shape: 'box', material: 'steel', size: BOX, mass: v.effort, x: fixed.x + 0.3, y: 3 },
        ],
        links: [{ type: 'rope', points: [{ ...anchor }, { body: 'M' }, { x: 6.0, y: fixed.y }, { x: fixed.x + 0.3, y: fixed.y }, { body: 'm' }] }],
        theory: [['Constraint', 'effort moves 2× as far as the load'], ['Load acceleration (2m − M)g/(M + 4m)', `${r2(Math.abs(aLoad))} m/s² ${aLoad >= 0 ? 'up' : 'down'}`], ['Effort acceleration', `${r2(Math.abs(2 * aLoad))} m/s² ${aLoad >= 0 ? 'down' : 'up'}`], ['Balanced when m = M/2', `${r2(v.load / 2)} kg`]],
      };
    },
  },

  pulley_system: {
    name: 'Pulley system (block and tackle)',
    params: [
      p('pulleys', 'Number of pulleys', 2, 6, 1, '', 3),
      p('load', 'Load M (on the movable block)', 0.5, 80, 0.5, 'kg', 12),
      p('effort', 'Hanging effort mass m', 0.1, 40, 0.1, 'kg', 3),
    ],
    // n pulleys hold up the load with n rope segments: the effort moves n times as far as the load.
    // Pulleys alternate between the ceiling block and the moving load block.
    build(v, g) {
      const n = Math.round(clamp(v.pulleys, 2, 6));
      const top = 5.9, gap = 0.22, loadY = 2.6;
      const x0 = 6 - ((n - 1) * gap) / 2;
      const xs = Array.from({ length: n + 1 }, (_, i) => x0 + i * gap + (i === n ? 0.25 : 0)); // effort hangs clear of the load
      const cx = (xs[0] + xs[n - 1]) / 2;
      const T = (i) => ({ x: xs[i], y: top });                   // ceiling side of segment i
      const size = Math.max(0.35, (n - 1) * gap + 0.2);
      const B = (i) => ({ body: 'M', dx: xs[i] - cx, dy: size / 2 }); // load side of segment i (top of the block)
      // Even n: the rope starts at the ceiling; odd n: it is tied to the load. Either way it
      // finishes over the ceiling and drops to the effort mass.
      const points = [];
      let atTop = n % 2 === 0;
      points.push(atTop ? T(0) : B(0));
      for (let i = 0; i < n; i++) {
        if (i > 0) points.push(atTop ? T(i) : B(i)); // cross over to the next segment on the same side
        atTop = !atTop;
        points.push(atTop ? T(i) : B(i));            // run along segment i to the other side
      }
      points.push(T(n));                              // over the last ceiling pulley
      points.push({ body: 'm' });
      const gg = G * g;
      const aLoad = ((n * v.effort - v.load) * gg) / (v.load + n * n * v.effort);
      return {
        world: { airDensity: 0 },
        bodies: [
          { key: 'M', shape: 'box', material: 'steel', size, mass: v.load, x: cx, y: loadY, fixedRotation: true },
          { key: 'm', shape: 'box', material: 'steel', size: 0.25, mass: v.effort, x: xs[n], y: loadY },
        ],
        links: [{ type: 'rope', points }],
        theory: [
          ['Mechanical advantage (rope segments holding the load)', `${n}`],
          ['Balances when m = M/n', `${r2(v.load / n)} kg`],
          ['Load acceleration (n·m − M)g/(M + n²m)', `${r2(Math.abs(aLoad))} m/s² ${aLoad >= 0 ? 'up' : 'down'}`],
          ['Effort acceleration', `${r2(Math.abs(n * aLoad))} m/s² ${aLoad >= 0 ? 'down' : 'up'}`],
          ['Rope tension', `${r2(v.effort * (gg - n * aLoad))} N`],
        ],
      };
    },
  },

  collision_1d: {
    name: '1D collision',
    params: [
      p('m1', 'Mass m₁ (left)', 0.1, 50, 0.1, 'kg', 2),
      p('m2', 'Mass m₂ (right)', 0.1, 50, 0.1, 'kg', 1),
      p('u1', 'Velocity u₁ (→ positive)', -15, 15, 0.1, 'm/s', 4),
      p('u2', 'Velocity u₂ (→ positive)', -15, 15, 0.1, 'm/s', -2),
      p('e', 'Coefficient of restitution e', 0, 1, 0.01, '', 1),
    ],
    build(v) {
      const { m1, m2, u1, u2, e } = v;
      const v1 = (m1 * u1 + m2 * u2 - m2 * e * (u1 - u2)) / (m1 + m2);
      const v2 = (m1 * u1 + m2 * u2 + m1 * e * (u1 - u2)) / (m1 + m2);
      return {
        world: { friction: 0, airDensity: 0, gravity: 1 },
        bodies: [
          { key: 'a', shape: 'box', material: 'steel', size: 0.4, mass: m1, x: 3.5, y: 0.2, vx: u1, friction: 0, bounce: e },
          { key: 'b', shape: 'box', material: 'steel', size: 0.4, mass: m2, x: 8.5, y: 0.2, vx: u2, friction: 0, bounce: e },
        ],
        links: [],
        theory: [['After: v₁', `${r2(v1)} m/s`], ['After: v₂', `${r2(v2)} m/s`], ['Momentum (conserved)', `${r2(m1 * u1 + m2 * u2)} kg·m/s`], ['Kinetic energy lost', `${r2(0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2 - 0.5 * m1 * v1 * v1 - 0.5 * m2 * v2 * v2)} J`]],
      };
    },
  },

  projectile: {
    name: 'Projectile',
    params: [
      p('speed', 'Launch speed u', 1, 20, 0.1, 'm/s', 8),
      p('angle', 'Launch angle θ', -80, 89, 1, '°', 45),
      p('height', 'Launch height h', 0, 5, 0.1, 'm', 0),
    ],
    build(v, g) {
      const gg = G * g, th = v.angle * DEG;
      const ux = v.speed * Math.cos(th), uy = v.speed * Math.sin(th);
      const t = (uy + Math.sqrt(uy * uy + 2 * gg * v.height)) / gg;
      const r = 0.1;
      const bodies = [{ key: 'ball', shape: 'ball', material: 'steel', size: r, x: 0.6, y: v.height + r + 0.01, vx: r2(ux), vy: r2(uy), bounce: 0.15 }];
      if (v.height > 0.2) bodies.push({ key: 'ledge', shape: 'plank', x: 0.6, y: v.height - 0.08, length: 0.9, size: 0.16, angle: 0 });
      return {
        world: { airDensity: 0 },
        bodies,
        links: [],
        theory: [['Time of flight', `${r2(t)} s`], ['Range', `${r2(ux * t)} m (lands at x = ${r2(0.6 + ux * t)} m)`], ['Max height above launch u²sin²θ/2g', `${r2(Math.max(0, uy) ** 2 / (2 * gg))} m`]],
      };
    },
  },

  incline_block: {
    name: 'Block on an incline',
    params: [
      p('angle', 'Incline angle θ', 1, 75, 0.5, '°', 30),
      p('mu', 'Friction μ', 0, 1.5, 0.01, '', 0.3),
      p('mass', 'Block mass', 0.1, 50, 0.1, 'kg', 2),
    ],
    build(v, g) {
      const th = v.angle * DEG, L = 6;
      const high = { x: 2, y: 1 + L * Math.sin(th) > 6 ? 6 : 1 + L * Math.sin(th) };
      const len = Math.min(L, (high.y - 0.5) / Math.sin(th));
      const low = { x: high.x + len * Math.cos(th), y: high.y - len * Math.sin(th) };
      const c = { x: (high.x + low.x) / 2, y: (high.y + low.y) / 2 };
      const down = { x: Math.cos(th), y: -Math.sin(th) }, normal = { x: Math.sin(th), y: Math.cos(th) };
      const lift = 0.08 + BOX / 2 + 0.01;
      const b = { x: high.x + down.x * 0.6 + normal.x * lift, y: high.y + down.y * 0.6 + normal.y * lift };
      const gg = G * g;
      const slides = Math.tan(th) > v.mu;
      return {
        world: { airDensity: 0, friction: 1 },
        bodies: [
          { key: 'ramp', shape: 'plank', x: c.x, y: c.y, length: len, size: 0.16, angle: -v.angle },
          { key: 'm', shape: 'box', material: 'wood', size: BOX, mass: v.mass, x: b.x, y: b.y, angle: -v.angle, friction: v.mu ** 2 },
        ],
        links: [],
        theory: [['Slides if tan θ > μ', `tan θ = ${r2(Math.tan(th))} → ${slides ? 'slides' : 'stays'}`], ['Acceleration g(sin θ − μ cos θ)', `${r2(slides ? gg * (Math.sin(th) - v.mu * Math.cos(th)) : 0)} m/s²`], ['Angle of repose tan⁻¹ μ', `${r2(Math.atan(v.mu) / DEG)}°`]],
      };
    },
  },
};

export const defaults = (type) => Object.fromEntries(APPARATUS[type].params.map((q) => [q.key, q.value]));

// Build a scene from an apparatus type and (possibly partial) parameters.
export function buildApparatus(type, values = {}, world = {}) {
  const def = APPARATUS[type];
  if (!def) return null;
  const v = { ...defaults(type) };
  for (const q of def.params) {
    if (values[q.key] != null && Number.isFinite(Number(values[q.key]))) v[q.key] = clamp(Number(values[q.key]), q.min, q.max);
  }
  const g = world.gravity ?? 1;
  const out = def.build(v, g);
  return { ...out, world: { ...(out.world || {}), ...world }, values: v, name: def.name };
}

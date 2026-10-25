// Starter experiments. Units: metres, kg, m/s, degrees; y is height above the floor.

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tower() {
  const bodies = [];
  const s = 0.4;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5 - row; col++) {
      bodies.push({ shape: 'box', material: 'wood', breakable: true, size: s, x: 8 + row * (s / 2) + col * s, y: s / 2 + row * (s + 0.002) });
    }
  }
  bodies.push({ shape: 'ball', material: 'steel', size: 0.22, x: 1.5, y: 0.22, vx: 14 });
  return bodies;
}

function rack() {
  const r = 0.18, bodies = [];
  const dx = 2 * r * Math.cos(Math.PI / 6) + 0.01;
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) {
      bodies.push({ shape: 'ball', material: 'steel', size: r, x: 8 + row * dx, y: 3.3 + (i - row / 2) * (2 * r + 0.01) });
    }
  }
  bodies.push({ shape: 'ball', material: 'steel', size: r, x: 2.5, y: 3.3, vx: 8 });
  return bodies;
}

function rain() {
  const rnd = seeded(42);
  const materials = ['rubber', 'wood', 'steel', 'ice', 'stone', 'foam'];
  const bodies = [
    { shape: 'plank', x: 3.5, y: 2.6, length: 4, angle: -15 },
    { shape: 'plank', x: 8.5, y: 1.6, length: 4, angle: 18 },
  ];
  for (let i = 0; i < 36; i++) {
    bodies.push({
      shape: rnd() < 0.6 ? 'ball' : 'box',
      size: 0.12 + rnd() * 0.18,
      material: materials[Math.floor(rnd() * materials.length)],
      x: 1 + rnd() * 10,
      y: 3.6 + rnd() * 2.6,
      vx: Math.round((rnd() - 0.5) * 6 * 10) / 10,
    });
  }
  return bodies;
}

export const PRESETS = {
  drop: {
    name: 'Drop test: foam vs wood vs steel',
    scene: {
      world: { gravity: 1, friction: 0.1, bounciness: 0.5, airDensity: 0 },
      bodies: [
        { shape: 'ball', material: 'foam', size: 0.25, x: 3.5, y: 5 },
        { shape: 'ball', material: 'wood', size: 0.25, x: 6, y: 5 },
        { shape: 'ball', material: 'steel', size: 0.25, x: 8.5, y: 5 },
      ],
    },
  },
  ramp: {
    name: 'Ramp race: ball vs box',
    scene: {
      world: { gravity: 1, friction: 0.1, bounciness: 0.2, airDensity: 1.2 },
      bodies: [
        { shape: 'plank', x: 4, y: 4.6, length: 5, size: 0.16, angle: -20 },
        { shape: 'plank', x: 4, y: 2.2, length: 5, size: 0.16, angle: -20 },
        { shape: 'ball', material: 'wood', size: 0.2, x: 2, y: 5.63 },
        { shape: 'box', material: 'wood', size: 0.36, x: 2, y: 3.2 },
      ],
    },
  },
  tower: {
    name: 'Wrecking ball vs tower',
    scene: { world: { gravity: 1, friction: 0.4, bounciness: 0.1, airDensity: 1.2 }, bodies: tower() },
  },
  shatter: {
    name: 'Shatter test: ice vs stone vs wood',
    scene: {
      world: { gravity: 1, friction: 0.3, bounciness: 0.3, airDensity: 1.2 },
      bodies: [
        { shape: 'box', material: 'ice', breakable: true, size: 0.4, x: 3, y: 2.8 },
        { shape: 'box', material: 'stone', breakable: true, size: 0.4, x: 6, y: 2.8 },
        { shape: 'box', material: 'wood', breakable: true, size: 0.4, x: 9, y: 2.8 },
      ],
    },
  },
  billiards: {
    name: 'Zero-g billiards',
    scene: { world: { gravity: 0, friction: 0, bounciness: 0.95, airDensity: 0 }, bodies: rack() },
  },
  rain: {
    name: 'Chaos rain',
    scene: { world: { gravity: 1, friction: 0.1, bounciness: 0.5, airDensity: 1.2 }, bodies: rain() },
  },
  empty: {
    name: 'Empty lab',
    scene: { world: { gravity: 1, friction: 0.1, bounciness: 0.4, airDensity: 1.2 }, bodies: [] },
  },
};

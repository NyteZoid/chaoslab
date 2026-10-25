// Materials give each object its own friction, bounce and density.
// Values are rounded real-world figures; density is kg/m³.
// toughness (J/kg) is how much impact energy per kilogram a breakable object survives.
// Dropping onto the floor from height h delivers about g·h J/kg, so ice (8) shatters from ~0.8 m.
export const MATERIALS = {
  rubber: { name: 'Rubber', friction: 0.9, bounce: 0.8, density: 1100, toughness: 300, color: '#c8553d', shine: 0.15 },
  wood: { name: 'Wood', friction: 0.5, bounce: 0.45, density: 700, toughness: 30, color: '#b98a55', shine: 0.25 },
  steel: { name: 'Steel', friction: 0.4, bounce: 0.85, density: 7850, toughness: 1000, color: '#9aa7b8', shine: 0.9 },
  ice: { name: 'Ice', friction: 0.03, bounce: 0.2, density: 920, toughness: 8, color: '#a8dbea', shine: 0.7, alpha: 0.7 },
  stone: { name: 'Stone', friction: 0.7, bounce: 0.15, density: 2600, toughness: 20, color: '#8b8781', shine: 0.1 },
  foam: { name: 'Foam', friction: 0.6, bounce: 0.3, density: 50, toughness: 15, color: '#e4d6a7', shine: 0.05 },
};

export const DEFAULT_MATERIAL = 'rubber';

export const materialOf = (key) => MATERIALS[key] || MATERIALS[DEFAULT_MATERIAL];

// Objects are treated as real 3D solids: a ball is a sphere, a box is a cube.
export function massFor(shape, size, material) {
  const volume = shape === 'ball' ? (4 / 3) * Math.PI * size ** 3 : size ** 3;
  return volume * materialOf(material).density;
}

// Impact energy (J) a breakable object of this material and mass can take before shattering.
export const breakEnergyFor = (material, mass) => materialOf(material).toughness * mass;

// How two touching surfaces combine (geometric mean, as most engines do).
export const combine = (a, b) => Math.sqrt(a * b);

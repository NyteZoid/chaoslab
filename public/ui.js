// Wires the controls, telemetry readout and chart to the lab.
import { Lab, toM, fmt } from './lab.js';
import { Renderer } from './render.js';
import { Telemetry, METRICS } from './telemetry.js';
import { PRESETS } from './presets.js';
import { MATERIALS, DEFAULT_MATERIAL, massFor, breakEnergyFor } from './materials.js';
import { ImpactSound } from './sound.js';
import { Assistant } from './assistant.js';
import { Challenge } from './challenge.js';

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const lab = new Lab(canvas);
const renderer = new Renderer(lab, canvas);
const telemetry = new Telemetry(lab);
const sound = new ImpactSound();
window.ChaosLab = { lab, telemetry, renderer }; // handy from the console; Gemma tools hook in here next

// ---------- sliders ----------

const WORLD_SLIDERS = [
  { key: 'gravity', label: 'Gravity', min: -1, max: 3, step: 0.05, unit: '× Earth' },
  { key: 'friction', label: 'Surface friction', min: 0, max: 1, step: 0.01, unit: 'μ' },
  { key: 'bounciness', label: 'Surface bounce', min: 0, max: 1, step: 0.01, unit: '' },
  { key: 'airDensity', label: 'Air density', min: 0, max: 10, step: 0.1, unit: 'kg/m³' },
  { key: 'timeScale', label: 'Time speed', min: 0.1, max: 2, step: 0.05, unit: '×' },
];

// Mass uses a log slider so 0.1 kg and 2 t are both easy to hit.
const MASS_MIN = 0.1, MASS_MAX = 2000;
const massFromSlider = (v) => { const m = MASS_MIN * (MASS_MAX / MASS_MIN) ** (v / 100); return m < 10 ? Math.round(m * 10) / 10 : Math.round(m); };
const sliderFromMass = (m) => (100 * Math.log(m / MASS_MIN)) / Math.log(MASS_MAX / MASS_MIN);

// Break energy is also logarithmic: 1 J (crumbles at a touch) to 1 MJ.
const E_MIN = 1, E_MAX = 1e6;
const energyFromSlider = (v) => { const e = E_MIN * (E_MAX / E_MIN) ** (v / 100); return e < 100 ? Math.round(e) : Math.round(e / 10) * 10; };
const sliderFromEnergy = (e) => (100 * Math.log(e / E_MIN)) / Math.log(E_MAX / E_MIN);

const SPAWN_SLIDERS = [
  { key: 'size', label: 'Size (radius / half-width)', min: 0.08, max: 0.6, step: 0.01, unit: 'm', value: 0.2, hide: 'plank' },
  { key: 'mass', label: 'Mass', min: 0, max: 100, step: 0.5, unit: 'kg', value: 50, map: massFromSlider, hide: 'plank' },
  { key: 'vx', label: 'Launch speed →', min: -15, max: 15, step: 0.5, unit: 'm/s', value: 0, hide: 'plank' },
  { key: 'vy', label: 'Launch speed ↑', min: -15, max: 15, step: 0.5, unit: 'm/s', value: 0, hide: 'plank' },
  { key: 'breakEnergy', label: 'Breaks above', min: 0, max: 100, step: 0.5, unit: 'J', value: 50, map: energyFromSlider, breaks: true },
  { key: 'angle', label: 'Ramp angle (+ rises to the right)', min: -80, max: 80, step: 0.5, unit: '°', value: -20, only: 'plank', exact: true },
  { key: 'length', label: 'Ramp length', min: 0.5, max: 11, step: 0.1, unit: 'm', value: 3, only: 'plank', exact: true },
];

const spawn = { material: DEFAULT_MATERIAL, massAuto: true, breakable: false, breakAuto: true };
let tool = 'ball';
let committedWorld = { ...lab.world };

function makeSlider(container, def, initial, onInput, onChange) {
  const row = document.createElement('label');
  row.className = 'slider';
  if (def.only) row.dataset.only = def.only;
  if (def.hide) row.dataset.hide = def.hide;
  if (def.breaks) row.dataset.breaks = '';
  row.innerHTML = def.exact
    ? `<span>${def.label}</span><span class="exact"><input type="number" min="${def.min}" max="${def.max}" step="${def.step}" aria-label="${def.label} exact value">${def.unit}</span>
       <input type="range" min="${def.min}" max="${def.max}" step="${def.step}">`
    : `<span>${def.label}</span><output></output>
       <input type="range" min="${def.min}" max="${def.max}" step="${def.step}">`;
  const input = row.querySelector('input[type=range]');
  const out = row.querySelector('output') || { set innerHTML(_) {} };
  const exactBox = row.querySelector('input[type=number]');
  let suffix = '';
  const show = () => {
    const v = def.map ? def.map(+input.value) : +input.value;
    out.innerHTML = `${fmt(v)}${def.unit ? ' ' + def.unit : ''}${suffix}`;
    return v;
  };
  input.value = initial;
  show();
  const syncExact = () => { if (exactBox && document.activeElement !== exactBox) exactBox.value = input.value; };
  syncExact();
  input.addEventListener('input', () => { syncExact(); onInput(show()); });
  if (onChange) input.addEventListener('change', () => onChange(show()));
  if (exactBox) {
    // typed values can be finer than the slider and are committed on Enter or blur
    exactBox.addEventListener('change', () => {
      const v = Math.min(def.max, Math.max(def.min, Number(exactBox.value)));
      if (!Number.isFinite(v)) return;
      exactBox.value = v;
      input.value = v;
      onInput(v);
      if (onChange) onChange(v);
    });
  }
  container.appendChild(row);
  return {
    set: (v) => { input.value = v; if (exactBox) exactBox.value = v; show(); },
    setSuffix: (s) => { suffix = s; show(); },
  };
}

const worldControls = {};
for (const def of WORLD_SLIDERS) {
  worldControls[def.key] = makeSlider($('worldSliders'), def, lab.world[def.key],
    (v) => lab.setWorld({ [def.key]: v }, { silent: true }),
    () => commitWorldChange());
}

const spawnControls = {};
for (const def of SPAWN_SLIDERS) {
  spawn[def.key] = def.map ? def.map(def.value) : def.value;
  spawnControls[def.key] = makeSlider($('spawnSliders'), def, def.value, (v) => {
    spawn[def.key] = v;
    if (def.key === 'mass') spawn.massAuto = false;
    if (def.key === 'breakEnergy') spawn.breakAuto = false;
    if (def.key === 'mass' || def.key === 'size' || def.key === 'breakEnergy') syncAutoMass();
  });
}

// Mass follows material and size until the user drags the mass slider.
function syncAutoMass() {
  if (spawn.massAuto) {
    const auto = massFor(tool === 'box' ? 'box' : 'ball', spawn.size, spawn.material);
    spawnControls.mass.set(sliderFromMass(Math.min(MASS_MAX, Math.max(MASS_MIN, auto))));
    spawn.mass = Math.round(auto * 10) / 10;
  }
  spawnControls.mass.setSuffix(spawn.massAuto ? '<span class="auto">from material</span>' : '');
  // the break threshold follows toughness × mass until dragged
  if (spawn.breakAuto) {
    const auto = breakEnergyFor(spawn.material, spawn.mass);
    spawnControls.breakEnergy.set(sliderFromEnergy(Math.min(E_MAX, Math.max(E_MIN, auto))));
    spawn.breakEnergy = Math.round(auto);
  }
  spawnControls.breakEnergy.setSuffix(spawn.breakAuto ? '<span class="auto">from toughness</span>' : '');
}

function syncBreakControls() {
  const show = spawn.breakable && tool !== 'plank' && tool !== 'grab';
  document.querySelectorAll('[data-breaks]').forEach((el) => { el.hidden = !show; });
}

$('breakable').addEventListener('change', (e) => { spawn.breakable = e.target.checked; syncBreakControls(); });

// ---------- materials ----------

for (const [key, m] of Object.entries(MATERIALS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'material';
  b.dataset.material = key;
  b.setAttribute('role', 'radio');
  b.innerHTML = `<span class="name"><span class="swatch" style="background:${m.color}"></span>${m.name}</span>
    <span class="props">μ ${m.friction} · e ${m.bounce}</span>`;
  b.title = `${m.name}: friction ${m.friction}, bounce ${m.bounce}, density ${m.density} kg/m³, toughness ${m.toughness} J/kg`;
  b.addEventListener('click', () => setMaterial(key));
  $('materials').appendChild(b);
}

function setMaterial(key) {
  spawn.material = key;
  spawn.massAuto = true;
  spawn.breakAuto = true;
  document.querySelectorAll('.material').forEach((b) => {
    const on = b.dataset.material === key;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on);
  });
  syncAutoMass();
}

// A released slider is one experiment step: rerun from the same start, or log it mid-run.
function commitWorldChange() {
  const changes = Object.keys(lab.world)
    .filter((k) => committedWorld[k] !== lab.world[k])
    .map((k) => `${k} ${fmt(committedWorld[k])} → ${fmt(lab.world[k])}`);
  if (!changes.length) return;
  const reason = changes.join(', ');
  committedWorld = { ...lab.world };
  if ($('autoRerun').checked) lab.rerun(reason);
  else lab.emit('change', { t: lab.time, reason });
}

function syncWorldSliders() {
  for (const def of WORLD_SLIDERS) worldControls[def.key].set(lab.world[def.key]);
  committedWorld = { ...lab.world };
}

// ---------- tools & canvas input ----------

function setTool(next) {
  tool = next;
  document.querySelectorAll('.seg[data-tool]').forEach((b) => {
    const on = b.dataset.tool === tool;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on);
  });
  document.querySelectorAll('[data-only]').forEach((el) => { el.hidden = el.dataset.only !== tool; });
  document.querySelectorAll('[data-hide]').forEach((el) => { el.hidden = el.dataset.hide === tool; });
  lab.setGrabEnabled(tool === 'grab');
  renderer.spawnPreview = tool === 'grab' ? null : () => ({ shape: tool, ...spawnSpec() });
  canvas.style.cursor = tool === 'grab' ? 'grab' : 'crosshair';
  syncAutoMass();
  syncBreakControls();
}

function spawnSpec() {
  if (tool === 'plank') return { size: 0.16, angle: spawn.angle, length: spawn.length };
  return {
    material: spawn.material, size: spawn.size, mass: spawn.mass, vx: spawn.vx, vy: spawn.vy,
    ...(spawn.breakable ? { breakable: true, breakEnergy: spawn.breakEnergy } : {}),
  };
}

document.querySelectorAll('.seg[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const p = canvasPoint(e);
  // clicking a ramp or wall selects it for editing instead of dropping something on it
  const hitId = lab.specAtPoint(p.x, p.y);
  const hit = hitId && lab.spec(hitId);
  if (hit && hit.static) { selectFixed(hit.id); return; }
  selectFixed(null);
  if (tool === 'grab') return;
  const m = toM(p.x, p.y);
  if (m.y <= 0) return;
  lab.addBody({ shape: tool, x: m.x, y: m.y, ...spawnSpec() });
});
canvas.addEventListener('pointermove', (e) => { renderer.hover = e.pointerType === 'mouse' ? canvasPoint(e) : null; });
canvas.addEventListener('pointerleave', () => { renderer.hover = null; });
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const p = canvasPoint(e);
  const id = lab.specAtPoint(p.x, p.y);
  if (id) lab.removeBody(id);
});

// ---------- selected ramp ----------

let selectedId = null;
let selectedBefore = null;
const RAMP_EDIT = [
  { key: 'angle', label: 'Angle (+ rises to the right)', min: -90, max: 90, step: 0.5, unit: '°', exact: true },
  { key: 'length', label: 'Length', min: 0.3, max: 12, step: 0.1, unit: 'm', exact: true },
];
const rampControls = {};
for (const def of RAMP_EDIT) {
  rampControls[def.key] = makeSlider($('rampSliders'), def, 0,
    (v) => { if (selectedId) lab.patchFixed(selectedId, { [def.key]: v }); },
    () => commitFixedChange());
}

function selectFixed(id) {
  selectedId = id;
  renderer.selectedId = id;
  const spec = id && lab.spec(id);
  $('rampCard').hidden = !spec;
  if (!spec) return;
  selectedBefore = { ...spec };
  $('rampTitle').textContent = spec.name ? `Ramp ${spec.name}` : `${Math.abs(spec.angle) >= 85 ? 'Wall' : 'Ramp'} #${spec.id}`;
  rampControls.angle.set(spec.angle);
  rampControls.length.set(spec.length);
}

// Releasing an angle or length change is one experiment step, like a world slider.
function commitFixedChange() {
  const spec = selectedId && lab.spec(selectedId);
  if (!spec || !selectedBefore) return;
  const changes = ['angle', 'length']
    .filter((k) => spec[k] !== selectedBefore[k])
    .map((k) => `${k} ${fmt(selectedBefore[k])}${k === 'angle' ? '°' : ' m'} → ${fmt(spec[k])}${k === 'angle' ? '°' : ' m'}`);
  if (!changes.length) return;
  lab.carryRiders(selectedBefore, spec);
  selectedBefore = { ...spec };
  const reason = `${$('rampTitle').textContent} ${changes.join(', ')}`;
  if ($('autoRerun').checked) {
    lab.rerun(reason);
    lab.resolveOverlaps(reason); // a steeper ramp can swing up into objects resting on it
  } else {
    lab.emit('change', { t: lab.time, reason });
  }
}

$('rampClose').addEventListener('click', () => selectFixed(null));
$('rampDelete').addEventListener('click', () => { if (selectedId) { lab.removeBody(selectedId); selectFixed(null); } });
lab.on('reset', () => { if (selectedId && !lab.spec(selectedId)) selectFixed(null); });

// ---------- top bar & switches ----------

for (const [key, p] of Object.entries(PRESETS)) $('preset').add(new Option(p.name, key));
$('preset').addEventListener('change', () => loadPreset($('preset').value));

function loadPreset(key) {
  const p = PRESETS[key];
  lab.loadScene(structuredClone(p.scene), `Preset: ${p.name}`);
}

$('playPause').addEventListener('click', () => lab.setPaused(!lab.paused));
lab.on('pause', (paused) => {
  $('playPause').querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
  $('playPause').querySelector('span').textContent = paused ? 'Play' : 'Pause';
  $('playPause').title = `${paused ? 'Play' : 'Pause'} (Space)`;
});
$('rerun').addEventListener('click', () => lab.rerun('Rerun'));
$('clear').addEventListener('click', () => lab.clear());
$('trails').addEventListener('change', (e) => { renderer.showTrails = e.target.checked; renderer.trails.clear(); });
$('vectors').addEventListener('change', (e) => { renderer.showVectors = e.target.checked; });
$('effects').addEventListener('change', (e) => { renderer.effects = e.target.checked; });
$('sound').addEventListener('change', (e) => { sound.enabled = e.target.checked; if (sound.enabled) sound.unlock(); });

// Audio can only start after a user gesture.
document.addEventListener('pointerdown', () => { if (sound.enabled) sound.unlock(); }, { once: true });
lab.on('collision', (c) => sound.play(c.materials[0], c.speed));
lab.on('break', (b) => sound.playBreak(b.material));

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input[type=text], textarea, select')) return;
  if (e.code === 'Space') { e.preventDefault(); lab.setPaused(!lab.paused); }
  if (e.key === 'r' || e.key === 'R') lab.rerun('Rerun');
});

// ---------- telemetry readout ----------

let baselineId = null; // run to compare against; null = the one before the current run

for (const [key, m] of Object.entries(METRICS)) $('metric').add(new Option(m.label, key));
$('metric').addEventListener('change', drawChart);

function baseline() {
  const pinned = baselineId && telemetry.runs.find((r) => r.id === baselineId);
  return pinned && pinned !== telemetry.current ? pinned : telemetry.previous();
}

lab.on('reset', () => {
  syncWorldSliders();
  if (baselineId && !telemetry.runs.some((r) => r.id === baselineId)) baselineId = null;
  renderRuns();
});

let lastRunsRender = 0;
telemetry.onUpdate(() => {
  renderStats();
  drawChart();
  if (performance.now() - lastRunsRender > 1000) renderRuns();
});

function renderStats() {
  const run = telemetry.current;
  const s = telemetry.latest();
  const first = run && run.samples[0];
  if (!s) { $('stats').innerHTML = ''; return; }
  const lost = first && first.energy > 0 ? (1 - s.energy / first.energy) * 100 : 0;
  const rows = [
    ['Time', `${s.t.toFixed(1)} s`],
    ['Objects', run.bodies],
    ['Kinetic energy', `${fmt(s.ke)} J`],
    ['Potential energy', `${fmt(s.pe)} J`],
    ['Energy lost', `${fmt(lost)} %`],
    ['Momentum', `${fmt(s.momentum)} kg·m/s`],
    ['Average speed', `${fmt(s.avgSpeed)} m/s`],
    ['Collisions', run.collisions],
    ['Hardest hit', `${fmt(run.hardestHit)} m/s`],
    ['Settled', run.settledAt === null ? 'Still moving' : `${run.settledAt} s`],
  ];
  $('stats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('runBadge').textContent = `Run ${run.id} · ${s.t.toFixed(1)} s · ${run.reason}`;
}

function renderRuns() {
  lastRunsRender = performance.now();
  const base = baseline();
  $('runs').innerHTML = telemetry.runs.slice().reverse().map((run) => {
    const sum = telemetry.summarize(run);
    const live = run === telemetry.current;
    const stats = sum
      ? `${fmt(sum.energy_lost_pct)}% energy lost · ${sum.collisions} hits · ${sum.settled_at_s === null ? 'still moving' : 'settled at ' + sum.settled_at_s + ' s'}`
      : 'Recording…';
    const cls = [live ? 'live' : '', base === run ? 'base' : ''].join(' ');
    return `<li class="${cls}" data-id="${run.id}" tabindex="${live ? -1 : 0}">
      <div class="run-title"><span>${run.id}</span><span class="reason">${escapeHtml(run.reason)}</span>${live ? '<span class="chip">Live</span>' : ''}${base === run ? '<span class="chip chip-muted">Comparing</span>' : ''}</div>
      <div class="run-meta">g ${fmt(run.world.gravity)} · μ ${fmt(run.world.friction)} · bounce ${fmt(run.world.bounciness)} · air ${fmt(run.world.airDensity)}</div>
      <div class="run-meta">${stats}</div>
    </li>`;
  }).join('');
}

function pickRun(li) {
  const id = Number(li.dataset.id);
  if (telemetry.runs.find((r) => r.id === id) === telemetry.current) return;
  baselineId = baselineId === id ? null : id;
  renderRuns();
  drawChart();
}
$('runs').addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li) pickRun(li); });
$('runs').addEventListener('keydown', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickRun(li); }
});

// ---------- chart ----------

const chart = $('chart');
const cctx = chart.getContext('2d');

function drawChart() {
  const metric = METRICS[$('metric').value];
  const cur = telemetry.current;
  const base = baseline();
  $('compareLabel').textContent = base ? `Run ${base.id}` : 'No earlier run yet';
  const W = chart.width, H = chart.height, pad = { l: 72, r: 16, t: 16, b: 40 };
  cctx.clearRect(0, 0, W, H);

  const series = [base, cur].filter((r) => r && r.samples.length);
  if (!series.length) return;
  const tMax = Math.max(5, ...series.map((r) => r.samples[r.samples.length - 1].t));
  let yMin = 0, yMax = metric.max || 0;
  for (const r of series) for (const s of r.samples) { yMax = Math.max(yMax, s[metric.key]); yMin = Math.min(yMin, s[metric.key]); }
  if (yMax - yMin < 1e-6) yMax = yMin + 1;
  const X = (t) => pad.l + (t / tMax) * (W - pad.l - pad.r);
  const Y = (v) => H - pad.b - ((v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);

  cctx.font = '500 24px Inter, system-ui, sans-serif';
  cctx.fillStyle = '#a3a3a3';
  cctx.strokeStyle = 'rgba(163, 163, 163, 0.15)';
  cctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const v = yMin + ((yMax - yMin) * i) / 3;
    const y = Math.round(Y(v)) + 0.5;
    cctx.beginPath(); cctx.moveTo(pad.l, y); cctx.lineTo(W - pad.r, y); cctx.stroke();
    cctx.textAlign = 'right'; cctx.textBaseline = 'middle';
    cctx.fillText(fmt(v), pad.l - 12, y);
  }
  cctx.textAlign = 'center'; cctx.textBaseline = 'top';
  const tick = tMax > 30 ? 10 : tMax > 12 ? 5 : 2;
  for (let t = 0; t <= tMax; t += tick) cctx.fillText(`${t}s`, X(t), H - pad.b + 8);

  if (cur) {
    cctx.strokeStyle = 'rgba(242, 184, 75, 0.5)';
    cctx.setLineDash([4, 4]);
    for (const ev of cur.events) { cctx.beginPath(); cctx.moveTo(X(ev.t), pad.t); cctx.lineTo(X(ev.t), H - pad.b); cctx.stroke(); }
    cctx.setLineDash([]);
  }

  const line = (run, color, dash) => {
    if (!run || !run.samples.length) return;
    cctx.strokeStyle = color;
    cctx.lineWidth = 3;
    cctx.lineJoin = 'round';
    cctx.setLineDash(dash);
    cctx.beginPath();
    run.samples.forEach((s, i) => (i ? cctx.lineTo : cctx.moveTo).call(cctx, X(s.t), Y(s[metric.key])));
    cctx.stroke();
    cctx.setLineDash([]);
  };
  line(base, '#737373', [8, 6]);
  line(cur, '#ef4444', []);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------- start ----------

const assistant = new Assistant({
  lab,
  telemetry,
  canvas,
  getBaseline: baseline,
  els: {
    panel: $('gemmaPanel'),
    form: $('gemmaForm'),
    input: $('gemmaInput'),
    build: $('gemmaBuild'),
    explain: $('gemmaExplain'),
    chips: $('gemmaChips'),
    status: $('gemmaStatus'),
    result: $('gemmaResult'),
    providers: [...document.querySelectorAll('[data-provider]')],
  },
});
window.ChaosLab.assistant = assistant;
assistant.els.challenge = $('challengeBtn');

const challenge = new Challenge({ lab, telemetry, assistant, els: { button: $('challengeBtn'), score: $('challengeScore') } });
window.ChaosLab.challenge = challenge;

setMaterial(DEFAULT_MATERIAL);
setTool('ball');
const startPreset = new URLSearchParams(location.search).get('preset'); // e.g. ?preset=tower
$('preset').value = PRESETS[startPreset] ? startPreset : 'drop';
loadPreset($('preset').value);

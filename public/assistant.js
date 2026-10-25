// The Gemma panel: build scenes from text (function calling) and explain results from telemetry.
import { DEFAULT_WORLD } from './lab.js';
import { layoutPlan, launchVelocity } from './layout.js';

const EXPLAIN_MIN_SECONDS = 4; // let a run play out a little before explaining it
const QUESTION = /\?\s*$|^(why|how|what|when|which|explain|does|did|is|are|can)\b/i;

const SUGGESTIONS = [
  'Drop a bowling ball and a feather-light foam ball on the Moon',
  'Race an ice cube and a rubber block down a 30° ramp',
  'Five steel balls in a row, the first one launched at 6 m/s',
];

export class Assistant {
  constructor({ lab, telemetry, canvas, els, getBaseline }) {
    this.lab = lab;
    this.telemetry = telemetry;
    this.canvas = canvas;
    this.els = els;
    this.getBaseline = getBaseline;
    this.provider = 'cloud';
    this.busy = false;
    this.history = []; // recent build requests, so follow-ups make sense
    this.status = { cloud: false, local: false };

    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = els.input.value.trim();
      if (!text) return;
      if (QUESTION.test(text)) this.explain(text);
      else this.build(text);
    });
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); els.form.requestSubmit(); }
    });
    els.build.addEventListener('click', () => { const t = els.input.value.trim(); if (t) this.build(t); else els.input.focus(); });
    els.explain.addEventListener('click', () => this.explain(els.input.value.trim()));
    els.providers.forEach((b) => b.addEventListener('click', () => this.setProvider(b.dataset.provider)));
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.target.matches('input, textarea, select')) { e.preventDefault(); els.input.focus(); }
    });

    lab.on('reset', () => this.renderChips());
    this.renderChips();
    this.loadStatus();
  }

  async loadStatus() {
    try {
      this.status = await (await fetch('/api/status')).json();
    } catch { this.status = { cloud: false, local: false }; }
    for (const b of this.els.providers) {
      const ok = this.status[b.dataset.provider];
      b.disabled = !ok;
      b.title = ok ? '' : b.dataset.provider === 'cloud' ? 'No Gemini API key on the server' : 'Ollama with gemma4:e4b is not running';
    }
    if (!this.status.cloud && this.status.local) this.setProvider('local');
  }

  async setProvider(p) {
    this.provider = p;
    this.els.providers.forEach((b) => {
      const on = b.dataset.provider === p;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on);
    });
    if (p === 'local') {
      this.showNotice('Loading Gemma 4 E4B onto your GPU…', true);
      const res = await fetch('/api/warm', { method: 'POST' }).then((r) => r.json()).catch(() => ({ ok: false }));
      this.showNotice(res.ok ? 'Gemma 4 E4B is loaded and running on this laptop. No internet needed.' : 'Could not load the on-device model. Is Ollama running?');
    }
  }

  // Contextual quick actions: explain the latest change, or example builds on an empty start.
  renderChips() {
    const run = this.telemetry.current;
    const base = this.getBaseline();
    const chips = [];
    if (run && base) chips.push({ label: `Why did run ${run.id} differ from run ${base.id}?`, action: () => this.explain('') });
    else if (run) chips.push({ label: 'Explain this run', action: () => this.explain('') });
    for (const s of SUGGESTIONS) chips.push({ label: s, action: () => { this.els.input.value = s; this.build(s); } });
    this.els.chips.replaceChildren(...chips.slice(0, 3).map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn';
      b.textContent = c.label;
      b.addEventListener('click', () => !this.busy && c.action());
      return b;
    }));
  }

  // ---------- build ----------

  async build(prompt) {
    if (this.busy) return;
    this.setBusy('build');
    try {
      const out = await this.post('/api/build', {
        prompt,
        scene: this.lab.getScene(),
        provider: this.provider,
        history: this.history.slice(-3),
        outcome: this.outcome(),
        image: this.snapshot(), // Gemma sees the current scene, so "make it faster" has a referent
      });
      const label = this.apply(out.call, prompt);
      const check = this.checkScene(out.call.args);
      this.history.push({ prompt, result: `${out.call.name}: ${label}. ${out.call.args.note || ''}`.trim() });
      this.renderResult({
        kind: 'build',
        headline: label,
        explanation: out.call.args.note || '',
        understood: out.call.args.checklist,
        check,
        meta: this.meta(out, out.call.name === 'build_scene' ? 'Built with function calling' : 'Edited with function calling'),
      });
      this.els.input.value = '';
    } catch (e) {
      this.renderError(e.message);
    } finally {
      this.setBusy(null);
    }
  }

  // A compact account of the run so far, for follow-up requests.
  outcome() {
    const run = this.telemetry.current;
    if (!run || !this.telemetry.latest()) return null;
    return {
      seconds: this.telemetry.latest().t,
      objects: this.telemetry.objectReport(run, 10).map((o) => ({
        id: o.id, shape: o.shape, material: o.material, start: o.start, end: o.end,
        peak_speed_mps: o.peak_speed_mps, ...(o.shattered ? { shattered: o.shattered } : {}),
      })),
    };
  }

  // For paths and stairs, run the scene ahead invisibly and say whether the ball gets to the bottom.
  checkScene(args) {
    const kinds = [...(args.structures || []), ...(args.add_structures || [])].map((s) => s.type);
    if (!kinds.some((k) => k === 'ramp_path' || k === 'staircase')) return null;
    const report = this.lab.dryRun(25);
    if (!report.length) return null;
    const arrived = report.filter((r) => r.floorAt !== null);
    if (arrived.length === report.length) {
      const t = Math.max(...arrived.map((r) => r.floorAt));
      return { ok: true, text: `Checked by running it ahead: ${report.length === 1 ? 'the ball reaches' : 'every object reaches'} the bottom in ${t} s.` };
    }
    return { ok: false, text: `Checked by running it ahead: ${report.length - arrived.length} of ${report.length} objects stop before the bottom. Try asking for a steeper path.` };
  }

  // Turn Gemma's tool call into a scene and run it from the start. Gemma describes the scene;
  // layout.js turns the description into exact positions.
  apply(call, prompt) {
    const args = call.args || {};
    const reason = `Gemma: ${truncate(prompt, 60)}`;
    if (call.name === 'build_scene') {
      const { world, bodies } = layoutPlan(args, {}, prompt);
      this.lab.loadScene({ world: { ...DEFAULT_WORLD, timeScale: this.lab.world.timeScale, ...world }, bodies }, reason);
      this.lab.resolveOverlaps(reason);
      return args.title || 'New experiment';
    }
    const scene = this.lab.getScene();
    const remove = new Set((args.remove_ids || []).map(Number));
    scene.bodies = scene.bodies.filter((b) => !remove.has(b.id));
    for (const u of args.update || []) {
      const b = scene.bodies.find((x) => x.id === Number(u.id));
      if (!b) continue;
      if (b.shape === 'plank') { // ramps: only their slope and length can change
        if (u.angle != null) b.angle = Number(u.angle);
        if (u.length != null) b.length = Number(u.length);
        continue;
      }
      for (const k of ['material', 'size', 'mass', 'breakable']) if (u[k] != null) b[k] = u[k];
      if ((u.material != null || u.size != null) && u.mass == null) delete b.mass; // let the material set the new mass
      if (u.material != null || u.size != null || u.mass != null) delete b.breakEnergy; // and the new threshold
      if (u.speed != null) Object.assign(b, launchVelocity(u.speed, u.direction));
    }
    const existingRamps = Object.fromEntries(scene.bodies.filter((b) => b.shape === 'plank').map((b) => [b.name || `#${b.id}`, b]));
    const { world, bodies } = layoutPlan({ world: args.world, structures: args.add_structures, ramps: args.add_ramps, groups: args.add_groups }, existingRamps, prompt);
    Object.assign(scene.world, world);
    scene.bodies.push(...bodies);
    scene.bodies = scene.bodies.slice(0, 60);
    this.lab.loadScene(scene, reason);
    this.lab.resolveOverlaps(reason);
    return 'Scene updated';
  }

  // ---------- explain ----------

  async explain(question) {
    if (this.busy) return;
    this.setBusy('explain');
    try {
      await this.waitForData();
      const run = this.telemetry.current;
      const base = question ? null : this.getBaseline();
      const data = this.telemetry.reportFor(run, base);
      if (!data.run && !data.after) throw new Error('No measurements yet. Let the simulation run for a moment.');
      const out = await this.post('/api/explain', { data, question, image: this.snapshot(), provider: this.provider });
      if (!out.result) throw new Error('Gemma returned an answer I could not read. Try again.');
      this.renderResult({
        kind: 'explain',
        ...out.result,
        twoRuns: !!base,
        meta: this.meta(out, base ? `Based on run ${base.id} vs run ${run.id}` : `Based on run ${run.id}`),
      });
      if (question) this.els.input.value = '';
    } catch (e) {
      this.renderError(e.message);
    } finally {
      this.setBusy(null);
    }
  }

  async waitForData() {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
      const run = this.telemetry.current;
      const last = this.telemetry.latest();
      if (this.lab.paused || (last && (last.t >= EXPLAIN_MIN_SECONDS || run.settledAt !== null))) return;
      this.els.status.textContent = `Recording run ${run?.id ?? ''}… ${last ? last.t.toFixed(1) : '0.0'} s`;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Small JPEG of the canvas so Gemma can see the scene, not just the numbers.
  snapshot() {
    const w = 720, h = Math.round((this.canvas.height / this.canvas.width) * w);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(this.canvas, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.75).split(',')[1];
  }

  // ---------- plumbing & rendering ----------

  async post(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  meta(out, grounding) {
    const model = out.provider === 'local' ? 'Gemma 4 E4B · on this laptop' : 'Gemma 4 26B · Gemini API';
    return `${out.fallback ? out.fallback + ' · ' : ''}${model} · ${(out.ms / 1000).toFixed(1)} s · ${grounding}`;
  }

  setBusy(kind) {
    this.busy = !!kind;
    const { build, explain, input, result, status } = this.els;
    build.disabled = explain.disabled = input.disabled = this.busy;
    build.classList.toggle('loading', kind === 'build');
    explain.classList.toggle('loading', kind === 'explain');
    this.els.panel.setAttribute('aria-busy', this.busy);
    if (kind) {
      status.textContent = kind === 'build' ? 'Gemma is building the scene…' : 'Gemma is reading the measurements…';
      result.hidden = false;
      result.className = 'answer skeleton';
      result.innerHTML = '<span></span><span></span><span></span>';
    } else {
      status.textContent = '';
      input.focus();
    }
  }

  showNotice(text, loading = false) {
    const { result } = this.els;
    result.hidden = false;
    result.className = loading ? 'answer notice loading' : 'answer notice';
    result.textContent = text;
  }

  renderResult(r) {
    const { result } = this.els;
    result.hidden = false;
    result.className = 'answer reveal';
    const rows = (r.numbers || []).slice(0, 4)
      .filter((n) => n && (n.after || n.before))
      .map((n) => `<tr><th scope="row">${esc(n.label)}</th>${r.twoRuns ? `<td>${esc(n.before)}</td><td>${esc(n.after)}</td>` : `<td>${esc(n.after || n.before)}</td>`}</tr>`).join('');
    const understood = (r.understood || []).filter(Boolean).slice(0, 8);
    result.innerHTML = `
      <h3 class="answer-head">${esc(r.headline)}</h3>
      ${r.explanation ? `<p>${esc(r.explanation)}</p>` : ''}
      ${understood.length ? `<p class="understood-label">What Gemma understood</p><ul class="understood">${understood.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : ''}
      ${r.check ? `<p class="check ${r.check.ok ? 'ok' : 'warn'}">${esc(r.check.text)}</p>` : ''}
      ${rows ? `<table class="numbers">${r.twoRuns ? '<thead><tr><th></th><th>Before</th><th>After</th></tr></thead>' : ''}<tbody>${rows}</tbody></table>` : ''}
      ${r.try_next ? `<button type="button" class="try-next">Try next: ${esc(r.try_next)}</button>` : ''}
      <p class="answer-meta">${esc(r.meta)}</p>`;
    const tryBtn = result.querySelector('.try-next');
    if (tryBtn) tryBtn.addEventListener('click', () => { this.els.input.value = r.try_next; this.build(r.try_next); });
    this.renderChips();
  }

  renderError(message) {
    const { result } = this.els;
    result.hidden = false;
    result.className = 'answer error';
    result.textContent = message;
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }


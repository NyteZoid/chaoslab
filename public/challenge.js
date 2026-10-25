// Predict-then-run: Gemma designs a scene and a question, the player predicts, the simulation runs.
// The correct answer is measured from the physics (a dry run before the reveal), never taken from the model.
import { DEFAULT_WORLD, fmt } from './lab.js';
import { layoutPlan } from './layout.js';
import { materialOf } from './materials.js';

const TIE = { first_to_floor: 0.05, farthest: 0.15, highest_bounce: 0.05 }; // s, m, m

export class Challenge {
  constructor({ lab, telemetry, assistant, els }) {
    this.lab = lab;
    this.telemetry = telemetry;
    this.assistant = assistant;
    this.els = els;
    this.score = { right: 0, played: 0 };
    this.recent = [];
    this.recentTypes = [];
    this.active = null;
    els.button.addEventListener('click', () => this.start());
  }

  async start(attempt = 0) {
    const a = this.assistant;
    if (a.busy) return;
    a.setBusy('challenge');
    let ready = null;
    try {
      const out = await a.post('/api/challenge', { provider: a.provider, recent: this.recent, recentTypes: this.recentTypes });
      ready = this.prepare(out);
      if (!ready) throw new Error('retry');
    } catch (e) {
      a.setBusy(null);
      if (e.message === 'retry' && attempt < 2) return this.start(attempt + 1);
      a.renderError(e.message === 'retry' ? 'Gemma\'s challenges kept coming out without a clear answer. Try again.' : e.message);
      return;
    }
    a.setBusy(null);
    this.ask(ready);
  }

  // Build the scene, measure the outcome invisibly, and work out the options and the answer.
  // groups: a reduced set when a first attempt had two winners (see below)
  prepare(out, only = null) {
    const args = out.call.args || {};
    const type = args.question_type;
    let groups = only || cleanGroups(args.groups || [], args.question || '');
    // Drop and bounce questions only make sense if everything starts at rest in the air, from one height.
    if (type === 'first_to_floor' || type === 'highest_bounce' || type === 'which_shatters') {
      const heights = groups.filter((g) => g.place === 'air' && Number(g.height) > 0.3).map((g) => Number(g.height));
      const h = heights.length ? Math.min(5, Math.max(...heights)) : 3;
      groups = groups.map((g) => (String(g.place || 'floor').includes('ramp') ? g : { ...g, place: 'air', height: h, speed: 0, direction: undefined }));
    }
    if (type === 'which_shatters') groups = groups.map((g) => ({ ...g, breakable: true }));
    if (type === 'farthest' && !groups.some((g) => Number(g.speed) > 0 || String(g.place || '').includes('ramp'))) return null;
    if (groups.length < 2) return null;
    const { world, bodies } = layoutPlan({ ...args, groups }, {}, args.question || '');
    const reason = `Challenge: ${args.title || 'predict the outcome'}`;
    this.lab.loadScene({ world: { ...DEFAULT_WORLD, timeScale: this.lab.world.timeScale, ...world }, bodies }, reason);
    this.lab.resolveOverlaps(reason);
    const objects = this.lab.bodies.filter((s) => !s.static);
    if (objects.length < 2 || objects.length > 5) return null;

    const report = this.lab.dryRun(12); // restarts the scene at t = 0 afterwards
    this.lab.setPaused(true);
    const byId = new Map(report.map((r) => [r.id, r]));
    const names = labels(objects);
    const options = objects.map((s) => ({ id: s.id, label: names.get(s.id) }));
    const measured = objects.map((s) => ({ ...byId.get(s.id), label: names.get(s.id) }));

    let answer, decisive;
    if (type === 'which_shatters') {
      const broke = measured.filter((m) => m.shattered);
      options.push({ id: 'none', label: 'None of them' }, { id: 'all', label: 'All of them' });
      if (!broke.length) answer = 'none';
      else if (broke.length === measured.length) answer = 'all';
      else if (broke.length === 1) answer = broke[0].id;
      // "two out of three" has no single option: drop the extra ones and measure again
      else return this.prepare(out, keep(groups, objects, (s) => !broke.some((m) => m.id === s.id) || s.id === broke[0].id));
      decisive = Math.max(...measured.map((m) => m.floorAt ?? 2)) + 0.6;
    } else {
      const key = { first_to_floor: 'floorAt', farthest: 'distance', highest_bounce: 'bounce' }[type];
      if (!key) return null;
      const scored = measured.filter((m) => m[key] != null && Number.isFinite(m[key]));
      if (scored.length < 2) return null;
      const better = type === 'first_to_floor' ? (x, y) => x < y : (x, y) => x > y;
      const best = scored.reduce((b, m) => (better(m[key], b[key]) ? m : b));
      const contenders = scored.filter((m) => Math.abs(m[key] - best[key]) <= TIE[type]);
      options.push({ id: 'tie', label: type === 'first_to_floor' ? 'All at the same time' : 'All about the same' });
      if (type === 'farthest' && best[key] < 0.3) return null; // nothing really moved
      if (contenders.length === scored.length) answer = 'tie';
      else if (contenders.length === 1) answer = best.id;
      // two share first place but not all: drop the extra winners and measure again
      else return this.prepare(out, keep(groups, objects, (s) => !contenders.some((m) => m.id === s.id) || s.id === best.id));
      decisive = type === 'farthest' ? 7 : Math.max(...scored.map((m) => m.floorAt ?? 1)) + (type === 'highest_bounce' ? 1.6 : 0.5);
    }
    return { args, type, reason, options, answer, measured, decisive: Math.min(decisive, 9), meta: out };
  }

  ask(c) {
    this.active = c;
    const { result } = this.assistant.els;
    result.hidden = false;
    result.className = 'answer reveal challenge';
    result.innerHTML = `
      <p class="challenge-kicker">Predict, then watch</p>
      <h3 class="answer-head">${esc(c.args.title || 'Challenge')}</h3>
      <p>${esc(c.args.question)}</p>
      <div class="choices">${c.options.map((o) => `<button type="button" class="choice" data-id="${o.id}">${esc(o.label)}</button>`).join('')}</div>
      <p class="answer-meta">The scene is frozen at the start. Pick your prediction to run it.</p>`;
    result.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => this.choose(b.dataset.id)));
  }

  choose(id) {
    const c = this.active;
    if (!c || c.chosen) return;
    c.chosen = String(id);
    const { result } = this.assistant.els;
    result.querySelectorAll('.choice').forEach((b) => {
      b.disabled = true;
      b.classList.toggle('picked', b.dataset.id === c.chosen);
    });
    result.querySelector('.answer-meta').textContent = 'Running the experiment…';
    this.lab.rerun(c.reason);
    this.lab.setPaused(false);
    const wait = (c.decisive / this.lab.world.timeScale) * 1000;
    this._timer = setTimeout(() => this.reveal(), wait);
  }

  async reveal() {
    const c = this.active;
    if (!c) return;
    const correct = c.chosen === String(c.answer);
    this.score.played++;
    if (correct) this.score.right++;
    this.recent.push(c.args.title);
    this.recentTypes.push(c.type);
    this.els.score.textContent = `Score ${this.score.right}/${this.score.played}`;
    const optLabel = (id) => c.options.find((o) => String(o.id) === String(id))?.label || id;
    const { result } = this.assistant.els;
    result.querySelectorAll('.choice').forEach((b) => {
      b.classList.toggle('right', b.dataset.id === String(c.answer));
      b.classList.toggle('wrong', b.dataset.id === c.chosen && !correct);
    });
    const rows = c.measured.map((m) => `<tr><th scope="row">${esc(m.label)}</th><td>${esc(measure(c.type, m))}</td></tr>`).join('');
    result.querySelector('.answer-meta').remove();
    result.insertAdjacentHTML('beforeend', `
      <p class="verdict ${correct ? 'ok' : 'miss'}">${correct ? 'Correct!' : `Not quite. The answer was: ${esc(optLabel(c.answer))}.`}</p>
      <table class="numbers"><tbody>${rows}</tbody></table>
      <p class="concept">${esc(c.args.concept || '')}</p>
      <div class="why skeleton"><span></span><span></span></div>
      <button type="button" class="try-next" id="nextChallenge">Next challenge</button>`);
    result.querySelector('#nextChallenge').addEventListener('click', () => this.start());

    // Gemma explains what happened, knowing what the player expected.
    const why = result.querySelector('.why');
    try {
      const data = this.telemetry.reportFor(this.telemetry.current, null);
      const question = `This was a predict-then-run challenge. Question: "${c.args.question}". The player predicted "${optLabel(c.chosen)}" and the measured answer was "${optLabel(c.answer)}" (${correct ? 'they were right' : 'they were wrong'}). Explain why it came out this way, and if they were wrong, the intuition that misled them.`;
      const out = await this.assistant.post('/api/explain', { data, question, image: this.assistant.snapshot(), provider: this.assistant.provider });
      const r = out.result || {};
      why.className = 'why';
      why.innerHTML = `<p><strong>${esc(r.headline || '')}</strong> ${esc(r.explanation || '')}</p><p class="answer-meta">${esc(this.assistant.meta(out, `Based on run ${this.telemetry.current.id}`))}</p>`;
    } catch (e) {
      why.className = 'why';
      why.innerHTML = `<p class="answer-meta">Gemma could not explain this one (${esc(e.message)}).</p>`;
    }
  }
}

// Gemma's groups often disagree with its own question: a box in "which ball…?", two identical
// objects, several on the same side, or none given a side. Keep one of each distinct object, of the
// shape the question names, and spread them evenly across the lab so they never overlap.
const SIDES = { 2: ['center-left', 'center-right'], 3: ['left', 'center', 'right'], 4: ['left', 'center-left', 'center-right', 'right'] };
function cleanGroups(raw, question) {
  const wants = /\bball/i.test(question) && !/\bbox/i.test(question) ? 'ball' : /\bbox|block|cube/i.test(question) && !/\bball/i.test(question) ? 'box' : null;
  const seen = new Set();
  const groups = [];
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const shape = g.shape === 'box' ? 'box' : 'ball';
    if (wants && shape !== wants) continue;
    const id = `${g.material}|${shape}|${g.size ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    groups.push({ ...g, shape, count: 1, arrangement: 'single' });
    if (groups.length === 4) break;
  }
  // objects on ramps keep their place; the rest are spread out
  const free = groups.filter((g) => !String(g.place || '').includes('ramp'));
  free.forEach((g, i) => { g.side = (SIDES[free.length] || ['center'])[i]; });
  return groups;
}

// The groups whose objects pass the test (bodies are created one per group, in order).
function keep(groups, objects, test) {
  const kept = groups.filter((g, i) => objects[i] && test(objects[i]));
  return kept.length < groups.length && kept.length >= 2 ? kept : [];
}

// "Steel ball", "Foam ball"; add size or position when two would read the same.
function labels(objects) {
  const base = (s) => `${materialOf(s.material).name} ${s.shape}`;
  const out = new Map();
  for (const s of objects) {
    const same = objects.filter((o) => base(o) === base(s));
    let label = base(s);
    if (same.length > 1) {
      const sizes = new Set(same.map((o) => o.size));
      if (sizes.size === same.length && same.length <= 3) {
        label = `${s.size === Math.max(...sizes) ? 'Large' : s.size === Math.min(...sizes) ? 'Small' : 'Medium'} ${label.toLowerCase()}`;
      } else {
        // name look-alikes by where they are, left to right
        const rank = [...same].sort((a, b) => a.x - b.x).indexOf(s);
        const where = same.length === 2 ? ['left', 'right'] : ['left', 'middle', 'right', 'far right'];
        label = `${label} (${where[rank]})`;
      }
    }
    out.set(s.id, label);
  }
  return out;
}

function measure(type, m) {
  if (type === 'first_to_floor') return m.floorAt == null ? 'never reached the floor' : `floor at ${fmt(m.floorAt)} s`;
  if (type === 'farthest') return `moved ${fmt(m.distance)} m`;
  if (type === 'highest_bounce') return m.floorAt == null ? 'never landed' : `bounced ${fmt(m.bounce)} m`;
  return m.shattered ? 'shattered' : 'survived';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

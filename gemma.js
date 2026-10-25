// Gemma 4 for ChaosLab: one interface over the Gemini API (cloud) and Ollama (on-device).
// The browser sends measured data; prompts and the API key stay on the server.
const fs = require('fs');
const path = require('path');

const CLOUD_MODEL = 'gemma-4-26b-a4b-it';
const LOCAL_MODEL = 'gemma4:e4b';
const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const m = env.match(/^GEMINI_API_KEY=(.*)$/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

// ---------- shared physics context ----------

const LAB_RULES = `ChaosLab is a 2D side-view physics sandbox (Matter.js plus our own Coulomb friction).
Units: metres, kilograms, seconds, m/s, degrees. x runs 0 to 12 m left to right; y is height above the floor, 0 to 6.4 m. There are walls on both sides and a ceiling.
World settings: gravity is a multiple of Earth gravity from -1 to 3 (1 = 9.81 m/s², Moon = 0.165, Mars = 0.38, Jupiter = 2.53, 0 = space, negative = upside down). friction and bounciness describe the fixed surfaces (floor, walls, ramps). airDensity is in kg/m³ (0 = vacuum, 1.2 = Earth air, 10 = very thick) and drives real quadratic drag F = ½·ρ·Cd·A·v² (ball Cd 0.47, box Cd 1.05, A = frontal area), so light, large objects are slowed most and heavy, small ones barely at all.
Objects: shape ball (size = radius), box (size = side length) or plank (a fixed ramp: size = thickness, plus length and angle in degrees; positive angle rises to the right).
Materials (friction μ, bounce e, density kg/m³): rubber 0.9/0.8/1100, wood 0.5/0.45/700, steel 0.4/0.85/7850, ice 0.03/0.2/920, stone 0.7/0.15/2600, foam 0.6/0.3/50.
Mass defaults to density × volume (ball = sphere, box = cube) unless set explicitly.
Breakable objects shatter into 4 pieces (which can shatter again) when one impact delivers more energy than their threshold. Impact energy = ½·μ·v², where v is the closing speed along the contact and μ the reduced mass (m for a hit against the floor or a wall). Threshold = toughness × mass, toughness in J/kg: ice 8, foam 15, stone 20, wood 30, rubber 300, steel 1000. Dropping from height h onto the floor delivers about 9.81·h J per kg, so ice breaks from about 0.8 m, stone 2 m, wood 3 m.
When two things touch, friction = sqrt(μ1 × μ2) and bounce = sqrt(e1 × e2). Fixed surfaces use the world friction and bounciness.
Kinetic energy includes spin. Air drag and friction remove energy; so do imperfect bounces.
Key facts for explanations: mass does NOT change how fast things fall, how high they bounce, or how fast they slow down when sliding. Bounce height after an impact is about e² times the drop height (e = combined bounce). Sliding deceleration is μ·g. Only air drag depends on mass (heavier for the same size = less affected). In collisions between objects, mass decides how momentum is shared.
"Energy lost" compares total (kinetic + height) energy at the start and end. An object that gets stuck high up (for example friction holding it on a ramp) keeps its height energy, so a lower energy-lost figure can simply mean things stopped before falling, not that less energy was wasted. Check end positions before interpreting it.`;

// ---------- explain ----------

const EXPLAIN_SYSTEM = `You are the explainer inside ChaosLab. ${LAB_RULES}

You receive measured telemetry from the simulation, sometimes for two runs of the same scene with a listed change, plus a screenshot of the current run.
Explain WHY the result happened or changed, using the real physics principle and quoting the measured numbers you were given.
Rules:
- Only use numbers that appear in the data. Never invent measurements.
- Plain language a curious 15-year-old understands; name the principle (for example energy loss to friction, Galileo's equal-fall result, momentum transfer, static vs sliding friction).
- If the data looks surprising, say what likely caused it (for example a ball that slid before rolling loses energy to friction).
- headline: one short sentence with the main finding.
- explanation: 2 to 4 sentences.
- numbers: 2 to 4 of the most telling measured values. label in plain words (for example "Energy lost", "Peak speed", "Steel ball bounce"), never a field name. before and after are short values with units (for example "8.7 m/s", "95%"). Use "" for before when there is only one run.
- When two runs are given, both are measured over the same first compared_over_first_s seconds. Objects still in the air are not "losing less energy", they just have not landed yet; check still_moving and the per-object data before claiming energy differences.
- try_next: one concrete follow-up experiment the user could run in ChaosLab, phrased as an instruction (for example "Set friction to 0 and rerun"). Stay inside the slider ranges: gravity -1 to 3, friction 0 to 1, bounciness 0 to 1, airDensity 0 to 10, object size 0.08 to 0.6 m.`;

const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    explanation: { type: 'string' },
    numbers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' } },
        required: ['label', 'before', 'after'],
      },
    },
    try_next: { type: 'string' },
  },
  required: ['headline', 'explanation', 'numbers', 'try_next'],
};

async function explain({ data, question, image, provider }) {
  const task = question
    ? `The user asks: "${question}"\nAnswer it using the data below.`
    : data.before
      ? 'Explain why the outcome changed between the two runs.'
      : 'Explain what happened in this run and why.';
  const text = `${task}\n\nTelemetry (JSON):\n${JSON.stringify(data)}`;
  // normal answers take ~7 s; a stalled cloud call falls back to on-device after 25 s
  const out = await generate({ provider, system: EXPLAIN_SYSTEM, text, image, schema: EXPLAIN_SCHEMA, maxTokens: 900, timeoutMs: 25000 });
  return { ...out, result: parseJson(out.text) };
}

// ---------- build (text to scene via function calling) ----------
// Gemma describes the scene (what, where, how arranged); public/layout.js computes every position.

const MATERIAL = { type: 'string', enum: ['rubber', 'wood', 'steel', 'ice', 'stone', 'foam'] };
const SIDE = { type: 'string', enum: ['left', 'center-left', 'center', 'center-right', 'right'], description: 'horizontal zone of the 12 m wide lab' };

const RAMP = {
  type: 'object',
  description: 'A fixed straight ramp.',
  properties: {
    name: { type: 'string', description: 'short id such as "A", used by groups to refer to this ramp' },
    side: SIDE,
    direction: { type: 'string', enum: ['down_right', 'down_left'], description: 'which way it slopes down' },
    angle: { type: 'number', description: 'steepness in degrees, 3 to 75. Use exactly the angle the user gives.' },
    length: { type: 'number', description: 'metres, 2 to 8' },
    top_height: { type: 'number', description: 'height of the high end above the floor, metres (0.5 to 5.5)' },
  },
  required: ['name', 'direction', 'angle', 'length', 'top_height'],
};

const STRUCTURE = {
  type: 'object',
  description: 'A multi-part fixed build whose pieces ChaosLab lines up exactly.',
  properties: {
    type: {
      type: 'string',
      enum: ['ramp_path', 'staircase', 'wall', 'cup', 'funnel'],
      description: 'ramp_path = zigzag of connected ramps a ball rolls all the way down (marble run, maze, pathway); staircase = steps going down; wall = vertical barrier; cup = open box that catches objects; funnel = V shape with a gap at the bottom',
    },
    name: { type: 'string', description: 'id; the ramps of a ramp_path are called <name>1 (top), <name>2, ...' },
    side: SIDE,
    levels: { type: 'integer', description: 'ramp_path: number of ramps, 2 to 7' },
    steps: { type: 'integer', description: 'staircase: number of steps, 2 to 10' },
    angle: { type: 'number', description: 'ramp_path: slope of each ramp in degrees (5 to 45, default 15). Use exactly the angle the user gives.' },
    top_height: { type: 'number', description: 'height of the top in metres' },
    height: { type: 'number', description: 'wall or cup height, or funnel height above the floor, metres' },
    width: { type: 'number', description: 'metres' },
    direction: { type: 'string', enum: ['down_right', 'down_left'], description: 'staircase: which way it goes down' },
    ball_material: { ...MATERIAL, description: 'ramp_path or staircase: put a ball of this material at the top. Use this instead of a separate group.' },
  },
  required: ['type'],
};

const GROUP = {
  type: 'object',
  description: 'One or more identical objects arranged together.',
  properties: {
    shape: { type: 'string', enum: ['ball', 'box'] },
    material: MATERIAL,
    size: { type: 'number', description: 'ball radius or box side in metres, 0.08 to 0.6 (0.2 is a typical ball)' },
    count: { type: 'integer', description: 'how many identical objects, 1 to 40' },
    arrangement: {
      type: 'string',
      enum: ['single', 'row', 'touching_row', 'stack', 'pyramid', 'grid', 'scattered'],
      description: 'row = side by side with gaps; touching_row = side by side touching (Newton\'s cradle); stack = on top of each other; pyramid = stacked triangle',
    },
    place: {
      type: 'string',
      enum: ['floor', 'air', 'top_of_ramp', 'on_ramp', 'bottom_of_ramp'],
      description: 'floor = resting on the floor; air = held at a height then released; top_of_ramp = on the ramp near its high end; on_ramp = partway down; bottom_of_ramp = on the floor just past the low end of the ramp',
    },
    ramp: { type: 'string', description: 'name of the ramp for ramp placements' },
    side: SIDE,
    height: { type: 'number', description: 'for place=air: height of the lowest object above the floor, metres' },
    speed: { type: 'number', description: 'launch speed in m/s (0 = released at rest)' },
    direction: { type: 'string', description: '"left", "right", "up", "down", or an angle in degrees (0 = right, 45 = up and to the right, 90 = up, 135 = up and to the left)' },
    mass: { type: 'number', description: 'kg per object; omit to use the material density (preferred)' },
    breakable: { type: 'boolean', description: 'true if the objects should shatter when hit hard enough' },
  },
  required: ['shape', 'material', 'place'],
};

const WORLD = {
  type: 'object',
  properties: {
    gravity: { type: 'number', description: 'multiple of Earth gravity, -1 to 3: 1 Earth, 0.165 Moon, 0.38 Mars, 2.53 Jupiter, 0 space' },
    friction: { type: 'number', description: 'friction of floor, walls and ramps, 0 to 1 (0.1 default)' },
    bounciness: { type: 'number', description: 'bounce of floor, walls and ramps, 0 to 1 (0.4 default)' },
    airDensity: { type: 'number', description: 'kg/m³: 0 vacuum (Moon, space), 1.2 Earth air, up to 10' },
  },
};

// Class 11 / JEE mechanics apparatus, built exactly by public/apparatus.js with these parameters.
const APPARATUS = {
  type: 'object',
  description: 'A standard mechanics setup with exact parameters. Use it for textbook and JEE-style problems.',
  properties: {
    type: {
      type: 'string',
      enum: ['spring_mass', 'pendulum', 'atwood', 'table_pulley', 'two_pulley_table', 'incline_pulley', 'movable_pulley', 'pulley_system', 'collision_1d', 'projectile', 'incline_block'],
      description: 'spring_mass = block on a spring (k, mass, rest, stretch, damping, mu, orientation 1 vertical / 0 horizontal); pendulum = bob on a string (length, mass, angle in degrees, double 1 for a double pendulum); atwood = two masses over one fixed pulley (m1, m2, height); table_pulley = block m1 on a table with friction mu, string over a pulley at the edge to hanging m2; two_pulley_table = 2 pulleys, 3 blocks: m1 hangs left, m2 on the table (mu), m3 hangs right; incline_pulley = block m1 on an incline (angle, mu) tied over a pulley at the top to hanging m2; movable_pulley = load on a movable pulley (load) lifted by a hanging effort mass (effort), 2 pulleys; pulley_system = block and tackle with 2 to 6 pulleys (pulleys, load, effort), mechanical advantage = pulleys; collision_1d = two blocks on a frictionless track (m1, m2, u1, u2 with right positive, e coefficient of restitution); projectile = launch (speed, angle in degrees, height of launch); incline_block = block on an incline (angle, mu, mass)',
    },
    values: {
      type: 'object',
      description: 'numbers from the problem in SI units; omit any not given',
      properties: Object.fromEntries(['orientation', 'k', 'mass', 'rest', 'stretch', 'damping', 'mu', 'length', 'angle', 'double', 'm1', 'm2', 'height', 'load', 'effort', 'pulleys', 'm3', 'u1', 'u2', 'e', 'speed']
        .map((k) => [k, { type: 'number' }])),
    },
  },
  required: ['type'],
};

const BUILD_TOOLS = [
  {
    name: 'build_scene',
    description: 'Create a new experiment from scratch, replacing the current scene.',
    parameters: {
      type: 'object',
      properties: {
        checklist: {
          type: 'array',
          items: { type: 'string' },
          description: 'Write this FIRST: one short line for every ramp and every kind of object the user asked for, with its position and motion, e.g. "steel ball, floor, left, moving right at 5 m/s". Every line must become exactly one ramp or group below.',
        },
        title: { type: 'string', description: 'short name for the experiment' },
        note: { type: 'string', description: 'one sentence telling the user what to watch for' },
        world: WORLD,
        apparatus: { ...APPARATUS, description: 'use INSTEAD of structures/ramps/groups for spring, pendulum, pulley, collision, projectile and incline problems' },
        structures: { type: 'array', items: STRUCTURE, description: 'ramp paths, stairs, walls, cups, funnels' },
        ramps: { type: 'array', items: RAMP, description: 'single stand-alone ramps only; for connected ramps use a ramp_path structure' },
        groups: { type: 'array', items: GROUP, description: 'every loose object, as groups' },
      },
      required: ['checklist', 'title', 'note'],
    },
  },
  {
    name: 'edit_scene',
    description: 'Change the current experiment: world settings, add ramps or objects, remove or change existing objects by id.',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'one sentence telling the user what changed and what to watch for' },
        world: WORLD,
        add_structures: { type: 'array', items: STRUCTURE },
        add_ramps: { type: 'array', items: RAMP },
        add_groups: { type: 'array', items: GROUP },
        remove_ids: { type: 'array', items: { type: 'integer' } },
        update: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              material: MATERIAL,
              size: { type: 'number' },
              mass: { type: 'number' },
              speed: { type: 'number' },
              direction: { type: 'string' },
              breakable: { type: 'boolean' },
              angle: { type: 'number', description: 'ramps only: new slope in degrees, positive rises to the right, negative falls to the right' },
              length: { type: 'number', description: 'ramps only: new length in metres' },
            },
            required: ['id'],
          },
        },
      },
      required: ['note'],
    },
  },
];

const BUILD_SYSTEM = `You set up physics experiments in ChaosLab, a 2D side-view lab 12 m wide and 6.4 m tall, by calling exactly one tool.
You never give coordinates. You describe ramps and groups of objects; ChaosLab computes exact positions.

Vocabulary:
- side: left, center-left, center, center-right, right.
- place: floor, air (needs height), top_of_ramp, on_ramp, bottom_of_ramp (both need ramp).
- structures (exact multi-part builds): ramp_path (connected zigzag ramps a ball rolls all the way down: marble run, maze, pathway, track), staircase, wall, cup, funnel.
- arrangement: single, row, touching_row, stack, pyramid, grid, scattered (use count for how many).
- speed (m/s) + direction ("left", "right", "up", "down" or degrees: 0 right, 45 up-right, 90 up, 135 up-left).
- materials: rubber, wood, steel, ice, stone, foam. Leave mass out unless the user gives one.
- world: gravity (Earth 1, Moon 0.165, Mars 0.38, space 0), airDensity (Earth 1.2, Moon/space 0), friction and bounciness of the floor and ramps (0 to 1).

Changing the current apparatus: when a current apparatus is given and the request changes it ("add 2 more pulleys", "make m2 heavier", "steeper", "stiffer spring", "double the length"), call build_scene with apparatus giving the type and only the values that change; ChaosLab keeps every other current value. "2 pulleys and 3 blocks" is two_pulley_table. Pulley counts: atwood has 1 pulley, movable_pulley has 2, pulley_system has "pulleys". Adding N pulleys to any pulley setup means pulley_system with pulleys = current count + N (2 to 6), load = the heavier or lifted mass, effort = the hanging mass.

Mechanics problems (Class 11, JEE): ALWAYS put the problem's numbers inside apparatus.values (for example {"type":"atwood","values":{"m1":5,"m2":3}}). If the request is a spring-block, pendulum, Atwood machine, block on a table or incline tied over a pulley, movable pulley, 1D collision, projectile or block on an incline, use apparatus with the numbers from the problem, in SI units, and leave groups empty. If the problem says g = 10 m/s², set world gravity 1.02.

Examples (arguments for build_scene):
"a 2 kg block on a spring of stiffness 200 N/m is pulled 10 cm and released" -> {"title":"Spring-block SHM","note":"...","checklist":["spring_mass k 200, m 2, stretch 0.1"],"apparatus":{"type":"spring_mass","values":{"k":200,"mass":2,"stretch":0.1,"orientation":0}}}
"masses of 5 kg and 3 kg hang over a pulley" -> {"title":"Atwood machine","note":"...","checklist":["atwood m1 5, m2 3"],"apparatus":{"type":"atwood","values":{"m1":5,"m2":3}}}
"a 4 kg block on a 30 degree incline with mu 0.2 is tied over a pulley to a 3 kg hanging mass" -> {"title":"Incline and pulley","note":"...","checklist":["incline_pulley angle 30, m1 4, m2 3, mu 0.2"],"apparatus":{"type":"incline_pulley","values":{"angle":30,"m1":4,"m2":3,"mu":0.2}}}
"a 1 kg ball at 6 m/s hits a 2 kg ball at rest, e = 0.5" -> {"title":"Collision","note":"...","checklist":["collision_1d m1 1, m2 2, u1 6, u2 0, e 0.5"],"apparatus":{"type":"collision_1d","values":{"m1":1,"m2":2,"u1":6,"u2":0,"e":0.5}}}
"two balls collide head-on" -> {"title":"Head-on collision","note":"...","groups":[{"shape":"ball","material":"steel","place":"floor","side":"left","speed":5,"direction":"right"},{"shape":"ball","material":"rubber","place":"floor","side":"right","speed":5,"direction":"left"}]}
"a ball rolls down a ramp into a stack of 3 boxes" -> {"title":"Ramp into a stack","note":"...","ramps":[{"name":"A","side":"left","direction":"down_right","angle":30,"length":5,"top_height":3}],"groups":[{"shape":"ball","material":"steel","place":"top_of_ramp","ramp":"A"},{"shape":"box","material":"wood","count":3,"arrangement":"stack","place":"bottom_of_ramp","ramp":"A"}]}
"Newton's cradle" -> {"title":"Newton's cradle","note":"...","world":{"airDensity":0},"groups":[{"shape":"ball","material":"steel","count":5,"arrangement":"touching_row","place":"floor","side":"center"},{"shape":"ball","material":"steel","place":"floor","side":"left","speed":4,"direction":"right"}]}
"feather vs bowling ball on the Moon" -> {"title":"Moon drop","note":"...","world":{"gravity":0.165,"airDensity":0},"groups":[{"shape":"ball","material":"foam","place":"air","height":4,"side":"center-left"},{"shape":"ball","material":"steel","place":"air","height":4,"side":"center-right"}]}
"a pathway of ramps the ball rolls down" or "a ramp maze" -> {"title":"Ramp path","note":"...","structures":[{"type":"ramp_path","name":"path","levels":4,"ball_material":"steel"}],"groups":[]}
"a ball bouncing down stairs into a cup" -> {"title":"Stairs","note":"...","structures":[{"type":"staircase","steps":5,"direction":"down_right","side":"center-left","ball_material":"rubber"},{"type":"cup","side":"right"}],"groups":[]}
"throw a ball at 45 degrees" -> {"title":"Projectile","note":"...","groups":[{"shape":"ball","material":"rubber","place":"floor","side":"left","speed":8,"direction":"45"}]}

Rules:
- Start with checklist: one line per ramp and per kind of object the user asked for. Then make exactly one ramp or group per line.
- Include every object the user asked for and nothing else. One group per distinct kind of object; never repeat a group.
- Use exactly the angles, heights, speeds and counts the user gives. To change an existing ramp's angle or length, use edit_scene update with its id.
- For a more complex or harder maze, use 6 or 7 levels. Each build gives a new layout.
- Anything with several connected ramps (path, track, maze, zigzag, marble run) is ONE ramp_path structure, never separate ramps.
- Give every group a side unless it is placed on or at a ramp. Things that move toward each other start on opposite sides.
- Use build_scene for a new experiment. Use edit_scene when the request refers to the current scene ("it", "the ball", "didn't", "make it", "more", "again", "faster"): the current scene, the previous requests and what happened in the last run are given, so fix the actual problem.
- Set breakable true only when the user mentions breaking, shattering, smashing or fragile things.
- note: one sentence on what to watch for.`;

// ---------- predict-then-run challenges ----------
// Gemma designs a scene and a question; the answer is measured by running the simulation,
// never decided by the model.

const CHALLENGE_TOOL = {
  name: 'make_challenge',
  description: 'Create a predict-then-run physics challenge.',
  parameters: {
    type: 'object',
    properties: {
      checklist: BUILD_TOOLS[0].parameters.properties.checklist,
      title: { type: 'string', description: 'short catchy title' },
      question: { type: 'string', description: 'the question shown to the player, matching question_type, e.g. "Which ball hits the floor first?"' },
      question_type: {
        type: 'string',
        enum: ['first_to_floor', 'farthest', 'highest_bounce', 'which_shatters'],
        description: 'first_to_floor = which object first touches the floor; farthest = which object ends furthest from where it started, horizontally; highest_bounce = whose first bounce is highest; which_shatters = which breakable objects shatter',
      },
      concept: { type: 'string', description: 'the physics idea being tested, e.g. "mass does not change fall time"' },
      world: BUILD_TOOLS[0].parameters.properties.world,
      structures: BUILD_TOOLS[0].parameters.properties.structures,
      ramps: BUILD_TOOLS[0].parameters.properties.ramps,
      groups: {
        type: 'array',
        items: GROUP,
        description: '2 to 4 single objects (count 1 each) that the question compares, each with its own side',
      },
    },
    required: ['checklist', 'title', 'question', 'question_type', 'concept', 'groups'],
  },
};

const CHALLENGE_SYSTEM = `You design short predict-then-run challenges for ChaosLab, a 2D physics lab. The player guesses the outcome, then the simulation runs and measures the real answer.
Pick setups where everyday intuition is often WRONG, so the result teaches something. Good ideas:
- heavy vs light balls dropped together (same time without air; with thick air the light, large one is slower)
- bounce height depends on material, not mass (steel bounces high, stone barely)
- a rolling ball vs a sliding box down identical ramps; friction on ice vs rubber
- the same drop on the Moon vs Earth; thick air vs vacuum
- breakable ice vs stone vs wood dropped from the same height (which_shatters)
- objects launched at different angles or speeds (farthest)
Rules:
- Use 2 to 4 single objects (count 1), each its own group with its own side (left, center-left, center, center-right, right), so they are easy to tell apart. Give them different materials (or sizes) so the question has a real answer.
- Match the scene to question_type: first_to_floor and highest_bounce need objects in the air (place air with a height) or on ramps; farthest needs launches or ramps; which_shatters needs breakable true and a drop of 1 to 5 m.
- Describe the scene in the same vocabulary as scene building (world, structures, ramps, groups); never give coordinates.
- question: one short neutral question. Never include hints, explanations or the answer in it (the concept field is for the physics idea, shown only after the reveal).
- The world must really contain what the challenge is about: thick air means airDensity 8 to 10, no air means airDensity 0, the Moon means gravity 0.165 and airDensity 0.
- Leave mass out so the material decides it, unless the challenge is about mass.
- Make each challenge different from the recent ones listed.`;

async function challenge({ provider, recent = [] }) {
  const started = Date.now();
  const text = `Recent challenges (avoid repeating them): ${recent.length ? recent.slice(-6).join('; ') : 'none'}.

Create a new challenge.`;
  let out;
  try {
    out = await (provider === 'local' ? generate : gemini)({ provider, system: CHALLENGE_SYSTEM, text, tools: [CHALLENGE_TOOL], maxTokens: 700, timeoutMs: 18000, temperature: 0.9 });
    if (provider !== 'local') out = { ...out, provider: 'cloud', ms: Date.now() - started };
  } catch {
    out = null;
  }
  if (!out?.call) out = { ...(await generate({ provider, system: CHALLENGE_SYSTEM, text, tools: [CHALLENGE_TOOL], maxTokens: 700, timeoutMs: 18000, temperature: 1 })), ms: Date.now() - started };
  if (!out.call) throw new Error('Gemma could not make a challenge. Try again.');
  console.log(`[challenge] ${out.provider} ${out.ms} ms -> ${JSON.stringify(out.call.args)}`);
  return out;
}

async function build({ prompt, scene, image, provider, history = [], outcome = null, apparatus = null }) {
  const started = Date.now();
  // Follow-ups ("the ball didn't reach the bottom") need to know what came before and what happened.
  const parts = [`Current scene (JSON):\n${JSON.stringify(describeScene(scene))}`];
  if (history.length) parts.push(`Previous requests in this session, oldest first:\n${history.slice(-3).map((h) => `- "${h.prompt}" -> ${h.result}`).join('\n')}`);
  if (outcome) parts.push(`What happened in the current run (measured):\n${JSON.stringify(outcome)}`);
  if (apparatus) parts.push(`Current apparatus (to change it, call build_scene with apparatus and only the changed values):\n${JSON.stringify(apparatus)}`);
  parts.push(`Request: ${prompt}`);
  const text = parts.join('\n\n');
  // Gemma sometimes loops, repeating groups until it runs out of tokens. Cap the output and the
  // wait, and retry once at a different temperature, which usually breaks the loop.
  let out;
  try {
    out = await (provider === 'local' ? generate : gemini)({ provider, system: BUILD_SYSTEM, text, image, tools: BUILD_TOOLS, maxTokens: 600, timeoutMs: 18000, temperature: 0.2 });
    if (provider !== 'local') out = { ...out, provider: 'cloud', ms: Date.now() - started };
  } catch {
    out = null; // the second attempt falls back to on-device if the cloud is still unavailable
  }
  if (!out?.call) {
    out = await generate({ provider, system: BUILD_SYSTEM, text, image, tools: BUILD_TOOLS, maxTokens: 600, timeoutMs: 18000, temperature: 0.8 });
    out = { ...out, retried: true, ms: Date.now() - started };
  }
  if (!out.call) throw new Error('Gemma did not return a scene. Try rephrasing the request.');
  normaliseApparatus(out.call.args);
  console.log(`[build] ${out.provider} ${out.ms} ms "${prompt}" -> ${out.call.name} ${JSON.stringify(out.call.args)}`);
  return out;
}

// Gemma often puts the numbers straight on the apparatus instead of in "values", or uses a
// near-miss name; accept both so the problem's numbers are never lost.
const APPARATUS_ALIASES = { double_pendulum: ['pendulum', { double: 1 }], simple_pendulum: ['pendulum', {}], spring: ['spring_mass', {}], spring_block: ['spring_mass', {}], atwood_machine: ['atwood', {}], collision: ['collision_1d', {}], projectile_motion: ['projectile', {}], incline: ['incline_block', {}], block_and_tackle: ['pulley_system', {}], two_pulley: ['two_pulley_table', {}] };
function normaliseApparatus(args) {
  const a = args && args.apparatus;
  if (!a || typeof a !== 'object') return;
  const values = { ...(a.values || {}) };
  for (const [k, v] of Object.entries(a)) if (k !== 'type' && k !== 'values' && typeof v === 'number') values[k] = v;
  let type = a.type;
  if (APPARATUS_ALIASES[type]) { Object.assign(values, APPARATUS_ALIASES[type][1]); type = APPARATUS_ALIASES[type][0]; }
  args.apparatus = { type, values };
}

// A short, readable version of the scene so edits can refer to ids and ramp names.
function describeScene(scene) {
  if (!scene || !scene.bodies) return scene;
  return {
    world: scene.world,
    objects: scene.bodies.map((b) => (b.shape === 'plank'
      ? { id: b.id, ramp: b.name || `#${b.id}`, angle: b.angle, length: b.length, x: b.x, y: b.y }
      : { id: b.id, shape: b.shape, material: b.material, size: b.size, mass: b.mass, x: b.x, y: b.y, vx: b.vx, vy: b.vy, breakable: !!b.breakable })),
  };
}

// ---------- providers ----------

async function generate({ provider = 'cloud', ...req }) {
  const started = Date.now();
  if (provider === 'local') return { ...(await ollama(req)), provider, ms: Date.now() - started };
  try {
    return { ...(await gemini(req)), provider, ms: Date.now() - started };
  } catch (e) {
    // Free-tier Gemini allows ~16k input tokens a minute, and occasionally fails or stalls.
    // Fall back to the on-device model so the user still gets an answer.
    const reason = e.rateLimited ? 'Cloud rate limit reached' : e.serverError ? 'Cloud Gemma had a server error' : /timed out/.test(e.message) ? 'Cloud Gemma timed out'
      : /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(e.message + (e.cause?.code || '')) ? 'Could not reach the Gemini API' : null;
    if (reason && (await status()).local) {
      const out = await ollama(req);
      return { ...out, provider: 'local', fallback: `${reason}, answered on-device`, ms: Date.now() - started };
    }
    throw e;
  }
}

// Gemma 4 on the Gemini API accepts thinking levels 'minimal' (~2 s) and 'high' (~25 s, too slow live).
async function gemini({ system, text, image, schema, tools, thinking = 'minimal', maxTokens, timeoutMs = 60000, temperature }) {
  const key = apiKey();
  if (!key) throw new Error('No GEMINI_API_KEY found in .env. Switch to on-device mode or add a key.');
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: 'image/jpeg', data: image } });
  parts.push({ text });
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: temperature ?? 0.4,
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      thinkingConfig: { thinkingLevel: thinking },
    },
  };
  if (schema) Object.assign(body.generationConfig, { responseMimeType: 'application/json', responseSchema: schema });
  if (tools) {
    body.tools = [{ functionDeclarations: tools }];
    body.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
  }
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${CLOUD_MODEL}:generateContent`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) },
    timeoutMs,
  );
  const json = await res.json();
  if (res.status === 429) {
    const wait = (json.error?.message || '').match(/retry in ([d.]+)s/i);
    const err = new Error(`Cloud Gemma is rate-limited (free tier). Try again in ${wait ? Math.ceil(Number(wait[1])) : 60} s, or switch to On-device.`);
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Gemini API ${res.status}: ${json.error?.message || 'request failed'}`);
    err.serverError = res.status >= 500;
    throw err;
  }
  const outParts = (json.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought);
  const fc = outParts.find((p) => p.functionCall)?.functionCall;
  return {
    model: CLOUD_MODEL,
    text: outParts.map((p) => p.text || '').join(''),
    call: fc ? { name: fc.name, args: fc.args || {} } : null,
  };
}

async function ollama({ system, text, image, schema, tools, maxTokens, temperature }) {
  const body = {
    model: LOCAL_MODEL,
    stream: false,
    think: false,
    keep_alive: '30m',
    options: { temperature: temperature ?? 0.4, num_ctx: 8192, ...(maxTokens ? { num_predict: maxTokens } : {}) },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text, ...(image ? { images: [image] } : {}) },
    ],
  };
  if (schema) body.format = schema;
  if (tools) body.tools = tools.map((f) => ({ type: 'function', function: f }));
  let res;
  try {
    res = await fetchWithTimeout(`${OLLAMA}/api/chat`, { method: 'POST', body: JSON.stringify(body) }, 180000);
  } catch (e) {
    throw new Error(`Ollama is not reachable at ${OLLAMA}. Start it with "ollama serve". (${e.message})`);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${json.error || 'request failed'}`);
  const tc = json.message?.tool_calls?.[0]?.function;
  return {
    model: LOCAL_MODEL,
    text: json.message?.content || '',
    call: tc ? { name: tc.name, args: typeof tc.arguments === 'string' ? parseJson(tc.arguments) : tc.arguments } : null,
  };
}

async function status() {
  let local = false;
  try {
    const res = await fetchWithTimeout(`${OLLAMA}/api/tags`, {}, 1500);
    const json = await res.json();
    local = (json.models || []).some((m) => m.name === LOCAL_MODEL);
  } catch { /* not running */ }
  return { cloud: !!apiKey(), local, cloudModel: CLOUD_MODEL, localModel: LOCAL_MODEL };
}

// Warm the local model so the first on-device answer isn't slowed by loading it.
async function warmLocal() {
  try {
    await fetchWithTimeout(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: LOCAL_MODEL, prompt: '', keep_alive: '30m' }) }, 180000);
    return true;
  } catch { return false; }
}

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`timed out after ${ms / 1000} s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { explain, build, challenge, status, warmLocal };

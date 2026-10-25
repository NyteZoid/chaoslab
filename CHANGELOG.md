# Changelog

All notable changes to ChaosLab. Newest first.

## 0.11.0 (2026-10-25): Grounded scene building

- Gemma is shown the solved problems most similar to each request (data/examples.json, 19 worked mappings), so new wordings map like known ones.
- If Gemma leaves numbers from the problem unused, it is asked once more and the answer that uses more of the problem is kept (e.g. a dropped 24 N push is recovered).
- Planets and moons use real surface gravity and air density from NASA fact sheets (Mercury to Pluto, Titan, Europa, Io, Ganymede, Callisto).
- Fine-tuning data generator: labelled sentence → build_scene call → textbook answer, 2,000 examples in data/finetune.jsonl.

## 0.10.0 (2026-10-25): Newton's-laws problems

- New apparatus from the NLM question bank: block pushed or pulled by a force at any angle with friction (normal force N = mg − F sin θ), or sliding to a stop; two blocks in contact pushed together. Textbook predictions match the simulation exactly in tests (e.g. 0.77, 0.11, 2.98, 3.92, 1.55 m/s²).
- Applied forces drawn as labelled arrows; friction accounts for an angled pull lifting the block.
- Gemma 4 maps these problems to the new apparatus (tested: pushed crate, contact blocks, angled pull with friction).
- Live acceleration is measured by a least-squares fit of position over time, accurate for slow and fast systems alike.

## 0.9.2 (2026-10-25): No more accidental panning

- Dragging the background no longer pans the view (it often happened when trying to grab something). Zoom stays, but the view always stays over the lab and cannot zoom out past 100%, so no blank space appears.

## 0.9.1 (2026-10-25): UI polish inspired by PhET and Algodoo

- Vertical tool rail beside the canvas, grouped into Objects, Mechanics and Move (Algodoo-style).
- PhET-style time controls under the canvas: rerun, large play/pause, step forward 1/10 s, Normal/Slow speed.
- Values switch labels every moving object with its speed.
- Apparatus and Telemetry panels can be collapsed.

## 0.9.0 (2026-10-25): Varied mazes, easier building, tested on JEE problems

- Mazes differ on every build (seeded layouts) and have a complexity setting: uneven ramp lengths and slopes, and holes the ball drops through. A maze where the ball would get stuck is rebuilt automatically; 36/36 random mazes tested reach the bottom.
- Strings, springs and ropes: the scene pauses while you build and takes the current layout as the start; an empty second click hangs a new bob or block; Enter ends a rope with a new block.
- Simulator self-test (public/selftest.js): 200 random JEE-style problems across all apparatus, 192 match the textbook answer.
- Gemma: apparatus numbers accepted whether or not they are inside "values"; aliases such as double_pendulum understood. Tested on 40 JEE-style wordings.

## 0.8.1 (2026-10-25): Pulley discs, two-pulley three-block apparatus

- New Pulley tool: place stand-alone pulley discs anywhere, drag them in Grab mode (ropes re-route), right-click to delete. The Pulley rope tool snaps onto discs and wraps the rope around both sides of each wheel.
- New apparatus: two pulleys, three blocks (m₁ hanging, m₂ on a table with friction, m₃ hanging), with direction, acceleration and both tensions predicted; Gemma maps "2 pulleys and 3 blocks" to it.
- Full screen view removed.

## 0.8.0 (2026-10-25): Build-your-own mechanics, full screen, cleaner layout

- New tools usable in any scene, including an empty one: Spring (set stiffness, natural length, damping), String (pendulums) and Pulley rope over as many pulleys as you click.
- Pulleys and spring/string anchors can be dragged in Grab mode; the coordinates of the cursor and of whatever is under it (pulley, anchor, object, ramp) are shown live.
- View bar on the canvas: play/pause, rerun, zoom in/out (also mouse wheel), reset view, grid spacing (1 m, 0.5 m, 0.25 m, 2 m, off) and full screen; keyboard: + − 0 G.
- Runs moved into a History drawer opened from the header; World and Next object settings moved under the canvas.

## 0.7.1 (2026-10-25): Gemma remembers the apparatus; pulley systems

- The current apparatus and its settings are sent with every request, so follow-ups such as "add 2 more pulleys" or "make the load 15 kg" change it instead of rebuilding from scratch. Values not mentioned are kept.
- New pulley system (block and tackle) apparatus with 2 to 6 pulleys; mechanical advantage, balance mass, accelerations and tension predicted and measured.
- Rope ends can attach off-centre on a body; loads can be kept from rotating.
- Acceleration is now measured from positions at three times (like ticker tape), which is robust to the jolt when a rope goes taut.

## 0.7.0 (2026-10-25): Class 11 mechanics apparatus

- New physics: springs (Hooke's law with damping, elastic energy in telemetry), rods for pendulums, and ideal ropes over fixed and movable pulleys (inextensible, can go slack).
- Apparatus panel with nine setups and every parameter adjustable: spring–block (vertical/horizontal), pendulum (single/double), Atwood machine, block on table + pulley, block on incline + pulley, movable pulley, 1D collision, projectile, block on incline.
- Each shows the textbook prediction and the value measured live from the simulation; all nine agree within a few per cent (most exactly).
- Gemma maps Class 11 / JEE-style problems to an apparatus with the numbers from the question (including g = 10 m/s²).
- Collisions between moving objects now use the textbook impulse with e (Matter.js lost restitution for flat faces).
- Per-object friction and bounce overrides.

## 0.6.0 (2026-10-25): Predict-then-run challenges

- "Challenge me" in the Gemma panel: Gemma 4 designs a scene and a neutral question (which hits the floor first, travels farthest, bounces highest, or shatters) through a `make_challenge` function call.
- The answer is measured, not guessed: ChaosLab runs the scene ahead invisibly and scores the options from the physics. Challenges without one clear answer are regenerated.
- The player picks, the experiment runs live, and the reveal shows the measured numbers, the concept, and Gemma's explanation of why, including the intuition behind a wrong guess. Score kept per session.

## 0.5.0 (2026-10-25): Exact ramp angles, black and red theme

- Click any ramp (including ones Gemma builds) to edit it: exact angle and length by slider or typed value, or delete it. Objects resting on it move with it.
- Every ramp shows its angle on the canvas; the selected one is outlined.
- Ramp tool angle range widened to ±80° with exact entry; Gemma can change existing ramps' angles and uses stated angles exactly.
- New colour scheme: black background with red accents across the UI, canvas, chart and icons.

## 0.4.0 (2026-10-25): Gemma understands paths, mazes and follow-ups

- Structures built exactly by code: ramp_path (connected zigzag marble run with bumper walls), staircase, wall, cup and funnel. Gemma names the structure; `layout.js` lines up every piece.
- Follow-up requests now send the previous requests, what happened in the current run and a screenshot, so "the ball didn't reach the bottom" fixes the current scene.
- Ramp paths and stairs are checked by running the physics ahead invisibly; the answer says whether the ball reaches the bottom.
- The answer card shows "What Gemma understood" (its checklist).
- Cloud network failures also fall back to on-device Gemma.
- Compared Gemma 4 31B with 26B A4B: 31B was 2 to 4 times slower and hit "high demand" errors, so 26B A4B stays.

## 0.3.1 (2026-10-25): Event rulebook compliance

- README: models used with licence links, exact Gemini API integration, libraries and services, honest credit for the AI coding tool used and which parts it produced, team members.
- Footer links Gemma 4 and its licence, Matter.js, and the source repository.

## 0.3.0 (2026-10-25): Gemma 4 integration, fracture

- Ask Gemma 4 panel: build scenes from text with function calling, explain runs from measured telemetry plus a canvas screenshot.
- Gemma describes scenes in terms of groups, sides and ramps; `layout.js` computes exact positions. A checklist-first tool argument stops missing objects.
- Cloud (Gemma 4 26B via the Gemini API) and on-device (Gemma 4 E4B via Ollama) modes, with automatic fallback to on-device on rate limits, server errors and timeouts.
- Breakable objects: shatter into simulated fragments when impact energy exceeds toughness × mass. New Shatter test preset.
- Real quadratic air drag (air density slider, kg/m³) replaces uniform damping.
- Smoother rolling (160-sided balls), per-step peak tracking, run comparisons over equal time windows.

## 0.2.0 (2026-10-25): Look and feel

- Pseudo-3D renderer: shaded spheres, extruded boxes and ramps, floor shadows, starfield backdrop with the metre grid.
- Six materials with friction, bounce, density and toughness.
- Impact effects and synthesised impact sounds, both switchable.
- UI restyled to a single design system: 4-point spacing, two typefaces, one corner radius, SVG icons, meta tags, favicon and share image.

## 0.1.0 (2026-10-25): Physics sandbox

- Matter.js sandbox with balls, boxes and ramps, five presets, world sliders and auto-rerun.
- Telemetry: energy, speed, momentum, collisions and settle time per run, with a chart comparing runs.
- Custom Coulomb friction calibrated against textbook values.

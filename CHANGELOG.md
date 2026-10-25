# Changelog

All notable changes to ChaosLab. Newest first.

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

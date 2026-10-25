# Changelog

All notable changes to ChaosLab. Newest first.

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

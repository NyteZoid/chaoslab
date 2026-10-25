# OrganizerHQ submission (copy into the form)

**Project link:** https://github.com/NyteZoid/chaoslab

**Project name:** ChaosLab

**Challenges to tick:** Best Use of Gemma 4 · Best Open-Source AI Project

**Demo URL:** leave empty (we demo from the laptop), or paste the current Cloudflare tunnel link if it is still running.

---

**Description:**

ChaosLab is a browser physics lab for students. Describe an experiment or paste a Class 11 / JEE mechanics problem in plain words: Gemma 4 builds it, the simulation runs it, and Gemma explains the result using the numbers the simulation actually measured.

What it does:
- Text to scene with Gemma 4 function calling: balls, boxes, ramps, ramp mazes, springs, pendulums, pulleys and ropes. Gemma describes the scene; our code computes exact geometry, which makes the scenes reliable.
- Nine Class 11 mechanics apparatus (spring–block, pendulum, Atwood machine, block on table or incline with pulleys, two-pulley three-block system, pulley systems up to 6 pulleys, 1D collisions, projectiles, inclines). Every parameter is adjustable, and each shows the textbook prediction next to the value measured live. Tested on 200 random problems: 192 match the textbook answer.
- Grounded explanations: Gemma 4 receives the measured telemetry of two runs plus a screenshot of the canvas (multimodal input, JSON output) and explains why the result changed.
- Predict-then-run challenges: Gemma designs a question where intuition often fails; the correct answer is measured by the simulation, never decided by the model.
- Build-your-own tools: place pulleys, run ropes over them, add springs and strings, drag them, read coordinates.
- Physics corrected to textbook behaviour: Coulomb friction, quadratic air drag, proper rolling, correct coefficients of restitution, breakable objects.
- Works offline: the same features run on-device with Gemma 4 E4B through Ollama, and the app falls back to it automatically when the cloud API is rate-limited.

How it uses Gemma 4: gemma-4-26b-a4b-it through the Gemini API generateContent endpoint (function calling, image input, response schema), with Gemma 4 E4B on Ollama as the on-device fallback. Both are open-weight under Apache 2.0. The code is MIT-licensed.

AI tools used to build it: Claude Code (Anthropic, Claude Opus 5.5) wrote most of the code and documentation under our direction; the team chose the idea, directed every feature, set the design guidelines, and tested and reported problems throughout. Details are in the README.

---

**Technologies used:**
Gemma 4, Gemini API, Ollama, JavaScript, Node.js, Matter.js, HTML Canvas, Web Audio API, Cloudflare Tunnel

---

## Checklist before pressing Submit
- [ ] Signed in with the account used to register; one member submits for the team.
- [ ] Both challenges ticked.
- [ ] Repository is public and stays public after the event.
- [ ] AI tools credited in the description (above) and in the README.
- [ ] All four members are registered and checked in.
- [ ] Submitted before 5:00 PM.

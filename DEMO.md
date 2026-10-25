# ChaosLab: 5-minute demo script

Judges score seven things equally: technical implementation, use of open-source AI, design and UX, creativity, usefulness, learning and ambition, and demo clarity. Every beat below is aimed at one or more of them. Show the working app; no slides.

**Before you start (2 minutes before your slot)**
- Laptop plugged in, Chrome on http://localhost:3000, browser zoom 100%, window maximised.
- Cloud mode selected in the Gemma panel. Do not fire Gemma requests faster than one every 10 seconds (free-tier limit).
- Load the preset **Drop test: foam vs wood vs steel** and press Rerun once so the History has a run.
- Sound on, volume low. Values switch off.
- Decide who drives the laptop and who talks. One person drives the whole time.

---

## 0:00 – 0:30 · The problem (talker)
> "Physics students learn F = ma from equations, but they rarely get to *test* an idea: what if gravity were weaker, what if the ramp were ice? ChaosLab is a physics lab in the browser where you describe an experiment in plain words, Gemma 4 builds it, the simulation runs it, and Gemma explains what happened using the numbers the simulation actually measured."

## 0:30 – 1:30 · Change one variable, see why (driver + talker)
1. Drop test is on screen. Press play: foam, wood and steel balls land **at the same moment**, then bounce to different heights.
2. Drag **Air density** from 0 to 10 and release. It reruns automatically; the chart overlays the old run as a dashed line.
3. Click the chip **"Why did run … differ from run …?"**
> "Gemma 4 gets the measured data from both runs plus a screenshot of the canvas, and explains with real numbers: the foam ball's peak speed dropped, the steel ball barely changed, because drag matters most for light, wide objects."

*Rubric: use of open-source AI (multimodal input, grounded output), usefulness.*

## 1:30 – 2:45 · Type a JEE problem (driver types, talker narrates)
Type exactly:
> `A 4 kg block on a rough 37 degree incline with mu 0.25 is connected over a smooth pulley to a hanging 5 kg mass. Take g = 10.`

Press Build scene.
> "Gemma 4 reads the problem and calls a function to build it: an incline, a pulley and two blocks with exactly those numbers. The panel shows the textbook prediction, 2.0 m/s², and the simulation measures the same value live."

Point at **Textbook prediction** and **Measured: a = …** in the Apparatus panel. Wait about 10 seconds, then type:
> `make the incline 50 degrees`

> "It remembers the setup and changes only what we asked for: the angle, not the masses or friction."

*Rubric: technical implementation, usefulness for students, use of AI.*

## 2:45 – 3:30 · Predict, then run (talker invites a judge)
Click **Challenge me: predict, then run**.
> "Gemma designs a challenge where intuition often fails. Would you like to guess?"

Let a judge pick. The scene runs and the reveal shows the measured answer, then Gemma explains the misconception.
> "Important detail: the correct answer is never decided by Gemma. We run the physics ahead invisibly and measure it, so the model can't get it wrong."

*Rubric: creativity, design/UX, demo clarity.*

## 3:30 – 4:15 · Build anything (driver)
1. Click **Clear**.
2. Rail → **Pulley**: click twice near the top to place P1 and P2.
3. Rail → **Box**: drop two boxes.
4. Rail → **Rope**: click box 1, P1, P2, box 2. It runs.
5. Rail → **Grab**: drag P1 somewhere else; the rope re-routes and the corner readout shows its coordinates.
6. Optional: type `make a complex ramp maze` and show the generated marble run with the "ball reaches the bottom" check.

*Rubric: technical implementation, ambition.*

## 4:15 – 5:00 · How it works and what we learned (talker)
> "Three things we learned today:
> 1. Language models are bad at coordinates. So Gemma never places objects; it describes them, and our code computes exact geometry. That took scene accuracy from roughly half right to nearly all right.
> 2. Physics engines cut corners. Matter.js friction, rolling and collisions didn't match textbooks, so we replaced them. We tested 200 random JEE-style problems and 192 match the textbook answer.
> 3. Gemma 4 runs in the cloud through the Gemini API, and also on this laptop with Ollama when we're offline or rate-limited. It's open-weight, and the whole project is MIT-licensed on GitHub."

End on the screen with a simulation running.

---

## Likely questions (3 minutes)

**Which model and how do you call it?** Gemma 4 26B A4B (`gemma-4-26b-a4b-it`) through the Gemini API `generateContent`. Function calling for building scenes and challenges, image input plus a JSON response schema for explanations. Fallback: Gemma 4 E4B through Ollama. Show `gemma.js`.

**How do you stop the model making things up?** Explanations only receive measured telemetry and per-object results, and the prompt forbids inventing numbers. Challenge answers are measured by the simulation, not the model.

**How accurate is the physics?** Friction, air drag and collisions follow textbook laws (our own code on top of Matter.js). 192 of 200 random problems match the formula within 8%. The known weak spots are slow creep in a few friction-held, two-rope setups, and projectiles that would fly above the 6.4 m ceiling.

**What did AI tools do?** Claude Code (Anthropic) wrote most of the code under our direction; we chose the idea, directed every feature, tested and reported problems. It's credited in the README. Be ready to explain any file a judge points to; `public/layout.js` (scene geometry) and `public/links.js` (springs, ropes, pulleys) are good ones to know.

**What doesn't it do yet?** Rotating rigid bodies such as rolling discs on wedges, moving wedges, circular-motion apparatus, and pulley systems beyond the built-in ones and hand-built ropes.

**If something breaks:** press Rerun. If Gemma is slow or rate-limited, the answer card says "answered on-device"; carry on with a preset or the Apparatus panel, which need no AI.

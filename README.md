# Cyber-Parry Arena

A fast 2D top-down arena action prototype built with **TypeScript, Vite and HTML5 Canvas**. No external assets: all visuals are drawn procedurally and all sound is synthesised with WebAudio.

Deflect sniper rail shots back at their owners, stun melee lunges with a perfectly timed parry, dash through enemy lines, and flank shielded Aegis units before the waves overwhelm you.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit + production bundle in dist/
npm run typecheck
```

## Controls

| Input | Action |
| --- | --- |
| `WASD` / Arrows | Move (snappy accel / friction, normalised diagonals) |
| `Space` / `Shift` | Dash: directional burst, i-frames, damages enemies you pass through (not through a shield) |
| `Right-Click` / `E` | Parry: 180 ms active window, then recovery if missed |
| `Left-Click` | Slash toward the cursor (100 ms input buffer) |
| `P` / `Esc` | Pause |
| `R` | Instant full restart |
| `F1` | Debug HUD and AI inspector |
| `M` | Mute |

Parry rules:
- A parried **projectile** flips ownership, leaves at 2x speed (min 1200 px/s) along your aim with a gentle homing assist, and deals double damage.
- A parried **melee lunge / bash** interrupts the attacker and stuns it for 1.5 s (an Aegis drops its shield while stunned).
- Each parry fills the meter; at 100 your next slash is an **Overcharge**: wider, stronger, and it ignores shields.
- A *successful* parry has a tiny recovery and can be **dash-cancelled**; a missed one cannot.

## Architecture

```
src/
  core/      generic, game-agnostic building blocks
    EventBus.ts       strongly typed pub/sub
    ObjectPool.ts     generic pool (acquire / release / releaseAll / sweep, active & free counts)
    StateMachine.ts   FSM with adjacency table, guards, enter/update/exit hooks
    Rng.ts            seeded mulberry32 (deterministic runs)
    math.ts
  sim/       pure simulation: NO DOM / Canvas / WebAudio imports
    World.ts          authoritative state, per-tick pipeline, combat resolution
    Player.ts         player + FSM states
    Enemy.ts          enemy data + steering helpers
    ai/               Utility AI: UtilityBrain.ts, rusher.ts, sniper.ts, aegis.ts
    Waves.ts          budget-based wave director
    Collision.ts      arena / pillar collision, swept tests, LOS, raycast
    config.ts         constants + live-tunable `Tuning`
    events.ts         the typed event map
  render/    presentation only
    Renderer.ts       canvas drawing, letterboxing, interpolation
    Fx.ts             pooled particles / rings / text / ghosts, driven by events
    Camera.ts         trauma-based shake
  audio/SoundEngine.ts  procedural WebAudio SFX
  ui/        Input.ts (DOM -> InputState), Hud.ts, DebugOverlay.ts
  Game.ts    composition root + fixed-timestep loop
```

### Boundary discipline

`src/sim` only ever sees a plain `InputState` and emits typed events. It never touches the DOM, canvas or audio, so it can be driven headlessly (the sim runs identically from a devtools console or a test harness: `window.game.world.step(1/60, input)`).

### Fixed timestep

`Game.advance` uses an accumulator: the simulation steps at exactly `1/60 s`, real frame time is clamped to `0.05 s` so tab-switches or hitches never cause tunnelling, and the renderer interpolates between the previous and current tick (`px/py` to `x/y`) so motion stays smooth on high-refresh displays. Fast projectiles use **swept segment-vs-circle** tests, so a 1800 px/s reflected shot cannot skip through a target.

### Deterministic simulation

All sim randomness comes from a seeded `Rng`. `world.reset(seed)` followed by identical inputs yields identical results (verified: two runs of 1500 ticks with the same seed produce identical score, kills, position and enemy count; a different seed diverges). The seed is shown in the debug panel.

### Object pooling

`ObjectPool<T>` backs projectiles (sim) and particles, shockwave/slash rings, floating callouts and dash ghosts (render). Items are re-initialised by a reset function on `acquire`, so no state leaks between uses. The debug panel shows active / free / ever-created counts per pool. Particle count is hard-capped so a chaotic wave cannot spike allocation.

### Typed EventBus

`ENTITY_PARRIED`, `ENTITY_DAMAGED`, `ENEMY_KILLED`, `PLAYER_DIED`, `WAVE_STARTED`, `WAVE_CLEARED`, plus `PLAYER_DASHED`, `PLAYER_SLASH`, `SNIPER_CHARGE`, `SNIPER_FIRED`, `SHIELD_BLOCK`, and others. The simulation emits; Fx, camera shake, hit-stop and audio subscribe. Listeners are registered once in the `Game` constructor, so `R` can never duplicate subscriptions (verified via `bus.listenerCount()` before and after restarts).

## Player FSM

States: `Idle`, `Move`, `Dash`, `Parry`, `Hitstun`, `Dead`, each with `enter / update / exit` hooks (`core/StateMachine.ts`).

```
Idle    -> Move, Dash, Parry, Hitstun, Dead
Move    -> Idle, Dash, Parry, Hitstun, Dead
Dash    -> Idle, Move, Dead                    (i-frames cover the whole dash)
Parry   -> Idle, Move, Dash*, Hitstun, Dead    (*only after a successful parry)
Hitstun -> Idle, Move, Dead
Dead    -> (terminal)
```

Illegal requests are rejected and counted (visible in the debug panel). Responsiveness aids: a 100 ms buffer for attack, dash and parry presses; hit grants 1.1 s of i-frames; parry success grants a short i-frame window.

## Utility AI

Each archetype owns a list of **actions**. Every ~0.2-0.35 s (or when an action finishes) every action scores itself from a shared context (distance, line-of-sight, whether the enemy is in the player's blind spot, nearest ally Sniper, cooldowns, patience since the last attack). The highest score wins, with a small hysteresis bonus for the current action so decisions do not flicker. Telegraphed attacks are *committed* (non-interruptible) until stunned.

| Archetype | Actions | Notes |
| --- | --- | --- |
| **Rusher** | Approach, Flank, Strafe, Lunge | Circles toward the player's blind spot; lunge score rises with `behind` and with a patience term so it eventually attacks head-on. 0.5 s windup (aim tracks, then locks) -> dash -> recovery. |
| **Sniper** | Reposition, SeekLOS, Strafe, Snipe | Keeps a 330-640 px band, flees along walls, seeks line-of-sight around pillars. 0.9 s laser charge; aim stops tracking for the last 0.25 s, leaving a parry/dodge window. |
| **Aegis** | Guard, Advance, Hold, Bash | Interposes between the player and the nearest Sniper, shield turn-rate limited (2.4 rad/s) so flanking works. Shield arc blocks player slashes, dashes and reflected shots from the front. |

Press `F1` to see each enemy's current action and the ranked scores of its candidates in world space.

## Game feel

- **Hit-stop:** parry 70 ms, kill 55 ms, player hit 75 ms, heavy hit 45 ms. Simulation ticks are skipped (events take the max, not the sum); rendering, camera and a slowed particle update continue, with a faint residual shake kept alive.
- **Screen shake:** `shake = trauma^2` with trauma decaying over time, plus a directional impulse on slashes, dashes and impacts.
- **Squash and stretch:** the player's body stretches along its velocity with volume preserved.
- **Telegraphs:** red lunge/bash lanes that fill as the attack approaches, a laser sightline that thickens and turns white at lock.
- **Procedural audio:** dash whoosh, parry clang (inharmonic partials + noise tick), sniper charge sweep, rail shot, slash, hits, kills, shield ping, wave clear arpeggio, death. Oscillators, looped noise buffers, biquad filters and envelopes only. The `AudioContext` is created on the first gesture.

## Debug overlay (`F1`)

FPS and frame time, sim tick / seed, per-pool active/free/created counts, player FSM state, timers, history and rejected transitions, enemy list, collision / parry / shield / slash wireframes, world-space Utility-AI scores, and live sliders for player speed, dash cooldown, spawn rate, enemy speed, hit-stop scale, shake scale and time scale.

## Technical challenges and trade-offs

- **Sim / presentation split.** Hit-stop lives in the loop (it pauses ticks) while Fx and camera keep running on real time. Sim-driven visuals (ghost trail, telegraphs) read state rather than being pushed events.
- **Tunnelling.** Reflected projectiles move up to 30 px per tick, which is more than a small enemy's diameter, so contacts are swept segment tests rather than point tests.
- **Interpolation under hit-stop.** `alpha` is forced to 1 while frozen, otherwise rendering would oscillate between the previous and current tick.
- **Restart safety.** `World.reset` resets state in place and never re-creates the bus; `Game.restart` also clears Fx pools, the camera, latched input edges and timers.
- **Input edges.** Presses latch in `Input` until a simulation tick consumes them, so a press that lands during hit-stop or between ticks is never lost.
- **Playtested by hand.** The author has played the whole game personally and had friends play it. The notes below about bots describe the automated checks; feel and difficulty have been judged by real players, though no formal playtest data (win rates, timings) was recorded.
- **Not done:** gamepad support, persistent high scores, and automated tests (the headless sim makes these straightforward to add).

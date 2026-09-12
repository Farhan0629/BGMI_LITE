# FRONTIER STRIKE

An original browser-based 3D tactical shooter. Single player battle-royale style
match against AI bots on **RAVENFALL ISLAND**, plus a shooting-range training
mode, built on a custom WebGL2 engine with **zero runtime dependencies and no
build step**.

All characters, weapons, map design, names, UI and audio are original. Nothing
from PUBG/BGMI, Fortnite or Apex Legends is used: there are no third-party
models, textures or sound files in this repository at all. Every mesh is
procedural geometry, every sound is synthesised at runtime with the Web Audio
API, and every material is generated in shaders.

---

## 1. Quick start

```bash
git clone https://github.com/Farhan0629/BGMI_LITE.git
cd BGMI_LITE
npm run dev          # static server on port 5173
# open http://127.0.0.1:5173/index.html
```

There is nothing to install (`npm install` is optional and only fetches
TypeScript for the optional `npm run typecheck`). The game is native ES modules
plus one stylesheet, so **any** static host works:

```bash
python3 -m http.server 5173     # alternative
npx serve .                     # alternative
```

### Production

No bundling is required. Deploy the repository root as static files (GitHub
Pages, Netlify, S3, nginx). Recommended production tweaks:

- serve over HTTPS (pointer lock and fullscreen behave best on secure origins)
- enable gzip/brotli for `.js` and `.css`
- set long cache headers on `/src/**` and short ones on `index.html`

### Multiplayer server (V2 foundation)

```bash
npm run server       # http + websocket on port 8080, also serves the client
```

---

## 2. Stack choice and justification

The brief preferred TypeScript + Three.js/Babylon + React + Vite, and allowed a
different stack if justified. This project uses **plain ES-module JavaScript
with JSDoc types, a hand-written WebGL2 renderer, and no bundler**, for three
reasons:

1. **The build environment had no network access**, so npm installs of `three`,
   `babylonjs`, `react` or `vite` were impossible. Rather than ship code that
   cannot run, the engine is self-contained and runs from a plain file server.
2. **Performance control.** The renderer is built around one instanced draw
   call per primitive per frame with CPU frustum/distance culling, so a
   thousands-of-props island runs in tens of draw calls. That is easier to
   guarantee with direct WebGL2 than through a general-purpose scene graph.
3. **Type safety is retained** without a compiler in the loop: `tsconfig.json`
   enables `allowJs`, `checkJs` and `strict`, so `npm run typecheck` type-checks
   the entire codebase (or your editor does it live) while the browser still
   loads the exact source files with no transpilation.

Migration path is intentionally short: the module boundaries match the requested
architecture, so renaming `.js` to `.ts` and adding Vite is mechanical, and the
UI layer is small enough to port to React if desired.

---

## 3. Project structure

```
BGMI_LITE/
├── index.html                  shell: canvas + UI root
├── styles.css                  all UI (HUD, menus, inventory, debug)
├── package.json                scripts only, no runtime deps
├── tsconfig.json               strict checkJs type checking
├── scripts/dev-server.mjs      dependency-free static dev server
│
├── src/
│   ├── main.js                 entry point, capability checks, error UI
│   ├── game.js                 system ownership + fixed-step main loop
│   │
│   ├── config/                 all balancing data (no magic numbers in systems)
│   │   ├── game.js  player.js  weapons.js  bots.js
│   │   └── loot.js  zone.js    graphics.js
│   │
│   ├── core/                   math, seeded RNG, event bus, settings store
│   ├── rendering/              geometry, scene graph, shaders, renderer,
│   │                           particles, environment (day/night + weather)
│   ├── physics/collision.js    AABB world, sweep resolve, raycast, LOS
│   ├── world/                  regions, terrain, prop builder, world builder
│   ├── player/                 character rig + player controller
│   ├── camera/cameraRig.js     third/first person spring arm
│   ├── input/input.js          bindings, pointer lock, edge-triggered keys
│   ├── weapons/                weapon controller (fire, recoil, reload)
│   ├── combat/                 hitscan/projectile resolution, grenades
│   ├── ai/                     bot FSM + bot manager
│   ├── loot/  inventory/       loot spawning, rarity, pickups, inventory
│   ├── zone/zone.js            shrinking safe zone with stages
│   ├── audio/audio.js          procedural Web Audio engine (spatial)
│   ├── ui/                     hud, minimap, menu, inventory panel, debug
│   ├── match/match.js          match state machine, stats, win/lose
│   ├── vehicle/atv.js          Ranger ATV
│   └── net/netAdapter.js       V2 seam: input frames + interpolation buffers
│
└── server/                     Version 2 foundation
    ├── GameServer.js           http + websocket, sessions, rooms, tick loop
    ├── Room.js                 lobby, ready-up, authoritative sim, win check
    ├── PlayerSession.js        per-player state, input queue, anti-cheat flags
    ├── blacksiteArena.js       BLACKSITE ARENA layout (shared data)
    └── networking/
        ├── wsServer.js         RFC 6455 server (no dependencies)
        ├── protocol.js         message types, room codes, tick rate
        └── validation.js       movement/fire-rate/damage validation
```

---

## 4. Architecture

**Main loop** (`src/game.js`): mouse look and edge-triggered actions are read
once per animation frame; simulation runs at a fixed `1/60 s` step (max 5 steps
per frame) so movement, recoil, AI and the zone are frame-rate independent;
rendering happens once per frame. The same fixed step lets the server
re-simulate client input in V2.

**Rendering** (`src/rendering/`): WebGL2, passes in order — shadow depth → sky →
terrain → instanced meshes → water → particles (alpha then additive) → post
(tone map, bloom, vignette, colour grade, damage tint). Static geometry is
baked into 125 m chunks at load; each frame visible chunks are merged with
dynamic instances into a scratch buffer and uploaded once per primitive.

**World** (`src/world/`): `buildSteps()` returns labelled build steps that the
loading screen runs one per animation frame, so the tab never freezes and the
progress bar is real. Six regions — RAVENFALL CITY, OUTPOST GRAVEL,
DRYDOCK WORKS, HOLLOW PINES, RAVEN RIDGE and SALT PIER — plus wilderness fill,
all generated from a seeded RNG with a matching AABB collision world and a
cover-point grid used by the AI.

**AI** (`src/ai/`): 12-state FSM (idle, patrol, search, investigate, combat,
take cover, retreat, loot, heal, reload, flank, dead). Perception is
line-of-sight + distance + FOV + gunshot hearing with a last-known-position
memory, so bots must actually find you. Difficulty changes reaction time,
decision weights, cover/flank bias and burst discipline — not just accuracy.
Bots fight each other as well as the player.

**Combat**: per-weapon hitscan or projectile, per-limb hitboxes
(head/chest/stomach/arms/legs), distance falloff, helmet/vest absorption with
durability, headshot multiplier, explosive barrels and grenades with pooled
particles.

**Events**: systems communicate through a tiny event bus (`src/core/events.js`)
rather than direct references, which is what lets audio, HUD, kill feed, stats
and minimap react to combat without coupling.

---

## 5. Controls

| Action | Key |
| --- | --- |
| Move | W A S D |
| Sprint / Crouch / Jump | Shift / Ctrl / Space |
| Fire / Aim | Left mouse / Right mouse |
| Reload | R |
| Interact, pick up | E |
| Primary / Secondary / Melee | 1 / 2 / 3 |
| Cycle weapon | Mouse wheel |
| Inventory | Tab |
| Use medical item | H |
| Throw grenade | G |
| Enter / exit vehicle | F |
| Toggle third/first person | V |
| Full map | M |
| Pause | Esc |
| Debug overlay | F3 |
| Fullscreen | F11 |

All bindings are rebindable and persisted in `localStorage`, together with
graphics, audio, sensitivity and gameplay settings. No account required.

---

## 6. Match flow

Main menu → loading (real progress) → `MATCH STARTING 3 2 1 DEPLOY` → free-roam
match against 8/16/30 bots (configurable) with looting, armour, healing, a
five-stage shrinking zone that damages you outside it, kill feed and minimap →
`VICTORY` (kills, damage, survival time, accuracy, loot) or `DEFEATED`
(placement, kills, damage, time) with **Play again** / **Main menu**.

Training mode drops you into the same world with a small group of low-threat
opponents so weapons, recoil and damage can be tested in isolation.

---

## 7. Performance

- one instanced draw call per primitive per frame; chunked frustum + distance
  culling; typical frame is tens of draw calls for thousands of props
- four quality presets (Low → Ultra) controlling shadow map size, view
  distance, terrain resolution, particle budget, device-pixel-ratio cap and
  whether the post stack runs at all
- object pooling for particles, grenades and tracers; no per-frame allocations
  in the hot paths (matrices, scratch arrays and HUD state objects are reused)
- AI think-rate scales with distance from the player (0.12 s near, 0.5 s far)
- uniform spatial grids for collision, cover and loot queries
- FPS/frame-time, entity counts, AI states, zone timer and renderer stats in the
  F3 debug overlay

If the frame rate is low: drop quality to Medium/Low, reduce bot count to 8,
and disable post-processing. Integrated GPUs are usually fine at Medium.

---

## 8. Known limitations

- Characters are procedural rigs built from primitives, not skinned GLTF meshes.
  Animation is procedural (gait, aim, recoil, reload, hit, death) rather than
  keyframed.
- Ambient occlusion is approximated per-instance, not screen-space SSAO.
- Water is a shader plane with animated normals, not a simulation.
- Vehicle physics is arcade (no suspension or wheel raycasts).
- Destruction is limited to windows, crates and explosive barrels by design.
- Bird ambience is audio-only; there are no flying entities.
- Multiplayer is the foundation described below, not yet wired to the UI.

---

## 9. Replacing the placeholder assets

The engine is asset-ready even though it currently ships none:

1. **Models.** `src/rendering/geometry.js` registers named primitives consumed by
   `scene.addStatic/addDynamic`. To use GLTF/GLB, add a loader that converts a
   mesh's positions/normals/indices into the same `{positions, normals, indices}`
   shape and register it under a new name; every call site is by string name, so
   props and characters pick it up without further changes.
2. **Characters.** Swap `src/player/character.js` for a skinned-mesh rig that
   keeps the same interface (`update(dt, animState)`, `draw(scene, transform)`,
   `hitboxes(...)`). The hitbox contract is what combat depends on.
3. **Textures/PBR maps.** Materials are per-instance colour + roughness +
   emissive in `src/rendering/shaders.js`. Add sampler uniforms and a UV
   attribute there, then pass texture indices through the instance stride.
4. **Audio.** `src/audio/audio.js` synthesises every cue. Replace any method
   body (for example `gunshot`) with a buffer-source playback path; keep the
   spatial panner wiring so positional audio still works.
5. Put real files under `public/assets/{models,textures,audio,environments}` and
   load them through an async manager so the loading screen keeps reporting
   progress.

---

## 10. Version 2 roadmap (1v1 online)

The foundation is already in the repository and is server-authoritative by
design.

**Shipped now**

- `server/GameServer.js` — HTTP + WebSocket on one port, sessions, room registry,
  30 Hz tick loop, ping/timeout reaping
- `server/networking/wsServer.js` — dependency-free RFC 6455 implementation
- `server/Room.js` — private room, lobby, ready-up, `MATCH STARTING 3 2 1`,
  authoritative movement + hitscan, first elimination wins, rematch, disconnect
  forfeits
- `server/networking/protocol.js` — message types and unambiguous 6-character
  room codes (e.g. `X7K9P2`)
- `server/networking/validation.js` — input sanitising, speed/teleport rejection,
  fire-rate enforcement, server-side damage, token-bucket rate limiting
- `server/blacksiteArena.js` — BLACKSITE ARENA: two spawns, central structure
  with elevated platform, ramps, flanking routes, mirrored cover and loot
- `src/net/netAdapter.js` — client seam: input-only frames, snapshot
  subscription, per-entity interpolation buffers (~100 ms delay, shortest-arc
  yaw blending)

**Remaining work**

1. Lobby UI: `MULTIPLAYER → CREATE ROOM / JOIN ROOM`, code display, waiting
   state, ready toggles (new screens in `src/ui/menu.js`).
2. Client arena loader: build `ARENA.blocks` through `PropBuilder` so client and
   server share one layout source.
3. Connect `NetAdapter.connect()` to the WebSocket, send input frames each fixed
   step, and render remote players from the interpolation buffers.
4. Client-side prediction with server reconciliation using the `ack` sequence
   already returned in every snapshot.
5. Reconnect flow behind the existing `CONNECTION LOST / attempting to
   reconnect...` toast, then match-end screens with rematch/return-to-lobby.
6. Optional scale-out: room sharding across processes, Redis room registry,
   WebRTC data channels for lower latency.

Version 1 is not discarded by any of this — the same configs, weapons, player
stats and match rules are imported by the server.

---

## 11. License and originality

MIT licensed. All content is original to this project. No proprietary assets,
trademarks, insignia or third-party media are included or required.

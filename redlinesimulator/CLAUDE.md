# Redline Garage

An open-world 3D driving simulator in one HTML page: 60 fictional cars, 6 large maps (about 5 km across each), a credit economy (earn money, buy cars, tune and customize them), traffic, a day and night cycle, and racing as an in-world activity (circuits, sprints, time attacks, speed traps). Plain JavaScript on Three.js r128, no bundler. `node build.js` stitches `src/` into one self-contained `dist/index.html`.

## Commands

```bash
node build.js                                   # bundle src/ into dist/index.html and syntax-check it
node test/check-data.js                         # car/map tables, stat ranges, buy/mod/sell economy round trip
THREE_PATH=<three.min.js> node test/check-models.js    # builds 180 random customized cars in Node
THREE_PATH=<three.min.js> node test/check-world.js     # builds all 6 worlds: roads, events, traps, curvature
THREE_PATH=<three.min.js> node test/check-physics.js [quick]   # AI drives every event route on every map
THREE_DIR=<node_modules/three> SHOTS=<dir> NODE_PATH=<global node_modules> node test/browser-test.js [quick]
THREE_DIR=<node_modules/three> SHOTS=<dir> NODE_PATH=<global node_modules> node test/mp-test.js   # starts the server, two browsers, checks they see each other (about 4 min)
npm install && npm start                        # run the multiplayer server + game on :8080
```

`three.min.js` is Three.js **r128** (`npm install three@0.128.0`; the build file is `node_modules/three/build/three.min.js`, and `THREE_DIR` is `node_modules/three`). The browser test needs Playwright, serves Three and the postprocessing scripts from `THREE_DIR` in place of the CDNs, drives the garage, buys and tunes a car, drives every map, runs an event and writes screenshots to `SHOTS`. It is slow (software GL, several minutes); run it in the background and poll.

Run all the test commands plus the build before publishing any change.

## Layout

| File | Job |
|---|---|
| `src/util.js` | math, `lin()` sRGB to linear, `mergeGeos`, `disposeTree`, `canvasTex`, `store`, formatters |
| `src/data.js` | `CAR_TABLE` (12 makes x 5), `BODY`, prices, all customization lists, `PERF` stages and costs, `MAPS` (6 worlds) |
| `src/save.js` | `settings`, `SAVE` (money, owned cars + per-car mods, driver, stats, best times, traps), sanitizing, `carStats`, `modsCost`, `applyDraft`, `buyCar`, `sellCar` |
| `src/models.js` | procedural lofted car bodies, wheels, lights, spoilers, driver: `buildCarMesh(car, profile, opts)`. Uses `CarModels` when a 3D model is ready |
| `src/carmodels.js` | 3D car models (glTF). `BODY_MODELS` maps each body type to model files, `fileFor(car)` picks one per car, `load()` prepares each file once, `make(car, prof, opts)` builds a car from a model |
| `src/terrain.js` | shared terrain height (`terrH` in JS and GLSL), terrain shader (grass, rock, snow, sand, fine grain), sky, `applyTimeOfDay`, `Post` (bloom + final ACES pass) |
| `src/world.js` | `buildWorld(mapIdx, quality)`: road network, `Route`, road texture (`roadTexture`), buildings and props (instanced, chunked, `propMat` window shader), colliders, events, speed traps, minimap bake |
| `src/engine.js` | renderer + quality, `Input`, `Sound`, `Particles`, environment maps, showroom `Garage` view |
| `src/vehicle.js` | `Vehicle` physics (fixed 90 Hz, terrain, surfaces, static collisions), `aiInputs` for race AI |
| `src/ui.js` | menu, garage + dealership, travel, pause, settings, full map, results |
| `src/net.js` | multiplayer client: WebSocket, remote cars + name tags, chat, menu modal (`Net`) |
| `server/server.js` | multiplayer relay server (Node, hand-written WebSocket, no npm dependencies); also serves `dist/index.html` and `assets/models/`. See `MULTIPLAYER.md` |
| `src/game.js` | `Game`: modes, world session, traffic, events, income, camera, HUD, minimap, main loop |
| `src/onfoot.js` | on foot mode: walking (`stepWalk`), getting in and out (`getIn`, `getOut`), stealing traffic cars (`steal`), wanted level and police chasers (`updateWanted`, `busted`), walk camera. Merged into `Game` |
| `src/account.js` | login gate before play: register, log in, log out, save sync to the server (`Account.gate`, `scheduleUpload`, `syncDown`). Uses `MP_SERVER` as the server address |
| `server/accounts.js` | accounts and saved games on the server: `/api/register`, `/api/login`, `/api/logout`, `/api/me`, `/api/save`. Passwords hashed with scrypt, data in `DATA_DIR` (default `data/`, git-ignored) |
| `src/boot.js` | wires UI and starts `Game` (waits for `Account.gate`) |
| `src/template.html` | page shell, CSS tokens, DOM for every screen. `<!--SCRIPTS-->` is replaced at build time |

Script order is fixed (`net.js` sits between `ui.js` and `game.js`) in `build.js` (all files share one global scope). Never edit `dist/index.html`.

`build.js` also embeds every `assets/models/vehicles/*.glb` into `dist/index.html` as base64 (`window.EMBEDDED_MODELS`), so the deployed game needs only that one file. `CarModels.modelUrl(name)` uses the embedded copy first and the file in `assets/models/vehicles/` second.

## Concepts

- **Coordinates:** car forward is `+Z`, left is `+X`, up is `+Y`. Heading `h` gives forward `(sin h, cos h)` and left `(cos h, -sin h)`. Steer `+1` is left.
- **Colour pipeline:** every material colour goes through `lin(hex)`. With post-processing on, `renderer.toneMapping` is off and the final `ShaderPass` does exposure, ACES, gamma, vignette and speed blur. At low quality post is off and the renderer tone-maps directly (`setPostMode`).
- **Terrain:** analytic height `terrH(x,z)` (three sines, per-map amplitude, flat zone for city/port, mountain rim). The GLSL copy in `terrain.js` must stay in sync. The mesh is a 192x192 grid warped around the player and snapped to 25 m, so there is no streaming.
- **Roads:** `RoadNet` holds polylines with a spatial hash. Each map has an outer ring, an inner ring, links, and theme extras (city/port grids, desert/salt chords, spokes). `W.ground(x, z, out)` returns height, normal, surface and water. Roads sit slightly above terrain with a per-kind lift to avoid z-fighting.
- **Props:** instanced meshes grouped by 400 m chunks, shown by distance. Colliders (circles and AABBs) live in a 48 m hash and are queried through `W.colsAt`. For circles, `collide` is a factor of the instance scale.
- **Events:** built in `buildEvents`. Circuits use the rings, sprints and time attacks use the links (`s0 = 24` is the start line on open routes). A `Route` carries arc length, tangents and curvature for AI and progress.
- **Economy:** `carPrice = 3500 * tier^1.7`, start with 12,000 CR and the Orrin Mini. Mods are edited as a draft and charged on Apply (`modsCost`). Sell value is 55% of the price plus 40% of money spent on performance parts. Income comes from events, speed traps, drifting, near misses and distance.
- **Loop:** fixed-step physics with render interpolation, inside `Game.simStep`. Rendering and HUD live in `Game.worldFrame`. The loop is wrapped in try/catch, repeated errors fall back to the menu. Autosave runs every 25 s and on pause.

## Known traps

- **Never feed a `ShaderMaterial` to `PMREMGenerator.fromScene`.** It captures black. Environment helpers use a vertex-coloured `MeshBasicMaterial` sphere.
- `Game` and other top-level `const` globals are not `window` properties. In tests use `typeof Game !== 'undefined'`.
- `Input.throttle` is only written by `Input.poll` (inside `Game.frame`). When a test calls `Game.simStep` directly, set `Input.throttle` itself and stub `Input.poll`.
- Colliders: `collide` multiplies the instance scale. A house scaled 10 with `collide: 6` makes a 60 m wall. `scatter` adds `collide * s` to the road clearance, keep it consistent.
- `InstancedMesh.frustumCulled` is false because r128 culls by the base geometry. Visibility is manual (`W.update`).
- Postprocessing scripts come from jsdelivr (`three@0.128.0/examples/js`), the only other allowed CDN for the artifact. If they fail to load, `Post.init` returns false and the game falls back to direct rendering.
- Headless Chromium is about 4 fps. The browser test advances time with `Game.simStep` and renders with `Game.frame(1/30)` only for screenshots.
- `CarMats` collects every car material for night/env scaling. `disposeTree` removes disposed ones. Traffic cars are clones that share materials, so only dispose the pooled originals.
- `template.html` declares `<meta charset="utf-8">`. Without it, hosts that send no charset show mojibake such as "Â·".
- **Car models:** `CarModels.load()` must finish before `Game` starts (boot waits for it). Tests must wait for `CarModels.ready` before taking screenshots. Every body type needs at least one model in `BODY_MODELS`, or cars of that type fall back to `CarConcept.glb`.
- **Uploaded models have no licence in the file.** Check `CREDITS.md` before publishing.
- `old/` holds unused source files from an earlier version. The build ignores them.

- **Multiplayer** is opt-in (`Net`): nothing runs until Connect. Remote cars are non-solid `Vehicle` instances driven only by `applyMesh`. Chromium blocks public pages from reaching `localhost` sockets, so `mp-test.js` loads the game from the server itself.

## Adding content

- **A car:** append `[make, model, body, tier 1-10, class]` to `CAR_TABLE` (keep it at 60 or fewer, `check-data.js` enforces 50 to 60). It gets a 3D model automatically from its body type.
- **A 3D car model:** put the `.glb` in `assets/models/vehicles/`, add its name (without `.glb`) to a body in `BODY_MODELS` in `src/carmodels.js`, then run `node build.js`. The build embeds it. Cars are scaled to the same length (4.4 m) unless the model is already 3.2 to 6.5 m long.
- **A map:** add to `MAPS` (`theme`, `seed`, `R`, `Rin`, `hill`, `flat`, `rim`, palette, `difficulty`), add a `THEMES` entry in `world.js`, and a prop branch in `buildWorld`. Run `check-world.js` and `check-physics.js`.
- **A customization option:** add the list and cost in `data.js`, a clamp in `sanitizeMods`, a control in `ui.js` (`renderBody`) and use it in `models.js`.

## Accounts

- Players must log in before playing. The save (`SAVE`, which holds garage and credits) is loaded from the server on login and uploaded about 2.5 s after each `persist()`.
- Needs a server: `MP_SERVER` must be set at build time, or the page must be served by the game server.
- Server data lives in `DATA_DIR` (`data/` by default): `users.json`, `sessions.json`, `saves/<id>.json`. Hosts with ephemeral disks (such as Render's free plan) lose this on restart, so back the folder up or use a host with a persistent disk.
- Test: `node test/accounts-test.js` (starts its own server on port 8197, no browser needed).

## Publishing

- The game is one built file: `node build.js` writes `dist/index.html` (about 2.9 MB, with car models embedded). Deploy that file, or let the host run the build.
- **Vercel (from git):** Framework Other, Build Command `node build.js`, Output Directory `dist`. Redeploy without build cache after changing the build. Vercel serves static files only, so the multiplayer server (`server/server.js`) needs a separate host such as Render or Railway (see `Dockerfile` and `MULTIPLAYER.md`).
- Check a deploy by viewing the page source and searching for `EMBEDDED_MODELS`. If it's missing, the host is serving an old build.

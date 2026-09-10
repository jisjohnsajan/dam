# Worklog

---
Task ID: 1
Agent: Super Z (main agent)
Task: Build an interactive 3D dam-break simulation in the browser — dam in a 3D landscape,
reservoir on top, real hydrodynamic water physics, dam-break flood flow like a Blender fluid animation.

Work Log:
- Loaded fullstack-dev skill; initialized Next.js 16 environment (init script); installed three@0.186 + @types/three.
- Designed physics core: depth-averaged 2D shallow-water (Saint-Venant) equations solved on the GPU
  (384×224 grid, 0.5 m cells, 192×112 m domain) using ping-pong RGBA32F render targets:
  * ETA pass: mass conservation with Rusanov (local Lax-Friedrichs) fluxes.
  * VEL pass: momentum with HLL-style fluxes, advective tangential transport, semi-implicit Manning
    friction (n=0.028), Audusse hydrostatic reconstruction + well-balanced source term.
  * CFL-limited substepping (dt ≤ 8 ms, ≤ 8 substeps/frame).
- Wrote GLSL (src/lib/dam/glsl.ts): sim passes, foam field (strain/speed-driven deposit + decay),
  16k GPU spray particles (respawn where speed > threshold, ballistic arcs), water surface shader
  (depth color ramp, Fresnel sky reflection, sun specular, micro-ripple normals, foam, jet speed map, fog).
- Terrain (src/lib/dam/terrain.ts): procedural canyon valley (fbm value noise), reservoir reach,
  incised downstream channel with floodplain benches, steep canyon walls, mountain closure;
  dam structure encoded as a per-cell elevation field (bed = max(terrain, structure)) so SWE flows
  naturally over/through the dam; breach + spillway-gate animation applied to this field.
- Scene (src/lib/dam/engine.ts, props.ts): Sky addon + PMREM environment, directional sun with shadows,
  extruded gravity-dam monoliths (intact / breach / spillway with lift gate + piers + bridge),
  floating barrels (buoyancy + drag from readback flow field), houses & trees swept by flood,
  concrete debris chunks (ballistic), river/rumble WebAudio, camera presets with tweening,
  cinematic orbit + letterbox, camera shake on breach.
- CPU bridge: 48×28 downsample pass + readRenderTargetPixels → gauge discharge, reservoir level,
  max velocity, Froude number, prop physics.
- UI (React + shadcn): control panel (Break the Dam / Spillway / Flash flood / Reset, time scale,
  inflow, erosion rate, gravity selector Earth/Mars/Moon, foam/speed-map/sound toggles, physics-model
  popover), gauge-station HUD with live flood hydrograph canvas + phase badges + supercritical warning,
  camera preset bar, collapsible panels, responsive mobile layout, cinematic mode.
- Debugged in headless browser (agent-browser):
  * Fixed missing `varying vec2 vUv` declarations in fragment shaders (compile errors).
  * Fixed CRITICAL physics bug: missing Audusse well-balanced source term → reservoir piled against
    dam and falsely overtopped (level 34 m). After fix: lake at rest exactly 21.5 m, u = 0.
  * Fixed stats bug: dry mountain cells polluted "reservoir level" (used eta−0 instead of stored depth channel).
  * Rebalanced lighting: environmentIntensity 0.22, darker concrete/rock palette, higher sun,
    darker water body, calmer ripple normals, smaller spray particles, surround plane, warm sage surround.
  * Verified lake-at-rest (probe: eta 21.5, u 0), breach erosion (23 → 11.4 m), flood wave at gauge
    (u 4.7 m/s), peak discharge ~2000 m³/s, overtopping stability at 400 m³/s inflow (no NaN).
  * Verified all UI interactions by real clicks: Break/Spillway/Flash-flood/Reset, camera presets
    (tween), speed-map switch → shader uniform, cinema mode (timeScale 0.5 + orbit), physics popover.
  * Mobile 390×844: stats panel default-hidden, layout clean; desktop 1280×720 verified.
- Final lint clean, dev.log clean (GET / 200), fresh-load engine boot verified, no console errors.

Stage Summary:
- Deliverable: interactive 3D dam-break hydrodynamics simulator at / route (Next.js + Three.js).
- Key files: src/lib/dam/{terrain,glsl,props,engine}.ts, src/components/dam/panels.tsx, src/app/page.tsx.
- Physics: real Saint-Venant SWE on GPU (HLL/Rusanov flux, hydrostatic reconstruction, Manning friction,
  wetting/drying) — lake at rest is exact; breach flood wave, spillway release and overtopping all
  emerge from the solver, nothing keyframed.
- Scenarios: dam breach with erosion + debris + camera shake; spillway gate release; flash-flood
  overtopping inflow; reset; slow-motion; gravity on Moon/Mars; speed colormap; foam/spray; ambient sound.
- Known headless-only artifact: rAF throttling in the sandbox browser slows the animation during
  automated tests; in a real browser it runs at rAF speed (415 fps observed in-engine).

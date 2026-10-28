# Visualizer and engine performance

StageLight runs a 232-fixture show (512 allowed) while drawing the 3D stage, so both the engine tick and the
desk's render loop are kept inside fixed budgets. This note records what costs what, what was changed on
2026-10-27, and what to measure before adding load.

## Where the time went (232 fixtures, Apple silicon, in-app browser, 924×850 viewport at 1.7× resolution)

| Path | Before | After |
| --- | --- | --- |
| 3D stage, settled look (nothing lit) | 11–15 fps with ~1 s stalls once a second | 120 fps, draws only when something changes |
| 3D stage, every fixture lit, movers with prisms | 40 fps | 120 fps (display limit) |
| Real scene lights in the lit-surface shader | 56 (one per enabled non-ellipsoidal fixture) | 12, pooled |
| JavaScript per drawn frame (all lit) | 4.1 ms | 2.5 ms |
| Distinct geometries uploaded | ~2 500 (one per mesh) | 92 (shared per shape) |
| Page heap after load | 42 MB | 21 MB |
| Engine tick, idle | 0.20 ms | 0.05 ms |
| Engine tick, five effect tracks over 215 fixtures | 0.68 ms | 0.50 ms |
| Engine tick with a Look Link change-mode target | 1.07 ms | 0.60 ms |
| Runtime stream to the desk while a look is settled | 10 messages/s of 47–115 kB each | none until something changes |

The engine was never the bottleneck: a 30 Hz tick costs well under a millisecond, and the DMX encode, cue
compose and effect layers are now indexed by fixture id so they stay linear in fixture count (they were
quadratic: each fixture searched the whole patch).

## The GPU problem: one scene light per fixture

Three.js lights every lit surface in the forward pass with every visible light. Fifty-six spot lights meant
each pixel of the room, trusses, chairs and 232 fixture bodies evaluated 56 lights, with a shader of 411
uniforms. Hiding the lights alone took the settled stage from 12 to 96 fps. Haze cones, floor pools and
lenses are unlit `MeshBasicMaterial`, so they were never the cost: with everything lit and no scene lights
the page held 120 fps through 1 946 draw calls.

`public/stage.js` now keeps a fixed pool of 12 spot lights (`LIGHT_BUDGET`). Each drawn frame the brightest
eligible heads (enabled, not Rêve E-3 or house pendants, intensity above 0.1 %) borrow a light; a head keeps
its light until it goes dark or another head is brighter by 15 % (`LIGHT_SWAP_MARGIN`), and a newly lit
head ramps in over 250 ms, so near-equal levels do not flicker a light between heads. The pool is always
visible at intensity 0 when idle, so the lit shader is compiled once and never recompiles during a show.
Beams, pools and lens glow are unchanged for every fixture; only the dim room illumination from the 13th
and dimmer heads is dropped, which is not visible beside their beams.

## Other render-loop changes

- Geometry is shared per shape (housing, barrel, lens, cone, pool, pendant cord, Rêve reflector and yoke).
  A cone or pool only gets its own geometry copy the first time it needs per-vertex filter bands (7R/200W
  mixed-colour wheel slots). Only those copies are disposed when a fixture is removed.
- Extra prism cones are created the first time a head's prism engages instead of five per fixture up front.
- Fixture colour and filter bands come from `outputRGB`/`outputBands`, which build objects and search slot
  tables. They are resolved once per engine frame (10 Hz, keyed on the frame object) instead of per drawn
  frame (60–120 Hz). The pan/tilt/intensity interpolation still runs every drawn frame.
- Scratch vectors and colours replace the per-fixture `clone()`/`new Color()` allocations that caused GC
  spikes (27 ms worst frame before).
- A settled look is not redrawn: the frame is drawn when the engine sent frames, something is still
  interpolating, a prism is turning, a pooled light is ramping, the camera moved, the selection, haze or LED
  wall changed, or an alignment preview is active; otherwise at most twice a second. This is what takes a
  held look to near-zero GPU use.
- Render resolution adapts: the pixel ratio starts at `min(devicePixelRatio, 1.7)`, steps down by 0.25 (to
  1.0) after about two seconds of frames longer than 26 ms, and back up after eight seconds at 60 fps or
  better. A step up that has to be undone within ten seconds blocks further tries for a minute.
- `powerPreference` is `high-performance` (it was `low-power`, which on a Mac with two GPUs picks the slow one).

## Desk (`public/app.js`)

- Fixture lookups are indexed per show object; `paint()` previously searched the patch linearly for every chip
  and tile ten times a second.
- Fixture chips and group-tile dots remember what they last showed and only touch `style` when the colour,
  level or override state changed. Restyling 232 chips with box shadows every 100 ms was pure layout and
  paint work even when the look was static.

## Server and engine

- `/api/events` only writes when the runtime changed. The tick counter alone is not a change; it is read from
  the diagnostics dialog when the next real change is sent. A settled look costs connected desks nothing.
- `Engine.tick` builds Art-Net packets only while output is armed; the patch sheet encodes its own readback.
- `fixtureIndex(show)` in `engine/model.mjs` is the shared id → fixture map, rebuilt when the show object is
  replaced. Strobe effects with a spatial axis cache their extent per profile instead of scanning the patch
  for every fixture.

## Measuring

In the desk, the quickest honest numbers come from a `requestAnimationFrame` loop timing frame gaps (a
GPU-bound page shows long gaps with no long tasks) and wrapping `gl.drawElements`/`gl.drawArrays` to count
draw calls. `tests/perf.test.mjs` keeps the engine tick budget: 232 fixtures with five effect tracks, a
preview, blind edits and a change-mode Look Link target must stay under 4 ms per tick on CI hardware.

## Still open

- 232 label sprites (one canvas texture each) are 232 transparent draw calls. An atlas or instanced labels
  would cut them to one; they were not the bottleneck.
- Fixture bodies could be instanced per profile (picking works with `instanceId`), which would take ~900 draw
  calls out of the opaque pass. Draw calls cost about 1.5 µs each on this machine, so this is a few
  milliseconds at most.
- The pop-out visualizer is a second WebGL context with its own light pool; both windows run the same code.
  The main window's stage is paused while the pop-out is open.
- WebKit (the Tauri app) has not been measured; the same changes apply, and forward lights are at least as
  costly there.

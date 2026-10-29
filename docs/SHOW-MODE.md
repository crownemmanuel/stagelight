# Show mode, pages and cue lists (v0.2)

## Data model (portable show)

- `pages[]`: `{id, name, color?, cues: [entry]}`. A page is a cue list; base looks under every cue are scenes (docs/MASTERS-AND-SCENES.md).
- entry: `{id, cue, label?, fade, follow: 'manual'|'auto', wait?}`. `cue` references `cues[]`; one cue may sit on several pages. `fade` = seconds to crossfade *into* the entry (0 = cut). `follow: 'auto'` fires the next entry after `wait` seconds (default: the cue duration).
- `cues[].hold` (optional): a non-looping cue holds its last frame instead of going dark.
- `media[]`: imported LED wall media `{id, name, kind: image|video, src: /media/<file>}`; files live in `data/media/` and are **not** inside an exported show file.
- `ledWall`: `{media: <id>|'off', brightness, fit: cover|contain|stretch}`. Built-in media (`public/led/*.svg`) are listed by `schema.media`.
- Shows saved before v0.2 are migrated on load: one page "Scene 1" with every cue in order (fade 2 s, manual), an `movers` group of patched moving heads, and the Salvation title on the wall.

## Engine behaviour

- Rendering is split into `compose` (cue), `applyOverrides` (programmer), `finish` (master, blackout, limits). Crossfades blend two composed states linearly; wheel attributes (gobo, prism, optical mode) switch at the midpoint. The outgoing cue keeps running during the fade.
- `page.go` keeps manual overrides on top. `override.release` snapshots the overridden state and blends it back to the cue (default 3 s). `cue.play` (single library cue) still clears overrides.
- Arming output is refused while a crossfade or release is in progress, as it is for playback and overrides.
- The LED wall is preview-only: the engine stores the choice; the browser renders it. Video pauses in the UI while output is armed. Nothing reaches Art-Net.

## Preview playback

A second playback, `preview`, renders a cue with the same renderer as live (master applied; no overrides or blackout) but is never encoded to Art-Net, so it is allowed while armed. `preview.cue` takes one of `id`, `page`+`entry` (crossfades from the current live look with that entry's fade) or `cue` (an unsaved definition — used by the preset and custom-effect dialogs). Non-hold cues loop in preview. `preview.go_live` GOes a previewed page entry on its cue list (or plays a previewed library cue with a 2 s fade) and clears the preview; unsaved cues must be saved first. `preview.stop` clears it. Readback: `runtime.preview` and `runtime.previewFrames`.

In the UI each cue row has an eye button. Previewing switches the stage to the preview frames, frames it in amber and shows a banner with Live/Preview source, Send to live and stop (Esc). The GO bar always reports the live cue.

## Programmer effects and cue recording

- Tracks may target `fixtures` (explicit list) instead of `group`, and may carry `layer` (`position`, `intensity`, `color`). Layer tracks modify the state beneath them instead of replacing it. Cue look entries may carry `over: true`. Compose order: base look → full tracks → `over` look → layer tracks, mirroring live: cue → overrides → programmer effects.
- `this.fx` (live) and `this.fxPreview` (visualizer only) hold programmer effects, one per fixture per layer. `fx.preview` re-sent with the same effect and fixtures keeps its phase; `fx.apply` without fixtures promotes the preview with the same phase and fades in over `blindFade`; `fx.stop` and Clear fade them out over `clearFade`.
- `cue.record {id}` on an existing cue merges overrides (or the blind buffer) as `over` look entries and programmer effects as layer tracks; if that cue is playing, its playback snapshot is refreshed and the programmer cleared with no visible jump. A new id copies the playing cue (or `from`) plus changes, or snapshots the look when nothing is playing; `page`/`after`/`go` place and run it. `mode: "replace"` snapshots the whole current look.
- UI: Effects tab (Build Programmer; Show Override → Effects) with Preview first / Straight to live; Save in the GO bar (Update / Save as new / Replace). The old bottom Effect button is now “Effect cue on a group…” in the Library dialog.

## Custom effect presets

`show.presets[]` holds custom presets `{id, name, icon, effect, params, description?, duration?, loop?}` — `icon` must be one of `public/icons.js` `ICONS` (exposed as `schema.icons`), `effect` one with a `layer`, and ids may not shadow built-ins. `schema.presets` merges built-ins (`custom:false`) with these (`custom:true`, category derived from the layer). `preset.save` / `preset.delete` (custom only); every command that takes `preset` resolves both kinds.

## Playback settings

`show.playback = {clearFade, blindFade}` (seconds, 0 = instant cut; defaults 3 and 2, added by migration) travels with the show. `override.release` without `fade` uses `clearFade` live and `blindFade` in blind; `blind.apply` without `fade` uses `blindFade`. Clearing in blind now fades the blind view like a live release instead of cutting (`runtime.blind.release` reports progress). Set with `settings.set`; UI: ☰ → Settings.

## Blind

`blind.set {enabled}` switches the programmer into a blind buffer. While on, `fixture.set`, `fixture.clear`, `point.recall` and `override.release` edit that buffer instead of the live overrides; it is drawn only in `runtime.previewFrames` — over the preview cue if one is loaded, otherwise over the live look (live overrides included). `look.capture` and `point.save` record from the blind view, so a look can be built and recorded mid-show. `blind.apply {fade}` merges the buffer into the live overrides with the same blend as a release (default 2 s). Lamp strike/douse and calibration hold stay physical. Leaving blind keeps the buffer; Clear empties it. Readback: `runtime.blind {enabled, fixtures, overrides}`.

UI: the Blind pill beside Show/Build; a violet BLIND banner with Live/Blind source, Record, Apply live and leave; the Programmer, Clear count and fixture chips read the blind buffer while it is on.

## Commands (all exposed as MCP tools `lights_*`)

`page.save`, `page.delete`, `page.go`, `page.back`, `preview.cue`, `preview.stop`, `preview.go_live`, `blind.set`, `blind.apply`, `override.release`, `effect.apply`, `media.import`, `media.delete`, `ledwall.set`, `point.delete`, `group.delete`, `palette.delete`; `point.recall` gains optional `ids`; `look.capture` gains optional `page`/`fade`; `cue.play` gains optional `fade`. Readback: `status.runtime.stack`, `.transition`, `.release`; `schema.presets`, `schema.media`.

## Pop-out visualizer (dual screen)

The pop-out button in the stage toolbar (next to LED wall) opens `/visualizer.html`, a window with only the 3D stage, so it can sit on a second screen. While it is out, the main window shows the group tiles in the stage area and pauses its own 3D renderer (one GPU-heavy stage at a time); the Visualizer tab focuses the pop-out instead. The dock button, in either window, brings it back; closing the pop-out does the same.

- The pop-out reads `/api/state` and `/api/events` itself, like the main window. Clicking a fixture calls `selection.set` (Shift adds/removes), so selection stays shared. It keeps its own camera view and haze.
- The main window tells it which frames it is looking at (`postMessage {type:'view-source', source:'live'|'preview'}`), so preview and blind are mirrored. The pop-out sends `visualizer-hello` every second (the main window re-links after a reload) and `visualizer-closed` when it goes away. With no main window it shows preview frames while a preview, blind or effect preview is active, and live otherwise.
- Desktop app: `window.open('/visualizer.html')` becomes a native window ("StageLight · Visualizer", `on_new_window` in `src-tauri/src/lib.rs`) that remembers its frame (window-state plugin), so it reopens on the screen where it was left, and supports native full screen. Other `window.open` links still open in the browser.
- No engine command or MCP tool: this is window layout in the operator UI, not show data or output. Agents already reach everything it shows through `lights_status` and `lights_selection_set`.

## Gobo icons

`public/gobos.js` draws each wheel slot from the manufacturer diagrams: Martin RUSH MH 7 Hybrid manual Rev A p.24 (open, iris 1–4, patterns 5–12; slots 1–4 are irises, not patterns) and Chauvet Rogue R3 Beam manual Rev 6 p.10 (open, apertures 1–6, patterns 7–17). The DMX mappings in `render.mjs` were already consistent with both manuals and are unchanged.

## Tests

`tests/pages.test.mjs` covers GO/back/crossfade progress, auto-follow, overrides across GO and release fades, presets (including fade hold), group-limited position recall and protected deletes, migration and cascade on cue delete, media import/LED wall/delete, and MCP tool exposure.

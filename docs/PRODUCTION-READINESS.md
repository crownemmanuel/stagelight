# Production readiness — 2026-11-01

The first live services with StageLight (2026-10-31 and 2026-11-01) worked, but the operator had to restart the engine eight times, re-arm by hand, and lost sound triggers and output for minutes at a time. This note records what was wrong, what changed, what was measured, and what is still open. Tests for everything below are in `tests/production.test.mjs`.

Evidence came from the live data folder (read only): `audit.jsonl`, `audit.jsonl.previous`, `live-state.json`, `show-files.json` and the show versions.

## How to apply this update (between shows only)

This update changes the engine, so it needs one engine restart. Do it between services, never during one.

1. Install the update and restart the app (disarm first).
2. Once this version is running, Resume and the hot-load paths below cover later fixes. The engine running today has none of them, so it cannot pick any of this up live.
3. Do not copy only the new desk files into the app running today. The new desk sends `output.arm {keepLook}` and `masters.own`, which the old engine refuses.
4. Rebuild the app so it bundles the new `stagelight-io` helper. The engine-side fixes work with the old helper too: it reopens the lost input itself, and only the per-channel meter needs the new helper.
5. The face lights get an intensity limit of 12% the first time the show loads (see *Intensity limits*). *Special · light up* has ten face lights at 18%, so it will look dimmer on those ten.

## What changed

### Output survives network faults (critical)

At 02:14:57 on 2026-11-01, seven Art-Net sends failed at once with `EADDRNOTAVAIL`: the lighting adapter dropped for a moment. Back then, any send error closed output. The rig stayed frozen for five minutes, until the operator restarted the engine at 02:20, and it happened again at 02:21.

- **Output stays armed.** Only `output.disarm` or stopping the engine disarms it.
- **Failures are counted, not spammed.** Each frame is still sent. A failure is logged once, then every 10 s with a count, and recovery is logged too.
- **The socket is rebound.** After 5 s of failures, the socket is rebound to the source address, every 5 s, until sends work again.
- **Readback.** `output.status` and `lights_output_status` gain `sending`, `failing {since, errors}`, `errors` and `rebinds`. `runtime.health` and the pre-show check report the failure.
- **A tick that throws** used to close output and log 30 lines a second. Now output stays armed, the error is logged once (then every 10 s), `runtime.health` shows it, and the next good tick sends again.

### Sound triggers survive the Dante device going away (critical)

At 02:15:06, nine seconds after the network blip, the helper logged *"The requested device is no longer available"*. When Dante came back, the engine asked the helper to open the same device. The helper reused the dead stream, so the triggers stayed deaf until the engine restarted. The same thing happened at 02:56:28. This is the likely cause of "Dante has no audio".

- **The engine reopens the input.** On the helper's input error, or when its meter (sent about 15 times a second while an input is open) stops for 3 s, the engine closes the input and opens it fresh every 2 s until it works. It logs the loss, each new kind of failure, and the recovery.
- **The helper no longer reuses a dead stream** (`src-tauri/io/src/main.rs`, the `alive` flag). This needs an app rebuild.
- **A crashed helper restarts itself** after 1, 2, 5, then 10 s, at most 5 times a minute. Its device list then makes the sound and MIDI modules reopen their input and ports.
- **Follow cues are never left up for good.** A follow trigger's cue is let go when no level arrives for 2 s (input or helper gone), when the module turns off, and, as already in the baseline, when the trigger is switched off.
- **Device changes are logged with both names** (`Sound input device · A → B`).
- **"System default input" warns.** It follows macOS, which can switch to the MacBook microphone on its own. It also logs when the default device changes underneath it.
- **Digital silence is flagged.** No audio at all on the whole input for 20 s with triggers on raises a warning: the feed is dead, not quiet.
- **The sound panel shows the whole input's level** next to the trigger's own channel. With the new helper it also shows every channel, green when it carries audio, with the trigger's channel outlined. The operator could not tell which Dante channels carried audio.

The live show's setting stayed *Dante Virtual Soundcard* in all 40 versions from 02:08 to 14:03. No version or log line shows a change to the MacBook mic. Device changes are now logged, so if it happens again the moment will be in the audit log.

### Masters that share a cue (high)

*Back Light up* is on master 2 (kick, hit), master 3 (lead, follow) and master 5 (tom 2, hit). A held flash on a cue already running from another master did nothing at all, so while the lead rode the cue at a low level, kicks showed nothing.

- **A flash now bumps the running cue.** A held flash bumps that cue to full and to the top until let go, whoever started it (another master, its own fader or the cue list), then the cue goes back to that master's level. A bump never releases a cue it did not start. A doubled press (two MIDI notes) never leaves a stale bump.
- **Shared cues are reported.** `masters.status` / `lights_masters_status` lists every slot and the cues on several masters, with a warning. The pre-show check warns, the master's ⚙ shows a warning with **Give it its own copy** (`masters.own` / `lights_masters_own`), and library tiles and the cue sheet show "N masters".
- **What a bump cannot do.** While one master holds a shared cue at full, a flash on another still cannot make it brighter, hence the warning and the copy button.

### Getting the look back after a restart (high)

Arming was refused whenever anything played, so getting the rig back took `cue.stop`, `override.release` and `fx.stop`, then arm, then replaying the cues by hand. A deliberate restart while armed offered no Resume at all.

- **Arm with the current look.** `output.arm {confirmation, keepLook:true}` arms with what the preview shows, with no stop and no dark gap. The arm dialog offers **Arm with this look** (or **Stop everything, then arm**) whenever something runs.
- **The live-state file records more.** It now holds every running cue with its position, master levels, the programmer and its effects, kills and blackout, besides the scene, page, master, tempo and lock.
- **A deliberate restart offers Resume too.** Stopping the engine while armed, with *keep the last look* on, offers Resume (`runtime.resume.reason: "restart"`) for 30 minutes. A crash offers it as before.
- **Resume restores everything first and arms output last,** so the first packet out is the whole look. It no longer fires the page entry's sends: the old resume re-sent ProPresenter its MIDI note. `resume.apply` returns how many cues came back and which are no longer in the show.

### Intensity limits (operator rule: face lights at most 12%)

- **The cap.** `limit.set {group, max}` / `lights_limit_set` caps a group's output. It applies after the grand master, park and kills, over every cue, scene, master, the programmer, Highlight and the preview. Blackout and kills still reach zero.
- **Overlaps and edits.** A fixture in several limited groups takes the lowest limit. Deleting a group drops its limit. Changing limits is a show edit, so the performance lock refuses it.
- **Where it lives.** Limits are saved in `show.limits`, listed in the pre-show check, and set on the desk with **Limit intensity…** in the group's right-click menu.
- **Migration.** A show that has never had limits and has a `face-lights` group gets `face-lights` at 0.12, once. An operator who later removes it keeps it removed.

### Audit log (medium)

On 2026-11-01 the log took up to 7 137 lines an hour: a line per drum hit, per key press, per knob step and per fader move.

- **High-rate controls are tallied.** Master presses and let-gos, fader and knob moves, sound hits, flash let-gos, find steps, selection changes and meter keep-alives become one line a minute, e.g. `Live controls in the last minute: masters.trigger ×120 (m2 ×80, m3 ×40) · sound hit ×64 …`. Show events are still logged one by one: GO, scenes, cue release, arm, kills, locks, edits and errors.
- **Rotation is fixed.** At 2 MB the log is renamed to `.previous` before the next file opens. It used to rename after opening, so new lines followed the old file.
- **The "Master 0" bug is fixed.** `masters.sound` logged "Master 0 sound trigger on" because it looked the slot up in the show it had just replaced.

### Runtime stream (medium)

`/api/events` sent the whole runtime (about 40 kB, 95% of it frames) ten times a second. While output is armed the packet counter changes every frame, so the stream never settled during a show.

- **Deltas for the desk.** `/api/events?delta=1` (`engine/stream.mjs`) sends only changed frame attributes, rounded to 6 decimals, finer than a 16-bit DMX step. Other runtime fields go only when they change. Packet counters and `tickCount` ride along but never cause a message by themselves.
- **The desk merges them.** The desk and the pop-out visualizer merge deltas (`public/stream.js`) and keep unchanged frame objects, so the stage skips re-resolving them.
- **Late joiners.** A desk that connects late starts from the last broadcast state.
- **Compatibility.** Plain `/api/events` is unchanged for other clients. A new desk on an old server still works: it gets full messages.

### Other live-run fixes

- **Running cues take edits at once.** `cue.save` reaches running copies (look, tracks, tempo, speed) and keeps their position. A Note step chase keeps its light. A saved preview of the cue updates too.
- **Tap tempo.** A tap more than 40% off the beat starts a new count and changes nothing until the next tap confirms it. `runtime.tempo.far` and `ratio` flag a live tempo below 0.75× or above 1.33× the cue's own; that is how 58 BPM made the BPM cues crawl. The GO bar shows it amber with the rate, and **Shift+T** (also ↺ and the APC40 Metronome button) goes back to the cue's own tempo. The status no longer changes every frame (`anchorAt` replaces `anchorAgo`).
- **Blind GO previews.** In Blind, the desk's GO and Space preview the next entry (`preview.cue`), and the button reads PREVIEW. **Send to live** or **Shift+Space** plays it. Masters, sound triggers and OSC/MCP `page.go` stay live. The operator expected Blind to keep GO off the stage.
- **Strobes.** A strobe whose flash or gap is shorter than two 30 Hz frames, at the live tempo, is flagged in the pre-show check and `runtime.health`. That means keeping to 5 Hz at 50% duty. Nothing is changed automatically.
- **Autosave.** The open show file is written once edits have been quiet for 10 s (at most every 2 minutes) and when the performance lock goes on (`show.autosave`, on by default, this Mac's setting). The show had been unsaved since 06:35.
- **Versions.** The versions folder keeps the newest 50 plus one a day for 90 days, so it stops growing.
- **Health banner.** `runtime.health` lists what is wrong right now: Art-Net failing, engine errors, sound input lost or silent, the default input, strobes too fast. The desk shows it above the GO bar.

### Re-verified earlier fixes

Each of these has a test:

- **Stale desk:** a desk on old code reloads when it reconnects to new code (`tests/desk-reload.test.mjs`).
- **Kill:** held flashes and sound hits punch through a kill (`tests/kill-parts.test.mjs`).
- **Faders:** a fader at 0 releases only what its master started, and a toggle pressed at level 0 comes up full (`tests/kill-parts.test.mjs`, `tests/live-show.test.mjs`).
- **Part cues:** they apply their tracks only while a track runs (`tests/kill-parts.test.mjs`).
- **Sound panel:** a follow trigger switched off lets go of its cue, and an off trigger is metered but never fires (`tests/live-show.test.mjs`).

## What can change without restarting the engine

| Change | How it takes effect live |
| --- | --- |
| Desk files (`public/*.js`, `.css`, `.html`) | The engine watches `public/` (`engine/desk-build.mjs`). Open desks show **Reload the desk** and never reload by themselves, since a reload lets go of held keys. `runtime.desk.build` is the readback. Only for a desk that matches the running engine (see step 3 above). |
| Sound and MIDI module code (`engine/modules/*.mjs`) | `modules.reload` / `lights_modules_reload` re-imports them and restarts the helper. Sound triggers and the APC40 drop for about a second, and follow cues are let go. |
| The native helper binary | Toggling the module, or `modules.reload`, starts the new binary. |
| Show data: cues, masters, limits, scenes | Live as always. Cue edits now reach running cues at once. |
| Everything else in `engine/` and `server.mjs` | Needs a restart. Restart between songs if it must happen during a service: with *keep the last look* on the rig holds, the new engine offers Resume, and one press brings back the whole look with output armed last. |

Controller maps (`engine/controllers/`) are imported by the MIDI module once, so they also need a restart.

## Measurements

Measured on a copy of the live show (171 fixtures), Apple silicon, Node 26. The scenario: the Praise page with the scene, Energy chase on master 8, and output armed.

| What | Before | After |
| --- | --- | --- |
| Runtime stream, cue running, output armed | 397 KB/s, 40 messages in 4 s | 22 KB/s (delta stream) |
| Runtime stream, settled look, output armed | 397 KB/s (never settled) | 1 message in 4 s |
| Same, over the real server from the browser, 3 s | 424 KB/s (`/api/events`) | 26 KB/s (`?delta=1`, including its first full message) |
| Engine tick | 0.47 ms | 0.48 ms |
| `tests/perf.test.mjs` tick, 232 fixtures | under 4 ms | under 4 ms, now with the limit, a kill and the delta stream encode in the budget |
| Audit lines for 100 sound hits and 100 key presses | 301 | 0, plus one tally line a minute |
| Audit growth, busiest hour on 2026-11-01 | 7 137 lines (~500 kB) | about 60 tally lines plus show events (estimate) |
| A show edit (e.g. `masters.sound`) | 11.7 ms | 11.7 ms (unchanged, see below) |

## What remains

| Severity | Risk | Notes |
| --- | --- | --- |
| High | Running the app today lacks every fix above | Apply between shows (see the top). Until then, a network blip still disarms output, and a Dante drop still leaves triggers deaf until a restart. |
| High | APC40 grid row order, Dante channels 17–27 and ProPresenter mapping not hardware-tested | Unchanged from earlier notes (docs/MIDI-AND-SOUND.md). |
| Medium | Disarming during a network fault | `output.disarm` sends five dark frames, then closes. If none arrive, the console holds the last lit frame. The desk now shows the failing state, so check before disarming. |
| Medium | Kills, park and limits apply only to output this engine sends | A Hog playback or programmer on the same fixtures is not affected. |
| Medium | Tick errors still freeze the rig at its last frame | Output stays armed and the banner says so, but the engine does not drop the cue that throws. Stop, or release the newest cue. |
| Low | A show edit blocks the engine for about 12 ms | Validation 4.7 ms, clone 2.5 ms, file write 2.3 ms. One late tick at most; fine at 30 Hz. |
| Low | A stale `engine.pid` with a reused PID | The watchdog would think the engine is alive and not restart it. Only after a crash and a PID collision. |
| Low | The meter watchdog needs meter messages | The engine treats a stopped meter as a lost stream only after the helper has sent at least one meter for the open input, so helpers that never meter are never closed by it. |
| Low | Resume restarts timed cues at their saved position | The position is from the last live-state write (at most a second old), not compensated for the restart time. |

## New commands (MCP)

| Command | MCP tool | |
| --- | --- | --- |
| `masters.status` | `lights_masters_status` | Read every slot and shared cues with warnings |
| `masters.own {slot, id?, name?}` | `lights_masters_own` | Give a master its own copy of its cue |
| `limit.set {group, max?}` | `lights_limit_set` | Cap a group's intensity; no `max` removes it |
| `modules.reload` | `lights_modules_reload` | Re-import module code and restart the helper |
| `show.autosave {enabled}` | `lights_show_autosave` | Autosave of the open show file |
| `output.arm {confirmation, keepLook?}` | `lights_output_arm` | `keepLook` arms with the running look |

Readback: `runtime.health`, `runtime.desk`, `runtime.tempo.far/ratio/anchorAt`, `runtime.resume.reason/running/overrides/kills`, `runtime.showFile.autosave`, `output.status` `sending/failing/errors/rebinds`, `sound.status` `input/silentFor/warnings/channels`, `modules.status` `version` and `helper.restarts`.

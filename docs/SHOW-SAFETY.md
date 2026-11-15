# Show safety: performance lock, versions, pre-show check, crash resume

Added 2026-10-29 so a mistake or a crash during a service never costs the show.

## Performance lock

- **Locking.** The padlock in the top bar locks with one click; unlocking means holding it for a second. MCP: `lights_performance_lock {enabled}`, read back from `runtime.locked`.
- **What is refused.** While locked, every command that changes the saved show is refused, for people and for agents. That is the `SHOW_EDITS` list in `engine/spec.mjs`: cues, pages, scenes, master set-up, patch, groups, positions, settings, import, restore and controller profiles. Media upload (`server.mjs`) is refused too.
- **What keeps working.** Playback, masters, tempo, scenes, Override and Clear, Blind, blackout and output. Tuning a master's sound trigger (channel, band, sensitivity, hold, gap) stays open too: it is a live adjustment, like a fader.
- **On the desk.** Build and Library show a "Locked for the show" banner, and the edit controls are dimmed.
- **Pre-show snapshot.** Turning the lock on saves a version of the show.
- **Restarts.** The lock survives an engine restart, because it is kept in the live-state file.

## Show versions

`engine/safety.mjs` writes timestamped copies of the show to `<data>/versions/`:
- **When.** At most one per five minutes of edits, and always before an import or a restore and when the lock goes on.
- **How many.** It keeps the newest 50 plus the last one of each older day.
  - Pruning never removes the copy just written, nor the 50 newest by modified time (so a Mac clock set wrong cannot make new copies look old). It only removes StageLight's own timestamped files.
- **Disk errors (2026-11-14).** Every file the engine writes goes through `writeAtomic` in `engine/safety.mjs`: a temporary file, flushed to disk, then renamed over the old one. These are versions, show files, `show-files.json` and `live-state.json`.
  - A full disk or a read-only folder leaves the previous file whole, with no temp file behind, and gives a plain error, for example "Could not save …/Sunday.json: the disk is full (ENOSPC)".
  - The five-minute copy after an edit never fails the edit, because the show is already saved. It retries 30 s later.
  - Copies taken before an import, a restore or the lock do refuse when they cannot be written, so the step never runs without its backup.
- **Restoring.** Settings → Show versions lists them, newest first, with **Restore**. MCP: `lights_show_versions`, `lights_show_restore {id}`.
  - Restoring saves the current show as a version first, so it can be undone.
  - This Mac's network settings are kept.
  - It is refused while output is armed or the show is locked.

## Pre-show check

☰ → **Pre-show check**, or `lights_show_check {network?}`. It sends no DMX. The rows:

- **Network.** Every step of the Art-Net path: source adapter, subnet, ping, ArtPoll.
- **Output.** Whether it is armed.
- **Universes.** Whether every universe is routed.
- **Fixtures.** Enabled and unverified fixtures. Unverified ones are preview only and never sent.
- **Saved.** The latest saved version.
- **Lock.** Whether the performance lock is on.
- **Timing.** Engine timing, as slow frames since start.
- **Modules.** The helper, the sound device and the APC40.
- **Rig check.** A rig check page with a cue.

**Run rig check** GOes that page's first cue. **Lock for the show** turns the lock on.

## When the engine stops

- **Closing the window** never stops the engine: it runs on its own, and the next launch attaches to it.
- **Stopping the engine** (a quit signal, an update, a restart) while armed just stops sending, so the rig keeps its last look, as after a crash. This is the default since 2026-10-30.
- **Black out on stop instead.** Turn off Settings → *When the engine stops* → *Keep the lights at their last look* (`lights_settings_set {holdOnStop: false}`, saved as `show.playback.holdOnStop`). Stopping the engine then closes shutters, sends zero intensity five times, then stops sending.
  - Turning output off (`output.disarm`) still blacks out.
  - What the console does once Art-Net stops (hold or release after a timeout) is its own setting. On 2026-10-30 the operator closed the window with output armed and the lights stayed on.

## Crash resume

- **Live-state file.** The engine mirrors what is live to `<data>/live-state.json` a second after it changes: armed, scene, page and cue, master, tempo, lock. A normal shutdown marks the file clean.
- **Watchdog.** In the desktop app, if an engine the app started stops answering for three seconds, the shell starts it again (`watch()` in `src-tauri/src/engine.rs`). An engine stopped on purpose (no `engine.pid`) is left alone.
  - It never loops fast. Each attempt waits up to 20 s for the engine to answer, then the watchdog needs 3 more seconds of silence before trying again: at most one start about every 23 s.
  - It only restarts an engine whose process has exited. An engine that is alive but stuck is not killed (it may still be sending the look).
- **The engine does not stop for a stray error (2026-11-14).** `server.mjs` catches any unhandled rejection or uncaught exception, writes it to the audit log ("Engine kept running after …") and to stderr (`engine.log` in the app), and keeps running. The same error is reported at most once per 10 s and at most 20 reports a minute, with a count of what was held back.
- **No frozen queue.** Desk, OSC, MCP and APC40 commands run one at a time. A command still running after 20 s is logged ("… is still running after 20 s") and the commands after it go ahead.
- **Unreadable show at startup (2026-11-14).** If `<data>/show.json` cannot be read or fails validation, startup keeps a copy as `show.unreadable-<time>.json` and tries each copy in `<data>/versions`, newest first. It starts with the first one that loads and logs: "Startup: show.json could not be read (…). It was kept as … and the show was restored from version …. Check the show before arming."
  - If no version loads, the bad file is put back and the engine exits with a message naming it, so a restart never comes up on an empty show.
  - A readable show is never touched when something else fails to start.
  - Corrupt `live-state.json` (no resume offer) or `show-files.json` (default folder, no current file) never stop the engine starting.
- **Big shows.** `/api/command` takes bodies up to 32 MB, so `show.import` of a large show works from the desk (the live show was about 440 000 characters on 2026-11-14). Above 32 MB the answer is 413 "Request too large: the limit is 32 MB".
- **Startup.** If the file was not clean, the new engine comes up **disarmed**, as always, and offers to resume. The desk shows "The engine restarted at 20:14 during the show. Resume puts it back: arm output · scene Warm base · Your Great Name cue 3 · 104 BPM", with **Resume** and **Dismiss**.
- **Resume.** Resume (`lights_resume_apply {confirmation: "ENABLE_PHYSICAL_OUTPUT"}`) re-arms, restores master, tempo and the scene, and GOes the page entry that was live. Nothing resumes by itself (AGENTS.md: no automatic startup playback).

## Faults during a show — 2026-11-14

Once output is armed, only the operator switches it off.

- **A send fails or the lighting network drops.** Output stays armed and keeps sending. The fault is logged once per outage, `output.status` reads `failing: true` with `lastError` and `sendErrors`, and the desk shows an amber bar over the stage and "LIVE · NOT SENDING". After two seconds of failures, or straight away if the socket itself fails, the engine reopens the socket and retries every second until packets go out again. Nothing has to be stopped or re-armed.
- **A frame cannot be built.** The engine sends the last good frame again, so the rig holds its look, and reports it in `runtime.engineError`. If three frames in a row fail it lets go of the newest thing running (a preview, then programmer effects, then cues from the newest down, then the programmer) and tries again, until frames build.
- **A code effect fails.** Only that effect is skipped; its fixtures keep the look underneath (docs/CODE-EFFECTS.md).
- **The disk refuses a save.** The edit still takes effect. `runtime.showFile.error` and the pre-show check say so until a save works again.
- **The Mac wants to sleep.** While output is armed the engine holds it awake (`caffeinate`), display included, and lets go on disarm.

The network recovery has been tested with stand-in sockets, not by pulling the cable on the venue network. Try it once at the venue: arm, pull the cable for five seconds, plug it back, and watch the bar clear.

## Undo — 2026-11-14

- `override.undo` (⌘Z) undoes the last change in the programmer. A slider drag is one step. Clear can be undone.
- `show.undo` (⇧⌘Z) puts the show back as it was before the last edit. It works while armed and never stops what is playing; pressing it again redoes the edit. The performance lock refuses it, like any edit.
- Every delete writes a show version first (at most one per 10 seconds), so older states are in `show.versions`.

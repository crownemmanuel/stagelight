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

## Crash resume

- **Live-state file.** The engine mirrors what is live to `<data>/live-state.json` a second after it changes: armed, scene, page and cue, master, tempo, lock. A normal shutdown marks the file clean.
- **Watchdog.** In the desktop app, if an engine the app started stops answering for three seconds, the shell starts it again (`watch()` in `src-tauri/src/engine.rs`). An engine stopped on purpose (no `engine.pid`) is left alone.
- **Startup.** If the file was not clean, the new engine comes up **disarmed**, as always, and offers to resume. The desk shows "The engine restarted at 20:14 during the show. Resume puts it back: arm output · scene Warm base · Your Great Name cue 3 · 104 BPM", with **Resume** and **Dismiss**.
- **Resume.** Resume (`lights_resume_apply {confirmation: "ENABLE_PHYSICAL_OUTPUT"}`) re-arms, restores master, tempo and the scene, and GOes the page entry that was live. Nothing resumes by itself (AGENTS.md: no automatic startup playback).

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
- **How many.** It keeps the newest 50 plus the last one of each older day, for 90 days (since 2026-11-01; the folder used to grow by a file a day for ever).
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
- **Engine** (2026-11-01). Shown only while frames are failing.
- **Masters sharing a cue.** A cue on several masters: while one holds it at full, the others' flashes show no change (docs/MASTERS-AND-SCENES.md).
- **Strobe rates.** A strobe whose flash or gap is under two 30 Hz frames: keep to 5 Hz at 50% duty.
- **Intensity limits.** Each capped group and its maximum (`limit.set`).
- **Sound input signal and device.** Digital silence on the whole input, and the *System default input* setting.

The output row fails, not just warns, while output is armed but its sends are failing (docs/PRODUCTION-READINESS.md).

**Run rig check** GOes that page's first cue. **Lock for the show** turns the lock on.

## When the engine stops

- **Closing the window** never stops the engine: it runs on its own, and the next launch attaches to it.
- **Stopping the engine** (a quit signal, an update, a restart) while armed just stops sending, so the rig keeps its last look, as after a crash. This is the default since 2026-10-30.
- **Black out on stop instead.** Turn off Settings → *When the engine stops* → *Keep the lights at their last look* (`lights_settings_set {holdOnStop: false}`, saved as `show.playback.holdOnStop`). Stopping the engine then closes shutters, sends zero intensity five times, then stops sending.
  - Turning output off (`output.disarm`) still blacks out.
  - What the console does once Art-Net stops (hold or release after a timeout) is its own setting. On 2026-10-30 the operator closed the window with output armed and the lights stayed on.

## Output during network faults — 2026-11-01

Armed is the operator's decision. A failed Art-Net send (the lighting adapter dropping for a moment, `EADDRNOTAVAIL`) no longer closes output, which on 2026-11-01 left the rig frozen for five minutes. Every frame is still sent. The failure is logged once and then every 10 s, and after 5 s the socket is rebound to the source address, every 5 s, until sends work again. `output.status` gives `sending`, `failing`, `errors` and `rebinds`. `runtime.health` and the desk banner say so while it lasts. A tick that throws also keeps output armed and logs once instead of 30 times a second.

## Health banner

`runtime.health` is a list of what is wrong right now, worst first: `{id, level: error|warn, message}`. It covers Art-Net sends failing, engine frames failing, the sound helper down, the sound input lost or silent, the *System default input* setting, and strobes too fast at the live tempo. The desk shows it above the GO bar, along with the **Reload the desk** offer when desk code changed on disk.

## Crash resume

- **Live-state file.** The engine mirrors what is live to `<data>/live-state.json` a second after it changes: armed, scene, page and cue, master, tempo, lock, and since 2026-11-01 every running cue with its position and master, master levels, the programmer and its effects, kills and blackout. A normal shutdown marks the file clean. A shutdown while armed with *keep the last look* on also marks it `held`.
- **Watchdog.** In the desktop app, if an engine the app started stops answering for three seconds, the shell starts it again (`watch()` in `src-tauri/src/engine.rs`). An engine stopped on purpose (no `engine.pid`) is left alone.
- **Startup.** If the file was not clean (a crash), or was `held` less than 30 minutes ago (a deliberate restart while the rig held its look, e.g. to take an engine fix), the new engine comes up **disarmed**, as always, and offers to resume. `runtime.resume.reason` is `crash` or `restart`. The desk lists what comes back, for example "arm output · scene Warm base · Praise cue 3 · 3 running cues (…) · 2 manual changes · 104 BPM", with **Resume** and **Dismiss**.
- **Resume.** Resume (`lights_resume_apply {confirmation: "ENABLE_PHYSICAL_OUTPUT"}`) restores the grand master, tempo, scene, every running cue at its position, the page cue, master levels, the programmer, kills and blackout, then re-arms output last, so the first packet is the whole look with no dark gap. It no longer fires the page entry's sends (MIDI to ProPresenter, Look Link). Cues a held flash or sound hit started, and follow triggers' cues, are left out: they are moments, and the sound brings follow cues back itself. Nothing resumes by itself (AGENTS.md: no automatic startup playback).
- **Arming with something running.** Without Resume, `output.arm {keepLook:true}` (the arm dialog's **Arm with this look**) arms with whatever the preview shows, instead of the old stop, clear, arm and replay.

# Tap tempo, sound triggers, MIDI and the APC40 mkII

Added 2026-10-29 for the operator's own venue. Agents build the cues; these are the tools a person uses to run them with a live band.

## Tap tempo

- **Live tempo.** Tap **T** or the BPM button in the GO bar on the beat. Two or more taps less than 2 s apart set the live tempo, from the average of the last four. ½ and ×2 halve or double it, and ↺ goes back to each cue's own tempo.
- **What follows it.** A cue with a `bpm` plays at *live tempo ÷ its bpm*. Its tracks, effect speeds, strobe rates, loops and auto-follow waits all speed up or slow down together. Changing the tempo never makes a running cue jump, because every running cue's clock is rebased at that moment (`rebase()` in `engine/engine.mjs`).
- **What doesn't.** Crossfades, releases and scene fades stay in real seconds.
- **Cue BPM.** Cues whose notes say "at 102.975 BPM" got that `bpm` once, by migration. Agents set it with `cue.save`.
- **Saving.** The live tempo is not saved. The GO bar shows *CUE* while you are on the cue's own tempo, and *TAP* or *BPM* once a live tempo is set.
- **MCP:** `lights_tempo_tap`, `lights_tempo_set {bpm?}`, `lights_tempo_scale {factor: .5|2}`, `lights_tempo_nudge {delta}`. Read the result back from `runtime.tempo`.
- **A stray tap (2026-11-01).** A tap more than 40% off the beat starts a new count and changes nothing until the next tap confirms it, so one late tap can no longer leave the cues at 58 BPM.
- **Far from the cue's tempo.** `runtime.tempo.far` and `ratio` flag a live tempo under 0.75× or over 1.33× the running cue's own. The BPM button turns amber and shows the rate (×0.48). **Shift+T** goes back to each cue's own tempo, as do ↺ and the APC40 Metronome button.
- **Not yet:** realigning the beat phase to the band; for now a tap sets the speed only (see [ROADMAP.md](ROADMAP.md)).

## Master levels (faders)

Every master has a level from 0 to 1. Drag the fader (the cap on the right of a master), move an APC40 fader, or call `lights_masters_level {slot, level}`.

- **What it changes.** The level scales the intensity of the cue that master started, and nothing else.
- **Like a Hog fader.** Raising it from 0 starts the cue. Bringing it back to 0 releases the cue, but only if the fader started it; a cue started with the key stays at level 0.
- **Flash beats the fader.** A held flash (key, APC40 pad or sound hit) plays the master at full and on top, whatever its fader says, like a Hog flash button. Over its own cue that is already running, it bumps that cue to full and to the top until you let go, then the fader level applies again.
- **Saving.** Levels are live only and never saved. Read them from `runtime.masters.levels`.

## Modules

Sound triggers and MIDI are **modules**, off by default. Switch them in Settings → Modules, or with `lights_modules_set {sound:{enabled, device}, midi:{enabled, virtualPort}}`.

- **Off means not loaded.** The engine imports `engine/modules/` only while one is on. No helper process runs, no port is open, no audio device is used, and nothing is added to the 30 Hz tick: modules react to events (a hit, a MIDI message, a GO) and to the end of each command.
- **Tested.** `tests/live-show.test.mjs` checks that a show with modules off has no helper and no module fields in its runtime.
- **The native helper.** The work is done by `stagelight-io` (`src-tauri/io`, Rust: `cpal` for CoreAudio, `midir` for CoreMIDI). The engine starts it when the first module goes on and stops it when the last goes off.
  - It speaks newline-delimited JSON on stdin/stdout. The full protocol is at the top of `src-tauri/io/src/main.rs`.
  - The desktop app bundles it next to its Node. A dev build uses `src-tauri/target/{debug,release}/stagelight-io`, and `LIGHTS_IO_BIN` overrides both; the tests point it at `tests/fixtures/fake-io.mjs`.
  - Without the helper, the module reports "helper not installed" and nothing else changes.
  - **When something fails (2026-11-14).** Tested in `tests/modules-resilience.test.mjs` with a misbehaving fake helper (`tests/fixtures/fake-io-flaky.mjs`).
    - *Helper exits.* It is started again after 1, 2, 5, 10, then every 30 s. The count starts over once it has run for a minute. Each restart is logged ("The native helper stopped (code)", "Restarting the native helper in 1 s"). `modules.status` → `helper.restarts` and the pre-show check show the count.
    - *Helper stops answering.* After 15 s with no output the engine asks for the device list. With no answer within 10 s, it kills the helper and restarts it ("The native helper stopped answering"). This check runs every 5 s, not per frame.
    - *After a restart.* The helper's first device list makes the modules reopen everything: the sound input with its triggers (and the meter, if it was on), the virtual "StageLight" port, and the APC40. The APC40 gets its introduction and every LED again. Shift and fader pickup start over.
    - *Sound card unplugged, or Dante stopped.* When the chosen device leaves the device list, its stream is closed and the sound check says "not connected" ("Sound: “…” is not connected; it opens again when it is back"). When it comes back, a fresh stream opens ("… is back"). An "Audio input" error from CoreAudio while the device is still listed closes the input and opens it again 2 s later, at most every 10 s.
    - *APC40 unplugged.* It is closed, and a held Shift is forgotten. Plugged back in, it reconnects with its LEDs. As before, the helper finds it within about 2 s.
    - *Follow cues.* A cue that a follow trigger is holding up lets go, as after 2 s of silence, in four cases: the helper stops, the input is lost, levels stop arriving for 2 s, or sound is switched off. An engine shutdown leaves it as it is (the last look holds).
    - *Bad helper output.* Lines that are not JSON objects, or that have the wrong shapes, are dropped. Only finite dBFS numbers and whole MIDI bytes are used. Nothing throws inside the stream handler, and the same helper message is logged at most once per 10 s.
    - *Metronome.* The Metronome LED blink is kept to 20–300 BPM, so a wild tempo cannot run a fast timer.
  - **Reloading module code.** `modules.reload` (`lights_modules_reload`) re-imports `engine/modules/*.mjs` from disk and restarts the helper, so a module fix (or a new helper binary) takes effect without restarting the engine. Sound triggers and the APC40 drop for about a second, and follow cues are let go. `modules.status` gives `version`.
  - **Hot-plug (2026-10-30).** The helper rescans every 2 s, but CoreMIDI only updates a process's device list through the run loop that was current when the process made its first MIDI client. The helper therefore makes that first client on its own thread running `CFRunLoopRun`. Before this fix, a running helper never saw an APC40 plugged in after it started, and the desk said "not connected" even though macOS had found the controller.

## Sound triggers

A kick (or any drum) on an audio input flashes a master.

1. Turn on **Sound triggers** in Settings → Modules and choose the input device: **Dante Virtual Soundcard**, or any interface, listed with its channel count.
2. Open the master's ⚙ (for example a "Backlight hit" master). Under **Sound trigger**, pick the input channel the kick is on and the band: Kick, Snare, Hat or Full.
3. Set **Sensitivity** against the live meter. Each hit that crosses the white line flashes the master. **Hold** is how long each hit holds the cue (default 80 ms), and **Gap** is the shortest time between hits (default 90 ms). **Test hit** fires it once.

### When the input goes away — 2026-11-01

On 2026-11-01 the network blip at 02:14 took Dante Virtual Soundcard away, and the helper kept the dead stream. Asked to open the same device again, it reused it, so the triggers stayed deaf until the engine restarted.

- **Reopening.** On the helper's input error, or when its meter (about 15 messages a second while an input is open) stops for 3 s, the engine closes the input and opens it fresh every 2 s until it works. Every change is logged. The new helper also never reuses a stream that reported an error.
- **Follow cues.** A follow trigger's cue is let go when no level arrives for 2 s (input or helper gone), when the module turns off, and when the trigger is switched off, removed or changed to another mode.
- **Dead feed.** No audio at all on the whole input (every channel under −80 dBFS) for 20 s with triggers on raises a warning in `runtime.health`, the desk banner and the pre-show check: check Dante Controller and the console's Dante card.
- **Device changes.** They are logged with both names (`Sound input device · A → B`). Choosing *System default input* warns, because it follows macOS, which can switch to the MacBook microphone by itself, and a switch underneath it is logged.
- **Seeing the audio.** The sound panel shows the trigger's channel, the **whole input** (the loudest channel, so you can see audio is arriving even when the trigger's channel is quiet) and, with the new helper, a strip of every channel. A channel is green when it carries audio, and the trigger's channel is outlined. `sound.status` gives `input`, `silentFor`, `warnings` and, while metering, `channels`.

### Step on notes

The third mode, for keys and melodic parts: each note moves a chase on by **one light**, instead of flashing or following the level.

- **The cue.** Use the **Note step** effect (`step`, intensity layer) on a group. It is dark until the first note, lights one fixture per note in group order and wraps round. It reads no time, so play faster and the lights chase faster; hold a note and that light stays; the next note moves it on.
- **The master.** Give it the cue with action **toggle**, and a sound trigger with mode **Step on notes**. The key starts and stops the experience; hits never start or release the cue, they only step it while it runs.
- **Crossfade.** Each step crossfades over 40% of the time since the previous note (at least 30 ms, at most 0.3 s): slow playing glides, fast playing snaps.
- **Not saved.** The step position lives in the running copy of the cue and starts again from the first light each time the cue starts.
- **MCP:** `lights_masters_step {slot}` steps it once, like a note; `lights_sound_test {slot}` does the same through the trigger.
- **Keys over audio.** Detection is onset-based, so a sustained pad or a chord with a slow attack may not count as a new note. Tune Sensitivity and Gap against the meter.

### Input names

Name each sound card channel after what the mixer sends on it, in Settings → Modules → **Input names** (editable with the module off). Every sound trigger's channel picker then reads "3 · KIK IN" instead of "Input 3". The names are saved in the show as `audioInputs [{channel, name}]`. MCP: `lights_sound_inputs` reads them; `lights_sound_inputs_set {inputs:[{channel, name}], replace?}` names or renames channels, and an empty name removes one.

The venue's dLive sends channel direct outs 1:1 to Surface I/O Port 5 (photographed 2026-10-30), so Dante channel *n* is mixer input *n*: 1 SUB KIK, 2 KIKOUT, 3 KIK IN, 4 SN1TP, 5 SN1BT, 6 SN2TP, 7 SN2BT, 8 HIHAT, 9–13 TOM 1–5, 14/15 OH L/R, 16 RIDE, 17 LoopDrum, 18/19 SPD L/R, 20 Bass, 21/22 GTR L/R, 23/24 FANTOM L/R, 25/26 MONTG L/R, 27 MONTG2 L. Only 1–16 are visible patched in the photos; 17–27 assume the same diagonal.

### Switching a trigger on and off live

During the show, switch a master's sound trigger off and on without opening its editor:
- **Shift + the master's key** (Shift+A for master 1), unless that combination is itself a key (Shift+H is Highlight).
- Click the waveform badge on the master. A crossed-out badge and a dimmed meter mean it's off.
- On the **APC40 mkII**, the numbered **Activator** buttons under the faders switch the fader bank's masters, and stay lit while on. Any controller button can be mapped to *Sound trigger on/off* in the profile editor.

The channel, band and sensitivity are kept, it works while the show is locked, and a hit already on its way is ignored. MCP: `lights_masters_sound {slot, enabled?}` (leave `enabled` out to toggle).

### Follow the level

For guitar, keys, pads and vocals, set the trigger's mode to **Follow the level** instead of **Flash on hits**.

- **What it does.** The master's level rides the channel's loudness, so the lights breathe with the instrument: brighter as it plays louder, fading as it fades.
- **Sensitivity** sets where the lights start: the white line on the meter. **Range** is how many dB above that they reach full (the blue mark; default 24).
- **Attack and release** smooth the movement (defaults 30 ms and 300 ms). A longer release gives a slower, softer fade.
- **Starting and stopping.** It works like a fader the band plays. Sound starts the cue, and quiet passages keep it running dark, so it picks up instantly on the next note. After 2 s of silence the cue is released.
- **Test swell** brings it to full and back.
- **Under the hood.** The helper sends follow levels about 30 times a second, only for follow triggers. The engine applies them through `masterLevel` without logging each update.
- **Saving.** Saved as `sound {…, mode: "follow", rangeDb, attackMs, releaseMs}`.

How it works:
- **Filtering.** The helper filters each trigger's channel: kick is a low-pass at 150 Hz, snare a band of 200 Hz–4 kHz, hat a high-pass at 6 kHz, full is unfiltered.
- **Detection.** It follows the peak level. A hit is the level rising through the threshold at least *gap* after the last hit, and it re-arms once the level falls 6 dB below the threshold. So a ringing drum or a held note is one hit, and a rise inside the gap is used up rather than fired late.
- **Sensitivity.** 0..1 maps to −6 dBFS (only the loudest hits) down to −60 dBFS (almost anything).
- **Timing.** Detection runs in CoreAudio's callback at 128-frame blocks. The engine presses the master and sends Art-Net at once, so a hit reaches the rig in a few milliseconds.
- **Saving.** Saved on the master as `sound {channel, band, sensitivity, holdMs, gapMs}`. MCP: `lights_masters_assign {slot, sound}`, `lights_sound_status`, `lights_sound_test {slot}`, `lights_sound_meter {on}`.
- **Microphone permission.** macOS asks once for microphone access, which covers every audio input, Dante included. The app's `Info.plist` says why. In a dev run the permission belongs to the terminal that started it.

## MIDI

**Virtual port "StageLight"** (on by default when MIDI is on):
- **What it is.** A MIDI source other apps on this Mac can listen to. In ProPresenter, choose StageLight as a MIDI input and map its notes to slides or macros. ProPresenter only reads notes, and listens on every channel.
- **On GO.** A page entry's sends can include `{message:"midi", note, channel?, velocity?}`. On GO the note is sent and turned off after 200 ms.
- **From a master.** A master's **MIDI note out** (`slot.midi {note, channel}`) sends note on while pressed and note off when let go, so a flash can hold a graphic up.
- **Testing.** `lights_midi_test {note}` sends one note, which is useful while mapping in ProPresenter.

### APC40 mkII

Plug it in over USB with the MIDI module on. StageLight finds it by name and puts it in **Ableton Live Mode**, where StageLight drives every LED. The mapping follows Akai's *APC40 Mk2 Communications Protocol* v1.2 (`engine/controllers/apc40mk2.mjs`).

Default map:

| Control | Does |
|---|---|
| 40 clip pads | masters 1–40, top-left = master 1 (press = the master's key: flash by default) |
| Faders 1–8 | levels of the 8 masters in the fader bank (masters 1–8 = A S D F G H J K to start) |
| Track select 1–8 | press the fader bank's master |
| Clip stop 1–8 | release the fader bank's master |
| Master fader | grand master |
| Solo 1–8 | kill the fader bank master's lights, for masters with **Solo kills its lights** ticked: off over everything until pressed again, LED lit while killed (docs/KILL.md, 2026-11-01). |
| Record Arm 1–8 | the fader bank master's sound trigger on/off, same as the Activators. Its red LED is lit while that master's trigger is on (operator request 2026-10-31). |
| Device knobs 1–3 | intensity, pan and tilt of the desk selection (pan and tilt only on moving heads). Each knob picks up from the first selected fixture's value (the programmer value, before the grand master) and picks up again after the selection changes, so nothing jumps. 128 steps, so pan moves about 4° a step on a 540° head. Added 2026-10-31. |
| Scene launch 1–5 | scenes 1–5 (press the active one again to release it) |
| Stop all clips | Stop: every cue, back to the scene |
| Play / Stop | GO / Back |
| Record | Blackout |
| Session | Highlight |
| Master | Clear |
| Tap tempo | tap |
| Nudge − / + | −1 / +1 BPM; with Shift: half / double time |
| Tempo knob | ±0.1 BPM per step |
| Metronome | back to the cue's own tempo (its LED blinks on the beat) |
| Bank ◀ ▶ and bank select ◀ ▶ | move the fader bank by 8; the eight masters it controls are outlined on screen |
| Activator 1–8 | switch the fader bank masters' sound triggers on and off (lit while on) |

Behaviour:
- **Pad colours.** Each master has its own colour without anyone choosing one: by position, 1 red, 2 orange, 3 yellow, 4 green, 5 sky, 6 blue, 7 violet, 8 magenta, repeating every eight like the track numbers. A **pad colour** chosen in the master's ⚙ or the APC40 editor replaces it. Colours are matched to the nearest of Akai's 128 LED colours. Dim (Akai's own darker shade of that colour, so an idle cyan pad stays cyan rather than grey) means assigned, full means running, pulsing means held, blinking means paused, off means empty.
- **Only the pads are colour.** The 40 grid pads and 5 scene buttons have RGB LEDs. Clip Stop, Track Select, Activator and the other buttons have one colour: on, off or blinking. A master's colour can therefore only show on a pad.
- **Scene buttons.** They show each scene's own colour, and the active scene pulses.
- **LED traffic.** LEDs are diffed: only changes are sent.
- **Fader pickup.** After a bank change or at start, a fader takes over only once it reaches the value it controls, so nothing jumps.
- **Grid rows to check.** The protocol numbers the grid 1–40 (notes 0x00–0x27) but does not say which row is which. We take the top row as notes 32–39. Press the top-left pad with the editor open: it should light **Pad 1**.

**Visual editor** (Settings → Modules → MIDI → *Edit APC40 profile…*):
- **The board.** The unit is drawn from its own control table, with live LEDs. Press any real control and it lights and is selected.
- **Changing a control.** Choose what the control does; *With Shift held* gives a button a second function. **Test** runs the control as if pressed, **Default** puts one control back, and *Reset whole profile* puts them all back.
- **Master colours.** With no control selected, the side panel shows the current fader bank's eight masters as numbered chips. Pick one and choose a swatch: every swatch is a colour the pads show exactly, and the rainbow swatch takes any colour (the pad shows the nearest). Selecting a pad, track or clip-stop control that fires a master shows that master's swatches too. This is `masters.assign {color}` (`clearColor: true` goes back to the automatic colour), the same as *Pad colour* in the master's ⚙.
- **Masters on the desk (2026-10-30).** Two profile settings, also in Settings → Modules → MIDI: **track numbers 1–8 instead of keys**, and **pad colours** on the masters under the stage. Each is *Auto* (default: only while the APC40 is connected), *On* or *Off* (`lights_controller_save {deskNumbers, deskColors}`). Numbers repeat per fader bank of eight (master 9 is 1 of bank 2), matching the numbered track buttons. Keyboard keys still work and are named in the tooltip. The desk shows the colour the pad shows: `public/pad-colors.js` holds the palette and the colour rule for both the engine and the desk. `lights_midi_status` reads back the settings (`profile`) and every master's colour and pad colour (`masterColors`).
- **Saving.** Changes are stored in the show (`show.controllers`) through `lights_controller_save`; `lights_controller_reset` and `lights_controller_test` do the rest. `lights_midi_status` lists the ports, controls, current LEDs and the last input.

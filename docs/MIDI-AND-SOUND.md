# Tap tempo, sound triggers, MIDI and the APC40 mkII

Added 2026-10-29 for the operator's own venue. Agents build the cues; these are the tools a person uses to run them with a live band.

## Tap tempo

- **Live tempo.** Tap **T** or the BPM button in the GO bar on the beat. Two or more taps less than 2 s apart set the live tempo, from the average of the last four. ½ and ×2 halve or double it, and ↺ goes back to each cue's own tempo.
- **What follows it.** A cue with a `bpm` plays at *live tempo ÷ its bpm*. Its tracks, effect speeds, strobe rates, loops and auto-follow waits all speed up or slow down together. Changing the tempo never makes a running cue jump, because every running cue's clock is rebased at that moment (`rebase()` in `engine/engine.mjs`).
- **What doesn't.** Crossfades, releases and scene fades stay in real seconds.
- **Cue BPM.** Cues whose notes say "at 102.975 BPM" got that `bpm` once, by migration. Agents set it with `cue.save`.
- **Saving.** The live tempo is not saved. The GO bar shows *CUE* while you are on the cue's own tempo, and *TAP* or *BPM* once a live tempo is set.
- **MCP:** `lights_tempo_tap`, `lights_tempo_set {bpm?}`, `lights_tempo_scale {factor: .5|2}`, `lights_tempo_nudge {delta}`. Read the result back from `runtime.tempo`.
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

## Sound triggers

A kick (or any drum) on an audio input flashes a master.

1. Turn on **Sound triggers** in Settings → Modules and choose the input device: **Dante Virtual Soundcard**, or any interface, listed with its channel count.
2. Open the master's ⚙ (for example a "Backlight hit" master). Under **Sound trigger**, pick the input channel the kick is on and the band: Kick, Snare, Hat or Full.
3. Set **Sensitivity** against the live meter. Each hit that crosses the white line flashes the master. **Hold** is how long each hit holds the cue (default 80 ms), and **Gap** is the shortest time between hits (default 90 ms). **Test hit** fires it once.

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
- **Pad colours.** Pads show each master's **pad colour** (set in the master's ⚙), or its cue's page colour, matched to the nearest of Akai's 128 LED colours. Dim means assigned, full means running, pulsing means held, blinking means paused, off means empty.
- **Scene buttons.** They show each scene's own colour, and the active scene pulses.
- **LED traffic.** LEDs are diffed: only changes are sent.
- **Fader pickup.** After a bank change or at start, a fader takes over only once it reaches the value it controls, so nothing jumps.
- **Grid rows to check.** The protocol numbers the grid 1–40 (notes 0x00–0x27) but does not say which row is which. We take the top row as notes 32–39. Press the top-left pad with the editor open: it should light **Pad 1**.

**Visual editor** (Settings → Modules → MIDI → *Edit APC40 profile…*):
- **The board.** The unit is drawn from its own control table, with live LEDs. Press any real control and it lights and is selected.
- **Changing a control.** Choose what the control does; *With Shift held* gives a button a second function. **Test** runs the control as if pressed, **Default** puts one control back, and *Reset whole profile* puts them all back.
- **Saving.** Changes are stored in the show (`show.controllers`) through `lights_controller_save`; `lights_controller_reset` and `lights_controller_test` do the rest. `lights_midi_status` lists the ports, controls, current LEDs and the last input.

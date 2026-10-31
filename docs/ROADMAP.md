# Roadmap

What StageLight does not do yet, roughly in the order the operator's venue is likely to need it. The rule from AGENTS.md holds for every item: available through MCP in the same change, and a module that is off must not load or run.

## Running the show
- **Beat-phase lock.** Today tap tempo sets the speed, not where the "one" is. Add a downbeat tap, or phase-align to the next tap, so beat-locked cues land on the band's bar.
- **BPM from audio.** Follow the band's tempo from the kick (the sound module already detects it), or from MIDI clock.
- **Group and inhibitive masters.** A level per group ("face lights 80%") that caps every cue on those fixtures; on screen first, then on controller faders.
- **Park.** Done 2026-10-30 (docs/PARK.md): park a group or selection at its current output. Still to come: park at a typed value.
- **Setlist mode.** Order pages as songs, a "next song" standby, and song notes in the GO bar.
- **GO with a time.** A one-off fade time at GO, and a Back time.

## Show control in and out
- **MIDI in from tracks.** Notes from Ableton, Playback or MultiTracks GO cues or fire masters, so the track drives the lights.
- **MIDI Timecode / LTC.** Cue lists that follow timecode, as on a Hog.
- **Generic MIDI learn.** Any controller (X-Touch, APC mini, Launchpad…) learned onto masters, faders and desk keys; profiles like the APC40 one.
- **Network MIDI (RTP-MIDI).** The StageLight port on other computers.
- **ProPresenter's network API.** A non-MIDI way to trigger slides, once its API documentation is checked.
- **Native Stream Deck.** Today it works through Companion and OSC (`/stagelight/masters/trigger`).

## Output and venue
- **sACN output** and merge priority with the Hog.
- **iPad second operator.** A masters-and-GO page on the local network with a token.

## Housekeeping
- **Post-show report.** What fired and when, from the audit log.
- **Existing features as modules.** Move the OSC listener, Look Link and the pop-out visualizer onto the module framework so a show that does not use them pays nothing.

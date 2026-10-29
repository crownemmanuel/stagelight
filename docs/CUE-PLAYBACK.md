# Running cues, pause, release and Highlight

Added 2026-10-28 at the operator's request: once a cue was started there was no way to stop just that cue.

## Running cues

Several cues can run at once. The newest is on top.

- **Who owns a fixture.** A fixture follows the newest running cue that uses it, through the cue's look entries or the groups its tracks name. Fixtures a new cue does not use keep following the older cue, so starting a movers cue over a colour look leaves the colour look on everything else.
- **Retiring.** When newer cues use every fixture of an older cue, the older cue has nothing left to show and is retired automatically. Stepping through full-look cues therefore behaves exactly as before, and the stack stays small (at most 8 running cues).
- **Masters keep their cues.** A cue started by a master (its key or fader, docs/MASTERS-AND-SCENES.md) is never retired for being covered: it stays underneath while its master holds it, ready to show again when the covering cue goes or a flash bumps it.
- **Same cue twice.** Starting a cue that is already running restarts it on top; it is never stacked twice.
- **End of a cue.** A non-looping cue that reaches its end leaves the stack; its fixtures fall back to the cue underneath, or go to zero with positions held when nothing else is running.

## Commands (UI, API and MCP share them)

| Command | MCP tool | What it does |
| --- | --- | --- |
| `cue.pause {paused, id?}` | `lights_cue_pause` | Freezes one running cue exactly where it is (moving heads stop mid-sweep); `paused:false` continues from that point. Default: the newest cue. |
| `cue.release {id?, fade?}` | `lights_cue_release` | Stops one running cue and keeps the others. Its fixtures crossfade (default 1.5 s) to the next older cue that uses them, or to zero with positions held. Manual overrides and programmer effects stay. |
| `cue.stop {fade?}` | `lights_cue_stop` | Stops everything, as before. |
| `highlight.set {enabled}` | `lights_highlight_set` | Hog-style Highlight, below. |

`runtime.running` lists every running cue, newest first: `id`, `name`, `top`, `paused`, `elapsed`, `duration`, `loop`, `hold`, `fixtures` (how many it uses), `page`, `entry`. `runtime.playback` is still the newest cue.

## Desk

The controls live on the cue list itself. While a cue runs, its play (or GO) button becomes **Pause** and a **Stop** button appears beside it. While paused, the button shows **Play** to resume. Stop releases only that cue; the stop button next to GO stops all running cues.

## Highlight

The Highlight button (Shift+H since 2026-10-29; H is master 6) works like the Hog Highlight key. While it is on, every selected fixture shows full intensity, open white (wheel colour overrides dropped so the wheel resolves to white) and open beam: gobo 0, no gobo shake, no prism, no frost, optical mode beam (the verified MH7 open beam). Position, zoom and focus are unchanged. It follows the selection live, so touching another fixture highlights that one instead.

Highlight is applied after the programmer, so it is never recorded into cues, saved in the show or seen by look reports. The master and blackout still apply. It reaches the rig only while output is armed.

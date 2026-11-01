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

## Cues with only some parts — 2026-11-01

A cue can carry `only`: any of `intensity`, `color`, `position`, `beam` (the attribute families in `ATTRIBUTE_FAMILIES`, like the Hog's I/C/P/B record masks). On its fixtures it plays only the attributes it recorded in those parts. Everything else comes from the full cues, masters and scene below it. Such a cue never takes a fixture over completely, so it never retires the look underneath. Among several, the newest wins, and highest-precedence masters' come last.

- **Save dialog:** choose **Whole look** or **Just my changes**, and tick Intensity / Colour / Position / Beam.
  - "Just my changes" saves a new cue holding only the programmer's changes (`cue.record {changes:true}`).
  - Unticking parts records only the ticked ones (`cue.record {only:[…]}`), for new, update and replace.
  - Update a scene always saves everything.
- **Example:** a drum hit that lifts the heads' intensity and keeps the song's colours and positions. Save the intensity change with only Intensity ticked, and put it on a master with a sound trigger.

## Release fade — 2026-11-01

A cue can carry `releaseFade` (seconds). Stop, or `cue.release` without a `fade`, settles it back over that time instead of 1.5 s. Worship · circle and R3 fan loop use 4 s, so the heads glide home rather than snapping back.

## Path, breathe depth and following the BPM — 2026-11-01

- **Path** (`effect: "path"`, position layer): flows through saved positions (`params.points`, 2–16, in order, looping) on a Catmull-Rom curve. It passes every point without stopping, and only slows where a head turns round. `params.lap` is the seconds per lap at speed 1. R3 fan loop uses it: R3 fan · up → down → spread, a 10 s lap. A position used by a path cannot be deleted.
- **Breathe depth** (`params.depth`, 0–1, default 0.92): how far a breath dips. Grid pulse uses 0.45, so it swells and softens but never goes off.
- **Following the BPM:** a cue with `bpm` plays at live tempo ÷ bpm, so tap tempo speeds up or slows down its effects, movement and loops. On the desk, right-click a cue row and choose **Follow BPM** (writes the current tempo, or 120, as the cue's bpm) or **Stop following BPM**. The same menu has **Remove from this page**, which keeps the cue in the Library. Over MCP, use `cue.save` with or without `bpm`, and `page.save`.
- **Order with full cues:** a part cue plays over the full cues older than it. A newer full cue, such as Worship · closing, takes its fixtures back, and a part cue whose fixtures are all taken retires.

## Own speed — 2026-11-01

`cue.speed` (0.1–8) is a cue's own rate. With `bpm` it multiplies the tempo rate (tempo ÷ bpm × speed); without `bpm` the cue ignores the global tempo and plays at that speed alone. The master popup has **Follow the global tempo** (sets or clears the cue's bpm) and **Speed ×** (0.25–4). Both are saved on the master's cue and change a running cue at once, rebased so it never jumps.
- **Waves:** in a part cue, a fixture driven only by tracks takes the cue's parts only while one of its tracks is running. So a wave (e.g. Praise · grid wave) leaves the waiting fixtures in whatever colour and level the look gives them.

## Release all on a page — 2026-11-01

The stop button beside the page name in Show mode (and `page.release {id, fade?}` / `lights_page_release`) releases every running cue on that page, its looks and the effects layered on them, with a 1.5 s fade by default. Masters' held flashes and other pages' cues keep running.

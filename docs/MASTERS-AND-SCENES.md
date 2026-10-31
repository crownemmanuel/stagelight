# Masters, scenes, the cue library and resizable panels

Added 2026-10-29 at the operator's request: a Hog-style performance surface. Hold a key to flash a cue. Keep a base look on underneath everything so clearing the cues never leaves the rig dark.

## Masters

Masters are square slots under the stage. Each holds one library cue and an action. Show the bank with the masters button (three bars) in the stage view tools. The list button shows the fixture buttons instead, and clicking the lit button hides the pane. That choice is a per-viewer convenience kept in browser storage. Library mode always shows the masters, so cues can be dragged onto them.

- **Keys.** A new show has 18 blank masters. Masters 1–9 are on **A S D F G H J K L** and 10–18 have no key. The key sits bold in the slot's top-left corner.
  - Click the key, then press another key to change it. Esc cancels, and Delete or Backspace removes the key.
  - If another master has that key, the slot asks: **Swap** (that master gets this one's old key), **Take it** (that master is left without a key) or Cancel.
  - Desk shortcuts work the same way: Highlight is **Shift+H**, Clear is **C**, Blackout is **B**. Taking one leaves the shortcut's button working without a key.
  - Space (GO), Backspace (Back), Esc, Tab, Enter, the arrows and ⌘/Ctrl/Option combinations stay with the desk and are refused.
- **Actions.** The ⚙ on a slot opens its editor, and right-click does the same. It sets the cue, the action, a fade (seconds, 0 = cut), a label and the key.

  | Action | Press | Let go |
  |---|---|---|
  | **Flash** (default) | the cue plays | the cue stops |
  | Toggle | plays, or stops if running | – |
  | Go | plays from the top (restarts if running) | – |
  | Pause | freezes or resumes the running cue | – |
  | Release | stops the running cue (over the fade) | – |

  - A flash only lets go of a cue it started. A cue already running from the cue list is left alone.
  - A flash never retires the cues underneath it, even when it covers every one of their fixtures. When you let go, they show again.
- **Firing.** Master keys work in Show, Build and Library, whether the pane is open or not. They are ignored while typing in a field or while a dialog is open.
  - Holding a key does not repeat.
  - Clicking or touching a slot works like its key, so mouse flashes work too.
  - If the window loses focus, every held flash is let go, so a key can never stick.
- **More masters.** "Add master" appends a slot, up to 60. ← and → (or the chevrons) page the bank by as many slots as fit, and the counter shows which are visible.
- **Live state.** Held (amber), Running (green), Paused (dimmed), with the cue's progress.
- **Playback semantics.** Masters start cues on top of what is running ([CUE-PLAYBACK.md](CUE-PLAYBACK.md)) and keep manual changes and the page cue list. Auto-follow keeps timing the page's own cue even while a master cue is on top.
- **Highest precedence (2026-10-30).** A checkbox in the master's ⚙ (`masters.assign {priority: true}`, `lights_masters_assign`). Normally the newest running cue wins each fixture, so a cue fired after a master covers it. With highest precedence, while that master's cue runs it wins every fixture it uses over the scene and every other cue, newer ones included, like a high-priority cuelist on a Hog. Use it for things such as the house lights: engage the master and they follow it whatever the scene or the cue list sets. Among several such masters the newest wins. Its fader still sets its level. The programmer (manual changes), Highlight, Park, the grand master and Blackout still apply on top. Released, its fixtures go back to whatever is underneath. The card shows an amber ↑, and `runtime.running` marks its cue `priority: true`. This is cue precedence, not HTP intensity mixing: the master's level replaces what is underneath rather than taking the higher of the two.

Saved in the portable show as `show.masters = {slots:[{id, key?, cue?, action, fade, label?}], desk:{highlight, clear, blackout}}`. Held flashes are transient (`runtime.masters.held`).

Agents (MCP):

- `lights_masters_trigger {slot, down}` presses (`down:true`) or lets go of (`down:false`) a slot, exactly like its key.
- `lights_masters_assign {slot, cue?, action?, fade?, label?, clear?}` sets what a slot holds and does.
- `lights_masters_key {slot, key | clear:true, conflict?: "swap"|"take"}` sets a key. Without `conflict`, a taken key is refused with its owner named.
- `lights_masters_save {slots?, desk?}` replaces the bank.

OSC (Stream Deck through Companion, a USB board later): `/stagelight/masters/trigger <slot id | number | key> <1|0>`. Faders and USB boards are not built yet. They will press masters through the same command.

## Scenes

A scene is a saved look that stays on underneath every cue, like a Hog scene. Only one scene is active at a time.

- **Using it.** Open the **Scenes** tab on the left panel (next to Pages).
  - **Save look as scene** captures every patched fixture as it looks now, or the blind view while blind. Highlight is never recorded.
  - Click a scene to make it active (crossfade over `show.playback.sceneFade`, default 2 s).
  - The × on the active scene releases it. Right-click a scene to rename, recolour, update it from the current look, or delete it.
- **What it does.**
  - Fixtures no running cue uses show the scene.
  - A cue overrides the scene on its own fixtures.
  - When the last cue is released, ends, or Stop (`cue.stop`) runs, the rig fades back to the scene instead of to dark.
  - Releasing the scene with no cue running fades to zero with positions held, as before.
  - The active scene shows under Now in the GO bar, and Stop's tooltip says it fades back to it.
- **Safety.**
  - The active scene is **not** restored when the app starts.
  - Arming output is refused while a scene is active, as it is while a cue runs, so arming never lights the rig by surprise.
  - Disarming drops the scene.

Saved in the show as `show.scenes = [{id, name, color?, look:[{id, values}]}]`. The active scene is transient (`runtime.scene`).

Agents:

- `lights_scene_capture {id, name, color?}` and `lights_scene_save {scene}` save a scene.
- `lights_scene_go {id, fade?}` makes it active, and `lights_scene_release {fade?}` releases it.
- `lights_scene_delete {id}` deletes it.

OSC: `/stagelight/scene <id | name | number> [fade]` and `/stagelight/scene/release [fade]`. Named triggers can use `scene.go` and `scene.release`.

Engine: the scene's states are composed once per show revision (`floor()` in `engine/engine.mjs`). Every place that used to produce "nothing" now produces the floor: uncontrolled fixtures in `composite()`, the no-cue fallback, cue end, the last release and `cue.stop`. With no active scene, the floor is the old dark state, so behaviour without scenes is unchanged.

## Cue library

**Library** is the third tab at the top (Show | Build | Library). It takes the stage's place with every saved cue as a square tile, so many fit at once. The masters stay below, so you can drag a tile onto one. The visualizer pauses while the library is showing.

- **Finding cues.** Search names and notes, then filter: All, Unused, On masters, This page, Effects, Looks.
- **Each tile.** Its kind (look, effect, look + effects), its length and whether it loops, holds or plays once. Tags show its master keys, its pages and any named triggers. A live dot appears while it runs.
- **Opening a cue.** Click a tile to open its **cue sheet** on the right. The layout follows a Hog cue/cuelist window: each Hog cue carries its trigger (Halt, Wait, Follow, Timecode, Clock), its fade, delay and path, and the list carries playback options such as release time and what happens at the end. Here the trigger and fade live where the cue is used, so the sheet gathers them in one place:
  - *How it plays*: length, what happens at the end (loops, holds, stops), fixture count and how many are lit, and notes.
  - *Fired by*: every page entry (cue number, label, cut or fade time, waits for GO or auto-follows after N s, Look Link sends), every master (key, action, fade) and every named trigger that plays it.
  - *Remote control*: the OSC address (`/stagelight/play <id>`) and the MCP call (`lights_cue_play`) that fire it from outside.
  - *Effects*: each track's effect, group, time span, fade in/out, layer, colours, speed and level.
  - *Look*: every fixture in its saved look, brightest first, with level, colour, pan/tilt for movers and beam settings (gobo, prism, frost, zoom, white, optical mode).
- **Actions.** Rename it in place, Preview, Put on a master, Add to the current page, Delete.
  - Preview shows the stage again, visualizer only and not live. **Back to the library** returns and stops the preview.
  - Delete says which pages, masters and triggers lose the cue first.
- **Making cues.** Record look and Effect cue are in the library header.
- Build's Library button opens this tab.

## Resizable panels

Drag the inner edge of the left (pages/scenes) or right panel: left 150–360 px, right 300–640 px. Double-click an edge to reset it. The button on the edge hides or shows the panel. Widths are per-viewer conveniences in browser storage, not in the show. They are off in the narrow single-column layout.

## Updating a scene from Save (2026-10-30)

The **Save** button's dialog has **Update a scene**: pick a scene (the active one is preselected) and press **Update scene**. It saves the whole current look into that scene, the blind look while blind, with the same `scene.capture {id, name}` as the scene's right-click **Update from the current look**. The scene keeps its colour. An active scene changes at once. MCP: `lights_scene_capture {id, name}` with an existing scene id.

## What a recorded cue holds (2026-10-30)

Recording a new cue (Save → Save as new cue, Record look, `cue.record`, `look.capture`) or replacing one keeps only fixtures that are **lit** or that you **changed** (programmer values, including ones set to zero on purpose, and programmer effects). Replacing a cue also keeps that cue's own fixtures. Untouched dark fixtures stay out, so playing the cue, or flashing it on a master, never blacks out the rest of the rig. `all: true` records every fixture. Scenes still record the whole rig, because a scene is a base look. Until then, cues held every fixture: on 2026-10-30, *House Lights* (master A) and *Back Light up* (F, G) were trimmed to their own lights.

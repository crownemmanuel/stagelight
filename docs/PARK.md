# Park

Added 2026-10-30. Like Hog Park: hold fixtures at exactly what they show now, whatever runs next.

## On the desk

Right-click a group (a group pill or a group card; long-press on touch):
- **Find · one at a time** starts find mode on that group (docs/FIND-MODE.md). The menu reads **Stop finding** while it runs.
- **Park · hold this look** holds the group at its current output. Parked fixtures get an orange ring on their group-card dots. The menu then reads **Unpark**, or **Park all** when only some are parked.
- **In find mode** the item reads **Park selected · 403** (or **Unpark selected**) and holds only the fixture you have found, not the whole group.
- **Change color…** picks the group's button color: ten swatches, any custom color, or **No color**. The pill and card are tinted with it. Saved in the show as `group.color`; MCP `lights_group_edit {id, color}` (empty string removes it).

## What a parked fixture does

- **Holds its output.** It keeps the exact output it had when parked (intensity after the master, color, position, beam) over every cue, the programmer, Highlight and the master.
- **Blackout still wins.** Blackout darkens it, and disarm still closes shutters.
- **Saved in the show.** Parks are stored as `show.parked [{id, values}]`, so they are still there after a restart. They reach the rig only while output is armed.
- **Works under the lock.** Park and unpark are allowed while the performance lock is on.

## MCP

- `lights_park_set {ids? | group? (all = whole rig), parked?: false}`. With neither, it uses the current selection.
- Read back `runtime.parked` (IDs).

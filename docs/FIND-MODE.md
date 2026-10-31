# Find mode

Added 2026-10-30. Like the Hog's Highlight with Next/Back: step through fixtures one at a time to see which light on the rig is which ID.

## On the desk

1. Choose a group from the group pills (or select two or more fixtures).
2. Press **Find** in the GO bar, next to Highlight, or right-click the group and choose **Find · one at a time**. The first fixture of the group is selected and highlighted: full, open white, open beam, position kept.
3. **→** goes to the next fixture, **←** to the previous one, wrapping round. The arrow buttons in the corner card do the same.
4. The card in the top-right corner of the stage shows the current **ID** large, its name or profile, *n / total* and its Hog patch (universe:address).
5. **Esc**, the ✕ on the card, or Find again leaves find mode: Highlight goes off and the whole list is selected again.

What it steps through: the selection when two or more fixtures are selected, otherwise the chosen group in group order, otherwise every enabled fixture by ID. While find is on, ← → step fixtures instead of paging masters. Turning Highlight off, or selecting something outside the list, ends find.

## MCP

- `lights_find_start {group?, ids?, at?}`
- `lights_find_step {direction: next|back}` (starts on the current selection when find is off)
- `lights_find_stop`
- Read back `runtime.find {active, index, total, id, name, profile, patch, group}`.

Find is transient like Highlight: never recorded or saved, master and blackout still apply, and it reaches the rig only while output is armed. Art-Net has no acknowledgment, so the operator's eyes confirm which light it is.

# Beam presets — 2026-10-31

Named beam looks, like Hog beam palettes, saved in the show as `show.beamPresets`. A preset holds beam attributes only: prism, prism rotation, frost, focus, zoom, gobo, gobo shake and optical mode. It never holds colour, intensity or position, so applying it keeps those.

- **Per fixture type.** `profiles` lists the fixture types a preset is for, because prisms and gobos differ per model. Applying it to a mixed selection sets only those fixtures and reports the rest as skipped. A preset with no `profiles` applies to any fixture.
- **Commands / MCP.**
  - `beam.capture {id, name, ids}` / `lights_beam_capture` saves what the fixtures show now. It reads the first fixture's live (or blind) frame and keeps the beam attributes its profile has.
  - `beam.save {preset}` / `lights_beam_save` writes a preset directly.
  - `beam.apply {id, ids}` / `lights_beam_apply` applies a preset as overrides. It returns `applied` and `skipped`.
  - `beam.delete {id}` / `lights_beam_delete` removes one.
  - Save and delete are show edits, so the performance lock refuses them. Apply is live.
- **Desk.** The Beam tab lists the presets under Beam presets. Presets for other fixture types are dimmed. Name a preset and press Save beam to capture the selection. In Build mode, × deletes a preset.

## Rogue R3 prisms (venue units)

The operator observed on 2026-10-31 that **prism 1 (ch10) is a 5-facet** (narrow spread) and **prism 2 (ch12) is an 8-facet**. Both in together give the full spread. Chauvet's manual says 8- and 24-facet; the observation of the actual units wins. The profile records this as `prismNames` (5-face, 8-face, Both · wide), and the Beam tab uses those labels.

Frost (ch14) is sent correctly, but it barely shows on these units, on the Hog too. The Hog "soft" look, read from its DMX Output for 301 (universe 4, 106–121), is **prism 1 = 255, prism 1 rotation = 63 (index), frost = 0, focus = 255**. StageLight sends the same, except prism rotation 0, which is a different fixed index angle. It is saved as the beam preset "Soft · 5-face" and in the Sunday Service scene.

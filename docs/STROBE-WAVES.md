# Scattered strobe waves

The shared `strobe` effect flashes the dimmer at 0.25–6 Hz and keeps hardware shutter values in their documented steady-open/closed ranges. Parameters exposed through UI effect type, JSON cue editor and MCP `lights_cue_save` / `lights_effect_preview` / `lights_effect_save`:

- `frequency`: flashes per second; `duty`: on-fraction 0.1–1.
- `travelSpeed`: full forward/back cycles per second; `width`: traveling band width.
- `strobePattern`: scatter (deterministic fixture offsets) or wave (spatial phase).
- `spatialAxis`: order, x (left/right), z (back/front).
- `pointA`: saved position to use as the motion center; `panAmplitude`, `tiltAmplitude`: normalized travel around it. `speed` adjusts motion timing independently of flash rate. Motion clamps to fixture ranges and respects saved visual direction signs.

This effect never strikes/douses lamps and does not use reset channels. MH7s retain the confirmed beam-mode default. Current show look/poses should be snapshotted before live playback. Stop fades to black while holding positions.

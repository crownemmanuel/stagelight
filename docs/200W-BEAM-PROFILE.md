# 200W Beam — operator Hog personality

3901 is at Hog 3:162, raw Art-Net 2. The operator supplied screenshots of the 200W Beam Advanced personality, then explicitly authorized live testing. This is a 16-channel profile; it is distinct from the four 7R heads. Those remain unverified.

|Relative channel|Function|Implemented values|
|---|---|---|
|1 / 3|Pan coarse / fine|16-bit, -225 to +225 degrees (450 travel)|
|2 / 4|Tilt coarse / fine|16-bit, -135 to +135 degrees (270 travel)|
|5|Position time|0 track; 1–255 means 0.2–120s. Motor speed 100% sends 0.|
|6|Frost|0–255|
|7|Shutter/strobe|255 steady-open only; use dimmer 0 for blackout. 51–240 strobe deliberately unused.|
|8|Intensity|0–255|
|9|Colour|0 neutral; named color slots not yet visible/verified|
|10|Colour 2|0 neutral; function visible as 0–255 continuous but relationship unverified|
|11|Gobo|0 open; gobos 1–17 at 11,18,25,...123; spin ranges not used|
|12|Gobo shake|0–255 maps to 0–10Hz|
|13|Focus|0–255|
|14|Prism|0 open, 255 3-face prism|
|15|Prism angle/rotation|64 stationary; 191→128 CW slow→fast; 192→255 CCW fast→slow|
|16|Fixture/lamp control|0 idle; explicit lamp strike 200, douse 100; global reset 255 is never sent|

UI and MCP share this encoder. `lights_fixture_set` supports intensity, pan, tilt, movementSpeed, frost, gobo, goboShake, focus, prism (0/1) and prismRotation. `lights_fixture_lamp` supports strike/douse at channel 16 for five seconds then neutral. Named RGB color matching stays unavailable; channels 9 and 10 remain neutral. The preview uses a neutral white approximation until actual filter names/values are captured.

Live testing starts at zero intensity. Hog must yield the full footprint **3:162–177**. At full intensity the actual intensity slot is **3:169 = 255**, with **3:168 = 255** for open shutter. Lamp control is **3:177**. Hardware response and pan/tilt direction still need operator verification.


### Color controls and observed slots
The Look inspector now exposes **Color wheel · channel 9** (0–127, static values only) and **Colour 2 · channel 10** (0–255). The primary wheel's spin range is excluded. At patch 3:162, these are absolute DMX addresses **170 and 171**. Adjust them while observing the actual fixture. **Save wheel color…** records its name and an approximate RGB swatch at that channel pair; this adds a fixture-specific swatch, feeds the 3D preview, and lets future RGB cues choose the nearest recorded slot. Unsaved wheel values preview white because their filter colors are unknown. Channel 10's physical effect still needs observation; its Hog personality labels it Colour 2 continuous.

The mapping is saved as the fixture's `colorSlots`, included in show export/import, and available through `lights_status`. Agents can use:

```json
{"tool":"lights_fixture_set","arguments":{"ids":["3901"],"values":{"colorWheel":32,"colorWheel2":0}}}
```

32 is an illustrative test position, not a claimed color. After an operator identifies the actual color, save it using `lights_fixture_color_save` with `id`, `name`, `color` (hex), `value`, and optional `secondary`. Saved looks also capture direct wheel values exactly. RGB-only `fixture.set` clears manual wheel overrides; intensity and pan/tilt are preserved.


## Operator-observed default colors
3901 now has 24 presets: 0, 8, 13, 16, 20, 24, 30, 34, 41, 46, 50, 54, 58, 69, 73, 78, 84, 89, 95, 99, 101, 106, 109, 112. The spoken “09” following 106 is interpreted as 109, pending correction. Secondary color remains zero for these observations. Full labels and illustrative RGB swatches live in `public/beam200-presets.js`; newly created shows seed these presets, and the current show stores them through MCP. Existing custom slots are retained.

The 3D preview resolves raw overrides and RGB requests through the same DMX wheel resolver as the encoder. Observed mixed-filter presets show separate colored sectors in their swatches, haze cones and floor footprints. Filter RGBs, proportions, lens/surface illumination and beam shapes remain illustrative, not measured photometric calibration. Custom saved observations override default visual splits.

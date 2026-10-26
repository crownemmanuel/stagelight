# 7R Beam 230W 16ch — Hog personality

Source: operator's seven Hog Advanced screenshots. Four fixtures enabled for live testing: 4101@3:57–72, 4102@3:78–93, 4103@3:99–114, 4104@3:120–135. Starts are 21 addresses apart but actual profile is 16 channels. Do not yield or write the gaps as part of these fixtures. Existing Hog3←raw Art-Net2 route applies.

|Channel|Function|Implemented behavior|
|---|---|---|
|1|Colour|0 neutral pending named slot evidence|
|2|Shutter/strobe|0 closed; 255 open. Hardware strobe ranges unused by ordinary intensity.|
|3|Intensity|0–255|
|4|Gobo / shake|Open 0; static gobos 1–14 = 4,8,12,…56. Shake bands 160–249 as photographed. Spin not exposed.|
|5|Prism|0 open, 255 8-face|
|6|Prism angle/rotation|191 stationary; positive rotation 190→128 slow→fast; negative 193→255 slow→fast|
|7|Unused|0|
|8|Frost|0–255|
|9|Focus|0–255|
|10/11|Pan coarse/fine|16-bit -270° to +270° (540 travel)|
|12/13|Tilt coarse/fine|16-bit -135° to +135° (270 travel)|
|14|Dimmer curve|0 neutral; entries collapsed, detailed curve modes pending|
|15|Fixture control|0 idle; beam reset76, position reset127 and global reset255 never emitted|
|16|Lamp control|0 idle; explicit strike101, douse26. Five-second pulse then idle.|

Intensity, pan/tilt, gobo, shake, frost, focus, single prism, prism rotation and explicit lamp control are shared by UI and MCP. See `lights_fixture_set`, `lights_fixture_lamp`, `lights_schema` beam7r and saved cue/effect schemas. This profile has no verified motor-speed channel; channel14 is not a speed control.

Named color slots are hidden inside collapsed Color Offset entries. Do not assign an unrelated brand's wheel. Preview is a neutral-white approximation until the actual slot data is captured. Physical order, pan/tilt alignment, filter color, and fixture response require room testing.

Initial full-intensity test addresses: 4101 shutter3:58/intensity3:59; 4102 shutter3:79/intensity3:80; 4103 shutter3:100/intensity3:101; 4104 shutter3:121/intensity3:122. Open-gobo and prism-out values are0. Raising intensity does not strike lamps automatically.


Color update: the Look inspector also exposes relative channel 1 as **Color wheel** (0–119, excluding spin). Record observed colors with **Save wheel color…** / `lights_fixture_color_save`; per-fixture mappings persist in the portable show and drive the encoder and preview. Named colors are not assumed to match any other personality. See the 200W profile's color-control section for the shared workflow; 7R has no secondary color control.


Group wheel colors: the Look inspector always shows Save wheel color for wheel-head selections, including multiple heads. It saves with `fixture.colors.save` / `lights_fixture_colors_save`, `scope: "profile"`, one observed source entry per selected exact profile. A 4101 observation thus saves to all four beam7r heads. 3901/beam200 uses its own entry/value, never a guessed 7R byte. The command also updates the shared named palette. Selection scope instead supports explicit per-head entries, atomically. Saved group swatches recall each fixture’s recorded values; intensity/aim remain unchanged.


## Operator-observed 7R color presets
All beam7r fixtures (4101–4104) have shared default wheel presets at 0, 11, 17, 24, 31, 35, 41, 49, 55, 60, 67, 72, 78, 82, 85, 91, 97, 101, 109, 113. DMX35 was explicitly corrected to **blue + green**, not blue + purple. Canonical names, approximate RGB swatches and split-filter portions are in `public/beam7r-presets.js`; default shows seed independent copies. Current show presets were saved through MCP profile scope. 3901 has a distinct 200W wheel table: never copy its raw values onto 7Rs. Both renderer and DMX use the same wheel resolver; mixed-filter 7R swatches/beams/footprints preserve distinct color sectors. The wheel slider and custom save action remain available. These observations supersede earlier notes saying 7R color slots are unknown.

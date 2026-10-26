# Ceiling grid — Colorlite Q120

The Hog screenshot labels these **Colorlite Q120 5ch**, not COLORado. Manufacturer: MEGA-LITE. Profile: 120 W RGB + warm-white COB wash, fixed 40° lens. Five-channel order: dimmer, red, green, blue, warm white, each 0–255. No moving pan/tilt, motor zoom, or shutter channel in this mode.

[Manufacturer user manual V4 (retailer-hosted PDF)](https://goknight.com/content/documentation/Colorlite%20Q120%20Manual%20V4.pdf).
The manual's 5-channel table repeats channel number 1; the mode description and first five channels of its expanded modes establish the dimmer/RGB/WW order. Confirm the physical fixtures are in 5-channel mode before testing.

## Placement

Counted back to front, left to right: 5 / 3 / 4 / 3 / 5 / 3 = 23 positions. The photo only supplies 21 fixture IDs. Placement is provisional: IDs ascend from back left; the first two sit close together. Final two positions are disabled, unpatched placeholders, not invented fixtures 222/223.

| Row | Fixtures |
|---|---|
| 1, back | 201–205 |
| 2 | 206–208 |
| 3 | 209–212 |
| 4 | 213–215 |
| 5 | 216–220 |
| 6, front | 221, unknown, unknown |

Hog universe 4: 201@1, 202@6, **203@36**, 204@11, 205@16, 206@21, 207@26, 208@31, 209@41, 210@46, 211@51.
Hog universe 5: 212@56, 213@61, 214@66, 215@71, 216@76, 217@81, 218@86, 219@91, 220@96, 221@101.

Existing routes Hog 4→Art-Net raw 3 and Hog 5→raw 4 apply. Yield Hog input addresses **4:1–55 and 5:56–105** to Art-Net. No extra universe mapping is needed if these routes are still configured. No Hog settings are changed by this update.

The Ceiling grid selection controls these washes. Agents can use group `grid` or individual `grid-row-1` through `grid-row-6`; `white` controls warm white. Profiles, groups, patches, and positions are included in the exported show. Use each fixture's Patch/position controls to refine placement. The 3D housing and 40° beams are approximate visual aids, not a photometric model. New fixtures start dark. Hardware response remains untested.

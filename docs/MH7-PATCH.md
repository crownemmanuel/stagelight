# Martin RUSH MH 7 Hybrid

Profile researched from [Martin's user manual, revision A, pp. 32–36](https://www.fullcompass.com/common/files/27391-MartinProfessionalRUSHMH7HybridUserManual.pdf). [Martin's download page](https://www.martin.com/en-US/support_downloads/products/rush-mh-7-hybrid.html) lists revision D; its download was inaccessible during this session. Physical operation of this app profile is not yet verified.

21-channel fixture. 540° pan / 250° tilt, 16-bit dimmer, motorized zoom/focus, color wheel, two gobo wheels, selectable 4-/8-facet prism, frost. Current app implements solid wheel colors, spot mode with static gobos, prism selection/rotation, zoom/focus, frost and movement. Rotating-gobo selection and mode switching remain future work. No dedicated pan/tilt speed channel. Channel 21 stays zero; no lamp strike, lamp off, reset or personality commands.

## Patch transcribed from Hog photo

| ID | Hog universe | Start | End | Placement |
|---|---:|---:|---:|---|
|705|6|1|21|Provisional stage|
|706|6|22|42|Provisional stage|
|707|6|43|63|Provisional stage|
|708|6|64|84|Provisional stage|
|3101|1|337|357|Audience left, provisional|
|3102|1|358|378|Audience right, provisional|
|3103|6|235|255|Provisional stage|
|3104|6|256|276|Provisional stage|
|3105|6|277|297|Provisional stage|

701–704 and 3106–3108 have blank patch cells in the photo and were not added. The 6:111 row below belongs to a different fixture type and was not added as an MH7.

Audience truss is estimated at Z=8 m, height 6.3 m, with heads X=±5.5 m. Operator proposed left=337/right=358; physical identity has not been tested. Stage placement and aim calibration can be corrected without repatching.

## Hog handover

Suggested consistent mappings: Hog Universe 1 ← raw Art-Net 0 (0/0); Hog Universe 6 ← raw Art-Net 5 (0/5). These are proposed routes, not confirmed console state. Create/apply those Input mappings in Processor 1 and yield only the desired ranges listed above. Then disarm the app, enter matching raw universes in Connection & diagnostics, save and re-arm. Until entered, the new MH7s can be previewed but emit no packets on new universes. Existing Hog 3/4/5 routes remain unchanged. Identify one head at a time before choreography.

## Working Hog comparison
The operator's working universe 6 capture shows fixture 705 channels 1–3 = 255,255,255. The app now uses shutter 255 (documented steady-open range 224–255), replacing 32 (also documented open). Dimmer remains coarse/fine on channels 1/2. Hog also shows channel 5 = 0 (beam mode), versus app 16 (spot-open); this difference is not changed in the shutter isolation test. Hardware confirmation pending. This shared encoder applies to UI and MCP controls.

## Confirmed rig behavior — 2026-10-25
Operator A/B test: all seven universe 6 MH7s light with open beam (relative ch5=0, ch8=0), dimmer ch1/2 at 255, shutter ch3=255. Switching back to spot-open (16/142) removed visible output. Open beam is now the shared engine default for intensity and cues; no lamp strike is automatically issued. Spot remains an explicit unverified option. Universe 1 is not physically confirmed. Hog routes 1→0 and 6→5 were confirmed by photograph and are now saved in the app.

## Placement observations awaiting operator confirmation — 2026-10-25

- 705: operator confirms current visual placement is correct; preserve it.
- 706: reported as the far-left fixture, not the second fixture.
- 707: reported as second from the left; operator also described the order as “705, 707,” then paused to recheck after becoming unsure. Do not resolve this ambiguity by guessing or moving 705.
- 3105: operator reports no control and suspects the physical fixture may be powered off. This is unconfirmed; do not remove its patch or assume a failed profile.
- No placement, patch, calibration, or output changes applied from these provisional observations. Await the operator’s confirmed order before rearranging.

## Confirmed stage row — supersedes provisional placement notes
Operator confirmed left-to-right: **705, 707, 708, 706**. These occupy X -5, -2, 2, 5 respectively, at Y 0.7, Z -2.9. Their DMX addresses and calibrations remain attached to the same fixture IDs. Fixture **3105 was removed** from the show and all groups; it does not belong on stage. Audience 3101/3102 and separate front-corner 3103/3104 were not moved.

## Floor mounting in the preview
Low-mounted MH7s (saved placement Y < 2m) render upright with the base below the head. Their uncalibrated preview orientation is flipped 180° around the stage Z axis relative to hanging heads; saved aim alignments take precedence. This is visualization only: DMX pan/tilt and invert flags are unchanged. Agents see/control mounting placement through fixture.place and show/status. After visually matching the mounting, use saved axis calibration if real/virtual travel still differs.

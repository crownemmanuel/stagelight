# LiveStage Lights agent instructions

This directory is the application root.

## MCP-first requirement

This is an MCP-first lighting application. Every new user-facing capability must also be available through MCP in the same change. UI-only implementations are incomplete.

- Implement shared operations in the engine; declare validated commands in `engine/spec.mjs`. The MCP server exposes these as `lights_<command_with_underscores>`.
- Use the same engine operations for UI, API, and MCP; do not duplicate behavior or bypass validation.
- Include readback/status and discoverable schemas so agents can inspect parameters, progress, saved state, and failures. Document tools and test their command behavior and MCP exposure.
- Save persistent settings, fixture patches, placements, calibration, scenes, and effects in the portable show. Keep transient physical commands such as lamp strike/douse out of saved cues and automatic startup playback.
- Use MCP for agent lighting operations when available. Explicit lamp commands are `lights_fixture_lamp` with `ids` and `action: strike|douse`.
- Physical output requires user authorization. Do not treat packet transmission as proof that a physical fixture responded; ArtDMX has no acknowledgment.
- Preserve existing patches and calibration when editing visualization placement. Read the current show rather than replacing it with defaults.
- Verify fixture-specific DMX definitions against manufacturer documentation. Do not invent channel mappings or assume similarly named fixtures share profiles.

## Performance budget — 2026-10-27
The desk draws the whole rig while the engine ticks at 30 Hz, so keep both inside their budgets (docs/VISUALIZER-PERFORMANCE.md). Never add a scene light per fixture: `public/stage.js` shares a pool of 12 spot lights among the brightest heads, resolves fixture colours once per engine frame, shares geometry per shape and skips redrawing a settled look. In the engine, look fixtures up through `fixtureIndex(show)` instead of `show.fixtures.find` in anything that runs per tick; `tests/perf.test.mjs` fails when a full tick over the saved show exceeds 4 ms. The runtime stream only sends when something other than the tick counter changed.

## Desktop app and releases
The desktop app is a Tauri shell in `src-tauri/` that runs this folder's engine with a bundled Node.js and loads the desk from it; releases are built by `.github/workflows/release.yml` from a `v*` tag and installed apps update themselves only when the operator presses Install (refused while output is armed). Read `docs/RELEASES.md` before touching packaging, versions or the updater. Keep `engine/`, `public/`, `mcp/` and `server.mjs` free of npm dependencies: they are copied into the app as they are. Ask before pushing tags or publishing releases.

## Verified MH7 intensity behavior — 2026-10-25
All seven universe 6 MH7s (705–708, 3103–3105) produced visible light with dimmer coarse/fine on channels 1/2, shutter 255 on channel 3, beam mode 0 on channel 5, and open gobo 0 on channel 8. Returning to spot mode (ch5=16/ch8=142) extinguished visible output in the operator's test. Use open beam as the default for manual intensity, cues, and MCP operations; retain explicit spot mode only as unverified. Do not repeatedly strike lamps when intensity changes. Universe 1 fixtures 3101/3102 remain a separate unresolved hardware/Hog test. Preserve current pan/tilt during intensity tests.

Placement correction: stage row left-to-right is 705, 707, 708, 706. 3105 was subsequently removed at operator request; do not reintroduce it from older patch notes. 3101/3102 and 3103/3104 remain separate fixtures.

Rear truss generic heads: 4101@3:57, 4102@3:78, 4103@3:99, 4104@3:120 (Hog label 7R Beam 230W 16ch), 3901@3:162 (Hog label 200W Beam). Registered as disabled/unverified unknown profiles pending actual Hog personality/channel comparison. Their physical left/right order is provisional. Never apply an internet 7R/200W personality just from the generic label. See docs/REAR-HEADS-PATCH.md.

200W update: operator supplied Hog Advanced screenshots for 3901 and explicitly authorized live testing. Its profile beam200 is now enabled at 3:162–177: pan coarse1/fine3 (450°), tilt coarse2/fine4 (270°), time5, frost6, open shutter7=255, dimmer8, neutral color9/10=0 pending slot names, gobo11 (0 open, 11+7*(n-1)), shake12, focus13, 3-face prism14, prism rotation15 (64 stationary), control16 (0 idle, explicit strike200/douse100). Never send global reset255. Four 7R heads remain unverified. See docs/200W-BEAM-PROFILE.md.

7R update: Hog Advanced screenshots now establish beam7r for 4101–4104, enabled at original patches. Ch1 neutral color pending names; ch2 shutter0/255; ch3 dimmer; ch4 static gobos0–14 at4*n or photographed shake ranges; ch5 single8-face prism; ch6 rotation191stop; ch7unused; frost8/focus9; pan10/11; tilt12/13; ch14dimmercurve neutral0; reset15idle0; lamp16 explicit strike101/douse26 then0. Do not apply 200W/MH7/Rogue channel layouts. See docs/7R-BEAM-PROFILE.md.


## Rear-head color control update
3901 (beam200) now has direct static colorWheel control on relative ch9 (0–127) and colorWheel2 on ch10 (0–255). 4101–4104 (beam7r) have colorWheel on ch1 (0–119; spin excluded). Do not hide these controls because slot names are unknown. Never assume their color names match the Rogue/MH7 wheels. Use `fixture.set` / MCP `lights_fixture_set` to test a wheel value, then `fixture.color.save` / `lights_fixture_color_save` to record an operator-observed name, RGB swatch, value and optional 200W secondary value. Slots live on each fixture as `colorSlots` in the portable show; encoder and preview share them. RGB-only color changes clear manual wheel overrides and select the nearest saved slot. Unknown wheel positions preview white. Lamp/reset channels remain separate and neutral.


Group wheel colors: the Look inspector always shows Save wheel color for wheel-head selections, including multiple heads. It saves with `fixture.colors.save` / `lights_fixture_colors_save`, `scope: "profile"`, one observed source entry per selected exact profile. A 4101 observation thus saves to all four beam7r heads. 3901/beam200 uses its own entry/value, never a guessed 7R byte. The command also updates the shared named palette. Selection scope instead supports explicit per-head entries, atomically. Saved group swatches recall each fixture’s recorded values; intensity/aim remain unchanged.

Confirmed rear-truss left-to-right order: **4104, 4102, 3901, 4103, 4101**. Update visual X placement and ordered rear-heads group only; retain each fixture’s patch and aiming calibration.


## Front truss Colorados — 2026-10-27
409–418 are Colorado 2 Quad Zoom (`colorado`, 7ch), the same Hog type as the 401–408 backlights, at Hog 2:241–304, 7 channels apart. Group `front-lights`. The operator confirmed they are a **front wash, not the face lights**, so their Look Link zone role is `front`, never `face`. Which fixtures are the face lights is still unknown. They hang on the front-of-house truss (Z=8) facing the stage and are saved with an `aim` point. Hog universe 2 → Art-Net 1 is inferred from the n−1 pattern: confirm it before arming. Left/right order is provisional. See docs/FRONT-LIGHTS-PATCH.md.

## Broadcast face lights 1–49 — 2026-10-27
These are 49 Chauvet Ovation Rêve E-3 heads in 12ch mode (`reveE3`, checked against the manufacturer manual Rev. 14). They are the show's **face lights**: Look Link zone role `face`, group `face-lights`. Patch: 1–19 at 2:1+12n, 20–44 at 1:1+12n, 45@2:229, 46@2:311, 47@2:323, 48@1:301, 49@1:313. They are mounted in the audience in two arcing rows facing the stage. Rows, positions and aims are provisional until the operator gives placement. Ch8–12 (strobe, VCW, CCT, hue, gobo rotator) stay at 0, and `white` drives amber + mint. See docs/FACE-LIGHTS-PATCH.md.

## House lights — 2026-10-27
These are 123 Hog "RGBW Pendant Light 4ch" pendants (`pendant4`): 1001–1062 at 8:1+4n, 3301–3318 at 5:165+4n, 3320–3362 at 5:241+4n. 3319 is unpatched on the Hog. Group `house-lights`. The label is generic and no manufacturer chart was found, so they are **enabled but unverified, which means preview only**: they light in 3D, but no DMX is ever encoded for them. Their assumed R,G,B,W (no dimmer) layout must be confirmed by a Hog Fixture Builder screenshot or an authorized live test before setting `verified:true`. Hog 8 → Art-Net 7 is inferred. They hang in five provisional arcs at R=17–25 m, behind the face lights, with the lowest number at the stage-right (+X) end. Hide them, or any group, from the 3D view with `visualizer.hide` / `lights_visualizer_hide` (preview only). Show limits are now 512 fixtures. See docs/HOUSE-LIGHTS-PATCH.md.

## Operator-observed 7R color presets
All beam7r fixtures (4101–4104) have shared default wheel presets at 0, 11, 17, 24, 31, 35, 41, 49, 55, 60, 67, 72, 78, 82, 85, 91, 97, 101, 109, 113. DMX35 was explicitly corrected to **blue + green**, not blue + purple. Canonical names, approximate RGB swatches and split-filter portions are in `public/beam7r-presets.js`; default shows seed independent copies. Current show presets were saved through MCP profile scope. 3901 has a distinct 200W wheel table: never copy its raw values onto 7Rs. Both renderer and DMX use the same wheel resolver; mixed-filter 7R swatches/beams/footprints preserve distinct color sectors. The wheel slider and custom save action remain available. These observations supersede earlier notes saying 7R color slots are unknown.

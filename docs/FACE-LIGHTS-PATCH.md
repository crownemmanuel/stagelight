# Broadcast face lights 1–49 (Chauvet Ovation Rêve E-3, 12ch)

Source: Hog fixture window, operator photos IMG_3844 and IMG_3845, 2026-10-27. These are 49 **Ovation Reve E-3 12ch** heads: directional ellipsoidals mounted in the audience in two arcing rows, facing the stage. Each one lights a section of the stage. They are the show's **face lights** (Look Link role `face`).

## Patch (Hog universe:start, 12 channels each)

| IDs | Hog patch |
|---|---|
| 1–19 | 2:1, 2:13 … 2:217 (12 apart) |
| 20–44 | 1:1, 1:13 … 1:289 (12 apart) |
| 45 | 2:229 |
| 46 | 2:311 |
| 47 | 2:323 |
| 48 | 1:301 |
| 49 | 1:313 |

Patch notes from the Hog: 30 "Pulpit left", 31 "pulpit right", 32 "DSL CENTER".

Hog universe 2 → Art-Net 1 is inferred (see [FRONT-LIGHTS-PATCH.md](FRONT-LIGHTS-PATCH.md)). Universe 1 → Art-Net 0 was already configured. Nothing overlaps the front lights 409–418 (2:241–310) or MH7 3101/3102 (1:337–378).

## Profile `reveE3`

From Chauvet's [Ovation Rêve E-3 User Manual Rev. 14](https://chauvetprofessional.com/wp-content/uploads/2021/03/Ovation-Reve-E-3_UM_Rev14.pdf), DMX Values, 12Ch column:

| Ch | Function | StageLight sends |
|---|---|---|
| 1 | Dimmer | intensity, coarse |
| 2 | Dimmer fine | intensity, fine (16-bit) |
| 3 | Red | color R |
| 4 | Green | color G |
| 5 | Blue | color B |
| 6 | Amber | white |
| 7 | Mint | white |
| 8 | Strobe (000–010 no function) | 0 |
| 9 | Virtual color wheel (000–005 no function) | 0 |
| 10 | Color temperature (000–005 no function; 006–255 = 2800–8000 K presets) | 0 |
| 11 | Hue (000 = 0) | 0 |
| 12 | Gobo rotator (000–127 index) | 0 |

* `amber` (ch6) and `mint` (ch7) are their own attributes (2026-10-30). When they are not set, `white` drives both equally (StageLight's mapping, not Chauvet's).
* **Hog colors, read from its DMX Output window on 2026-10-30:** CTB on face light 27 at full = dimmer 255/255, R 255, G 255, B 254, amber 0, **mint 101**, ch8–10 0, hue 128, ch12 63. CTO on face light 27 at full = dimmer 255/255, R 255, G 205, B 180, **amber 255, mint 103**, ch8–10 0, hue 128, ch12 63; saved as palette `hog-cto` (#ffcdb4, amber 1, mint 103/255). (An earlier guess of R 218/G 199/B 141 from the dim running look was wrong.) StageLight still holds hue (ch11) and ch12 at 0. A palette can carry `amber`/`mint`, so palette `hog-ctb` = #fffffe + mint 101/255, and `hog-cto` = #ffcdb4 + amber 255 + mint 103/255.
* Chauvet recommends setting the fixture's Dimmer Mode to Off for the best 16-bit dimming in 12Ch.
* **Not used yet:** the fixture's own colour temperature channel (ch10). It gives calibrated whites from 2800 to 8000 K, which suits broadcast. It could become a `cct` attribute later.
* **Status.** Enabled and verified against the manual. The Hog mode label matches 12Ch. **Not tested physically yet.**

## 3D (provisional: no placement data yet)

* Row 1 is IDs 1–24, on an arc of radius 12 m around stage centre at Y=6. Row 2 is IDs 25–49, on an arc of radius 15 m at Y=7. Both arcs span ±55°, ordered from stage left (−X) to stage right. Groups: `face-row-1` and `face-row-2`. **Row membership and order are guesses.**
* **Focus plan (even wash, standard front-of-house split).** The **near row lights upstage and the far row lights downstage**, so every area gets a similar angle onto faces and the far row doesn't spill upstage. The pools overlap so the stage is evenly lit.
  * Row 1 (1–24): two upstage lines. Odd IDs aim at Z=−3, even IDs at Z=−1. Each line has 12 points from X −8.25 to 8.25.
  * Row 2 (25–49): two downstage lines. Odd IDs aim at Z=1 (13 points, X −8.5 to 8.5), even IDs at Z=3 (12 points, X −8.25 to 8.25).
  * Left-to-right order is kept, so fixtures on the left of the arc light the left of the stage.
  * Exceptions from the Hog notes: 30 aims at pulpit left [−0.8,0,1.3], 31 at pulpit right [0.8,0,1.3] and 32 at DSL centre [−2.5,0,2.8].
  * Aims are floor points (Y=0). Change placement with `fixture.place {id, position, aim}` / `lights_fixture_place`.
* Model: a yoke, a reflector housing and a lens tube along the beam axis. The preview assumes a 19° lens, because the actual lens tubes are unknown. To keep the GPU light, they draw beams and floor pools but no scene spotlights.
* Group `face-lights` holds all 49, ordered by ID.
* Backup of the show before this patch: `data/before-face-lights-2026-10-27.json`, local only and ignored by git.

## Update 2026-10-30

The operator gave the rigs: **1–19 hang on the upfront rig, 20–41 on the back rig.** Physically patched faces end at 41; 42–49 do not exist. Groups: `face-lights` (parent, 41) → `face-upfront` (1–19) and `face-back` (20–41); the provisional `face-row-1/2` are gone. 42–49 sit in `face-unpatched`, hidden in the 3D view and out of the face zone, until they are removed with output off. 3D: upfront arc R=12 m at 6 m, back arc R=15 m at 7 m, each spanning ±55°; the order along each arc is still provisional.

**Correction, same day:** 45 (right), 46 (left) and 47 (right) are on the upfront rig; 48 and 49 are on the back rig. Upfront is now 22 heads, back 24, Face lights 46. 42–44 were not mentioned: they sit in `face-unpatched` (hidden, out of the face zone) until the operator confirms. Right = the operator's right facing the stage (−X); 48 and 49 are at either end of the back arc until their side is known.

**42–44, same day:** the operator confirmed they are real and stay patched, but they did not respond today. They are kept in `face-unpatched` (renamed “42–44 not responding”) until the fault is found. Do not delete them.

# House lights: 123 RGBW pendants (Hog "RGBW Pendant Light 4ch")

Source: Hog fixture window, operator photos IMG_3836–IMG_3843, 2026-10-27. These are house lights over the audience in a wide arc.

## Patch (4 channels each)

| IDs | Hog patch |
|---|---|
| 1001–1062 (62) | 8:1, 8:5 … 8:245 |
| 3301–3318 (18) | 5:165, 5:169 … 5:233 |
| 3319 | **no patch on the Hog**, so it isn't registered |
| 3320–3362 (43) | 5:241, 5:245 … 5:409 |

* None of these overlap anything else: Hog 5 already uses 56–137 (grid, Rogues). Cloud 9 99/100 at 5:509/511 isn't registered.
* **Routing.** Hog universe 8 → Art-Net 7, inferred from the n−1 pattern; confirm it at the Hog. `output.configure` now accepts Hog universes 7 and 8, and the Connection dialog lists Hog 1–8.

## Profile `pendant4`: **unverified, preview only**

* No manufacturer could be identified. "RGBW Pendant Light 4ch" is a generic Hog label, and an online search found no matching library or chart. The project rule is not to guess a channel layout from a generic name.
* So all 123 fixtures are registered **enabled but unverified**, which means preview only. They light in the 3D visualizer, but `encode()` never sends their DMX, even while output is armed. The validator now allows an enabled fixture to be unverified; only verified fixtures are encoded.
* `pendant4` assumes the common order **R, G, B, W with no dimmer channel**: intensity scales all four. It stays an assumption until it is confirmed by either:
  * a Hog Fixture Builder screenshot of the "RGBW Pendant Light 4ch" personality, or
  * an operator-authorized live test (one pendant, one channel at a time).
* Once confirmed, mark them `verified:true` with `fixture.patch`, or correct the encoder in `engine/render.mjs` if the order differs.

## 3D (provisional: rows and positions are not mapped yet)

* Five rows going back into the audience, sized 25, 25, 25, 24 and 24, in ID order: 1001–1062, then 3301–3318, then 3320–3362.
* Rows are arcs around stage centre (0, 0), the same centre as the face-light arcs. Their radii are 17, 19, 21, 23 and 25 m, so the first house row starts 2 m behind face row 2 (R=15). Height Y=5, spanning ±50°. The camera can now pull back to 65 m to show them.
* **The lowest number is at the stage-right (+X) end**, which is the far left as seen from the audience, as the operator described. Each row runs from stage right to stage left.
* Groups: `house-lights` (all 123) and `house-row-1` … `house-row-5`.
* Model: a ceiling canopy, a drop cord and a short cylindrical shade, pointing straight down with a 60° beam. They draw no scene spotlights, so 230+ fixtures stay smooth (about 49 fps measured).

## Hiding fixtures from the visualizer

Click the eye button in the 3D view's toolbar and untick a group, for example House lights. Those fixtures are not drawn at all: no mesh, beam or pool. Agents do the same with `visualizer.hide` / `lights_visualizer_hide {groups|fixtures, hidden}` and read it back with `visualizer.status`. This is preview only, saved in the show as `show.visualizer`.

## Scale changes

The show schema allowed only 128 fixtures. The show now has 232, so the limit on fixtures per show, per group and per zone is now 512. Commands that take a list of fixtures (including `fixture.set` and `fixture.clear`, which were capped at 64) now take up to 512. Lamp strike/douse stays capped at 32 on purpose.

Backup of the show before this patch: `data/before-house-lights-2026-10-27.json`, local only and ignored by git.

## Layout confirmed — 2026-10-28

The operator photographed the Hog Fixture Builder page for **RGBW Pendant Light 4ch**:

| Channel | Function | DMX |
| --- | --- | --- |
| 1 | Intensity | 0–255 → 0–100 % |
| 2 | Red | 0–255 |
| 3 | Green | 0–255 |
| 4 | Blue | 0–255 |

There is no white channel, so the earlier assumed R, G, B, W layout was wrong. `pendant4` now encodes dimmer, red, green, blue, and its attributes are intensity and colour only. All 123 pendants are `verified:true` and receive DMX while output is armed. The operator's Hog Art-Net screen maps Hog universes 1–8 to Art-Net 0/0–0/7, which matches the app (Hog 8 → Art-Net 7, Hog 5 → Art-Net 4). On the same day the house-light channels read 0 on the Hog because the app sent nothing for unverified fixtures.

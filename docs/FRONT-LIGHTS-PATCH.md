# Front truss Colorados 409–418

Hog fixture window (operator photo, 2026-10-27): ten **Colorado 2 Quad Zoom Tour ar2z** heads, the same Hog fixture type as backlights 401–408, on a truss facing the stage.

| ID | Hog universe:start | Footprint |
|---|---|---|
|409|2:241|241–247|
|410|2:248|248–254|
|411|2:255|255–261|
|412|2:262|262–268|
|413|2:269|269–275|
|414|2:276|276–282|
|415|2:283|283–289|
|416|2:290|290–296|
|417|2:297|297–303|
|418|2:304|304–310|

* Profile `colorado` (7ch: dimmer, R, G, B, W, zoom, strobe 0). The starts are 7 apart, and the Hog type is identical to the backlights, which are verified on this profile. Enabled and verified as a profile. **Not yet tested physically on the front truss.**
* **Routing.** Hog universe 2 → raw Art-Net 1, inferred from the existing pattern (1→0, 3→2, 4→3, 5→4, 6→5). Confirm it at the Hog before arming. `output.configure` now accepts universe 2, and the Connection dialog lists it.
* **Group.** `front-lights`, "Front lights · truss facing stage", ordered 409→418.
* **Purpose.** Front wash, confirmed by the operator on 2026-10-27. **Not** the face lights. For the Look Link (docs/LOOK-LINK.md) this group is a `front` zone, not `face`.
* **3D placement (provisional).** Front-of-house truss Z=8, height Y=6.1, spaced 1.8 m from X=-8.1 (409) to X=8.1 (418). Left/right order has not been observed in the room. Each head saves `aim` [X, 0, 3], a floor point just inside the curved apron. Its pool lands on the downstage area, and it crosses face height near the stage edge. (The first aim, [X, 1.6, 1], put the pools upstage by the MH7s.) Change the placement with `fixture.place {id, position, aim}` / `lights_fixture_place`. The patch and calibration are kept.
* Backup of the show before this change: `data/before-front-lights-2026-10-27.json`, local only and ignored by git.
* Loading the show in the 0.3.0 engine also added its standard migrated fields: pages, targets, triggers, playback, LED wall and the `movers` group.

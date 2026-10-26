# Rear truss generic moving heads — pending verification

Hog screenshot inventory:

| ID | Hog personality label | Hog universe:start | Status |
|---|---|---|---|
|4101|7R Beam 230W 16ch|3:57|Unverified|
|4102|7R Beam 230W 16ch|3:78|Unverified|
|4103|7R Beam 230W 16ch|3:99|Unverified|
|4104|7R Beam 230W 16ch|3:120|Unverified|
|3901|200W Beam|3:162|Unverified|

Five existing rear-truss placeholders have these IDs and patches. Left/right order is provisional. They remain disabled with profile unknown: no DMX personality is guessed. All five use the already-established Hog universe 3 → raw Art-Net 2 route. The four starts are 21 addresses apart; that does not prove a 21-channel mode. The console label says 16ch. Actual footprint must come from the Hog personality or fixture documentation.

The screenshot's WATER, Fog Fury Jet, blank Rex Beam m2 and unpatched 3902 entries are outside this registration. No fog/water controls are added.

## Research

The manufacturer LIGHT4ME has a [7R Beam 230W product](https://light4me.pl/en/product/7r-beam-230w/) with 16 DMX channels, but the generic name does not establish that these physical heads use that model or chart. Similar-name manufacturer manuals use different layouts. Do not enable a speculative encoder based on a wattage/model label.

## Identify one personality at a time

1. Keep 4101 under Hog control. Use a working steady white look, with intensity full, no strobe and a known position.
2. Capture Hog DMX Output, Processor 1, universe 3, addresses 57–77. Also capture intensity zero with other settings unchanged. Identify which bytes change.
3. Obtain the Hog fixture personality's channel chart/export if possible. Confirm dimmer, steady shutter-open, pan/tilt and fine channels, color, gobo/prism/focus, and lamp/reset control. Only then build the shared UI/API/MCP encoder.
4. Compare the exact outgoing frame against the known working Hog frame. Yield the verified footprint, test one light, then add the other three matching personalities. Treat 3901 separately until its custom/200W personality is established.
5. Confirm physical left/right order and calibrate using saved stage placement/aim controls.

Unknown profiles remain visible through MCP status and `rear-heads` group. Existing fixture.patch/show.import/group.save support inventory edits. No raw channel probing or lamp/reset commands are sent during registration.

## Hog XML exports received
Both operator exports, `User Created 7R Beam 230W 16ch rev 0.xml` and `User Created 200W Beam rev 0.xml`, are well-formed Hog v3.17.1 XML. Both contain EncryptedData/CipherData/CipherValue, with no readable channel definitions. Originals are retained in docs/fixture-exports with SHA-256 inventory. These files cannot establish channel mappings without Hog displaying the decrypted personality. Keep all five profiles unverified. Next evidence: Fixture Builder Basic/Advanced channel blocks/screenshots, including channel ranges. Exporting/renaming the same library copy again does not provide a readable chart.

Update: 200W Beam screenshots subsequently supplied and transcribed; 3901 is now mapped and enabled for operator-authorized live testing. Named colors remain pending. See [200W profile](200W-BEAM-PROFILE.md). 4101–4104 remain disabled until their separate channel layout is supplied.

Update: the operator supplied the 7R Advanced screenshots as well. Four 7R heads now use beam7r and are enabled for live testing at their original addresses; named color slots remain pending. See [7R profile](7R-BEAM-PROFILE.md).

Confirmed rear-truss left-to-right order: **4104, 4102, 3901, 4103, 4101**. Update visual X placement and ordered rear-heads group only; retain each fixture’s patch and aiming calibration.

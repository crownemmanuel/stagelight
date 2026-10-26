# Verification · October 25, 2026

This version was built and exercised on the user's Mac. Development and the MCP demonstration used preview mode. No physical Art-Net output was armed by this build session. Earlier user-confirmed physical tests establish the patch, not acceptance of this new application as a production show controller.

## Automated checks

`npm test` completed with **24 passing tests, zero failures**. It covers the following with isolated temporary show files and fake output adapters:

- All 1,800 frames of the 60-second Prism dance: valid 530-byte ArtDmx packets, correct raw universe addresses, zeros outside the intended patch, no lamp/reset commands, only open/closed shutter values.
- Patch overlap and range validation; malformed input, unknown fixtures, unsupported raw-DMX fields, reserved object keys and command rejection.
- Deterministic effects; verified moving heads output regardless of the spatial calibration review flag. A regression test compares all six Rogue blocks byte for byte with the working Python photo look.
- Preview emits no packets; explicit arming rejects active previews; duplicate execution IDs do not restart a cue.
- Pause, preview seek, immutable playback snapshots, fade-to-black with retained pan/tilt, and disarm during an asynchronous tick.
- Individual still-look capture and named-position save/recall.
- Persisted edits survive restart; armed state, active playback and overrides do not.
- A corrupt show causes startup failure without overwriting the file.
- OSC encoding/decoding and rejection of malformed packets.
- Immediate live slider updates, merged rapid edits without losing attributes, captured selection targets, recovery after a rejected edit, and intensity changes during paused playback.

## Integration checks completed

- Real MCP SDK client over stdio: initialization, discovery of 23 tools, status read, saved Agent · Aurora cue, play, pause and seek to 8 seconds. Rendered intensity was nonzero while physical output remained disarmed with zero packets. Raw-DMX input was rejected. Script: `tests/mcp-smoke.mjs` (uses the SDK already installed in the separate LiveStage project).
- HTTP: mutation without the session token and requests with an unrelated Origin were rejected.
- OSC on loopback: ping, cue acknowledgment and duplicate-execution behavior passed.
- ArtDmx: a real UDP datagram was sent to a temporary **loopback-only** receiver and decoded. This is a packet-format/transport check, not a Hog receipt test. Script: `tests/network-smoke.mjs`.
- Syntax checks and native Swift build/ad-hoc signing completed.

Integration scripts intentionally exercise the local application's preview state and may save a demo cue. Run them with physical output disarmed. They are separate from the offline `npm test` suite.

## Desktop inspection

Opened the built AppKit/WKWebView app and verified the 3D room, beams, haze, cue library, playback, individual fixture selection, color controls, position inspector and named-position capture. The browser UI was also inspected at the narrow in-app panel width. Help pages and API documentation are bundled for offline use.

## Limits that remain

- The new app has not yet completed a supervised physical rehearsal or long-duration soak test.
- Stage dimensions and Rogue physical ID order are estimated. Every Rogue starts with calibration review unset. Named preview positions are not proof of real aiming.
- MH7 and unidentified blue fixtures are disabled placeholders until their exact personalities and patch are known.
- Visualization is illustrative: no photometric accuracy, exact gobo projection, measured beam orientation or 3D target-to-DMX calibration.
- This prototype has one active cue, ordered tracks and manual overrides. Cue-stack GO, timecode chase, live crossfades and redundant-engine takeover remain future work.
- Art-Net does not acknowledge ArtDmx receipt. A send counter is not proof of console/fixture response.
- Closing the native window leaves the independent engine running. Use Stop and Disarm for physical shutdown; manual HogNet handback remains necessary.
- The native bundle uses this Mac's installed Node.js runtime. It is ad-hoc signed, not a notarized installer with a bundled runtime.

Before a show, conduct a supervised rehearsal of the known fixture ranges, saved positions, blackout, network loss, engine termination/restart, and manual Hog takeover.

Full pan/tilt control: the six Rogue heads now default to the complete normalized 0–1 range, displayed as 0–255 in the Position sliders. Both 16-bit DMX endpoints are covered by an offline regression test. Updating the live show limits preserved the current positions. The earlier narrow rehearsal ranges are no longer the default.

Joystick math tests cover neutral/dead-zone hold, axis directions, constant diagonal speed, relative movement and per-fixture endpoints. No automated full-range physical sweep was performed.

Motor-speed correction: channel 5 defaults to DMX 0 (fastest), replacing the rehearsal value 160. The movementSpeed attribute runs 0–1 (slow–fast) independently of effect timing and joystick sensitivity. Tests cover default, both endpoints, and the original Python value.

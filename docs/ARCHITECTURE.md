# StageLight 0.1 (formerly LiveStage Lights)

This is a working, local prototype: native macOS window, independent Node engine, browser 3D view, HTTP command API, OSC input, and MCP stdio server. No cloud or AI is involved in playback. It is not yet a certified/redundant show-control system.

## Ownership

The engine is the sole owner of playback time and Art-Net output. UI, OSC and MCP are adapters around the same validated command catalogue in `engine/spec.mjs`. Pure effect functions map cue time + parameters + patch to fixture attributes. The encoder translates attributes to the two verified personalities. The UI receives those same attributes at 10 Hz and interpolates them for display. The engine outputs at 30 Hz on a monotonic clock.

Draft cue edits save to disk but do not mutate the snapshot currently playing. A cue play with an already-seen execution ID does not restart. IDs are remembered for the process lifetime (bounded to 1000). Only one cue plays at a time in this version; overlapping tracks use last-active-track precedence for a fixture. Manual fixture attributes override cue attributes, then the master and blackout apply. Stop fades from the current rendered frame and holds final pan/tilt. Cue completion holds the final pose at zero intensity. Live cue crossfades, layered playback buses and timecode chasing are future work.

## Files

- `engine/model.mjs`: known patch, profiles, ordered groups, palettes, example cues.
- `engine/spec.mjs`: every command schema and structural patch/cue validation.
- `engine/render.mjs`: deterministic effects, attribute conversion, ArtDmx encoding.
- `engine/engine.mjs`: playback, save transactions, command handlers and audit log.
- `engine/output.mjs`: exclusive UDP source socket; never armed automatically.
- `engine/osc.mjs`: strict OSC strings/int32/float32 codec.
- `engine/osc-routes.mjs`: the `/stagelight/…` OSC namespace for sister apps (pure routing to engine commands).
- `engine/look.mjs`: Look Link colour science (CCT, Duv, `white`, per-zone measures, change thresholds) for protocol `stagelight.look/1` ([LOOK-LINK.md](LOOK-LINK.md)).
- `server.mjs`: loopback HTTP, session token, server-sent events, loopback OSC.
- `mcp/server.mjs`: minimal MCP stdio transport with tools/list and tools/call.
- `public/stage.js`: Three.js spatial study using the room photograph as reference.
- `src-tauri/`: the desktop app (Tauri). It attaches to or starts the engine with its bundled Node.js, then shows the desk served by the engine; it also checks for and installs updates ([RELEASES.md](RELEASES.md)).

## Output contract

Verified physical patch: backlights 401–408 on Hog 3:1–56 → Art-Net address 2. Rogues 301–304 on Hog 4:106–169 → address 3; 305–306 on Hog 5:106–137 → address 4. Unverified MH7 and generic fixtures have no physical patch. Rogue fixture ordering, dimensions and beam orientation are provisional.

All outgoing packets are full 512-channel universes. Unused slots are zero. Therefore only the documented address ranges should be handed to Art-Net in Hog. There is no per-channel omission mechanism in an ArtDmx frame. No control/reset/lamp values are exposed through the command API. Wash reset and Rogue control slots remain zero. Hardware strobe commands are not exposed in v0.1. The dimmer effects are smooth pulses.

Rogue RGB requests map to the nearest discrete color-wheel position; preview uses the requested RGB as a conceptual approximation. Gobos and prism rotation are output attributes, but this renderer shows simplified prism rays, not exact gobo projections or optics. Frost broadens the illustrative cone. The screen is a static landmark, not a live video feed. Haze is preview-only.

## Live operation

Arming is explicit and cannot occur while a preview cue, override or fade is active. The previously tested Rogue heads are enabled using the verified 16-channel personality. Spatial calibration review is metadata, not a second output gate; pan/tilt limits still apply. Input bounds, overlap checks and fixture modes are validated. Changing patch/network settings or seeking is disabled while armed. Editing saved cues remains allowed, but affects the next play.

Blackout is intensity zero + closed shutter and holds motion positions; it does not extinguish discharge lamps. Disarm sends repeated dark frames with retained positions before closing the socket. The engine continues without the UI. Closing/quitting the native window leaves the service running intentionally; disarm from UI first. SIGTERM/SIGINT tries to send dark frames. Kill -9, power failure or lost network cannot guarantee a blackout; rehearse the Hog's input-loss behavior and manual HogNet handback.

No automatic console takeover, sender failover, acknowledged ArtDMX receipt, hard real-time guarantee, emergency-stop hardware, show-wide transport synchronization, or full optical simulation is claimed. A visible UDP send success only means the OS accepted the datagram.

## Persistence and security

`data/show.json` is versioned and atomically replaced. A malformed file causes startup to fail rather than silently replace the show. Runtime and armed state do not persist. `data/audit.jsonl` rotates at roughly 2 MB. The server listens only on loopback; token-protected mutations, Host/Origin validation and a bounded request size protect the local UI. OSC is also loopback-only, has no arm endpoint, and supports explicit cue IDs/execution IDs. Remote triggering needs a deliberate authenticated bridge or a future restricted LAN mode; do not simply expose this HTTP server publicly.

## Extension plan

1. Rehearse failure paths, map Rogue physical IDs, save calibrated positions, verify lamp and blackout behavior.
2. Add cue-stack GO/previous, runtime snapshots with explicit recovery, keyboard/MIDI bindings and per-attribute arbitration.
3. Add versioned fixture-profile import with review, fixture orientation/16-bit calibration, 3D targets and pan/tilt inverse mapping.
4. Add scheduled starts and video/timecode transport reconciliation; reliable command ack/retry, never replay relative GO blindly.
5. Separate hardware for lighting; rehearse a single-active-sender takeover policy before adding a standby engine.
6. Continue through the same command catalogue so all UI features remain available to agents.

## Portable stage alignment

`fixture.place` saves XYZ in meters (+X right, +Y up, -Z rear). 302 and 305 occupy the second bar at Z=0, pending operator confirmation of IDs. `calibration.hold` pauses playback and pins the selected head's commanded pan/tilt. `calibration.align` saves an actual normalized pose, virtual yaw/tilt in degrees, axis signs, label and timestamp under `fixture.calibration.alignment`. It rejects moving playback or a changed actual pose. These fields affect only the visualizer; Art-Net encoding is unchanged. One anchor determines offsets, not full optical/mount calibration. Travel assumptions: 540° pan, 270° tilt; axis signs are adjustable. There is no motor-position feedback.

The schema and status expose all fields via HTTP and MCP (`lights_fixture_place`, `lights_calibration_hold`, `lights_calibration_align`, `lights_show_import`). Show export includes complete calibration; import validates, requires disarmed output, saves a backup and retains the receiving Mac's network settings. Imports and launches never arm output. Desktop builds embed the current `data/show.json` as a first-launch template; subsequent edits live beside the app in `data/show.json`. Send an updated show export with the app for changes made after a build. Node 22+ remains a recipient requirement.

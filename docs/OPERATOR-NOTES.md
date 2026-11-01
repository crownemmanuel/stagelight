# Operator notes: rig to-dos

Physical jobs to do on the rig, noted during programming. Tick them off here when done.

- [ ] **Face light 48 (back rig): move it down physically.** It shines on the projector screen, so it is parked **off** in the show until it is moved (2026-10-30). After moving it, unpark it: right-click Face lights → open, or `lights_park_set {ids:["48"], parked:false}`.
- [ ] **Face light 49 (back rig, on the keyboard):** some of it spills onto the projector. Check it once 48 is fixed. It is in the group *On projector* with 48.
- [ ] **Face lights 42–44:** patched but not responding (2026-10-30). Find the fault, then place them on a rig.

## Software, after the 2026-11-01 services

- [ ] **Install the production-readiness update between services** (docs/PRODUCTION-READINESS.md), not during one. It needs one engine restart, and the app build must include the new `stagelight-io` helper.
- [ ] **Masters 2, 3 and 5 all play *Back Light up*.** A kick flash now punches through while the lead rides it. While one of them holds it at full, the others still show nothing: consider **Give it its own copy** on master 3 (lead, follow) in its ⚙.
- [ ] **Face lights are capped at 12%** by the update. *Special · light up* asks for 18% on ten face lights (45, 49, 25, …), so expect them dimmer there. Re-record it at 12% if that look matters.
- [ ] **Run the pre-show check** after the update. It now covers shared master cues, strobe rates, intensity limits, the sound input signal and device, and Art-Net sends.
- [ ] **Keep the sound input on *Dante Virtual Soundcard* by name**, not *System default input*. Watch the whole-input meter in a master's sound panel to confirm Dante audio before the service.


# StageLight ⇄ sister apps (OSC show control)

StageLight talks to LiveStage, the Sound app, a camera-control app and anything else on the show network with **OSC over UDP** — the same transport LiveStage already uses for the Hog and the Sound app. No connection setup, no handshake, sub-millisecond on the same Mac. This is the live-show path; MCP is for agents building the show.

## Where to send

| | Default | Notes |
|---|---|---|
| StageLight OSC listen port | **1461** UDP | ☰ → Network & triggers. Dev desks use other ports (1471, 1481). |
| Bind | **This Mac only** (127.0.0.1) | Switch to *Show network* to listen on all interfaces; then only allowlisted IPs are heard (`*` = any device). |
| Replies | to the sender's IP and source port | `/stagelight/ping i:port` replies to that port instead. |

Arguments are OSC strings, int32 or float32 (bundles are accepted). Pages and cues can be given **by ID, by name (case-insensitive) or by 1-based number**, as a string or an int. Commands set state, so a repeated packet is harmless; add a unique `requestId` string to GO/trigger messages to make retries exactly-once.

## Messages StageLight receives

| Address | Arguments | Does |
|---|---|---|
| `/stagelight/ping` | `[i:replyPort]` | Replies `/stagelight/hello s:"StageLight" s:version i:armed s:runningPage s:runningCue i:catalogRevision` |
| `/stagelight/catalog` | `[i:replyPort]` | Replies with everything another app can pick from (below) |
| `/stagelight/go` | `[s:page] [s:requestId]` | GO the next cue of that page's cue list (default: the page that is running). Auto-follow cues continue by themselves. |
| `/stagelight/go/cue` | `s:page s\|i:cue [s:requestId]` | GO a specific cue of a page (cue = entry ID, number or name). |
| `/stagelight/back` | | Previous cue on the running page |
| `/stagelight/stop` | `[f:fade]` | Stop and fade to dark (default 1.5 s) |
| `/stagelight/clear` | `[f:fade]` | Release manual changes back to the cue |
| `/stagelight/blackout` | `i:0\|1` | Blackout off / on |
| `/stagelight/master` | `f:0..1` (or 0..100) | Master level |
| `/stagelight/play` | `s:cue [f:fade]` | Play a library cue outside any page |
| `/stagelight/ledwall` | `s:media` | LED wall preview media (`off`) |
| `/stagelight/trigger` | `s:name [s:requestId]` | Fire a **named trigger** (below) |
| `/stagelight/look/get` | `[s:target] [i:replyPort] [s:requestId]` | Look Link: send the live look now ([LOOK-LINK.md](LOOK-LINK.md) §4) |
| `/stagelight/zones` | `[i:replyPort]` | Look Link: list zones (`/stagelight/zones/begin i:count`, `/stagelight/zone s:id s:name s:role i:fixtures`, `/stagelight/zones/end`) |
| `/stagelight/feedback` | `s:messageId s:status s:summary` | Look Link: log the app's decision about a message StageLight sent |
| `/stagelight/presets/begin` · `/item` · `/end` | `i:count [s:target]` · `s:id s:name [s:description]` · | Look Link: publish the app's preset list to StageLight's pickers |

Errors are answered with `/stagelight/error s:address s:message`. Legacy `/lights/*` addresses still work. OSC can never arm physical output or edit the patch.

## Named triggers (recommended for sister apps)

Send a meaning, not a cue number: `/stagelight/trigger "chorus"`, `"music.start"`, `"lion.leap"`. In StageLight each name maps to one action — GO a page or a specific cue, back, stop, clear, blackout on/off, master level, LED wall media or a library cue — and the operator or an agent can change the mapping without touching the sending app. MCP: `lights_trigger_save {trigger:{id,name,command,args}}`, `lights_trigger_fire`, `lights_trigger_delete`.

## Catalog: pick from what exists

So another app can offer StageLight's scenes, cues and triggers in a list instead of typed OSC (the way LiveStage lists StageMics' mics), `/stagelight/catalog` answers with one small message per item, in this order:

| Reply | Arguments |
|---|---|
| `/stagelight/catalog/begin` | `i:revision i:pageCount i:triggerCount i:libraryCueCount` |
| `/stagelight/catalog/page` | `s:pageId s:pageName i:pageNumber i:cueCount s:color` |
| `/stagelight/catalog/cue` | `s:pageId i:cueNumber s:entryId s:cueName s:follow (manual\|auto) f:fadeSeconds`, one per cue-list entry, after its page |
| `/stagelight/catalog/trigger` | `s:triggerId s:triggerName s:whatItDoes` (e.g. `GO Act One · cue 2 Sunrise`) |
| `/stagelight/catalog/library` | `s:cueId s:cueName` (for `/stagelight/play`) |
| `/stagelight/catalog/zone` | `s:zoneId s:zoneName s:role i:fixtureCount` (Look Link zones) |
| `/stagelight/catalog/end` | `i:revision` |

`revision` goes up whenever the show changes. `/stagelight/hello` carries it as its 6th argument, so an app that pings every few seconds re-reads the catalog only when it changed. Apps should store **IDs** (page, entry, trigger) and send those: names can be renamed, IDs keep working. Builds before OSC version 0.3.0 send a 5-argument hello and no catalog.

## Messages StageLight sends

Targets (☰ → Network & triggers → *Send to*; MCP `lights_target_save`) are OSC (`host`, `port`) or HTTP (JSON POST to `url`). Sends never delay playback.

| When | OSC | HTTP JSON |
|---|---|---|
| Every GO, to targets with **announce** | `/stagelight/cue/live s:pageId s:pageName i:cueNumber s:cueName s:entryId` | `{type:"cue", page:{id,name}, cue:{entry,id,name,number}}` |
| A cue's **look summary** (cue-list entry → *When this cue GOes, send → Look summary*), every GO for targets whose look mode is *Every GO* or *GO + live changes*, and live changes in that mode | burst: `/stagelight/look/begin …`, `/stagelight/look s:page s:cue i:kelvin f:level s:#rrggbb f:saturation` (unchanged), one `/stagelight/look/zone …` per zone, `/stagelight/look/end i:seq` | `{protocol:"stagelight.look/1", type:"look", reason, id, seq, page, cue, timing, state, output, kelvin, level, color, saturation, lit, fixtures, zones:[…], groups:[…]}` |
| A cue's **preset send** (*Preset in that app*), before its look | `/stagelight/preset s:presetId f:fade (-1 = not set) i:seq` | `{type:"preset", preset, fade?, page, cue}` |
| Custom (*Custom OSC message*) | the address and args you set | `{type:"message", address, args}` |
| Target test | `/stagelight/hello s:"StageLight" s:"test"` | `{type:"hello"}` |
| Preset list request (picker opened or *Refresh*) | `/stagelight/presets/request i:replyPort` | `{type:"presets.request"}`; reply `{presets:[{id,name,description}]}` |

Every HTTP body also carries the Look Link envelope (`protocol`, `version`, `id`, `seq`, `at`, `target`, `test`). An HTTP reply body `{ok, status, summary}` is shown next to the send in Recent messages and `lights_network_status` (`outbound[].reply`); `/stagelight/feedback` lands in `outbound[].feedback`.

**Look Link.** The full camera colour-temperature contract (zones with roles such as *face*, Duv/tint, `white`, change mode, presets, feedback) is [LOOK-LINK.md](LOOK-LINK.md), protocol `stagelight.look/1`. Zones: ☰ → Network & triggers → *Look Link zones* (MCP `lights_zone_save`); per-target settings: *Look* on the target (`lights_target_save` `look:{zones, mode, members, heartbeat}`); what would be sent: `lights_look_report`; send now: `lights_look_send`.

The overall look summary is the intensity-weighted color of every lit fixture (or, when the target receives zones, of the fixtures in those zones) (using what the fixtures can actually make: wheel slots, calibrated wheel colors), its correlated color temperature in Kelvin (McCamy), the average level and a saturation figure (0 = white light, 1 = pure color) so a camera app can tell "warm white 3000 K" from "deep amber" and only re-balance on white light. Per-group summaries are included in JSON.

### Example: camera white balance
1. Camera app listens for OSC on, say, 9100. Add a target *Camera control* → OSC 127.0.0.1:9100.
2. On each cue that changes the light's color, add *When this cue GOes, send → Camera control · Look summary*.
3. GO (from StageLight, LiveStage or a trigger): the camera app receives `/stagelight/look "Act 1" "Sunrise" 3150 0.72 "#ffc58a" 0.31` and sets white balance ≈ 3150 K.

### Example: LiveStage video marker
A time marker on a clip sends `/stagelight/go/cue "Act 1" 4` (or `/stagelight/trigger "lion.leap"`) to 127.0.0.1:1461 at the exact frame; StageLight GOes cue 4 and its auto-follow chain runs. With *announce* on a LiveStage target, LiveStage hears `/stagelight/cue/live …` back.

## Readback and testing

`lights_network_status` (and the Recent messages list) shows the listener, the allowlist, every inbound message with sender, result and handling time in ms, and every outbound send. Measured on a MacBook (same machine, loopback): a GO sent over UDP is handled in ≈1 ms and its announcement arrives back in ≈2 ms median.

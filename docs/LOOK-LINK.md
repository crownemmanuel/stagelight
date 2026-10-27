# StageLight Look Link: integration spec, protocol `stagelight.look/1`

This is the contract between **StageLight**, the stage lighting desk, and a **receiving app**: a lighting or camera control app that has its own agent. StageLight tells the receiving app what the stage light looks like now: colour temperature, tint, colour and level for each zone (face, front, back, top grid…). StageLight can also tell it to **recall one of its presets**. The receiving app's agent then decides what to change, for example warming the camera's white balance or trimming the face light. StageLight never tells it how to correct.

Give this whole file to whoever builds the receiving app. It builds on the OSC show-control link in [SISTER-APPS.md](SISTER-APPS.md). Every message that exists today keeps working unchanged.

> **Status (2026-10-27).** Everything marked **v1** is implemented in StageLight's working tree (not yet in a tagged release; the `version` field reads the app's package version, currently `0.3.0`): zones, Duv, `white`, on-change sends, settled and heartbeat looks, pull requests, presets, preset lists and feedback. Released StageLight 0.3.0 only sends the overall look (`/stagelight/look`, and JSON `type:"look"` with `groups`) on cue GO, so treat every v1 field as optional when you parse. Where building it changed a detail, the text below says so; the list is in §10.

---

## 1. Transports

| Direction | Transport | Use it for |
|---|---|---|
| StageLight → app | **HTTP JSON POST** to a URL the app gives (recommended for an agent-driven app) | Full look reports with zones and per-fixture detail, presets, cue announcements |
| StageLight → app | **OSC over UDP** to a host:port the app gives | The same information as small typed messages, with the lowest latency |
| app → StageLight | **OSC over UDP** to StageLight's port **1461** | Asking for the current look, asking for the zone list, sending feedback, and the existing GO, trigger and ping messages |

* StageLight's own HTTP API listens on the StageLight Mac only (localhost, with a session token), so other apps **must not** call it. Talk to StageLight over OSC. StageLight talks to the app over HTTP or OSC, whichever the operator picks for that target.
* By default, StageLight's OSC listener accepts only senders on the same Mac. For a second machine, the operator switches it to *Show network* and adds the app's IP to the allowlist (☰ → Network & triggers).
* Both apps should run on a trusted show network. HTTP sends carry no authentication. If the app needs some, put a secret path segment in the URL, for example `http://10.0.0.20:9200/stagelight/7f3a…`.

### What the receiving app needs to give the StageLight operator
1. **Either** an HTTP endpoint URL that accepts `POST application/json`, for example `http://10.0.0.20:9200/stagelight`, **or** an OSC UDP port, for example `10.0.0.20:9100`. Both are fine.
2. Optionally, its preset list (see §5), so presets show up in StageLight's pickers.

---

## 2. Concepts

**Zone.** A named set of StageLight fixtures that has one *role*. The StageLight operator defines zones and chooses which zones each receiving app gets. The app must work with whatever zones arrive, so it should key its logic on the **role** and fall back to the zone **id** or **name**.

| role | Meaning | Typical zone in our rig |
|---|---|---|
| `face` | Key or face light on performers. **This is what camera white balance and skin tone depend on.** | Face lights (Rêve E-3s 1–49, group `face-lights`) |
| `front` | Front wash or front beams | Front lights (409–418), Front beams (Rogues) |
| `back` | Backlight and rim | Backlights (Colorados) |
| `top` | Overhead and top light | Ceiling grid (Q120s) |
| `side` | Side light | Stage left, stage right |
| `effect` | Moving-head beams and effects. Usually ignored for colour correction. | MH7s, rear heads |
| `audience` | Audience-facing light | Audience MH7s |
| `other` | Anything else | |

Zone ids are stable, but names can be renamed. Several zones may share a role. When they do, weight each zone by its `level`.

**Look.** The lighting state of those zones at one moment. Values are **absolute**, not deltas, so any single look message is enough to know the whole state, and the newest one always wins.

**Nominal, not metered.** StageLight computes colour from what each fixture is told to output and what that fixture can actually make: RGB mixing, colour wheel slots, and wheel colours the operator calibrated. Nobody measures it with a meter. Treat `kelvin` and `duv` as a strong prior for the camera, not as ground truth. A fixture on a wheel position that nobody has named yet counts as white and is reported in `colorUnknown`.

---

## 3. StageLight → app: messages

### 3.1 JSON envelope (HTTP)

Every POST body is one JSON object:

```json
{
  "protocol": "stagelight.look/1",
  "app": "StageLight",
  "version": "0.4.0",
  "type": "look",
  "id": "msg_9f2c1a7e",
  "seq": 1842,
  "at": "2026-10-26T19:42:07.512Z",
  "target": "camera-control",
  "test": false
}
```

| Field | Notes |
|---|---|
| `protocol` | **v1.** Always `stagelight.look/1` for this version. A future major version changes the number. |
| `type` | `look`, `preset`, `cue`, `hello` or `message` (custom). Ignore any type you don't know. |
| `id` | **v1.** Unique per message. Use it to de-duplicate, and echo it back in feedback. |
| `seq` | **v1.** Counts up for each target (every message type shares the counter, with gaps). **Drop any `look` whose `seq` is lower than the last one you applied.** UDP and parallel HTTP can arrive out of order. It is based on tenths of a second since 2026-01-01, so it keeps rising across StageLight restarts and fits an OSC int32 until 2032. |
| `at` | When StageLight sent the message (ISO 8601, UTC) |
| `target` | **v1.** The id StageLight gave your app, which is useful if one app serves several targets |
| `test` | `true` when the operator pressed *Send look* or *Ping* on the target. Show it, but you may skip acting on it. |

The envelope is on every JSON message StageLight sends (`look`, `preset`, `cue`, `hello`, `message`, `presets.request`). `version` is StageLight's app version.

**Your HTTP response:** reply **within 1 second**. StageLight gives up after 1 s and does not retry. A newer look replaces the old one anyway. Accept first, then let your agent run asynchronously:

```json
{ "ok": true, "status": "queued", "summary": "Will rebalance face cam to 3400K / +2 magenta" }
```

`status` is one of `applied`, `queued` or `ignored`. StageLight shows `summary` (up to 200 characters) next to that send in its network log, where the operator and StageLight's agent can read it. Any `2xx` counts as delivered. The body is optional.

### 3.2 `type: "look"`, the state report

Sent when:

| `reason` | When |
|---|---|
| `cue` | A cue GOes on a cue-list entry that has a *Look summary* send for your target, or on any GO if the target's mode is `cue` or `change`. **The values are the cue's end state**, under the operator's current manual changes, master and blackout (effects are sampled the way 0.3.0 did, at half the cue length or 2 s). The fade is still running when you get this message (see `timing`). |
| `change` | **v1.** Target mode `change`: the live look of your zones changed by at least a set amount, through manual edits, effects, master or blackout. Rate-limited (see §6). |
| `settled` | **v1.** Change-mode targets only: a fade that was announced with `reason:"cue"` has finished. The values match the cue message (recomputed, so they include manual changes made meanwhile). Use it to confirm. |
| `request` | **v1.** Your app asked for it with `/stagelight/look/get` (see §4), or the StageLight operator or agent pressed *Send now* (`lights_look_send`). A `requestId` you sent comes back as `requestId`. |
| `heartbeat` | **v1.** An optional repeat every N seconds, configured per target. Nothing changed. |
| `test` | The operator pressed *Send look* on the target |

```json
{
  "protocol": "stagelight.look/1", "app": "StageLight", "version": "0.4.0",
  "type": "look", "reason": "cue", "id": "msg_9f2c1a7e", "seq": 1842,
  "at": "2026-10-26T19:42:07.512Z", "target": "camera-control", "test": false,

  "page": { "id": "act-1", "name": "Act 1" },
  "cue":  { "entry": "e-04", "id": "sunrise", "name": "Sunrise", "number": 4 },
  "timing": { "fade": 3.0, "startedAt": "2026-10-26T19:42:07.510Z", "settlesAt": "2026-10-26T19:42:10.510Z" },
  "state": "fading",
  "output": { "armed": true, "blackout": false, "master": 0.8 },

  "kelvin": 3420, "level": 0.61, "color": "#ffcf9e", "saturation": 0.38,
  "lit": 31, "fixtures": 44,

  "zones": [
    {
      "id": "face", "name": "Face lights", "role": "face",
      "lit": 4, "fixtures": 4, "level": 0.72, "peak": 0.80,
      "color": "#ffc58a", "kelvin": 3150, "mired": 317, "duv": 0.0042,
      "cie": { "x": 0.4252, "y": 0.3971 },
      "saturation": 0.46, "white": true, "colorUnknown": 0
    },
    {
      "id": "back", "name": "Backlights", "role": "back",
      "lit": 8, "fixtures": 8, "level": 0.55, "peak": 0.55,
      "color": "#3a6bff", "kelvin": 12800, "mired": 78, "duv": -0.0610,
      "cie": { "x": 0.1912, "y": 0.1730 },
      "saturation": 0.77, "white": false, "colorUnknown": 0
    }
  ],

  "groups": [ { "id": "backlights", "name": "Backlights", "kelvin": 12800, "level": 0.55, "color": "#3a6bff", "saturation": 0.77 } ]
}
```

**Top level**

| Field | Notes |
|---|---|
| `page`, `cue` | The scene and cue that set this look. Both are `null` for `change`, `request` or `heartbeat` messages sent while no cue is running. `cue.number` is the 1-based position in the page's cue list. |
| `timing.fade` | **v1.** Seconds over which the stage moves to these values. 0 means a hard cut. **Ramp your correction over the same time** so the camera follows the light. On live looks (`change`, `request`, `heartbeat`, `test`) it is 0, or the crossfade or stop fade that is running, in which case `state` is `fading`. |
| `timing.startedAt`, `timing.settlesAt` | **v1.** When the fade started and when it finishes, both in absolute time |
| `state` | **v1.** `fading` or `settled` |
| `output` | **v1.** `armed: false` means StageLight is in preview only and the real stage did not change. **Do not correct cameras while `armed` is false** unless you are rehearsing. `blackout: true` means everything is dark. `master` (0–1) is already included in every level. |
| `kelvin`, `level`, `color`, `saturation`, `lit`, `fixtures` | The overall figures across the zones sent to this target. In 0.3.0 they covered every fixture. These fields stay for compatibility. Prefer `zones`. |
| `zones` | **v1.** One entry for each zone this target receives, in the operator's order |
| `groups` | Every StageLight group that has lit fixtures (0.3.0 behaviour). Kept for compatibility. |

**Zone measures**

| Field | Type | Meaning |
|---|---|---|
| `id`, `name`, `role` | string | See §2 |
| `fixtures` | int | Enabled fixtures in the zone |
| `lit` | int | Fixtures above 2% intensity. **If it is 0, the zone is dark: keep your last correction and don't balance to it.** |
| `level` | 0–1 | Average intensity across all fixtures in the zone, after master and blackout. This is what the audience sees. |
| `peak` | 0–1 | **v1.** The brightest fixture in the zone |
| `color` | `#rrggbb` | The colour of the zone's light, as an intensity-weighted average of each lit fixture's output (sRGB, display-referred) |
| `kelvin` | int, 1000–20000, or `null` | Correlated colour temperature (CCT, McCamy). `null` when the zone is dark (`mired`, `duv` and `cie` are then `null` too; OSC sends 0). McCamy is only meaningful near the white locus: a deep blue can read 4400 K. Look at `white` first. |
| `mired` | int | **v1.** 1,000,000 ÷ kelvin. Use it to compare or ramp white balance, because mired steps are perceptually even. |
| `duv` | float | **v1.** Distance from the Planckian locus in CIE 1960 uv. **A positive value means greenish, so add magenta. A negative value means magenta or pink, so add green.** This is the camera's *tint* axis. |
| `cie` | `{x, y}` | **v1.** CIE 1931 chromaticity, for apps that do their own colour science |
| `saturation` | 0–1 | HSV saturation of `color`. Warm whites read 0.3–0.6, so **use `white`, not `saturation`, to decide whether to white balance.** |
| `white` | bool | **v1.** `true` when the light is *white light* that a camera should balance to: lit, `abs(duv) <= 0.015` and 2000 K ≤ kelvin ≤ 10000 K. `false` means it's a coloured look (deep blue, amber, magenta), so don't try to neutralise it. The thresholds may be tuned. Apply your own rule to the raw values if you like. |
| `colorUnknown` | int | **v1.** Lit fixtures whose colour StageLight can't vouch for, because they sit on a wheel position nobody has named yet. Above 0, treat the zone's colour as low confidence. |
| `members` | array | **v1, only if the target asks for per-fixture detail:** `[{ "id":"301", "name":"Rogue 1", "profile":"rogue", "level":0.8, "color":"#ffc58a", "kelvin":3150, "duv":0.004, "known":true }]` |

### 3.3 `type: "preset"`: recall one of *your* presets (v1)

The operator attaches this to a cue so the receiving app recalls a preset it owns, for example "Face warm 3200" or "Cam 2 stage-wide":

```json
{ "protocol": "stagelight.look/1", "type": "preset", "id": "msg_…", "seq": 1843, "at": "…", "target": "camera-control",
  "preset": "face-warm-3200", "fade": 3.0,
  "page": { "id": "act-1", "name": "Act 1" }, "cue": { "entry": "e-04", "id": "sunrise", "name": "Sunrise", "number": 4 } }
```

* `preset` is **your** preset id, exactly as you published it (§5) or as the operator typed it. Match case-insensitively on id, then on name.
* `fade`, in seconds, is optional. If it is present, transition over that time.
* An unknown preset gets `{ "ok": false, "status": "ignored", "summary": "Unknown preset face-warm-3200" }` so the operator sees it.
* If a cue sends both a preset and a look, the preset message is sent first. The look follows straight after.

### 3.4 `type: "cue"`: cue announcement (exists today)

Sent on **every** GO when the target has *announce* on: `{ "type":"cue", "page":{id,name}, "cue":{entry,id,name,number} }`. Use it for context and logging. It carries no colour data.

### 3.5 `type: "hello"`: connection test (exists today)

`{ "type":"hello", "app":"StageLight" }`. Reply with any 2xx.

### 3.6 OSC equivalents

The same information as typed OSC messages (`s` string, `i` int32, `f` float32), for targets of kind OSC. A look is a burst of messages in this order:

| Address | Arguments |
|---|---|
| `/stagelight/look/begin` **v1** | `i:seq s:reason s:pageName s:cueName f:fadeSeconds i:zoneCount i:armed` |
| `/stagelight/look` (exists) | `s:pageName s:cueName i:kelvin f:level s:#rrggbb f:saturation` (overall; kelvin 0 = dark) |
| `/stagelight/look/zone` **v1** | `i:seq s:zoneId s:role s:zoneName i:kelvin f:duv f:level s:#rrggbb f:saturation i:white(0/1) i:lit i:fixtures i:colorUnknown`, one message per zone |
| `/stagelight/look/end` **v1** | `i:seq` |
| `/stagelight/preset` **v1** | `s:presetId f:fadeSeconds i:seq` (fade `-1` = not set: use your own default) |
| `/stagelight/cue/live` (exists) | `s:pageId s:pageName i:cueNumber s:cueName s:entryId` |
| `/stagelight/hello` (exists) | `s:"StageLight" s:"test"` |

Apply the look when `/look/end` arrives with the same `seq`. If the burst is incomplete, ignore it and wait for the next one. Per-fixture detail is JSON only.

---

## 4. App → StageLight: OSC to port 1461

Everything in [SISTER-APPS.md](SISTER-APPS.md) still works: `/stagelight/ping`, `/stagelight/catalog`, `/stagelight/go`, `/stagelight/trigger` and the rest. These are new in v1:

| Address | Arguments | StageLight does |
|---|---|---|
| `/stagelight/look/get` | `[s:targetId] [i:replyPort] [s:requestId]` (an int first = no target; `""` holds a place; `s:targetId s:requestId` also works) | Sends a fresh `look` with `reason:"request"`, from the live stage state. **With `targetId`** (id or name), StageLight sends it through that target's own transport, so an HTTP target gets a POST, and uses that target's zones. **Without it**, StageLight replies with the OSC burst (§3.6), covering every zone, to the sender, or to `replyPort` if given. Use it on startup and after a reconnect. |
| `/stagelight/zones` | `[i:replyPort]` | Replies `/stagelight/zones/begin i:count`, then one `/stagelight/zone s:id s:name s:role i:fixtureCount` for each zone, then `/stagelight/zones/end`. The `/stagelight/catalog` reply also includes `/stagelight/catalog/zone` with the same arguments. |
| `/stagelight/feedback` | `s:messageId s:status s:summary` | Logs your agent's decision against the StageLight message it answers. Use this for decisions made after your HTTP reply, or for OSC targets. `status` is `applied`, `ignored`, `failed` or `queued`; `summary` up to 200 characters. OSC messages carry no message id, so an OSC target sends the message's `seq` as a string. StageLight matches the last 40 messages it sent. |
| `/stagelight/presets/begin`, `/stagelight/presets/item`, `/stagelight/presets/end` | `i:count [s:targetId]` · `s:presetId s:name [s:description]` · nothing | Publishes your preset list to StageLight's pickers (§5). StageLight files it under the target named in `begin`, else the only target whose host matches your sender IP, else the one whose OSC port matches your sending port, else the one StageLight asked last (within 30 s). If several targets share your host and none of that decides, it answers `/stagelight/error`: send your target id in `begin`. At most 200 presets. |

Errors come back as `/stagelight/error s:address s:message`. Nothing an app sends can arm physical output or edit fixtures.

---

## 5. Publishing your presets (v1, optional)

You don't have to do this, but it lets the StageLight operator choose your presets from a list instead of typing ids.

* **HTTP target:** StageLight POSTs `{ "type": "presets.request", … }`. Reply with
  `{ "ok": true, "presets": [ { "id": "face-warm-3200", "name": "Face warm 3200K", "description": "Key 3200K, cam WB 3200/+0" } ] }`.
  StageLight asks when the operator picks *Preset in that app* or presses *Refresh*. Lists are kept in StageLight's memory, not in the show, so publish again after StageLight restarts (or wait to be asked).
* **OSC target:** StageLight sends `/stagelight/presets/request i:replyPort`. Answer with the `/stagelight/presets/*` burst (§4) to that port.

Keep preset ids stable. StageLight stores the id in the cue.

---

## 6. Delivery rules

* **State, not commands.** Each look is the complete state of your zones. Missing one does no harm. Always act on the newest `seq`.
* **On a cue GO**, the look arrives right away, together with the start of the fade, and contains the **end** state. Ramp your correction over `timing.fade`. In `change` mode, a `settled` look follows when the fade ends.
* **Change mode limits:** a look goes out only when a zone has changed by at least 100 K, or 0.002 Duv, or 0.05 level, or when `lit` crosses 0, or `white` flips. The 100 K step counts only while the zone is white light, because McCamy Kelvin of a saturated colour jumps by hundreds of K for tiny shifts. At most 4 looks go out per second per target. After a look went out because of a change, a final look goes out once changes stop for 250 ms (if anything moved since), so the last state is never lost. Turning change mode on sends nothing by itself; ask with `/stagelight/look/get`.
* **During an announced fade** (change mode), live changes are held until the fade ends and the `settled` look goes out. Stopping, another GO, a master change or blackout during the fade ends that wait at once, and normal change sends resume.
* **No retries.** HTTP times out after 1 s. UDP is fire-and-forget. If you miss something or restart, use `/stagelight/look/get` to catch up.
* **Preview vs live:** `output.armed: false` means StageLight is not driving the real fixtures. Flag it in your UI. Don't move real cameras for it unless you are rehearsing deliberately.
* **Units:** levels are 0–1, Kelvin is an integer, colours are `#rrggbb` lowercase, times are ISO 8601 UTC, fades are in seconds.
* **Forward compatibility:** ignore fields and types you don't know. New fields can be added in `stagelight.look/1`. Removing or redefining a field means `stagelight.look/2`.

---

## 7. Suggested logic for the receiving app's agent

1. Choose the reference: the `face` zone(s), weighted by `level`. If none are lit, use `front`, then `top`. Never use `effect` or `audience`.
2. If the reference zone has `white: true`, set camera white balance toward `kelvin`, ramped in mired over `timing.fade`. Set tint from `duv`: positive means add magenta, negative means add green.
3. If `white: false`, the look is intentionally coloured. Keep the camera on the show's base white balance, or the last white look's, and possibly protect skin tones only. Don't neutralise the colour.
4. If `colorUnknown > 0` or `output.armed` is false, lower confidence. Hold your correction or ask the operator.
5. Use `back` and `top` as context, for example how strong a coloured rim is relative to the key (`level` ratios). Don't white balance to them.
6. Answer each message with a short `summary` (HTTP reply or `/stagelight/feedback`), so the StageLight operator sees what you did.

---

## 8. Quick test from a terminal

Listen as an HTTP target (any small server works). For example, with Node:

```bash
node -e "require('http').createServer((q,r)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{console.log(b);r.writeHead(200,{'content-type':'application/json'});r.end('{\"ok\":true,\"status\":\"applied\",\"summary\":\"test receiver\"}')})}).listen(9200)"
```

In StageLight, add a target (☰ → Network & triggers → *Send to*) that points at `http://<your-ip>:9200/stagelight`, then press **Send look**. Its MCP equivalent is `lights_target_test {id, message:"look"}`.

---

## 9. StageLight-side reference (for StageLight maintainers and agents)

| Capability | UI | MCP |
|---|---|---|
| Define zones (name, role, groups and/or fixtures), saved in the portable show | ☰ → Network & triggers → *Zones* | `lights_zone_save`, `lights_zone_delete` |
| Per target: zones to send (none = every zone), mode (`cue` / `change` / `off`; a target without `look` is `off`), per-fixture detail, heartbeat seconds (0 = off; with mode `cue` or `change`) | *Look* on the target | `lights_target_save` (`look: {zones, mode, members, heartbeat}`) |
| Attach a look or a preset send to a cue | Cue entry → *When this cue GOes, send* | `lights_page_save` entry `send: [{target, message:"look"\|"preset", preset?, fade?}]` |
| Read or refresh an app's published preset list | *Preset in that app* → list / *Refresh* | `lights_target_presets {id, refresh?}` |
| See exactly what would be sent (live or for a cue) | *Look* → *Preview*; live zone figures in the *Zones* list | `lights_look_report {target?, zones?, cue? \| page+entry, members?}` |
| Send now | *Send look* | `lights_look_send {target}` / `lights_target_test` |
| Feedback and delivery log | Network & triggers → Recent messages | `lights_network_status` (`outbound[].reply`, `outbound[].feedback`, `presets`, `looks`) |

Code: colour science and change thresholds in `engine/look.mjs`; zones, envelope, sending modes, presets and feedback in `engine/engine.mjs`; OSC routes in `engine/osc-routes.mjs`; tests in `tests/look-link.test.mjs`.

---

## 10. What changed while building v1

For the receiving app's builder; all of it is reflected in the sections above.

1. `seq` is time-based (tenths of a second since 2026) rather than a plain counter, so it survives StageLight restarts.
2. OSC `/stagelight/preset` sends fade `-1` when the cue has no preset fade.
3. Feedback for OSC targets matches the message's `seq` (OSC carries no message id).
4. `/stagelight/presets/begin` accepts an optional `s:targetId`, needed when several targets share a host (for example two apps on the same Mac).
5. Change mode ignores Kelvin steps while a zone is coloured (not `white`) and also sends when `white` flips. Live changes are held during an announced fade unless playback, master or blackout change.
6. `settled` looks go to change-mode targets only, as §6 said; `cue`-mode targets get only the GO look.
7. A cue look's end state includes current manual changes, master and blackout. 0.3.0 used the cue alone at master.
8. Dark zones have `null` `kelvin`, `mired`, `duv` and `cie` in JSON.
9. *Send look* (`target.test`) now sends the live look of the target's zones (reason `test`); 0.3.0 sent the running or first cue's look. On OSC it still uses page name `test` in `/stagelight/look`.
10. Preset lists are kept in memory, not saved in the show.

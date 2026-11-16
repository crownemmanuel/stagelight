# Wall video link (LiveStage → StageLight), receiver

While the operator rehearses in LiveStage's **preview**, LiveStage can stream what its preview monitor shows to StageLight. StageLight puts the picture on the virtual LED wall of its 3D visualizer and **delays its light rendering** by each frame's measured latency, so a light cue LiveStage fires with a clip lands on the visualizer with the frame it belongs to.

It is a rehearsal tool. It changes nothing about lighting, output or the show: only what the visualizer draws. The sender side, the choice of method (NDI, MJPEG, WebRTC and Syphon were rejected) and LiveStage's settings are described in LiveStage's own docs.

## Ports and endpoints

| Where | What |
| --- | --- |
| `ws://<this Mac>:1455/wall/in` (`LIGHTS_WALL_PORT`, default **1455**, `off` to disable), bound to `0.0.0.0` | Ingest: LiveStage connects here. One sender at a time, and a new sender replaces the old one. Loopback is always accepted. Other addresses are accepted only when StageLight listens on the show network with that address (or `*`) in its OSC allowlist (☰ → Network & triggers). Messages over 2 MB close the socket (1009). |
| `ws://127.0.0.1:<LIGHTS_PORT>/api/wall` | Relay to StageLight's own windows (main window and pop-out visualizer). It is on the main HTTP server, so it has the same host and origin checks and is never on the LAN. Frames are relayed **byte for byte**. |

A dev desk sets its own port. The `stagelight-wall` launch config uses HTTP 1486, OSC 1487 and wall 1488.

The WebSocket is `engine/ws.mjs`, a small RFC 6455 implementation with no dependencies. It covers the handshake, text and binary messages with 7-, 16- and 64-bit lengths, fragmentation, masking, ping/pong and close, and supports no extensions. It also has a client, used by the test sender and the tests.

## Wire protocol, version 1 (unchanged from LiveStage's spec)

Binary messages are frames and text messages are JSON. Everything is little-endian. Times are epoch ms floats, read as `performance.timeOrigin + performance.now()`.

```
0  4 ascii "LSWV"   4 u8 version=1   5 u8 codec 1=JPEG 2=WebP
6  2 u16 width      8 u16 height     10 u16 flags (bit0 preview frozen, bit1 no scene)
12 4 u32 seq (+1 per frame sent; gaps = dropped by the sender)
16 8 f64 stamp   LiveStage clock time this picture shows (when its render ran)
24 8 f64 sentAt  LiveStage clock time it went on the socket
32 ... image bytes
```

| Direction | Message |
| --- | --- |
| LS → SL | `{"t":"hello","app":"LiveStage","version":…,"protocol":1,"width","height","fps","scene","wall":[3072,768]}` on connect and on change |
| SL → LS | `{"t":"hello","app":"StageLight","version":"<package version>","protocol":1,"armed":false}` on connect and whenever armed changes (checked every 250 ms) |
| SL → LS | `{"t":"viewers","n":2}` on connect and whenever it changes. n counts the windows showing the stream, and is 0 while output is armed. **With n:0 LiveStage stops capturing.** |
| SL → LS | `{"t":"stats","fps","latency","jitter","delay","offset"}` once a second while frames arrive |
| SL → LS → SL | `{"t":"ping","id","s"}` / `{"t":"pong","id","s","l"}`: five pings 100 ms apart after connecting, then one every second |

**Clock offset:** `rtt = now − s` and `offset = l − (s + rtt/2)`, which is the LiveStage clock minus the StageLight clock. StageLight keeps the sample with the smallest rtt from the last 10 s (`ClockSync` in `engine/wall.mjs`).

## How the delay works

1. **Engine light frames carry their time.** Each engine tick stamps `tickAt` (StageLight clock, epoch ms). The runtime carries it as `at`, and the delta stream sends it with every message (`engine/stream.mjs`). A new `at` on its own never causes a message.
2. **30 Hz while a window draws the stream.** Normally the desk's delta stream samples at 10 Hz. While the feed is live (frames relayed to at least one showing window, the last one under 1 s ago), the server sends a delta after every engine tick instead (`engine.afterTick`). A light change is then never more than one tick away from its true time. When the feed stops, the hook is removed.
3. **The window shows video as soon as it is decoded** (`public/wall-video.js`). Decoding is `createImageBitmap` on the JPEG bytes, one frame at a time, and frames that arrive meanwhile replace each other, so only the newest waits. The picture is drawn into one reused canvas texture on a plane just in front of the LED wall media (`Stage.wallFrame`). The chosen media is paused underneath, and `Stage.wallEnd()` brings it back.
4. **The lights follow the picture.** While the feed is live, `Stage.update(frames, at)` hands engine frames to a 1 s light history instead of drawing them. At the start of each animation frame where a new picture is ready (`Stage.animate` → `present()`), the window draws that picture and sets the lights to their state at StageLight time **`stamp − offset − manual`**. Both are drawn by the same render. History entries hold until the next one. A time within half an engine tick (16.7 ms) before an entry counts as that entry, because the change it carries happened during that tick. Fixtures snap to the delayed state (`stage.snap`) rather than ease toward it, so the drawn light changes on the frame it belongs to.
5. **Measurement.** For each drawn frame, `latency = shownAt − (stamp − offset)`, with `shownAt` mapped to the StageLight clock through the window's own ping to the server. Windows send their samples up once a second. The server reports latency as the median over the last 2 s and jitter as p90 − p10. `delay = latency + manual`.

**Manual offset:** −200…+200 ms, default 0, **positive = lights later**. It is for what the stamps cannot see, such as a monitor's own lag. It is saved per computer in `<data>/wall-video.json`, not in the show, so that MCP and every window share the same value. The number box sits beside the readout. (The brief's formula wrote `+ manual`; here the sign follows its own rule that positive means later.)

**Feed stops** (no frame for 1 s, or the sender disconnects): the window stops delaying, the lights go live, and the wall returns to its media. The readout says `Wall video: no feed`, or `sender gone` (it disappears 10 s later). **Output armed:** frames are neither relayed nor drawn, viewers read 0 and the readout says it is paused. This keeps the existing rule that preview video does not decode while output is armed.

**When nothing is connected, it costs nothing.** The runtime has no `wall` field, so windows open no socket and keep no history or texture. The extra work in a paint is one check (`syncWall`), plus one property check in `Stage.update` and one in `Stage.animate`. The server runs no timers until a sender connects.

## Readout

`Wall video · 25 fps · 1024×256 · latency 46 ms ±4 · lights +46 ms`, with the light offset box. It sits under the top bar of the 3D view in both windows. It is hidden while that window's stage is hidden (Groups view, Library, popped out).

## MCP and commands

| Command / tool | Does |
| --- | --- |
| `wall.video.status` / `lights_wall_video_status` (read-only) | Listening port, sender and its hello, feed state, viewers, fps, latency, jitter, delay, manual, clock offset and rtt, frame counts (received, relayed, invalid, sender gaps, view drops, refused), bytes/s, the last header, and the probe's steps |
| `wall.video.offset {ms}` / `lights_wall_video_offset` | Sets the manual light offset and returns the status |
| `wall.video.probe {enabled, threshold?}` / `lights_wall_video_probe` | The sync probe (below). Returns the status. |

The built-in assistant gets only the status tool, because providers allow at most 128 tools.

### Sync probe (flash test)

While the probe is enabled, each showing window samples every drawn picture's mean luma on an 8×4 canvas. It records the StageLight time at which the luma crossed the threshold, and the time at which the drawn (delayed) intensity of any fixture crossed it. The status pairs each video step with the nearest light step of the same direction from the same window: `{videoStepAt, lightStepAt, diff}`, where diff = lights − video in ms. Because lights change only on drawn pictures, diff comes in whole video frames (40 ms at 25 fps).

Measured on 2026-11-16, on one Mac with the test sender (25 fps, 256×64 JPEG, 40 ms artificial sender delay, a cue fired over OSC at each cut) and headless Chrome as the window: latency 50 ms ±13, and the light steps landed on the same frame as the video steps (**diff 0** across 8 cuts). As a control, a manual offset of +100 ms gave diffs of +117 ms. Without the artificial delay, latency was about 9 ms.

## Testing without LiveStage

```bash
node scripts/wall-test-sender.mjs --port 1488 --fps 25 --delay 40 --flash 2 --osc 1487 --cue flash-test
```

The test sender connects, says hello, answers pings and streams stamped JPEG frames (`tests/fixtures/wall/`) while StageLight reports viewers. `--delay` imitates capture and network time. `--skew` fakes a clock offset. `--flash` alternates black and white, and with `--osc/--cue` it fires `/stagelight/play <cue> 0` and `/stagelight/stop 0` at each cut. Use dev ports only. `tests/wall-video.test.mjs` covers the WebSocket, the header, the clock math, the relay, armed behaviour, sender replacement, refusals, the light history, the engine commands and MCP exposure.

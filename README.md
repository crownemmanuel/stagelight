# StageLight

**Agent-first lighting control.** Connect your AI agent, describe your console and your rig, send it a photo of your stage, and tell it what you want to see. The agent patches your fixtures, places them in a 3D model of your stage, designs the looks and effects, and records them as cues. You run the show.

StageLight is a lighting engine with a 3D stage preview, an operator desk and an [MCP](https://modelcontextprotocol.io) server. It sends Art-Net to your fixtures (directly, or alongside a console such as a Hog 4), and it works with Claude Code, Claude Desktop, Codex, Cursor and any other MCP client that can run a local server.

## Built for agents, on purpose

Most lighting software puts thousands of options in front of you. StageLight's Build side has very few. That is deliberate: the building is meant to be done by an agent, in conversation, while you watch the preview and approve.

What you do | What your agent does
--- | ---
Tell it your console, your universes and how the rig is hung. Send photos of the fixtures, the console's patch screen, a plot or a fixture list. | Patches the fixtures with their DMX addresses and Art-Net routes, groups them, and checks the patch sheet for clashes.
Send a photo of the stage. | Places every fixture where it really hangs, so the 3D preview matches the room, and calibrates aim against real heads.
Describe a look: *"warm sunrise from upstage, slow fade, then a cold blue chase on the rear beams when the music drops"*. | Builds it in the preview first, tells you what it did, and records it as cues on a page when you say so.
Press GO. | Nothing. Show mode is yours: a big GO bar, cue lists per scene, overrides, blackout and master, all instant.

The desk is still a complete operator surface: Show mode for running, Build mode for quick edits. You just don't have to build a show by clicking through it.

## Get started

### 1. Install

Download the latest release from **[Releases](https://github.com/crownemmanuel/stagelight/releases)**:

- **macOS** (Apple silicon): `StageLight_<version>_aarch64.dmg`. Drag the app to Applications. The app is not notarized yet, so run this once:

  ```bash
  xattr -cr /Applications/StageLight.app
  ```

- **Windows** (x64): `StageLight_<version>_x64-setup.exe`. If SmartScreen says "Windows protected your PC", choose *More info → Run anyway*.

The app carries its own Node.js and engine: nothing else to install. When it opens it starts the lighting engine and shows the desk. **Physical output starts disarmed**: until you arm it, everything happens in the 3D preview only.

The app updates itself from this repository's releases, but only when you press **☰ → Update to version …**, and never while output is armed. See [docs/RELEASES.md](docs/RELEASES.md).

### 2. Connect your agent

Open **☰ → Connect an agent** in StageLight. It shows the exact setup for Claude Code, Claude Desktop / Cursor, Codex or any other MCP client, with this computer's paths filled in, and it switches to **Connected** when your agent first talks to StageLight.

For reference, on macOS the server is:

```text
command: /Applications/StageLight.app/Contents/MacOS/node
args:    /Applications/StageLight.app/Contents/Resources/app/mcp/server.mjs
env:     LIGHTS_URL=http://127.0.0.1:1460
```

With Claude Code, for example:

```bash
claude mcp add stagelight -s user -e LIGHTS_URL=http://127.0.0.1:1460 -- /Applications/StageLight.app/Contents/MacOS/node /Applications/StageLight.app/Contents/Resources/app/mcp/server.mjs
```

The same dialog has a short **instructions** text to paste as your first message. It tells the agent how StageLight works and the safety rules: preview first, and never arm output unless you ask.

### 3. Tell it about your rig

Start the conversation with what you have. For example:

> I run a Hog 4 sending Art-Net on 10.0.0.0/24. Universe 3 is the rear truss: four 7R 230W beams in 16-channel mode at 57, 78, 99 and 120, and a 200W beam at 162. Here is a photo of the Hog's patch window and one of the truss.

The agent reads your current show (`lights_status`, `lights_patch_report`), patches (`lights_fixture_patch`) and groups fixtures (`lights_group_save`). It uses the fixture profiles StageLight has verified, and it is told never to invent a channel map. For a fixture StageLight does not know yet, give it the manufacturer's DMX chart or a photo of your console's personality screen. Until a profile is confirmed, that fixture is preview-only and never transmits.

### 4. Give it your stage

Send a photo of your stage (from the audience, plus one of each truss if you can) and ask it to place the rig. `lights_fixture_place` puts each fixture where it hangs; `lights_calibration_align` matches a real head's aim to the preview.

StageLight ships with a demo 3D world: a curved church stage with an LED wall. **To model your venue**, open this repository in a coding agent (Claude Code, Codex, Cursor), send it photos of your stage, and ask it to rebuild the room in `public/stage.js` to match. The room is plain Three.js, and the fixtures keep their placements.

### 5. Design looks, then run the show

Describe what you want. The agent previews effects in the visualizer (`lights_fx_preview`, `lights_preview_cue`, Blind mode), so you see them before anything is live, then saves them as cues on a page (`lights_cue_record`, `lights_page_save`). Custom effects go into the effects library with their own icons.

When you're ready: arm output (**Output off → Arm physical output**), switch to **Show**, and press **GO** (or Space). To program on two screens, pop the 3D visualizer out into its own window with the button next to *LED wall*.

## Safety

- Physical output is **off at every start**, and only a person arms it, in the app. Agents are told never to call `lights_output_arm` unless you ask.
- Patching, Art-Net routing and show import are refused while output is armed.
- Fixtures without a verified profile never transmit.
- Art-Net has no acknowledgment: StageLight reports what it sent, never that a light responded.
- Closing or updating the app never cuts the lights: the engine keeps running on its own, and updates refuse to install while output is armed.

## Triggers from other apps

Other apps can GO cues and fire named triggers over **OSC** (UDP port 1461): a show-control app, a sound app, a camera app, a Stream Deck, QLab. StageLight also announces every GO, and can send the look of each **zone** you define (colour temperature, tint, level, colour, and whether it is white light) to keep a camera's white balance right, on GO or whenever the live look changes, and recall the other app's presets from a cue ([docs/LOOK-LINK.md](docs/LOOK-LINK.md), protocol `stagelight.look/1`). Another app can ask for StageLight's scenes, cues and triggers (`/stagelight/catalog`) and offer them in a picker instead of typed commands. That is how [LiveStage](https://github.com/crownemmanuel/livestage) drives StageLight from its cues and video time markers.

Setup is in the app under **☰ → Guides → Triggers from other apps**. The full message reference is [docs/SISTER-APPS.md](docs/SISTER-APPS.md).

## Fixtures and consoles

Built-in, verified profiles:

- Chauvet Rogue R3 Beam (16 ch)
- Martin RUSH MH 7 Hybrid
- COLORado 2 Quad Zoom (AR2.Z)
- MEGA-LITE Colorlite Q120 (5 ch)
- Generic 7R 230W beam and 200W beam (16 ch, as patched on a Hog 4), with operator-observed colour-wheel presets

Output is Art-Net (unicast) with configurable universe mapping. [Hog 4 setup](public/help/hog-setup.html) shows how to hand universes over from a Hog.

## Run from source

Node.js 22 or newer:

```bash
npm start          # engine + desk at http://127.0.0.1:1460 (show data in ./data)
npm test           # engine tests, offline
npm run mcp        # MCP stdio server (the engine must be running)
```

Desktop app: `pnpm install`, then `pnpm tauri dev` (needs Rust). Ports: HTTP 1460 (loopback only), OSC 1461 (loopback, or allow-listed devices on the show network), Art-Net 6454 only while armed. `LIGHTS_PORT`, `LIGHTS_OSC_PORT` and `LIGHTS_DATA_DIR` run a second copy beside a show without touching it.

Agents working on this repository: start with [AGENTS.md](AGENTS.md). Every user-facing capability must also be reachable through MCP.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): engine, data model, timing
- [docs/SHOW-MODE.md](docs/SHOW-MODE.md): pages, cue lists, preview, blind, effects, pop-out visualizer
- [docs/SISTER-APPS.md](docs/SISTER-APPS.md): OSC show control, triggers, announcements, catalog
- [docs/RELEASES.md](docs/RELEASES.md): the desktop app, releases and updates
- [public/help/agent-api.html](public/help/agent-api.html): HTTP, OSC and MCP examples
- [docs/VERIFICATION.md](docs/VERIFICATION.md): what has been verified on a real rig, and known limits

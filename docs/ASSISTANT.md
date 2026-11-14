# Built-in assistant

The **Assistant** button in the top bar opens a chat on the desk. Describe a look, an effect, a cue, a scene, a page or a master in plain words, and the assistant builds it. It works with the operator's own **Anthropic** or **OpenAI** API key; no MCP client is needed.

## How it works

- The assistant acts only through the engine's validated command catalogue (`engine/spec.mjs`), the same commands the desk, OSC and the MCP server use. Its tools are named exactly like the MCP tools (`lights_cue_save`, `lights_preview_cue`, `lights_fx_preview`, `lights_preset_save`, `lights_scene_capture`, `lights_page_save`, `lights_masters_assign`…), and every argument is validated by the engine. Errors go back to the model, which fixes its arguments and tries again.
- It starts by reading `show.summary` (`lights_show_summary`), a compact read of the show: groups with sizes and fixture profiles, cues, pages, scenes, effects and presets, masters and live state. It is about 4% of the size of `status`.
- Its commands run through the server's command queue one at a time, like every other client. The chat itself (`assistant.*`) never waits in that queue, so a slow provider never delays a GO.
- A reply runs in the background. The desk re-reads `assistant.status` whenever `runtime.assistant.revision` changes, and shows each command the reply ran (open a row to see its arguments and result).
- Nothing runs per tick. With the panel closed and no reply in progress, the assistant costs nothing.

## Safety

- **It can never arm output.** These commands are not offered to it at all: `output.arm`, `resume.apply`, `resume.dismiss`, `show.import`, `show.restore`, `performance.lock`, `output.configure`, `network.configure` and its own `assistant.*` set-up (so it cannot widen its own permissions). `status` and `schema` are left out only because they are very large.
- **Live commands are refused while output is armed** (every command marked `live` in the spec: playing cues, masters, scenes, fixture values, lamps, master, blackout, disarm…) unless the operator turns on **Let the assistant run the live rig** in its settings. `preview.cue` and `fx.preview` are visualizer only and always allowed. The setting is per Mac and off by default.
- The performance lock applies to it like anyone else: show edits are refused while locked.
- Its instructions tell it to preview before running, read before replacing, keep the operator's cues, pages, scenes, patch and calibration, never strike lamps unless asked, and that a sent command is not proof a fixture responded.
- **House rules**: notes the operator writes in its settings (for example "face lights never above 12%"). They are saved in the show (`show.settings.assistant.instructions`) and given to the model as rules on every request.

## API keys and privacy

- Keys are saved per provider in `<data>/assistant.json` on this Mac, written owner-only (mode 600). They are never saved in the show, its versions or exports, never logged, and `assistant.status` only ever shows the last four characters.
- Provider, model and the live setting are also per Mac. Importing a show keeps them.
- Requests go straight from the engine to `api.anthropic.com` or `api.openai.com` and are billed to the operator's key. A request carries the conversation, the tool definitions and the results of the commands the assistant ran (for example the show summary).
- The conversation lives in the engine's memory only. It is forgotten on restart or with **New chat**, and switching provider or model starts a new one.

## Providers

| | Anthropic | OpenAI |
|---|---|---|
| API | Messages API, raw HTTPS, `anthropic-version: 2026-10-21` | Chat Completions with function tools |
| Default model | `claude-opus-5-5` | `gpt-5` |
| Notes | Tools and the system prompt are prompt-cached. Each reply is appended to the history unchanged (thinking blocks included). On models that support it, the server-side refusal fallback is on (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). | **Check key** lists the chat models the key can use. |

**Model and reasoning level.** The model is a dropdown filled from the provider's model list (`assistant.models`, loaded when the settings open; the reload button fetches it again). The reasoning level is per provider: **Auto** sends nothing and lets the model decide; Anthropic offers low, medium, high, extra high and max (`output_config.effort`), OpenAI minimal, low, medium and high (`reasoning_effort`). Higher levels think longer, which helps big multi-cue requests but is slower and costs more. A model that does not support a level returns an error in the chat; pick another level or Auto.

The engine has no npm dependencies (it is copied into the desktop app as it is), so both providers are called with Node's built-in `fetch` rather than an SDK. **Check key** (`assistant.models`) confirms the key works and lists the models it can use; any model ID can be typed in.

Limits: 30 model calls per reply, 16,000 output tokens per call, tool results cut at 40,000 characters. A conversation over about 400,000 tokens asks for a new chat.

## Commands (also MCP tools)

| Command | MCP tool | What it does |
|---|---|---|
| `show.summary` | `lights_show_summary` | Compact read of the whole show for planning. |
| `assistant.status` | `lights_assistant_status` | Provider, model, which providers have a key (last 4 characters only), allowLive, house rules, busy, last error, token usage, the conversation and the commands each reply ran. |
| `assistant.configure` | `lights_assistant_configure` | `provider`, `apiKey`, `clearKey`, `model`, `effort`, `allowLive`, `instructions`. |
| `assistant.models` | `lights_assistant_models` | Checks the key and lists the models it can use; the list is kept for the dropdown (`providers.<name>.models` in status). |
| `assistant.send` | `lights_assistant_send` | Sends a message; returns at once. Poll `assistant.status`. |
| `assistant.stop` | `lights_assistant_stop` | Stops the reply in progress. Commands it already ran stay done. |
| `assistant.clear` | `lights_assistant_clear` | New conversation. Saved cues and settings are untouched. |

Tests: `tests/assistant.test.mjs` fakes both providers, so no request leaves the machine.

## Not verified

The request and reply handling is tested against recorded API shapes, and the key check was run against Anthropic with an invalid key (it is rejected with a clear message). A full build-a-cue conversation with a real key has not been run here yet.

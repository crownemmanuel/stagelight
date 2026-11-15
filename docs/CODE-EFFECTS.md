# Code effects

A code effect is an effect written as a small JavaScript function instead of picked from the built-in list. It exists so the assistant can build whatever the operator describes: if a fixture can do it, an effect can be written for it.

It is an ordinary effect everywhere else. It is saved in the show, sits in the Effects library, runs on a selection or in a cue, follows the cue's tempo, pauses, loops and previews like any built-in.

## Writing one

The effect is `effect: "code"` with two params:

- `params.code`: the function, or just its body.
- `params.args`: named settings the code reads as `p.name` (numbers, true/false, `#rrggbb` colours, lists of numbers). Each one becomes a control on the desk.

The function is called once per fixture per frame and returns the attributes to set on that fixture. Whatever it does not return keeps the look underneath.

```js
// A comet with a coloured tail. args: {rate: 0.3, tail: 8}
const head = fract(t * p.rate), d = fract(head - f.phase);
return {intensity: exp(-d * p.tail), color: lerp(rgb(p.color), rgb(p.secondary), clamp(d * 3))};
```

| Input | What it is |
|---|---|
| `t` | Seconds since the effect started, multiplied by `params.speed`. In a cue it follows the cue: it loops, freezes on pause and follows the live tempo when the cue has a bpm. |
| `f` | The fixture: `id`, `i` (index in the group), `n` (how many), `phase` (0–1 across the group), `x` `y` `z` (metres on the stage), `u` `v` `w` (the same, scaled 0–1 across this effect's fixtures), `profile`, `moving`, `home`. |
| `base` | What the fixture shows underneath: `intensity`, `color` (`[r, g, b]`, 0–1), `pan`, `tilt`, `zoom` and so on. |
| `p` | `params.args` on top of the ordinary effect params (`p.color`, `p.secondary`, `p.speed`, `p.brightness`). |
| `ctx` | `time` (not scaled by speed), `duration`, `progress`, `bpm`, `beat`, `step` and `sinceStep` (note-step hits, from `masters.step` or a step-mode sound trigger). |

It may return any of `intensity`, `color` (`[r, g, b]` or `"#rrggbb"`), `white`, `amber`, `mint`, `pan`, `tilt`, `zoom`, `focus`, `frost`, `gobo`, `goboShake`, `prism`, `prismRotation`, `movementSpeed`, `opticalMode`. Values are clamped to their range. A fixture uses only what its type has.

Helpers are in scope without `Math.`: the usual maths, `clamp`, `lerp`/`mix`, `smooth`, `smoothstep`, `step`, `fract`, the cycle shapes `saw`, `tri`, `wave`, `square`, `pulse`, `bump`, the repeatable randomness `hash` and `noise`, the colour helpers `hsv`, `rgb`, `kelvin`, and `dist`. The full list with examples is served to agents in `schema {only: ["code"]}` (`engine/code-effects.mjs`, `CODE_DOC`).

### Rules

- **Pure.** The same time and fixture must give the same values. `Math.random` and `Date` are refused with a message that names the replacement (`hash`, `noise`, `t`). Nothing may wait: `async`, `await`, `Promise` and `import` are refused.
- **Light it.** In a cue, a track on dark fixtures needs `intensity` as well as `color`. `base` is the cue's own look there; as a programmer effect it is the live look.
- **Single fixtures.** Use `f.phase`, never `f.i / (f.n - 1)`.
- **Small moves.** Move heads around the current aim (`base.pan + offset`) with offsets of a few hundredths.

## How the assistant uses it

1. `effect.test {params, group}` (`lights_effect_test`) runs the code on real fixtures without touching the stage, the show or the output. It returns `ok`, or the error with its line; `sets` (the attributes changed); sample `frames`; `ms` per frame; and `warnings` (nothing lit, pan/tilt on fixtures that do not move). Fix and repeat until it is right.
2. `preset.save` with `effect: "code"` puts it in the Effects library. `layer` (`intensity`, `color` or `position`) sets its heading there and which other effect it replaces on a fixture. The code still sets every attribute it returns.
3. `fx.preview` / `fx.apply` run it on a selection over the live look; `effect.apply` makes a cue from it; a `cue.save` track can carry the code directly, with `layer` to modify the cue's own look.

Code that cannot run is never saved: `preset.save`, `cue.save`, `fx.apply`, `fx.preview` and `effect.preview` all load the code and dry-run it at several moments, with six fixtures and with one, and refuse it with the reason.

## Safety during a show

- The code runs in its own sandbox (a `node:vm` context) that holds nothing of the engine: no files, no network, no process. Inputs go in and results come out as plain data.
- Every frame has a time limit (15 ms for all of the effect's fixtures; typical effects take 0.1 ms). An endless loop costs that one effect one frame, never the engine's tick.
- If the code fails mid-show, its fixtures keep the look underneath, the failure is logged once and listed in `runtime.effectErrors` (also in `overview`), and the effect is tried again after a short pause. Nothing else on stage changes.
- The performance lock refuses saving or changing effects, like every other show edit. `effect.test` stays open.

This is protection against mistakes, not against hostile code: only the operator's own assistant, on this Mac, can send it.

## Reading the show (agents)

Replies are sized for an assistant's context:

- `overview` (`lights_overview`): a compact map of the show and what is live. Start here.
- `status {only: [...], ids?}`: one part in full, for example one cue, or the current values of some fixtures (`only: ["frames"]`). With no arguments it is still everything.
- `schema {only: [...]}`: `effects`, `presets`, `code`, `profiles` without the command list (over MCP the commands are the tools).
- Over MCP every command's reply carries a brief runtime (what is running, the programmer, errors) instead of every fixture's frame.

On the venue show that takes a typical build conversation from several hundred KB per call down to under 1 KB per command and about 18 KB for the overview.

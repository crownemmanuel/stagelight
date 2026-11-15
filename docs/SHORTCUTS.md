# Keyboard shortcuts and quick paths — 2026-11-14

Press **?** on the desk (or ☰ → Keyboard shortcuts) for the live list: it reads the master keys and desk keys from the
show, so it is always right for the open show.

## Keys

| Key | Does |
|---|---|
| Space | GO: run the next cue (held down, it fires once) |
| Backspace | Back: the previous cue (held down, it fires once) |
| 1 … 9, then Enter | Go to that cue number on the current page. A readout over the stage shows the number and the cue's name; Backspace edits it, Esc cancels, it clears itself after 5 s. Digits that are master keys stay master keys. |
| Esc | Close the go-to readout, a menu or the master editor; stop preview or Find; then select none |
| C | Clear: fade manual changes back to the cues |
| Shift+H | Highlight the selected fixtures |
| B | Blackout on / off |
| T | Tap tempo (right-click the tap button for half time, double time and back to each cue's own tempo) |
| ← → | Step through fixtures while Find is on, otherwise page the masters |
| A S D F G H J K L | Masters 1–9 (hold to flash, or the master's own action) |
| Shift + a master key | That master's sound trigger on / off |
| ⌘Z | Undo the last manual change in the programmer (a whole slider drag is one step; a Clear can be undone; up to 30 steps; follows Blind) |
| ⇧⌘Z | Undo the last show edit (delete, record, rename, assign…), also while armed; press again to redo. Also ☰ → Undo, which names the edit |
| Stop all key | Unset by default. Set it in Settings → Desk keys; it runs Stop all (`cue.stop`) |
| ? | The shortcut list |
| ⌘S, ⇧⌘S, ⌘O | Save show, Save show as…, Open show… |

C, Shift+H, B, T, the Stop all key and every master key are saved in the show (`show.masters.desk`, `masters.key`).
Desk keys are changed in Settings → Desk keys (click, press the new key; Esc cancels, Delete removes it; a key a master
or another desk key has is refused with its owner named). Master keys are changed by clicking the key on a master slot.
Shift+H stays Highlight, so the master on H has no Shift sound switch from the keyboard: the `?` sheet says so beside it,
and its wave badge on the slot still switches it. Tooltips on Highlight, Clear, Blackout, GO and Back name their current key.

## When keys are ignored

- While you type in a text, number or search field, or a menu list.
- While a dialog is open (Esc closes it).
- Not after touching a slider, checkbox or colour well: Space, the masters and B keep working. Dragging the grand master
  gives focus back when you let go, so the next key press reaches the desk.

## Masters never stick

A flash lets go when its key or pointer is released, wherever the pointer is when you let go, even if the master bank
was redrawn while it was held. Every held master is also let go when the window loses focus, when the desk is hidden,
and when ⌘ is pressed (macOS drops key releases while ⌘ is down). A press that the engine does not answer within 3 s
is given up, so it cannot hold back the release behind it.

## Mid-show paths

- **Cue list row, right-click:** Fade & follow… (fade seconds, wait for GO or auto-follow and its wait), Rename on this
  page…, Duplicate cue (a library copy placed right after it, safe to edit), Move up / down, Edit cue content…, Follow
  BPM / Set speed…, Remove from page. All go through `page.save` / `cue.save`, so the performance lock refuses them.
- **GO bar:** Now shows elapsed and time left of the running cue (elapsed only for a loop); Next shows what GO runs and
  the auto-follow countdown.
- **Kills and parks:** a killed group's pill turns red, and while anything is killed or parked a chip in the top bar says
  so ("1 killed · 8 parked"). Click it to bring back one kill, everything killed (`kill.clear`) or unpark.
- **Turning output off asks first:** it blacks out the rig. For a quick dark stage use Blackout (B).
- **Output armed but not sending** (`runtime.output.failing`): output stays armed and keeps retrying. The bar over the
  stage turns amber, says packets are not getting out and gives `lastError`. It cannot be dismissed and clears itself
  once packets flow; the Output pill reads LIVE · NOT SENDING.
- **Failures mid-show:** a code effect that fails (`runtime.effectErrors`, its fixtures keep the look underneath) or a
  frame the engine could not build (`runtime.engineError`) is toasted once in red and kept in Messages.
- **Not saved to disk** (`runtime.showFile.error`): the dot by the show name becomes an amber warning whose tooltip
  gives the reason, and it is toasted once. Edits are live but not on disk until it clears.
- **Messages:** every message the desk shows is kept for the session in ☰ → Messages, errors in red, with the engine's
  recent events. A red dot on ☰ means an error arrived since you last looked.
- **Undo after a delete:** deleting a cue, page, scene, group, colour, position, effect or beam look from the desk shows
  a toast with **Undo** (`show.undo`); after undoing, the toast offers **Redo**.
- **Manual fade:** Settings → "Manual changes fade over" (`show.playback.manualFade`, default 0 = snap) fades levels,
  colours, palettes and positions set by hand.
- **Copy look:** right-click a group (pill or card) → Copy look from selection copies what the selected fixtures show
  onto that group, into the programmer (`look.copy`, intensity, colour and beam). Disabled until something is selected.
- **Dialogs:** the first text field takes focus, and Enter presses the dialog's main button (Save, Rename, Save as…).

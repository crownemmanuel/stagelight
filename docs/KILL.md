# Kill — 2026-11-01

Kill turns lights off over everything, for a moment, without touching what runs underneath. The operator asked for a quick off that doesn't use up masters.

- **What wins.** A killed fixture shows intensity 0 over every cue, the scene, toggled masters, the programmer, Highlight and park. Cues keep running underneath, so bringing a kill back shows whatever is live at that moment.
- **Hits punch through.** A held master flash, or a sound-trigger hit, still shows on killed fixtures for as long as it is held, the killed master's own included. The kill comes back when the hit lets go. It works like an "off" master that drum hits punch through (Backlights off + Drums backlight), on one column: Solo 6 kills the heads, and the kicks on master 6 still flash them (operator, 2026-11-01). Blackout is above everything.
- **Masters.** Tick **Solo kills its lights** in a master's ⚙ (`masters.assign {slot, soloKill:true}`). On the APC40, that master's fader-bank **Solo** button then kills every fixture its cue uses (look entries and track groups), and pressing it again brings them back. The Solo LED is lit while killed. Solo does nothing on a master without the setting, or with no cue.
- **Groups.** Every group tile (Groups view) has a **Kill** button: one press kills the group, the tile turns red and the button reads Killed, and another press brings it back. The group right-click menu has the same ("Kill · off over everything" / "Bring back (unkill)").
- **Commands / MCP.**
  - `kill.set {group | slot, killed?}` / `lights_kill_set` toggles a kill when `killed` is omitted.
  - `kill.clear` / `lights_kill_clear` brings everything back.
  - `runtime.kills` lists what is killed.
- **Live only.** Kills are never saved in the show, recorded into cues or scenes, or restored after a restart. They work under the performance lock.
- **Cost.** With no kills, nothing is added to the tick. With kills, the killed set is computed once per show change, and the tick does one set lookup per fixture.

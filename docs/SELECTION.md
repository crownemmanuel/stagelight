# Fixture selection

Select all beside the group tabs reselects every fixture in the active group, replacing a partial/mixed selection. Group-tab clicks also select their group. Shift-click toggles individual members. Unverified entries may be selected for inspection but remain physically disabled.

Shared engine/MCP commands: `lights_selection_group` with `{group: "grid"}` or another group ID; `all` selects all enabled fixtures. `lights_selection_set` accepts `ids` and optional `group`. Runtime `selection` contains IDs, group and revision, which the UI follows. Selection is transient and does not change fixture attributes or saved shows.

# Groups and parent groups

Added 2026-10-30. A **parent group** holds other groups instead of fixtures, to keep the group pills and cards tidy. For example, *All house lights* holds the five house rows and the 3300s, and *All heads* holds the top and bottom heads.

## How it behaves

- **Selecting a parent selects everything in it.** Its fixtures are always all of its child groups' fixtures, in child order, kept up to date when a child changes. So cues, effects, Find and Park work on a parent like on any group.
- **Opening a parent shows its child groups,** so you can select one section on its own.
  - In the group pills, use the ▸ on the parent pill. Its child pills open beside it, inside a dashed outline.
  - On the group cards, use **n groups ›**. The grid shows *All <parent>* and its child cards, with a path back (All groups › House lights).
  - Selecting a child keeps its parents open.
- **Top level only.** Pills and cards list top-level groups; children appear when their parent is open. Which parents are open is a per-viewer convenience in browser storage, not show data.
- **Nesting.** Parents can be nested (a parent inside a parent). A group cannot end up inside itself.
- **Fixtures belong to the children.** A parent's fixtures cannot be edited directly: add or remove fixtures in its child groups.

## Right-click a group

- **Open · its n groups** / **Close** (parents only).
- **Move into a group…** lists the parent groups, and **Top level**.
- **Take out of <parent>**.
- **New parent group with this…** names a new parent that starts with this group, in the same place this group was.

## MCP

- `lights_group_save {id, name, children:[group IDs]}` creates a parent group.
- `lights_group_nest {id, parent?}` moves a group into a parent, or back to the top level when `parent` is left out. The parent must already be a parent group, so a plain group never loses its fixtures.
- `lights_group_edit {id, children}` replaces a parent's children. `children: []` makes it a plain group again, keeping its current fixtures.
- Deleting a child removes it from its parents.
- Read groups with their `children` from the show.

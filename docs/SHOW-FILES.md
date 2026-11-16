# Show files: Save, Save As, Open

Added 2026-10-31. Shows can be saved as named files in a folder on this Mac and opened again, like documents in any Mac app. Export / Import stay for moving a show by hand.

## On the desk

- **Top bar.** The name next to the logo is the open show file. A gold dot means unsaved changes; no file yet shows the show's own name with the dot. Click it to open another show.
- **Save show (⌘S)** saves to the open file. With no file yet it opens Save As.
- **Save show as… (⇧⌘S)** asks for a name and lists the shows already in the folder (click one to reuse its name). Saving over another show asks before replacing it.
- **Open show… (⌘O)** lists the saved shows, newest first, with the show's own title, fixture and cue counts and the date. Type to search by file name or title. Click a show and press Open, or double-click it (Enter opens the first match). If the current show has unsaved changes it asks: **Save and open**, **Don't save** or Cancel. A show that was never saved offers only Don't save: cancel and use Save As to keep it.
- **Folder.** Both dialogs show the folder with **Change…** (the Finder's folder picker) and **Show in Finder**.
- All three are in the ☰ menu, above Export and Import.

## What a show file is

- The whole show as JSON, the same format as Export: patch, placement, calibration, groups, cues, pages, scenes, masters, palettes, effects, LED wall choice. Media files stay in this Mac's media library and are not copied.
- The folder is `~/Documents/StageLight Shows` unless changed. The folder and which file is open are this Mac's, kept in `<data>/show-files.json`, never inside a show.
- File names are 1–80 characters without `/ \ : * ? " < > |` and not starting with a dot. Names are matched case-insensitively, like the Mac's disk.
- Any `.json` file in the folder is listed. One that is not a StageLight show is shown greyed out and cannot be opened.

## Rules

- **Opening replaces the show** like Import: this Mac's network settings stay, running cues, the scene, the programmer and Highlight are cleared, and the old show is kept in Settings → Show versions (`before-open`).
- **Refused** while output is armed and while the performance lock is on (`show.open` is in `SHOW_EDITS`).
- **Saving only writes a file**, so it works while armed and under the lock.
- **Unsaved** means the show changed since it was last saved to or opened from its file. Playback, selection, master and other live state are not show changes. The state survives an engine restart (a hash of the saved show is kept).
- **Import makes the show untitled**: the next ⌘S asks for a name.

## Autosave — 2026-11-01

While a show file is open and has unsaved changes, it is written for you once edits have been quiet for 10 s, at most every 2 minutes, and when the performance lock goes on. The log says `Show autosaved · <name>`. On 2026-11-01 the show stayed unsaved from 06:35 for the rest of the service. Turn it off with `show.autosave {enabled:false}` (`lights_show_autosave`); it is this Mac's setting, kept in `show-files.json`. `runtime.showFile.autosave` reads it back. `<data>/show.json` and the show versions are still written on every edit, autosave or not.

## MCP

- `lights_show_files {query?}` lists `{name, file, modified, bytes, title, fixtures, cues, pages, valid}` plus `folder` and `current {name, savedAt, dirty}`. `runtime.showFile` carries `current` too.
- `lights_show_save {name?, overwrite?}`: no name saves to the open file; a different name that already exists needs `overwrite:true`.
- `lights_show_open {name, discard?}`: refused while there are unsaved changes unless `discard:true`.
- `lights_show_folder_set {path}` sets the folder (absolute or `~/…`; created if missing).
- `lights_show_reveal {name?}` shows a file, else the open file, else the folder, in the Finder.
- The folder picker behind **Change…** is `POST /api/choose-folder` on the server (it waits on the operator, so it runs outside the command queue). Agents set the folder by path instead.

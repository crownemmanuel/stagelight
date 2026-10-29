# Desktop app, releases and updates

StageLight ships as a Tauri app, the same way as LiveStage: GitHub Actions builds it from a version tag, signs the update files and publishes a release on [crownemmanuel/stagelight](https://github.com/crownemmanuel/stagelight/releases). Installed apps update themselves from that release, but only when the operator says so.

```
build computer                     GitHub Actions                      show computer (installed app)
pnpm release 0.3.0         →      Release workflow                    ☰ → Update to version 0.3.0…
git push origin HEAD v0.3.0       builds macOS + Windows,             → Install 0.3.0 and restart
                                  signs the update files,               (only while output is disarmed)
                                  publishes the release + latest.json
```

## What the app is

- `src-tauri/` is a thin native shell. On start it shows a "Starting the lighting engine…" page, makes sure the engine is running, then loads the desk from it (`http://127.0.0.1:1460`).
- The engine is the same `server.mjs`, run by a **Node.js bundled inside the app** (a Tauri sidecar fetched by `scripts/fetch-node.mjs`, pinned version and SHA-256). Nothing needs to be installed on the show computer.
- A second sidecar, `stagelight-io` (`src-tauri/io`, Rust), is the native helper for the sound and MIDI modules (docs/MIDI-AND-SOUND.md). `scripts/build-io.mjs` builds it before every `tauri build`/`tauri dev`, so CI needs nothing extra. The engine starts it only while a module is on. `src-tauri/Info.plist` carries the microphone reason macOS shows the first time Sound triggers listen to an input.
- If an engine the app started crashes, the app starts it again within a few seconds (`watch()` in `src-tauri/src/engine.rs`). It comes up disarmed and offers to resume (docs/SHOW-SAFETY.md).
- The engine, desk, help pages and MCP server are copied into the app (`resources/app/`). The desk is still served by the engine, so a browser at `http://127.0.0.1:1460` sees exactly what the app window shows.
- **The window never owns the show.** The engine is started detached: quitting or crashing the app leaves playback and output as they were, and the next launch attaches again. The app only stops an engine it started itself (`engine.pid` in the data folder), and only while physical output is disarmed: to replace an engine left over from an older version, and before installing an update. An engine started some other way (a terminal, another checkout) is used as it is.
- The pop-out visualizer opens as a native window (`window.open` → `on_new_window`), keeps `window.opener` for the desk link, and comes back where it was left (window-state plugin). Other links open in the browser.

### Data folder

Show, settings, media, `audit.jsonl` and `engine.log` live in the app data folder, which updates never touch:

- macOS: `~/Library/Application Support/org.salvation.stagelight/`
- Windows: `%APPDATA%\org.salvation.stagelight\`

Never change the identifier in `tauri.conf.json`: the app would start with an empty data folder. A first start with no `show.json` seeds it from the show built into the app (`show-template.json`, the repo's `data/show.json` at build time).

### Test copy beside the show

`LIGHTS_PORT`, `LIGHTS_OSC_PORT` and `LIGHTS_DATA_DIR` work as before, so a second copy can run next to the show engine without touching it:

```bash
open -n --env LIGHTS_PORT=1480 --env LIGHTS_OSC_PORT=1481 --env LIGHTS_DATA_DIR=/tmp/stagelight-test StageLight.app
```

Running `StageLight.app/Contents/MacOS/stagelight` from a terminal with the variables set works too.

## On the show computer

- A few seconds after the desk opens, and every six hours after, the app asks GitHub whether a newer version is published. That is all it does by itself: it never downloads, installs or restarts on its own.
- When there is one, the ☰ button gets a green dot and the menu reads **Update to version 0.3.0…**. Otherwise the same item is **Check for updates…** (only in the desktop app, not in a browser).
- The dialog shows this app's version, the new version and its release notes. **Install 0.3.0 and restart** downloads the update (with progress), stops the lighting engine, installs and reopens StageLight, which starts the new engine. It comes back with **output off**, like every start: arm it again when you are ready.
- **It refuses while physical output is armed.** Disarm first. If output is armed while the update downloads, nothing is installed: press Install again after disarming.
- Update on a rehearsal day, not right before a show, and run the cue list once in preview afterwards.

A development build (`pnpm tauri dev`) can check for updates but never installs them: update it with git.

## Cutting a release

The version is kept in one place, `package.json`. `src-tauri/tauri.conf.json` reads it from there (`"version": "../package.json"`), and the release script keeps `src-tauri/Cargo.toml` and `Cargo.lock` equal to it. The workflow refuses a tag that does not match.:

1. Commit the work that goes into the release.
2. Set the version, commit it and tag it:

   ```bash
   pnpm release 0.3.0
   ```

   `patch`, `minor` or `major` count up from the current version instead. The release notes the operator sees are the tag message: by default the commit subjects since the last release, or your own with `--notes "..."`. `--dry-run` shows what would happen. Only the three version files are committed; nothing is pushed.
3. Push the commit and the tag. This starts the build:

   ```bash
   git push origin HEAD v0.3.0
   ```

4. Watch it under **Actions → Release** on GitHub. The release stays a hidden draft until both builds have succeeded and `latest.json` lists macOS and Windows; then it is published, and installed apps see it at their next check.

A version with a suffix (`pnpm release 0.3.0-beta.1`) is published as a **pre-release**: apps never offer it. If a build fails, the release stays a draft and no app sees it: re-run the failed job, or cut a new patch version. **Actions → Release → Run workflow** rebuilds an existing tag whose release is still a draft.


What a release contains:

| File | For |
| --- | --- |
| `StageLight_<version>_aarch64.dmg` | macOS (Apple silicon) installer |
| `StageLight_<version>_aarch64.app.tar.gz` (+ `.sig`) | The file the Mac app updates from |
| `StageLight_<version>_x64-setup.exe` (+ `.sig`) | Windows installer, and the file the Windows app updates from |
| `latest.json` | What installed apps read: version, notes, download links and signatures |

## One-time setup on GitHub

1. Create the repository **crownemmanuel/stagelight**. It must be **public**: installed apps download `latest.json` and the updates without signing in.
2. Push the repository to it.
3. Add the update signing key as two repository secrets (**Settings → Secrets and variables → Actions**):
   - `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.tauri/stagelight.key` (`pbcopy < ~/.tauri/stagelight.key`).
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the contents of `~/.tauri/stagelight.key.password`.
4. Cut the first release, then install it by hand from the release page. From then on, updates come through the app.

## The signing key

Every update is signed, and the app installs only files signed with the key whose public half is built into it (`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`).

- The private key and its password are on the build computer in `~/.tauri/stagelight.key*` (owner-only files) and in the two GitHub secrets. **Never commit them.** Keep a copy in a password manager: if the key is lost, installed apps can no longer take updates and must be reinstalled by hand.
- To change keys: generate a new pair (`pnpm tauri signer generate -w ~/.tauri/new.key`), put the new public key in `tauri.conf.json`, release that version while the secrets still hold the old key, then switch the secrets.

## Building on this computer

- `pnpm build:installer`: an app and installer for this computer (`src-tauri/target/release/bundle/`), without update files, so no key is needed.
- `pnpm tauri build` also makes the update files, so it needs the key:

  ```bash
  TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/stagelight.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/stagelight.key.password)" pnpm tauri build
  ```

- `pnpm tauri dev` runs the shell from source; the engine and desk come from this folder's copy in `src-tauri/target/debug`.
- App icon: the source art is a rounded tile (`stage-light-master.png`, kept outside the repo). `python3 scripts/make-app-icon.py <master.png> app-icon.png <preview.png>` (needs Pillow) turns it into a full-bleed square, the tile's own gradient edge to edge, so macOS rounds it itself instead of setting it on a white plate. Then `pnpm tauri icon app-icon.png -o src-tauri/icons` and delete `icons/android` and `icons/ios`. The desk header logo and the tab icon are `public/logo.png` and `public/favicon.png`, the rounded tile cropped to its edges.

## Unsigned installers

The installers are not code-signed with an Apple Developer ID or a Windows certificate yet (the update signature above is separate and always there):

- **macOS**: after dragging the app to Applications, run once: `xattr -cr "/Applications/StageLight.app"`.
- **Windows**: the first install may show "Windows protected your PC": **More info → Run anyway**. The Windows build is untested on a real rig so far.

## How it fits together

- `.github/workflows/release.yml`: on a `v*` tag, checks the versions, creates a draft release with the tag message as notes, builds macOS Apple silicon and Windows x64 with `tauri-apps/tauri-action`, checks `latest.json`, publishes.
- `scripts/release.mjs`: `pnpm release` and `--check` (CI). `scripts/fetch-node.mjs`: the bundled Node.
- `src-tauri/tauri.conf.json`: `bundle.resources` (engine, desk, MCP), `bundle.externalBin` (node), `bundle.createUpdaterArtifacts`, `plugins.updater` (public key, endpoint `https://github.com/crownemmanuel/stagelight/releases/latest/download/latest.json`, Windows `installMode: passive`). `src-tauri/tauri.unsigned.conf.json` turns the update files off.
- `src-tauri/capabilities/default.json`: the desk page (served by the engine on 127.0.0.1) may call the app's commands.
- `src-tauri/src/engine.rs`: start, attach, replace and stop the engine. `src-tauri/src/updater.rs`: check, download, install, restart, and the armed-output guard. `public/app.js` (*App updates*): the ☰ item, the dot and the dialog.
- Not reachable from MCP yet: checking or installing updates is an app-shell action, and the engine (which the MCP server talks to) cannot reach it. Agents can read the app version from `/api/session`.

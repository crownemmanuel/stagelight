//! App updates from the GitHub releases (docs/RELEASES.md).
//!
//! Nothing here downloads, installs or restarts on its own. The desk asks whether a newer version
//! exists; installing is always the operator's explicit action, and it is refused while physical
//! output is armed. Installing stops the engine this app started (it must restart on the new code),
//! so the new version comes up with output disarmed, like every start.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::engine::{self, Config};

#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    done: AtomicU64,
    total: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current: String,
    /// The newer version, when there is one.
    version: Option<String>,
    notes: Option<String>,
    date: Option<String>,
    /// A development build (`pnpm tauri dev`) checks but never installs.
    dev: bool,
}

#[derive(Serialize)]
pub struct Progress {
    done: u64,
    total: u64,
}

fn message(e: impl std::fmt::Display) -> String {
    let text = e.to_string();
    // No release published yet, or the repository is private / unreachable.
    if text.contains("valid release JSON") || text.contains("404") {
        "No published release found on GitHub yet.".into()
    } else {
        text
    }
}

/// Ask GitHub whether a newer version is published. Downloads nothing.
#[tauri::command]
pub async fn update_check(app: AppHandle, updates: State<'_, Updates>) -> Result<UpdateInfo, String> {
    let update = app.updater().map_err(message)?.check().await.map_err(message)?;
    let info = UpdateInfo {
        current: app.package_info().version.to_string(),
        version: update.as_ref().map(|u| u.version.clone()),
        notes: update.as_ref().and_then(|u| u.body.clone()),
        date: update.as_ref().and_then(|u| u.date.map(|d| d.to_string())),
        dev: cfg!(debug_assertions),
    };
    *updates.pending.lock().unwrap() = update;
    Ok(info)
}

/// Bytes of the update downloaded so far (total 0 = unknown).
#[tauri::command]
pub fn update_progress(updates: State<'_, Updates>) -> Progress {
    Progress { done: updates.done.load(Ordering::Relaxed), total: updates.total.load(Ordering::Relaxed) }
}

/// Download the update found by the last check, stop the engine, install and restart.
#[tauri::command]
pub async fn update_install(app: AppHandle, updates: State<'_, Updates>, cfg: State<'_, Config>) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("This is a development build: update it from git. Installed copies of the app update here.".into());
    }
    let armed = || engine::output_armed(cfg.port) == Some(true);
    if armed() {
        return Err("Physical output is armed. Disarm it to install the update.".into());
    }
    let update = updates.pending.lock().unwrap().take().ok_or("Check for updates first.")?;
    updates.done.store(0, Ordering::Relaxed);
    updates.total.store(0, Ordering::Relaxed);
    let bytes = update
        .download(
            |chunk, total| {
                updates.done.fetch_add(chunk as u64, Ordering::Relaxed);
                updates.total.store(total.unwrap_or(0), Ordering::Relaxed);
            },
            || {},
        )
        .await
        .map_err(message)?;
    // Output may have been armed while the update downloaded: keep it for another press of Install.
    if armed() {
        *updates.pending.lock().unwrap() = Some(update);
        return Err("Physical output was armed while the update downloaded. Disarm it and press Install again.".into());
    }
    // The engine runs from inside the app; the new version must start its own. An engine started
    // some other way is left alone.
    if let Err(e) = engine::stop_owned(&cfg) {
        if !e.contains("not started by this app") {
            *updates.pending.lock().unwrap() = Some(update);
            return Err(e);
        }
    }
    update.install(bytes).map_err(message)?;
    app.restart();
}

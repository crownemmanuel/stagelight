fn main() {
    // The desk is a page served by the local engine (a remote origin to Tauri), so the app's own
    // commands need permissions that capabilities/default.json can grant to it.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["update_check", "update_install", "update_progress"]),
    ))
    .expect("failed to run tauri-build");
}

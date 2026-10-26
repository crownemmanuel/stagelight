mod engine;
mod updater;

use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use engine::Config;

/// Pages of the local engine stay in the app; everything else opens in the browser.
fn is_local(url: &Url) -> bool {
    url.scheme() == "tauri" || matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "tauri.localhost"))
}

/// window.open from the desk: the pop-out visualizer becomes a real window (drag it to a second
/// screen; window-state brings it back where it was left). It keeps `window.opener`, which the desk
/// and the visualizer use to stay linked. Any other link opens in the browser.
fn new_window(app: &AppHandle, port: u16, url: Url, features: NewWindowFeatures) -> NewWindowResponse<tauri::Wry> {
    if url.port() == Some(port) && is_local(&url) && url.path() == "/visualizer.html" {
        if let Some(old) = app.get_webview_window("visualizer") {
            let _ = old.destroy();
        }
        let built = WebviewWindowBuilder::new(app, "visualizer", WebviewUrl::External("about:blank".parse().unwrap()))
            .window_features(features)
            .title("StageLight · Visualizer")
            .inner_size(1280.0, 760.0)
            .min_inner_size(480.0, 300.0)
            .on_navigation(|url| is_local(url))
            .build();
        if let Ok(window) = built {
            return NewWindowResponse::Create { window };
        }
    } else {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
    NewWindowResponse::Deny
}

fn main_window(app: &AppHandle, port: u16) -> tauri::Result<WebviewWindow> {
    let handle = app.clone();
    let opener = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("StageLight")
        .inner_size(1440.0, 900.0)
        .min_inner_size(960.0, 700.0)
        .center()
        .on_new_window(move |url, features| new_window(&handle, port, url, features))
        .on_navigation(move |url| {
            if is_local(url) {
                return true;
            }
            let _ = opener.opener().open_url(url.as_str(), None::<&str>);
            false
        })
        .build()
}

/// Show a message on the start-up page (src-tauri/splash).
fn status(window: &WebviewWindow, title: &str, detail: &str, error: bool) {
    let js = format!(
        "window.setStatus&&setStatus({},{},{})",
        serde_json::to_string(title).unwrap(),
        serde_json::to_string(detail).unwrap(),
        error
    );
    let _ = window.eval(&js);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        // Updates only install when the operator asks for it (updater.rs, public/app.js).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::Updates::default())
        .invoke_handler(tauri::generate_handler![updater::update_check, updater::update_install, updater::update_progress])
        .setup(|app| {
            let cfg = Config::new(app.handle())?;
            app.manage(cfg.clone());
            let window = main_window(app.handle(), cfg.port)?;
            std::thread::spawn(move || match engine::ensure(&cfg) {
                Ok(()) => {
                    let _ = window.navigate(cfg.url().parse().unwrap());
                }
                Err(e) => status(&window, "The lighting engine did not start", &e, true),
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running StageLight")
        // The engine is not stopped on exit: closing the app never touches the lights.
        .run(|_, _| {});
}

//! The lighting engine is `server.mjs` run by the Node.js bundled next to the app (a sidecar).
//!
//! The window never owns the show: the engine is started detached, so quitting or crashing the app
//! leaves playback and output exactly as they were, and the next launch attaches to it again. The
//! app only ever stops an engine it started itself (recorded in `engine.pid`), and only while
//! physical output is disarmed: to replace an engine left over from an older version, and before
//! installing an update.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

#[derive(Clone)]
pub struct Config {
    /// HTTP port of the desk and API. LIGHTS_PORT overrides it, e.g. 1480 for a test copy.
    pub port: u16,
    /// Show data, settings, media and the engine log. LIGHTS_DATA_DIR overrides it.
    pub data_dir: PathBuf,
    /// The bundled engine and desk (resources/app).
    pub app_dir: PathBuf,
    pub node: PathBuf,
    pub version: String,
}

impl Config {
    pub fn new(app: &AppHandle) -> tauri::Result<Self> {
        let port = std::env::var("LIGHTS_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(1460);
        let data_dir = match std::env::var_os("LIGHTS_DATA_DIR") {
            Some(dir) => PathBuf::from(dir),
            None => app.path().app_data_dir()?,
        };
        let exe_dir = std::env::current_exe()?.parent().map(PathBuf::from).unwrap_or_default();
        let node = exe_dir.join(if cfg!(windows) { "node.exe" } else { "node" });
        Ok(Config {
            port,
            data_dir,
            app_dir: app.path().resource_dir()?.join("app"),
            node,
            version: app.package_info().version.to_string(),
        })
    }
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/", self.port)
    }
    fn pid_file(&self) -> PathBuf {
        self.data_dir.join("engine.pid")
    }
}

/// GET a path from the local engine; the body, or None when nothing answers.
fn get(port: u16, path: &str, timeout: Duration) -> Option<String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, timeout).ok()?;
    stream.set_read_timeout(Some(timeout * 4)).ok()?;
    // The engine refuses any Host but its own.
    write!(stream, "GET {path} HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").ok()?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).ok()?;
    let text = String::from_utf8_lossy(&raw);
    let (head, body) = text.split_once("\r\n\r\n")?;
    head.starts_with("HTTP/1.1 200").then(|| body.to_string())
}

/// The version of the engine answering on `port`, or None when nothing (or something else) answers.
pub fn running_version(port: u16) -> Option<String> {
    let body = get(port, "/api/session", Duration::from_millis(500))?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    v.get("token")?;
    Some(v.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string())
}

/// Whether physical output is armed. None when the engine does not answer.
pub fn output_armed(port: u16) -> Option<bool> {
    let body = get(port, "/api/state", Duration::from_millis(800))?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    v.pointer("/runtime/output/armed").and_then(|a| a.as_bool())
}

fn wait_until(deadline: Duration, mut ready: impl FnMut() -> bool) -> bool {
    let start = Instant::now();
    while start.elapsed() < deadline {
        if ready() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    ready()
}

/// Start the bundled engine, detached from the app, and wait until it answers.
pub fn spawn(cfg: &Config) -> Result<(), String> {
    fs::create_dir_all(&cfg.data_dir).map_err(|e| format!("Cannot create {}: {e}", cfg.data_dir.display()))?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(cfg.data_dir.join("engine.log"))
        .map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&cfg.node);
    cmd.arg(cfg.app_dir.join("server.mjs"))
        .current_dir(&cfg.app_dir)
        .env("LIGHTS_PORT", cfg.port.to_string())
        .env("LIGHTS_DATA_DIR", &cfg.data_dir)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own process group: Ctrl-C or a signal to the app does not reach the engine.
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Could not start the engine ({}): {e}", cfg.node.display()))?;
    let _ = fs::write(cfg.pid_file(), format!("{} {}", child.id(), cfg.port));
    // Reap it if it exits while the app runs; the app never kills it on quit.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    if wait_until(Duration::from_secs(20), || running_version(cfg.port).is_some()) {
        Ok(())
    } else {
        Err(format!(
            "The lighting engine did not start. Check that port {} is free. Log: {}",
            cfg.port,
            cfg.data_dir.join("engine.log").display()
        ))
    }
}

/// The PID of the engine this app started on `cfg.port`, if it is still running.
fn owned_pid(cfg: &Config) -> Option<u32> {
    let text = fs::read_to_string(cfg.pid_file()).ok()?;
    let mut parts = text.split_whitespace();
    let pid: u32 = parts.next()?.parse().ok()?;
    let port: u16 = parts.next()?.parse().ok()?;
    (port == cfg.port && alive(pid)).then_some(pid)
}

#[cfg(unix)]
fn alive(pid: u32) -> bool {
    Command::new("kill").args(["-0", &pid.to_string()]).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
}

#[cfg(windows)]
fn alive(pid: u32) -> bool {
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
}

/// Stop the engine this app started, only while output is disarmed, and wait until the port is free.
pub fn stop_owned(cfg: &Config) -> Result<(), String> {
    if output_armed(cfg.port) == Some(true) {
        return Err("Physical output is armed. Disarm it first.".into());
    }
    let Some(pid) = owned_pid(cfg) else {
        return Err("The engine on this port was not started by this app.".into());
    };
    #[cfg(unix)]
    let status = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    // A windowless Node ignores a polite close; output is disarmed, so nothing is cut off.
    #[cfg(windows)]
    let status = Command::new("taskkill").args(["/PID", &pid.to_string(), "/F"]).status();
    status.map_err(|e| e.to_string())?;
    if wait_until(Duration::from_secs(8), || running_version(cfg.port).is_none()) {
        let _ = fs::remove_file(cfg.pid_file());
        Ok(())
    } else {
        Err("The engine did not stop.".into())
    }
}

/// Watchdog: if an engine this app started stops answering for three seconds (it crashed), start it again. The new
/// engine comes up disarmed and offers to resume the show (docs/SHOW-SAFETY.md); nothing comes back on by itself. An
/// engine this app stopped on purpose (no `engine.pid`), or one started some other way, is left alone.
pub fn watch(cfg: Config) {
    std::thread::spawn(move || {
        let mut down = 0;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            if running_version(cfg.port).is_some() {
                down = 0;
                continue;
            }
            down += 1;
            let ours = fs::read_to_string(cfg.pid_file())
                .ok()
                .and_then(|t| t.split_whitespace().nth(1).and_then(|p| p.parse::<u16>().ok()))
                == Some(cfg.port);
            if down >= 3 && ours && owned_pid(&cfg).is_none() {
                down = 0;
                let _ = spawn(&cfg);
            }
        }
    });
}

/// Make sure this version's engine is answering on the port: attach to a running one, or start it.
/// An engine this app started from an older version is replaced while output is disarmed; one
/// started some other way (a terminal, another copy) is used as it is.
pub fn ensure(cfg: &Config) -> Result<(), String> {
    match running_version(cfg.port) {
        None => spawn(cfg),
        Some(v) if v == cfg.version => Ok(()),
        Some(_) => {
            if owned_pid(cfg).is_some() && output_armed(cfg.port) == Some(false) {
                stop_owned(cfg)?;
                spawn(cfg)
            } else {
                Ok(())
            }
        }
    }
}

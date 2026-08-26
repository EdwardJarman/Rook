// Rook Node Tauri shell.
//
// Thin supervised shell around the Node.js sidecar, which owns the real
// execution authority (Chromium, gateway, durable state). The shell:
//   - starts the bundled sidecar on launch (adopting an already-healthy
//     gateway instead of spawning a duplicate that would die on the port),
//   - sets PLAYWRIGHT_BROWSERS_PATH to the bundled Chromium resource,
//   - exposes health/start/stop + "Connect account" (opens the local pairing
//     page in the system browser),
//   - probes the gateway's /healthz so the UI can show real state
//     (running / listening / paired) instead of just "process exists",
//   - stops the sidecar on exit so closing the window never leaves an
//     orphaned rook-node-sidecar.exe squatting on the gateway port.
//
// The sidecar is spawned via std::process::Command at an explicit, verified
// path (next to the app executable). The shell plugin's sidecar resolution
// produced "path not found" inside installed builds, so we don't rely on it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, State};

/// Loopback gateway port — must match DEFAULT_GATEWAY_PORT in the sidecar.
const GATEWAY_PORT: u16 = 37831;

struct SidecarState {
    child: Mutex<Option<Child>>,
    /// True when an already-running gateway was detected and adopted instead
    /// of spawning a second sidecar (e.g. an orphan from a crashed shell).
    adopted: Mutex<bool>,
    /// Why the last spawn attempt failed (or the gateway never came up), for
    /// the status UI.
    last_error: Mutex<Option<String>>,
}

/// Probes the sidecar's gateway over loopback HTTP. Returns (listening, paired).
/// A refused connection is instant on loopback; the timeouts only guard against
/// a hung accepter, and this runs inside spawn_blocking, never the UI thread.
fn probe_gateway() -> (bool, bool) {
    let addr = SocketAddr::from((Ipv4Addr::new(127, 0, 0, 1), GATEWAY_PORT));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(900)) else {
        return (false, false);
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(900)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(900)));
    let request = format!(
        "GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:{GATEWAY_PORT}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        // Something accepted the connection even if it misbehaves: still
        // report the port as taken so we never double-spawn on top of it.
        return (true, false);
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return (true, false);
    }
    let body = response.split("\r\n\r\n").nth(1).unwrap_or("");
    (true, body.contains("\"paired\":true"))
}

/// Reflects process + gateway state to the UI. `paired` lets the window show
/// "Connected ✓" the moment the browser pairing round-trip lands.
#[tauri::command]
fn health(app: tauri::AppHandle) -> Result<String, String> {
    let state: State<'_, SidecarState> = app.state();
    // Reap an exited sidecar so "running" never lies: without this, a crashed
    // node process would keep the UI on "Starting…" forever.
    let running = {
        let mut guard = state.child.lock().map_err(|_| "lock")?;
        match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(status)) => {
                    let code = status.code().map(|c| c.to_string()).unwrap_or_else(|| "signal".to_string());
                    if let Ok(mut error) = state.last_error.lock() {
                        if error.is_none() {
                            *error = Some(format!("the node process exited unexpectedly (code {code})"));
                        }
                    }
                    *guard = None;
                    false
                }
                Ok(None) => true,
                Err(_) => true,
            },
            None => false,
        }
    };
    let mut adopted = state.adopted.lock().map_err(|_| "lock")?;
    let (listening, paired) = probe_gateway();
    // An adopted orphan that vanished is gone — report it honestly instead of
    // "starting…" forever.
    if *adopted && !listening {
        *adopted = false;
    }
    let running = running || *adopted;
    // A gateway that appeared without us spawning it (orphan, autostart
    // instance, manual run) is serving our port: mark it adopted so exit
    // cleanup stops it too — closing the app must not leave a stray node.
    if listening && !running {
        *adopted = true;
        // The gateway answering is the outcome that matters; stale spawn-time
        // errors would only confuse the status pill.
        if let Ok(mut error) = state.last_error.lock() {
            *error = None;
        }
    }
    let error = state.last_error.lock().map_err(|_| "lock")?.clone();
    let body = serde_json::json!({
        "running": running,
        "listening": listening,
        "paired": paired,
        "error": error,
    });
    Ok(body.to_string())
}

#[tauri::command]
fn start_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    spawn_sidecar(&app)
}

#[tauri::command]
fn stop_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    kill_child(&app);
    Ok(())
}

/// Opens the sidecar's local pairing page in the system browser. Refuses when
/// the gateway isn't listening so the click can never open a dead page.
#[tauri::command]
fn open_connect(app: tauri::AppHandle) -> Result<(), String> {
    let (listening, _) = probe_gateway();
    if !listening {
        return Err(format!("the local gateway is not listening on port {GATEWAY_PORT} yet"));
    }
    let url = format!("http://127.0.0.1:{GATEWAY_PORT}/connect");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Explorer delegates the URL to the registered browser without starting
        // cmd.exe, so the installed application never flashes a terminal window
        // during account connection.
        std::process::Command::new("explorer.exe")
            .arg(&url)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    let _ = &app;
    Ok(())
}

/// The sidecar ships next to the app executable (Tauri externalBin).
fn sidecar_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {}", e))?;
    let dir = exe.parent().ok_or_else(|| "executable has no directory".to_string())?;
    #[cfg(target_os = "windows")]
    let name = "rook-node-sidecar.exe";
    #[cfg(not(target_os = "windows"))]
    let name = "rook-node-sidecar";
    Ok(dir.join(name))
}

/// Bundled Chromium lives under the app's resource directory. Some layouts
/// (dev builds, portable runs) place it next to the executable instead, so
/// accept whichever exists.
fn browsers_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("chromium"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources").join("chromium"));
        }
    }
    for candidate in &candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }
    Err(format!(
        "bundled Chromium folder not found; tried {}",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join("; ")
    ))
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    let state: State<'_, SidecarState> = app.state();
    {
        let existing = state.child.lock().map_err(|_| "lock")?;
        if existing.is_some() {
            return Ok(());
        }
    }

    // An orphaned sidecar from a previous session may already be healthy on
    // the gateway port. Adopt it instead of spawning a second node that could
    // only die with "port already in use".
    {
        let (listening, _) = probe_gateway();
        if listening {
            *state.adopted.lock().map_err(|_| "lock")? = true;
            *state.last_error.lock().map_err(|_| "lock")? = None;
            log::info!("[shell] healthy gateway already listening on {GATEWAY_PORT} — adopted");
            return Ok(());
        }
    }

    let result = (|| -> Result<(), String> {
        let sidecar = sidecar_path()?;
        if !sidecar.exists() {
            return Err(format!("sidecar binary not found at {}", sidecar.display()));
        }
        let browsers_dir = browsers_path(app)?;
        if !browsers_dir.exists() {
            return Err(format!(
                "bundled Chromium folder missing at {}",
                browsers_dir.display()
            ));
        }

        let mut child = {
            let mut cmd = Command::new(&sidecar);
            cmd.arg("--headless")
                // The shell UI owns the connect flow: the sidecar must not
                // auto-open a browser on its own at boot.
                .arg("--no-open")
                .env("PLAYWRIGHT_BROWSERS_PATH", &browsers_dir)
                .current_dir(
                    sidecar
                        .parent()
                        .ok_or_else(|| "sidecar has no parent directory".to_string())?,
                )
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW — no terminal flash
            }
            cmd.spawn()
                .map_err(|e| format!("spawn failed: {}", e))?
        };

        if let Some(stdout) = child.stdout.take() {
            std::thread::spawn(move || {
                use std::io::BufRead;
                for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) {
                    log::info!("[sidecar] {}", line);
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                use std::io::BufRead;
                for line in std::io::BufReader::new(stderr).lines().map_while(Result::ok) {
                    log::error!("[sidecar] {}", line);
                }
            });
        }

        *state.child.lock().map_err(|_| "lock")? = Some(child);
        Ok(())
    })();

    if let Err(message) = &result {
        eprintln!("[shell] sidecar spawn failed: {}", message);
        *state.last_error.lock().map_err(|_| "lock")? = Some(message.clone());
    } else {
        wait_for_gateway(app.clone());
    }
    result
}

/// Watches the freshly spawned sidecar: clears any stale error once the
/// gateway answers, or records a real, visible reason if it never comes up.
fn wait_for_gateway(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        for _ in 0..30 {
            std::thread::sleep(Duration::from_millis(500));
            let state: State<'_, SidecarState> = app.state();
            let child_gone = state.child.lock().map(|g| g.is_none()).unwrap_or(true);
            if child_gone {
                return;
            }
            let (listening, _) = probe_gateway();
            if listening {
                if let Ok(mut error) = state.last_error.lock() {
                    *error = None;
                }
                return;
            }
        }
        if let Some(state) = app.try_state::<SidecarState>() {
            let mut error = match state.last_error.lock() {
                Ok(error) => error,
                Err(_) => return,
            };
            if error.is_none() {
                *error = Some(format!(
                    "the node process did not open its gateway on port {GATEWAY_PORT} within 15s"
                ));
            }
        }
    });
}

/// Kills the shell's own sidecar child (no-op when none was spawned).
fn kill_child(app: &tauri::AppHandle) {
    let state: State<'_, SidecarState> = app.state();
    let Ok(mut guard) = state.child.lock() else { return };
    if let Some(mut child) = guard.take() {
        log::info!("[shell] stopping sidecar pid {}", child.id());
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Stops an adopted orphan on exit so closing the app never leaves a stray
/// rook-node-sidecar behind to squat on the gateway port.
#[cfg(target_os = "windows")]
fn kill_adopted_orphans() {
    use std::os::windows::process::CommandExt;
    let Ok(output) = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .creation_flags(0x08000000)
        .output()
    else {
        return;
    };
    let listing = String::from_utf8_lossy(&output.stdout);
    for line in listing.lines() {
        // CSV row: "rook-node-sidecar.exe","1234",... The image name carries
        // the target-triple suffix in dev/staged layouts, so match a prefix.
        let mut fields = line.split("\",\"");
        let image = fields.next().unwrap_or("").trim_start_matches('"');
        let is_sidecar = image
            .get(.."rook-node-sidecar".len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("rook-node-sidecar"));
        if is_sidecar {
            if let Some(pid) = fields.next() {
                let pid = pid.trim_matches('"');
                if let Ok(output) = Command::new("taskkill")
                    .args(["/PID", pid, "/F", "/T"])
                    .creation_flags(0x08000000)
                    .output()
                {
                    log::info!(
                        "[shell] stopped orphaned sidecar pid {pid}: {}",
                        String::from_utf8_lossy(&output.stdout).trim()
                    );
                }
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn kill_adopted_orphans() {
    let _ = Command::new("pkill").arg("-x").arg("rook-node-sidecar").output();
}

fn main() {
    env_logger::init();
    let app = tauri::Builder::default()
        .manage(SidecarState {
            child: Mutex::new(None),
            adopted: Mutex::new(false),
            last_error: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            health,
            start_sidecar,
            stop_sidecar,
            open_connect
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let _ = spawn_sidecar(&handle);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Rook Node");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let adopted = app_handle
                .try_state::<SidecarState>()
                .map(|state| state.adopted.lock().map(|a| *a).unwrap_or(false))
                .unwrap_or(false);
            kill_child(app_handle);
            if adopted {
                kill_adopted_orphans();
            }
        }
    });
}

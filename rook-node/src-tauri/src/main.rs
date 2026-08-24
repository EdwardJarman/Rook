// Rook Node Tauri shell.
//
// Thin supervised shell around the Node.js sidecar, which owns the real
// execution authority (Chromium, gateway, durable state). The shell:
//   - starts the bundled sidecar on launch,
//   - sets PLAYWRIGHT_BROWSERS_PATH to the bundled Chromium resource,
//   - exposes health/start/stop + "Connect account" (opens the local pairing
//     page in the system browser).
//
// The sidecar is spawned via std::process::Command at an explicit, verified
// path (next to the app executable). The shell plugin's sidecar resolution
// produced "path not found" inside installed builds, so we don't rely on it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, State};

struct SidecarState {
    child: Mutex<Option<Child>>,
    /// Why the last spawn attempt failed, for the status UI.
    last_error: Mutex<Option<String>>,
}

#[tauri::command]
fn health(state: State<'_, SidecarState>) -> Result<String, String> {
    let guard = state.child.lock().map_err(|_| "lock")?;
    let error = state.last_error.lock().map_err(|_| "lock")?.clone();
    let body = match guard.as_ref() {
        Some(child) => serde_json::json!({ "running": true, "pid": child.id(), "error": error }),
        None => serde_json::json!({ "running": false, "error": error }),
    };
    Ok(body.to_string())
}

#[tauri::command]
fn start_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    spawn_sidecar(&app)
}

#[tauri::command]
fn stop_sidecar(state: State<'_, SidecarState>) -> Result<(), String> {
    let child = state.child.lock().map_err(|_| "lock")?.take();
    if let Some(mut child) = child {
        let _ = child.kill();
    }
    Ok(())
}

/// Opens the sidecar's local pairing page in the system browser.
#[tauri::command]
fn open_connect(app: tauri::AppHandle) -> Result<(), String> {
    let url = "http://localhost:37831/connect";
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/c", "start", "", url])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(url).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(url).spawn().map_err(|e| e.to_string())?;
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

        let mut child = Command::new(&sidecar)
            .arg("--headless")
            .env("PLAYWRIGHT_BROWSERS_PATH", &browsers_dir)
            .current_dir(
                sidecar
                    .parent()
                    .ok_or_else(|| "sidecar has no parent directory".to_string())?,
            )
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn failed: {}", e))?;

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
    }
    result
}

fn main() {
    env_logger::init();
    tauri::Builder::default()
        .manage(SidecarState {
            child: Mutex::new(None),
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
        .run(tauri::generate_context!())
        .expect("error while running Rook Node");
}

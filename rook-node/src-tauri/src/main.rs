// Rook Node Tauri shell.
//
// Thin supervised shell around the Node.js sidecar, which owns the real
// execution authority (Chromium, gateway, durable state). The shell:
//   - starts the bundled sidecar on launch,
//   - sets PLAYWRIGHT_BROWSERS_PATH to the bundled Chromium resource,
//   - exposes health/start/stop + "Connect account" (opens the local pairing
//     page in the system browser).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct SidecarState {
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn health(state: State<'_, SidecarState>) -> Result<String, String> {
    let guard = state.child.lock().map_err(|_| "lock")?;
    Ok(match guard.as_ref() {
        Some(child) => format!("running pid={}", child.pid()),
        None => "not running".to_string(),
    })
}

#[tauri::command]
fn start_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    spawn_sidecar(&app)
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    let state: State<'_, SidecarState> = app.state();
    {
        let existing = state.child.lock().map_err(|_| "lock")?;
        if existing.is_some() {
            return Ok(());
        }
    }

    let browsers_dir = browsers_path(app)?;
    let command = app
        .shell()
        .sidecar("binaries/rook-node")
        .map_err(|e| e.to_string())?
        .args(["--headless"])
        .env("PLAYWRIGHT_BROWSERS_PATH", &browsers_dir);

    let (mut rx, child) = command.spawn().map_err(|e| e.to_string())?;
    *state.child.lock().map_err(|_| "lock")? = Some(child);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => log::info!("[sidecar] {}", String::from_utf8_lossy(&line)),
                CommandEvent::Stderr(line) => log::error!("[sidecar] {}", String::from_utf8_lossy(&line)),
                CommandEvent::Terminated(payload) => {
                    log::warn!("[sidecar] terminated code={:?}", payload.code);
                }
                _ => {}
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn stop_sidecar(state: State<'_, SidecarState>) -> Result<(), String> {
    let child = state.child.lock().map_err(|_| "lock")?.take();
    if let Some(child) = child {
        child.kill().map_err(|e| e.to_string())?;
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
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    let _ = &app;
    Ok(())
}

/// Bundled Chromium lives under the app's resource directory.
fn browsers_path(app: &tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources")
        .join("chromium");
    Ok(dir.to_string_lossy().to_string())
}

fn main() {
    env_logger::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            health,
            start_sidecar,
            stop_sidecar,
            open_connect
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = spawn_sidecar(&handle);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Rook Node");
}

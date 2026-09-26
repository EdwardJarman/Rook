/**
 * Native login-start registration (autostart).
 *
 * On Windows this writes a Run key under the current user's HKCU. macOS uses
 * launchd; Linux uses XDG autostart. Each mechanism starts the Rook Node
 * sidecar when the owner signs in so the computer is ready for their Bots.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const APP_NAME = "Rook Node";

function sidecarCommand(): { command: string; args: string[] } {
  // When running from a built Tauri app the sidecar path is passed via env.
  const override = process.env.ROOK_NODE_BINARY;
  if (override) return { command: override, args: [] };
  const entry = path.resolve(process.argv[1] ?? process.execPath);
  return { command: process.execPath, args: [entry] };
}

export function installAutostart(): void {
  const { command, args } = sidecarCommand();
  if (process.platform === "win32") {
    const runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const value = `"${command}"${args.length ? ` ${args.map(quote).join(" ")}` : ""}`;
    spawnSync("reg", ["add", runKey, "/v", APP_NAME, "/t", "REG_SZ", "/d", value, "/f"], { stdio: "inherit" });
    return;
  }
  if (process.platform === "darwin") {
    const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", "com.rook.node.plist");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.rook.node</string>
  <key>ProgramArguments</key>
  <array><string>${command}</string>${args.map((a) => `<string>${a}</string>`).join("")}</array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>`;
    fs.writeFileSync(plistPath, plist);
    spawnSync("launchctl", ["load", plistPath], { stdio: "inherit" });
    return;
  }
  const autostartDir = path.join(os.homedir(), ".config", "autostart");
  fs.mkdirSync(autostartDir, { recursive: true });
  const desktopFile = path.join(autostartDir, "rook-node.desktop");
  const content = `[Desktop Entry]\nType=Application\nName=${APP_NAME}\nExec=${quote(command)}${args.length ? ` ${args.map(quote).join(" ")}` : ""}\nX-GNOME-Autostart-enabled=true\n`;
  fs.writeFileSync(desktopFile, content);
}

export function uninstallAutostart(): void {
  if (process.platform === "win32") {
    spawnSync("reg", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", APP_NAME, "/f"], { stdio: "inherit" });
    return;
  }
  if (process.platform === "darwin") {
    const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", "com.rook.node.plist");
    spawnSync("launchctl", ["unload", plistPath], { stdio: "inherit" });
    fs.rmSync(plistPath, { force: true });
    return;
  }
  fs.rmSync(path.join(os.homedir(), ".config", "autostart", "rook-node.desktop"), { force: true });
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "../..");

function getWindowsStartupScriptPath() {
  const appData =
    process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "001Router.vbs"
  );
}

export function getAutostartStatus() {
  if (process.platform !== "win32") {
    return { supported: false, enabled: false, path: "" };
  }
  const target = getWindowsStartupScriptPath();
  return {
    supported: true,
    enabled: fs.existsSync(target),
    path: target,
  };
}

export function enableAutostart({ port = 20128 } = {}) {
  if (process.platform !== "win32") {
    return { ok: false, error: "Autostart is currently configured for Windows Startup folder only." };
  }
  const target = getWindowsStartupScriptPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const cliEntry = path.join(APP_ROOT, "cli", "index.js");
  const cmd = `"${process.execPath}" "${cliEntry}" --tray --port ${Number(port) || 20128}`;
  const vbs = [
    'Set WshShell = CreateObject("WScript.Shell")',
    `WshShell.CurrentDirectory = "${APP_ROOT.replace(/"/g, '""')}"`,
    `WshShell.Run "${cmd.replace(/"/g, '""')}", 0, False`,
    "",
  ].join("\r\n");
  fs.writeFileSync(target, vbs, "utf8");
  return { ok: true, enabled: true, path: target };
}

export function disableAutostart() {
  if (process.platform !== "win32") {
    return { ok: true, enabled: false };
  }
  const target = getWindowsStartupScriptPath();
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
  return { ok: true, enabled: false, path: target };
}

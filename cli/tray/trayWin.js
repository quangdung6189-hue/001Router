import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Spawn the native Windows NotifyIcon tray via PowerShell (zero extra native binaries).
 */
export function startWindowsTray({
  port = 20128,
  pid = process.pid,
  cliTokenFile = "",
} = {}) {
  if (process.platform !== "win32") {
    return { launched: false, reason: "Windows tray is only available on win32" };
  }

  const scriptPath = path.join(__dirname, "tray.ps1");
  const iconPath = path.join(__dirname, "icon.ico");
  if (!fs.existsSync(scriptPath)) {
    return { launched: false, reason: "tray.ps1 script not found" };
  }

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    scriptPath,
    "-ServerPid",
    String(Number(pid) || process.pid),
    "-DashboardUrl",
    `http://127.0.0.1:${Number(port) || 20128}`,
    "-IconPath",
    fs.existsSync(iconPath) ? iconPath : "",
    "-CliTokenFile",
    cliTokenFile || "",
  ];

  const child = spawn("powershell.exe", args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  return { launched: true, pid: child.pid };
}

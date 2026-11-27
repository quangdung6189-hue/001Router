import { startWindowsTray } from "./trayWin.js";

export function startSystemTray(options = {}) {
  if (process.platform === "win32") {
    return startWindowsTray(options);
  }
  return {
    launched: false,
    reason: `System tray UI is currently supported on Windows; continuing in headless background mode on ${process.platform}.`,
  };
}

#!/usr/bin/env node
import { execFile } from "node:child_process";
import readline from "node:readline";
import {
  configureHttpServer,
  createApp,
  DEFAULT_HOST,
  shouldEnforcePasswordChange,
} from "../server/index.js";
import { startDailyCatalogScheduler } from "../server/catalog/updater.js";
import { cleanupLocalTunnels, registerLocalTunnelRunner } from "../server/localTunnel.js";
import { createStorage, resolveDataDir } from "../server/storage.js";
import {
  applyCliToolConfig,
  CONFIGURABLE_CLI_TOOLS,
  getAllCliToolStatuses,
  resetCliToolConfig,
} from "../server/cliTools.js";
import { getCliTokenFilePath, LocalCliClient } from "./apiClient.js";
import { createLocalTunnelRunner } from "./localTunnelRunner.js";
import { runTerminalUI } from "./terminalUI.js";
import { startSystemTray } from "./tray/tray.js";

const VERSION = "2.0.0";
const DEFAULT_PORT = Number(process.env.PORT) || 20128;

function parseArgs(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "-h" || token === "--help") flags.help = true;
    else if (token === "-v" || token === "--version") flags.version = true;
    else if (token === "--json") flags.json = true;
    else if (token === "--tray") flags.tray = true;
    else if (token === "--headless") flags.headless = true;
    else if (token === "--reset") flags.reset = true;
    else if (token === "--port" || token === "-p") {
      flags.port = Number(argv[i + 1]) || DEFAULT_PORT;
      i++;
    } else if (token.startsWith("--port=")) {
      flags.port = Number(token.slice(7)) || DEFAULT_PORT;
    } else if (token === "--model" || token === "-m") {
      flags.model = argv[i + 1] || "";
      i++;
    } else if (token === "--key" || token === "-k") {
      flags.key = argv[i + 1] || "";
      i++;
    } else {
      args.push(token);
    }
  }
  return { command: args[0] || "", rest: args.slice(1), flags };
}

function printHelp() {
  console.log(`001Router v${VERSION} - Local AI Router & CLI Launcher

Usage:
  001router [options]            Start router and choose Web UI / Terminal UI / Tray
  001router show [--json]        Display endpoints, providers, keys, combos, and CLI tool status
  001router connect <tool>       Configure or reset a local CLI tool (claude, codex, opencode, cline, kilo, droid, continue, aider)

Options:
  -p, --port <port>              Router HTTP port (default: 20128)
      --tray                     Start headless with Windows system tray icon
      --headless                 Start server without interactive prompt
      --model <model>            Target model or combo for 'connect'
      --key <apiKey>             Router API key for 'connect'
      --reset                    Restore original config backup for 'connect <tool>'
      --json                     Machine-readable JSON output for 'show'
  -v, --version                  Print version
  -h, --help                     Show this help text`);
}

function openBrowser(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

  if (process.platform === "win32") {
    execFile("rundll32", ["url.dll,FileProtocolHandler", parsed.href], {
      windowsHide: true,
    });
  } else if (process.platform === "darwin") {
    execFile("open", [parsed.href]);
  } else {
    execFile("xdg-open", [parsed.href]);
  }
}

async function handleShowCommand(flags) {
  const port = flags.port || DEFAULT_PORT;
  const dataDir = resolveDataDir();
  const client = new LocalCliClient({ port, dataDir });
  const running = await client.isHealthy();

  let providers = [];
  let keys = [];
  let combos = [];
  let cliTools = {};
  let tunnel = null;

  if (running) {
    const [pRes, kRes, cRes, tRes, tunRes] = await Promise.all([
      client.getProviders().catch(() => ({ providers: [] })),
      client.getKeys().catch(() => ({ keys: [] })),
      client.getCombos().catch(() => ({ combos: [] })),
      client.getCliToolStatuses().catch(() => ({ statuses: {} })),
      client.getTunnelStatus().catch(() => null),
    ]);
    providers = pRes?.providers || [];
    keys = kRes?.keys || [];
    combos = cRes?.combos || [];
    cliTools = tRes?.statuses || {};
    tunnel = tunRes;
  } else {
    const storage = await createStorage({ dataDir, port, bindHost: DEFAULT_HOST });
    providers = storage.getProviders();
    keys = storage.getKeys();
    combos = storage.getCombos();
    cliTools = getAllCliToolStatuses({ port });
    const s = storage.getSettings();
    tunnel = {
      tunnel: { enabled: Boolean(s.tunnelEnabled), tunnelUrl: s.tunnelUrl || "" },
      tailscale: { enabled: Boolean(s.tailscaleEnabled), tunnelUrl: s.tailscaleUrl || "" },
    };
  }

  const payload = {
    version: VERSION,
    serverRunning: running,
    port,
    localEndpoint: `http://127.0.0.1:${port}/v1`,
    dashboardUrl: `http://127.0.0.1:${port}`,
    providersCount: providers.length,
    keysCount: keys.length,
    combosCount: combos.length,
    tunnel,
    cliTools: Object.fromEntries(
      Object.entries(cliTools).map(([k, v]) => [
        k,
        { status: v.status, model: v.summary?.model || "" },
      ])
    ),
  };

  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`001Router v${VERSION} (${running ? "running" : "offline"})`);
  console.log(`Dashboard : ${payload.dashboardUrl}`);
  console.log(`API Base  : ${payload.localEndpoint}`);
  console.log(`Providers : ${payload.providersCount} | API Keys: ${payload.keysCount} | Combos: ${payload.combosCount}`);
  if (tunnel?.tunnel?.enabled && tunnel.tunnel.tunnelUrl) {
    console.log(`Cloudflare: ${tunnel.tunnel.tunnelUrl}/v1`);
  }
  if (tunnel?.tailscale?.enabled && tunnel.tailscale.tunnelUrl) {
    console.log(`Tailscale : ${tunnel.tailscale.tunnelUrl}/v1`);
  }
  console.log("");
  console.log("CLI Tools:");
  for (const [id, info] of Object.entries(payload.cliTools)) {
    console.log(`  - ${id.padEnd(10)} ${info.status}${info.model ? ` (${info.model})` : ""}`);
  }
}

async function handleConnectCommand(toolArg, flags) {
  const tool = String(toolArg || "").trim().toLowerCase();
  if (!CONFIGURABLE_CLI_TOOLS.has(tool)) {
    console.error(
      `Unsupported tool '${toolArg || ""}'. Supported: ${[...CONFIGURABLE_CLI_TOOLS].join(", ")}`
    );
    process.exitCode = 1;
    return;
  }

  const port = flags.port || DEFAULT_PORT;
  const dataDir = resolveDataDir();
  const client = new LocalCliClient({ port, dataDir });
  const running = await client.isHealthy();

  if (flags.reset) {
    if (running) await client.resetCliTool(tool);
    else resetCliToolConfig(tool, { port });
    console.log(`Restored original config backup for '${tool}'.`);
    return;
  }

  const payload = {
    baseUrl: `http://127.0.0.1:${port}`,
    ...(flags.model ? { model: flags.model } : {}),
    ...(flags.key ? { apiKey: flags.key } : {}),
  };

  if (running) {
    const res = await client.applyCliTool(tool, payload);
    console.log(`Configured '${tool}' -> ${res?.status?.summary?.baseUrl || payload.baseUrl}`);
  } else {
    const storage = await createStorage({ dataDir, port, bindHost: DEFAULT_HOST });
    const res = applyCliToolConfig(tool, payload, storage, { port });
    console.log(`Configured '${tool}' -> ${res?.summary?.baseUrl || payload.baseUrl}`);
  }
}

function askChoice(rl, text) {
  return new Promise((resolve) => {
    rl.question(text, (ans) => resolve(String(ans || "").trim()));
  });
}

async function startInteractiveLauncher(flags) {
  const port = flags.port || DEFAULT_PORT;
  const host = DEFAULT_HOST;
  const dataDir = resolveDataDir();
  const client = new LocalCliClient({ port, dataDir });
  const dashboardUrl = `http://127.0.0.1:${port}`;

  let server = null;
  let storage = null;

  const alreadyRunning = await client.isHealthy();
  const tunnelRunner = createLocalTunnelRunner();
  registerLocalTunnelRunner(tunnelRunner);

  if (!alreadyRunning) {
    const app = await createApp({
      dataDir,
      port,
      host,
      enforceBindCheck: true,
      enforcePasswordChange: shouldEnforcePasswordChange(),
      tunnelManagerOverride: tunnelRunner,
    });
    storage = app.storage;

    server = await new Promise((resolve, reject) => {
      const s = app.listen(port, host, () => resolve(s));
      s.once("error", reject);
    });
    app.locals.httpServer = server;
    configureHttpServer(server);
    startDailyCatalogScheduler(app.storage);

    const initialKey = storage.peekInitialRouterKey();
    if (initialKey?.key) {
      console.log(`[FIRST BOOT] Default Router API Key (shown once): ${initialKey.key}`);
    }
  } else {
    console.log(`Attached to running 001Router instance at ${dashboardUrl}`);
  }

  const shutdownAndExit = async (code = 0) => {
    try {
      await cleanupLocalTunnels();
      await storage?.flushDeferred?.();
      if (server) {
        await new Promise((resolve) => server.close(() => resolve()));
      }
    } catch {
      // ignore
    }
    process.exit(code);
  };

  process.once("SIGINT", () => shutdownAndExit(0));
  process.once("SIGTERM", () => shutdownAndExit(0));

  console.log("");
  console.log(`==================================================`);
  console.log(`  001Router v${VERSION} (Local AI Gateway)`);
  console.log(`  Dashboard : ${dashboardUrl}`);
  console.log(`  API Base  : ${dashboardUrl}/v1`);
  console.log(`==================================================`);

  if (flags.tray) {
    const trayRes = startSystemTray({
      port,
      pid: process.pid,
      cliTokenFile: getCliTokenFilePath(dataDir),
    });
    console.log(
      trayRes.launched
        ? "Running in Windows System Tray (check taskbar overflow if hidden)."
        : trayRes.reason
    );
    return;
  }

  if (flags.headless || !process.stdin.isTTY) {
    console.log("Running in headless mode (press Ctrl+C to stop).");
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      console.log("");
      console.log("Choose Interface:");
      console.log("  1. Web UI (Open Browser)");
      console.log("  2. Terminal UI (Interactive Console)");
      console.log("  3. Hide to System Tray (Windows)");
      console.log("  4. Stop Server & Exit");

      const choice = await askChoice(rl, "Select [1-4]: ");
      if (choice === "1") {
        console.log(`Opening ${dashboardUrl} ...`);
        openBrowser(dashboardUrl);
      } else if (choice === "2") {
        await runTerminalUI({ rl, client, port });
      } else if (choice === "3") {
        const trayRes = startSystemTray({
          port,
          pid: process.pid,
          cliTokenFile: getCliTokenFilePath(dataDir),
        });
        if (trayRes.launched) {
          console.log("System tray started. Minimized terminal prompt (press Ctrl+C anytime to stop).");
          rl.close();
          return;
        }
        console.log(trayRes.reason);
      } else if (choice === "4" || choice.toLowerCase() === "q") {
        rl.close();
        if (alreadyRunning) {
          await client.shutdown().catch(() => {});
          process.exit(0);
        } else {
          await shutdownAndExit(0);
        }
      }
    }
  } catch (err) {
    rl.close();
    console.error(err?.message || err);
    await shutdownAndExit(1);
  }
}

async function main() {
  const { command, rest, flags } = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }
  if (flags.version) {
    console.log(`001Router v${VERSION}`);
    return;
  }
  if (command === "show") {
    await handleShowCommand(flags);
    return;
  }
  if (command === "connect") {
    await handleConnectCommand(rest[0], flags);
    return;
  }
  await startInteractiveLauncher(flags);
}

main().catch((err) => {
  console.error(`[CLI ERROR] ${err?.message || err}`);
  process.exit(1);
});

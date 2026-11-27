import { getAutostartStatus, enableAutostart, disableAutostart } from "./tray/autostart.js";

function ask(rl, promptText) {
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => resolve(String(answer || "").trim()));
  });
}

function line() {
  console.log("-".repeat(58));
}

async function runProvidersMenu(rl, client) {
  while (true) {
    console.log("");
    console.log("=== Providers ===");
    const data = await client.getProviders().catch((e) => ({ error: e.message }));
    if (data?.error) {
      console.log(`Error: ${data.error}`);
      return;
    }
    const providers = data?.providers || [];
    if (providers.length === 0) {
      console.log("No connected providers yet. Connect one in the Web UI.");
    } else {
      providers.forEach((p, idx) => {
        const status = p.enabled === false ? "disabled" : "active";
        const keyCount = (p.apiKeys || []).length;
        console.log(
          `${idx + 1}. ${p.name} [${p.slug}] (${status}, keys=${keyCount}, models=${(p.models || []).length})`
        );
      });
    }
    line();
    console.log("Enter number to test provider, or [b] Back");
    const choice = await ask(rl, "> ");
    if (!choice || choice.toLowerCase() === "b") return;
    const idx = Number(choice) - 1;
    if (Number.isInteger(idx) && providers[idx]) {
      const target = providers[idx];
      console.log(`Testing ${target.name}...`);
      try {
        const res = await client.testProvider(target.id);
        console.log(res?.ok ? `OK (${res.latencyMs || 0}ms)` : `Result: ${JSON.stringify(res)}`);
      } catch (err) {
        console.log(`Test failed: ${err.message}`);
      }
    }
  }
}

async function runKeysMenu(rl, client) {
  while (true) {
    console.log("");
    console.log("=== API Keys ===");
    const data = await client.getKeys().catch((e) => ({ error: e.message }));
    if (data?.error) {
      console.log(`Error: ${data.error}`);
      return;
    }
    const keys = data?.keys || [];
    keys.forEach((k, idx) => {
      console.log(
        `${idx + 1}. ${k.name} (${k.keyPreview}) [${k.enabled === false ? "paused" : "active"}]`
      );
    });
    line();
    console.log("[n] Create new key   [d <num>] Delete key   [b] Back");
    const choice = await ask(rl, "> ");
    if (!choice || choice.toLowerCase() === "b") return;
    if (choice.toLowerCase() === "n") {
      const name = await ask(rl, "Key name: ");
      if (name) {
        try {
          const res = await client.createKey(name);
          console.log(`Created: ${res?.key?.key || res?.key?.keyPreview || "ok"}`);
        } catch (err) {
          console.log(`Create failed: ${err.message}`);
        }
      }
    } else if (choice.toLowerCase().startsWith("d ")) {
      const idx = Number(choice.slice(2).trim()) - 1;
      if (Number.isInteger(idx) && keys[idx]) {
        try {
          await client.deleteKey(keys[idx].id);
          console.log(`Deleted ${keys[idx].name}`);
        } catch (err) {
          console.log(`Delete failed: ${err.message}`);
        }
      }
    }
  }
}

async function runCombosMenu(rl, client) {
  console.log("");
  console.log("=== Combos ===");
  try {
    const data = await client.getCombos();
    const combos = data?.combos || [];
    if (combos.length === 0) {
      console.log("No combos configured yet.");
    } else {
      combos.forEach((c, idx) => {
        console.log(
          `${idx + 1}. ${c.name} [${c.strategy || "fallback"}] -> ${(c.targets || []).join(", ")}`
        );
      });
    }
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
  await ask(rl, "Press Enter to return...");
}

async function runCliToolsMenu(rl, client) {
  while (true) {
    console.log("");
    console.log("=== CLI Tools ===");
    let statuses = {};
    try {
      const res = await client.getCliToolStatuses();
      statuses = res?.statuses || {};
    } catch (err) {
      console.log(`Error: ${err.message}`);
      return;
    }
    const entries = Object.entries(statuses);
    entries.forEach(([id, info], idx) => {
      console.log(
        `${idx + 1}. ${id.padEnd(10)} [${info.status}] ${info.summary?.model || ""}`
      );
    });
    line();
    console.log("[c <num>] Configure with router URL   [r <num>] Reset backup   [b] Back");
    const choice = await ask(rl, "> ");
    if (!choice || choice.toLowerCase() === "b") return;
    if (choice.toLowerCase().startsWith("c ")) {
      const idx = Number(choice.slice(2).trim()) - 1;
      if (Number.isInteger(idx) && entries[idx]) {
        const [toolId] = entries[idx];
        const model = await ask(rl, "Model or combo (blank for default): ");
        const apiKey = await ask(rl, "Router API key (blank to reuse/existing): ");
        try {
          await client.applyCliTool(toolId, {
            baseUrl: client.baseUrl,
            ...(model ? { model } : {}),
            ...(apiKey ? { apiKey } : {}),
          });
          console.log(`Configured ${toolId}`);
        } catch (err) {
          console.log(`Apply failed: ${err.message}`);
        }
      }
    } else if (choice.toLowerCase().startsWith("r ")) {
      const idx = Number(choice.slice(2).trim()) - 1;
      if (Number.isInteger(idx) && entries[idx]) {
        const [toolId] = entries[idx];
        try {
          await client.resetCliTool(toolId);
          console.log(`Reset ${toolId} from backup`);
        } catch (err) {
          console.log(`Reset failed: ${err.message}`);
        }
      }
    }
  }
}

async function runSettingsMenu(rl, client, port) {
  while (true) {
    console.log("");
    console.log("=== Settings & Tunnel ===");
    const tun = await client.getTunnelStatus().catch(() => ({}));
    const autostart = getAutostartStatus();
    console.log(
      `1. Cloudflare Tunnel: ${tun?.tunnel?.enabled ? tun.tunnel.tunnelUrl : "Off"}`
    );
    console.log(
      `2. Tailscale Funnel:  ${tun?.tailscale?.enabled ? tun.tailscale.tunnelUrl : tun?.tailscale?.installed ? "Off" : "Not installed"}`
    );
    console.log("3. Reset Dashboard Password");
    console.log(
      `4. Windows Startup Autostart: ${autostart.supported ? (autostart.enabled ? "Enabled" : "Disabled") : "Unsupported"}`
    );
    console.log("5. Back");

    const choice = await ask(rl, "> ");
    if (choice === "1") {
      try {
        if (tun?.tunnel?.enabled) {
          await client.disableTunnel();
          console.log("Cloudflare Tunnel disabled.");
        } else {
          console.log("Starting Cloudflare Tunnel...");
          const res = await client.enableTunnel();
          console.log(`Tunnel active: ${res?.tunnelUrl}`);
        }
      } catch (err) {
        console.log(`Tunnel error: ${err.message}`);
      }
    } else if (choice === "2") {
      try {
        if (tun?.tailscale?.enabled) {
          await client.disableTailscale();
          console.log("Tailscale Funnel disabled.");
        } else {
          const res = await client.enableTailscale();
          console.log(res?.success ? `Tailscale active: ${res.tunnelUrl}` : `Tailscale: ${res?.error}`);
        }
      } catch (err) {
        console.log(`Tailscale error: ${err.message}`);
      }
    } else if (choice === "3") {
      const confirm = await ask(rl, "Reset dashboard password back to default (1234)? [y/N]: ");
      if (confirm.toLowerCase() === "y" || confirm.toLowerCase() === "yes") {
        try {
          const res = await client.resetDashboardPassword();
          console.log(res?.message || "Dashboard password reset to default (1234).");
        } catch (err) {
          console.log(`Reset password failed: ${err.message}`);
        }
      }
    } else if (choice === "4") {
      if (autostart.supported) {
        if (autostart.enabled) {
          disableAutostart();
          console.log("Disabled Windows Startup entry.");
        } else {
          enableAutostart({ port });
          console.log("Enabled Windows Startup entry.");
        }
      }
    } else {
      return;
    }
  }
}

export async function runTerminalUI({ rl, client, port = 20128 }) {
  while (true) {
    console.log("");
    line();
    console.log(`001Router Terminal UI · http://127.0.0.1:${port}`);
    line();
    console.log("1. Providers");
    console.log("2. API Keys");
    console.log("3. Combos");
    console.log("4. CLI Tools");
    console.log("5. Settings (Tunnel / Reset Password / Autostart)");
    console.log("6. Back to Interface Launcher");

    const choice = await ask(rl, "Select [1-6]: ");
    if (choice === "1") await runProvidersMenu(rl, client);
    else if (choice === "2") await runKeysMenu(rl, client);
    else if (choice === "3") await runCombosMenu(rl, client);
    else if (choice === "4") await runCliToolsMenu(rl, client);
    else if (choice === "5") await runSettingsMenu(rl, client, port);
    else if (choice === "6" || choice.toLowerCase() === "b") return;
  }
}

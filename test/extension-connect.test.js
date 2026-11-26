import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { getCloudCodeFlavor, resolveCatalogModel } from "../server/geminiCliOAuth.js";
import { resolveUpstreamModel } from "../server/geminiCliTranslator.js";
import { openaiToClaudeRequest } from "../server/translator.js";
import { packVsix } from "../vscode-001router/scripts/pack-vsix.js";

describe("001Router IDE Extension API & VSIX Packaging", () => {
  let tmpDir;
  let app;
  let server;
  let baseUrl;
  let extensionRouterKey;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "001router-ext-test-"));
    app = await createApp({ dataDir: tmpDir, port: 20128 });

    // Seed sample providers to test Provider -> Model -> Dynamic Effort rules
    await app.storage.update((data) => {
      data.providers.push(
        {
          id: "prov-anthropic",
          slug: "anthropic",
          preset: "anthropic",
          name: "Anthropic",
          baseUrl: "https://api.anthropic.com/v1",
          formatType: "anthropic",
          apiKeys: [{ id: "k1", key: "sk-ant-test-key", enabled: true }],
          models: ["claude-opus-5-5", "claude-haiku-5-5", "claude-haiku-4.5"],
          enabled: true
        },
        {
          id: "prov-openai",
          slug: "openai",
          preset: "openai",
          name: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          formatType: "openai",
          apiKeys: [{ id: "k2", key: "sk-openai-test-key", enabled: true }],
          models: ["gpt-5.2", "gpt-5-mini", "gpt-5.1-codex-max", "gpt-4o-mini"],
          enabled: true
        },
        {
          id: "prov-antigravity",
          slug: "antigravity",
          preset: "antigravity",
          name: "Antigravity (Google)",
          baseUrl: "https://daily-cloudcode-pa.googleapis.com/v1internal",
          formatType: "gemini-openai",
          apiKeys: [{ id: "k3", authMethod: "antigravity", enabled: true }],
          models: [
            "gemini-4-neon",
            "gemini-4-flash-lite",
            "gpt-oss-120b-medium",
            "gemini-4-carbon-low",
            "gemini-4-carbon-medium",
            "gemini-4-carbon-high",
            "gemini-4-argon-low",
            "gemini-4-argon-medium",
            "gemini-4-argon-high",
            "gemini-4-argon-xhigh"
          ],
          enabled: true
        },
        {
          id: "prov-openrouter",
          slug: "openrouter",
          preset: "openrouter",
          name: "OpenRouter",
          baseUrl: "https://openrouter.ai/api/v1",
          formatType: "openai",
          apiKeys: [{ id: "k4", key: "sk-or-test-key", enabled: true }],
          models: ["anthropic/claude-opus-4-6", "qwen/qwen4-max"],
          enabled: true
        }
      );
    });

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("1. rejects POST /api/extension/connect with wrong web password", async () => {
    const res = await fetch(`${baseUrl}/api/extension/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "001router"
      },
      body: JSON.stringify({ password: "wrong-password" })
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.ok(data.error);
  });

  it("2. authenticates with web password, issues router key, and returns accurate unified provider -> model -> effort catalog", async () => {
    const res = await fetch(`${baseUrl}/api/extension/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "001router"
      },
      body: JSON.stringify({
        password: "1234",
        clientName: "001Router VS Code Extension"
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(typeof data.routerKey === "string" && data.routerKey.startsWith("sk-001r-"));
    extensionRouterKey = data.routerKey;

    const providers = data.catalog?.providers || [];
    assert.equal(providers.length, 4);

    // Anthropic: Opus 5.5 and Haiku 5.5 support full Low..Max; legacy Haiku 4.5 stays Low..High
    const ant = providers.find((p) => p.slug === "anthropic");
    assert.equal(ant.logoFile, "anthropic.png");
    const opus = ant.models.find((m) => m.id === "claude-opus-5-5");
    assert.equal(opus.logoFile, "claude.png");
    const haiku55 = ant.models.find((m) => m.id === "claude-haiku-5-5");
    const haiku45 = ant.models.find((m) => m.id === "claude-haiku-4.5");
    assert.equal(opus.effort.maxEffort, "max");
    assert.deepEqual(
      opus.effort.effortLevels.map((l) => l.id),
      ["low", "medium", "high", "max"]
    );
    assert.equal(haiku55.effort.maxEffort, "max");
    assert.deepEqual(
      haiku55.effort.effortLevels.map((l) => l.id),
      ["low", "medium", "high", "max"]
    );
    assert.equal(haiku45.effort.maxEffort, "high");
    assert.deepEqual(
      haiku45.effort.effortLevels.map((l) => l.id),
      ["low", "medium", "high"]
    );

    // OpenAI: gpt-5.2 & gpt-5.1-codex-max (product -max NOT stripped!) -> xhigh; gpt-5-mini -> high; gpt-4o-mini -> medium
    const oai = providers.find((p) => p.slug === "openai");
    assert.equal(oai.logoFile, "openai.png");
    const gpt52 = oai.models.find((m) => m.id === "gpt-5.2");
    const gpt5Mini = oai.models.find((m) => m.id === "gpt-5-mini");
    const codexMax = oai.models.find((m) => m.id === "gpt-5.1-codex-max");
    const mini4o = oai.models.find((m) => m.id === "gpt-4o-mini");
    assert.equal(gpt52.logoFile, "openai.png");
    assert.equal(gpt52.effort.maxEffort, "xhigh");
    assert.equal(gpt5Mini.effort.maxEffort, "high");
    assert.ok(codexMax, "gpt-5.1-codex-max product name must not have -max stripped");
    assert.equal(codexMax.effort.maxEffort, "xhigh");
    assert.equal(mini4o.effort.maxEffort, "medium");

    // OpenRouter vendor-prefixed IDs keep full vendor recognition and product -max names intact
    const orProv = providers.find((p) => p.slug === "openrouter");
    const orOpus = orProv.models.find((m) => m.id === "anthropic/claude-opus-4-6");
    const orQwen = orProv.models.find((m) => m.id === "qwen/qwen4-max");
    assert.equal(orOpus.effort.maxEffort, "max");
    assert.ok(orQwen, "qwen/qwen4-max must not have -max stripped");
    assert.equal(orQwen.effort.maxEffort, "xhigh");

    // Antigravity: single-suffixed gpt-oss-120b-medium keeps 3-stop slider (not trapped at 1 stop!)
    const ag = providers.find((p) => p.slug === "antigravity");
    assert.equal(ag.logoFile, "antigravity.png");
    const neon = ag.models.find((m) => m.id === "gemini-4-neon");
    assert.equal(neon.logoFile, "gemini.png");
    const lite = ag.models.find((m) => m.id === "gemini-4-flash-lite");
    const gptOss = ag.models.find((m) => m.id === "gpt-oss-120b-medium");
    assert.equal(neon.effort.maxEffort, "xhigh");
    assert.equal(lite.effort.maxEffort, "medium");
    assert.ok(gptOss, "single-suffixed model gpt-oss-120b-medium must keep its ID and full slider");
    assert.deepEqual(
      gptOss.effort.effortLevels.map((l) => l.id),
      ["low", "medium", "high"]
    );

    // Verify suffixed sibling models collapse into one unified model with exact real Effort stops
    const carbon = ag.models.find((m) => m.id === "gemini-4-carbon");
    assert.ok(carbon, "gemini-4-carbon-{low,medium,high} must unify into gemini-4-carbon");
    assert.equal(ag.models.find((m) => m.id === "gemini-4-carbon-medium"), undefined);
    assert.equal(carbon.effort.maxEffort, "high");
    assert.deepEqual(
      carbon.effort.effortLevels.map((l) => l.id),
      ["low", "medium", "high"]
    );
    assert.equal(carbon.variantMap.high.fullId, "antigravity/gemini-4-carbon-high");

    const argon = ag.models.find((m) => m.id === "gemini-4-argon");
    assert.ok(argon, "gemini-4-argon-{low,medium,high,xhigh} must unify into gemini-4-argon");
    assert.equal(argon.effort.maxEffort, "xhigh");
    assert.equal(argon.variantMap.xhigh.fullId, "antigravity/gemini-4-argon-xhigh");

    // Verify resolveCatalogModel & resolveUpstreamModel honor xhigh/max without wrongful downgrade
    const mockCatalog = [
      { id: "gemini-4-carbon-low" },
      { id: "gemini-4-carbon-medium" },
      { id: "gemini-4-carbon-high" },
      { id: "gemini-4-argon-high" },
      { id: "gemini-4-argon-xhigh" }
    ];
    assert.equal(
      resolveCatalogModel("gemini-4-carbon-medium", mockCatalog, { reasoning_effort: "high" }),
      "gemini-4-carbon-high"
    );
    assert.equal(
      resolveCatalogModel("gemini-4-argon", mockCatalog, { reasoning_effort: "xhigh" }),
      "gemini-4-argon-xhigh"
    );
    assert.equal(
      resolveCatalogModel("gemini-4-argon", mockCatalog, { reasoning_effort: "max" }),
      "gemini-4-argon-xhigh"
    );

    const agFlavor = getCloudCodeFlavor("antigravity");
    assert.equal(
      resolveUpstreamModel("gemini-4-neon", { reasoning_effort: "xhigh" }, agFlavor).model,
      "gemini-4-neon-xhigh"
    );
    assert.equal(
      resolveUpstreamModel("gemini-4-neon", { reasoning_effort: "max" }, agFlavor).model,
      "gemini-4-neon-xhigh"
    );

    // Verify OpenAI -> Anthropic translation forwards reasoning_effort to thinking budget_tokens
    const claudeReq = openaiToClaudeRequest(
      {
        messages: [{ role: "user", content: "Design a router" }],
        reasoning_effort: "max",
        temperature: 0.7,
        max_tokens: 4096
      },
      "claude-opus-5-5"
    );
    assert.deepEqual(claudeReq.thinking, { type: "enabled", budget_tokens: 32768 });
    assert.ok(claudeReq.max_tokens > 32768);
    assert.equal(claudeReq.temperature, undefined);
  });

  it("3. protects /v1/extension/catalog with router API key auth", async () => {
    const unauth = await fetch(`${baseUrl}/v1/extension/catalog`);
    assert.equal(unauth.status, 401);

    const auth = await fetch(`${baseUrl}/v1/extension/catalog`, {
      headers: { Authorization: `Bearer ${extensionRouterKey}` }
    });
    assert.equal(auth.status, 200);
    const payload = await auth.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.catalog.providers.length, 4);
  });

  it("4. packages a valid v1.3.0 .vsix archive with OPC manifests and brand assets", async () => {
    const packed = packVsix();
    assert.ok(packed.bytes > 5000);
    assert.ok(packed.outPath.endsWith("001router-code-1.3.0.vsix"));
    const vsixBuf = await fs.readFile(packed.outPath);
    // ZIP PK\x03\x04 signature + required OPC entries inside archive
    assert.equal(vsixBuf[0], 0x50);
    assert.equal(vsixBuf[1], 0x4b);
    const asLatin1 = vsixBuf.toString("latin1");
    assert.ok(asLatin1.includes("[Content_Types].xml"));
    assert.ok(asLatin1.includes("extension.vsixmanifest"));
    assert.ok(asLatin1.includes("extension/extension.js"));
    assert.ok(asLatin1.includes("extension/media/icon.png"));
    assert.ok(asLatin1.includes("extension/media/icon-activity.svg"));
    assert.ok(asLatin1.includes("extension/media/webview.js"));
    assert.ok(asLatin1.includes("extension/media/webview.css"));
    assert.ok(asLatin1.includes("extension/media/providers/claude.png"));
    assert.ok(asLatin1.includes("extension/media/providers/openai.png"));
    assert.ok(asLatin1.includes("extension/media/providers/gemini.png"));
    assert.ok(asLatin1.includes("extension/media/providers/antigravity.png"));
    assert.ok(asLatin1.includes("extension/media/providers/xai.png"));
  });
});

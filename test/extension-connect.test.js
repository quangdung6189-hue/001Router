import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/index.js";
import { resolveCatalogModel } from "../server/geminiCliOAuth.js";
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
          models: ["claude-opus-5-5", "claude-haiku-5-5"],
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
          models: ["gpt-5.2", "gpt-4o-mini"],
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
            "gemini-4-carbon-low",
            "gemini-4-carbon-medium",
            "gemini-4-carbon-high",
            "gemini-4-argon-low",
            "gemini-4-argon-medium",
            "gemini-4-argon-high",
            "gemini-4-argon-xhigh"
          ],
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

  it("2. authenticates with web password, issues router key, and returns provider -> model -> effort catalog", async () => {
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
    assert.equal(providers.length, 3);

    const ant = providers.find((p) => p.slug === "anthropic");
    assert.equal(ant.logoFile, "anthropic.png");
    const opus = ant.models.find((m) => m.id === "claude-opus-5-5");
    assert.equal(opus.logoFile, "claude.png");
    const haiku = ant.models.find((m) => m.id === "claude-haiku-5-5");
    assert.equal(opus.effort.maxEffort, "max");
    assert.deepEqual(
      opus.effort.effortLevels.map((l) => l.id),
      ["low", "medium", "high", "max"]
    );
    assert.equal(haiku.effort.maxEffort, "high");
    assert.deepEqual(
      haiku.effort.effortLevels.map((l) => l.id),
      ["low", "medium", "high"]
    );

    const oai = providers.find((p) => p.slug === "openai");
    assert.equal(oai.logoFile, "openai.png");
    const gpt52 = oai.models.find((m) => m.id === "gpt-5.2");
    assert.equal(gpt52.logoFile, "openai.png");
    const mini = oai.models.find((m) => m.id === "gpt-4o-mini");
    assert.equal(gpt52.effort.maxEffort, "xhigh");
    assert.equal(mini.effort.maxEffort, "medium");

    const ag = providers.find((p) => p.slug === "antigravity");
    assert.equal(ag.logoFile, "antigravity.png");
    const neon = ag.models.find((m) => m.id === "gemini-4-neon");
    assert.equal(neon.logoFile, "gemini.png");
    const lite = ag.models.find((m) => m.id === "gemini-4-flash-lite");
    assert.equal(neon.effort.maxEffort, "xhigh");
    assert.equal(lite.effort.maxEffort, "medium");

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

    // Verify resolveCatalogModel honors reasoning_effort across base and suffixed IDs
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
    assert.equal(payload.catalog.providers.length, 3);
  });

  it("4. packages a valid .vsix archive with OPC manifests and brand PNG", async () => {
    const packed = packVsix();
    assert.ok(packed.bytes > 5000);
    const vsixBuf = await fs.readFile(packed.outPath);
    // ZIP PK\x03\x04 signature + required OPC entries inside archive
    assert.equal(vsixBuf[0], 0x50);
    assert.equal(vsixBuf[1], 0x4b);
    const asLatin1 = vsixBuf.toString("latin1");
    assert.ok(asLatin1.includes("[Content_Types].xml"));
    assert.ok(asLatin1.includes("extension.vsixmanifest"));
    assert.ok(asLatin1.includes("extension/extension.js"));
    assert.ok(asLatin1.includes("extension/media/icon.png"));
    assert.ok(asLatin1.includes("extension/media/ai-face-3d.jpg"));
    assert.ok(asLatin1.includes("extension/media/webview.js"));
    assert.ok(asLatin1.includes("extension/media/providers/claude.png"));
    assert.ok(asLatin1.includes("extension/media/providers/openai.png"));
    assert.ok(asLatin1.includes("extension/media/providers/gemini.png"));
    assert.ok(asLatin1.includes("extension/media/providers/antigravity.png"));
    assert.ok(asLatin1.includes("extension/media/providers/xai.png"));
  });
});

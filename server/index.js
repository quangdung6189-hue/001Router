import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { DEFAULT_PORT, createStorage } from "./storage.js";
import { RouterService } from "./router.js";
import { LiveEventsHub } from "./liveEvents.js";
import { AGENT_SKILLS, renderSkillMarkdown } from "./skillsData.js";
import { createRouterAuthMiddleware } from "./auth.js";
import { createDashboardRouter } from "./routes/dashboard.js";
import { createCatalogRouter } from "./routes/catalog.js";
import { createCliToolsRouter } from "./routes/cliTools.js";
import { createV1Router } from "./routes/v1.js";
import { createMediaRouter } from "./routes/media.js";
import { startDailyCatalogScheduler } from "./catalog/updater.js";
import {
  createCorsMiddleware,
  createCsrfMiddleware,
  createSecurityHeadersMiddleware,
  isLoopbackHost
} from "./security/headers.js";
import { redactSecrets, stripPrototypePollution } from "./security/redact.js";

export const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_WEB_DIST = path.resolve(import.meta.dirname, "../web/dist");

/**
 * Verify that binding to a non-loopback address is only allowed when the dashboard
 * password has been changed from the default ('1234').
 * @param {string} host
 * @param {import("./storage.js").Storage} storage
 */
export function assertSafeNetworkBind(host, storage) {
  const targetHost = String(host || DEFAULT_HOST).trim();
  if (!isLoopbackHost(targetHost)) {
    console.warn(
      `[SECURITY WARNING] 001Router is configured to bind to non-loopback address '${targetHost}'.`
    );
    if (storage && storage.isDefaultPasswordSync()) {
      throw new Error(
        `Refusing to bind non-loopback host '${targetHost}' while default dashboard password ('1234') is active. Change the dashboard password first.`
      );
    }
  }
}

/**
 * Create and initialize the 001Router Express application.
 * @param {{
 *   dataDir?: string,
 *   port?: number,
 *   host?: string,
 *   enforceBindCheck?: boolean,
 *   webDistDir?: string,
 *   oauthExchangeUrl?: string,
 *   oauthAuthBaseUrl?: string,
 *   oauthFetchImpl?: typeof globalThis.fetch,
 *   googleOAuthAuthBaseUrl?: string,
 *   googleOAuthTokenUrl?: string,
 *   googleOAuthUserinfoUrl?: string,
 *   googleOAuthModelsUrl?: string,
 *   googleOAuthBillingBaseUrl?: string,
 *   googleOAuthFetchImpl?: typeof globalThis.fetch,
 *   serviceAccountFetchImpl?: typeof globalThis.fetch,
 *   serviceAccountTokenUri?: string,
 *   allowLoopbackTokenUri?: boolean,
 *   oauthAllowLoopback?: boolean,
 *   oauthGitLabBaseUrl?: string,
 *   oauthKiloApiBaseUrl?: string,
 *   oauthNousPortalBaseUrl?: string,
 *   oauthTokenUrlOverride?: string,
 *   oauthUserinfoUrlOverride?: string,
 *   cliToolsHomeDir?: string,
 *   cliToolsEnvPath?: string
 * }} [options]
 */
export async function createApp(options = {}) {
  const port = Number(options.port) || Number(process.env.PORT) || DEFAULT_PORT;
  const bindHost = options.host || process.env.HOST || DEFAULT_HOST;
  const storage = await createStorage({ dataDir: options.dataDir, port, bindHost });
  if (options.enforceBindCheck || options.host) {
    assertSafeNetworkBind(bindHost, storage);
  }

  const app = express();
  app.disable("x-powered-by");
  app.bindHost = bindHost;
  app.storage = storage;
  app.locals.storage = storage;
  app.locals.port = port;
  if (options.oauthExchangeUrl) {
    app.locals.oauthExchangeUrl = options.oauthExchangeUrl;
  }
  if (options.oauthAuthBaseUrl) {
    app.locals.oauthAuthBaseUrl = options.oauthAuthBaseUrl;
  }
  if (options.oauthFetchImpl) {
    app.locals.oauthFetchImpl = options.oauthFetchImpl;
  }
  if (options.googleOAuthAuthBaseUrl) {
    app.locals.googleOAuthAuthBaseUrl = options.googleOAuthAuthBaseUrl;
  }
  if (options.googleOAuthTokenUrl) {
    app.locals.googleOAuthTokenUrl = options.googleOAuthTokenUrl;
  }
  if (options.googleOAuthUserinfoUrl) {
    app.locals.googleOAuthUserinfoUrl = options.googleOAuthUserinfoUrl;
  }
  if (options.googleOAuthModelsUrl) {
    app.locals.googleOAuthModelsUrl = options.googleOAuthModelsUrl;
  }
  if (options.googleOAuthBillingBaseUrl) {
    app.locals.googleOAuthBillingBaseUrl = options.googleOAuthBillingBaseUrl;
  }
  if (options.googleOAuthFetchImpl) {
    app.locals.googleOAuthFetchImpl = options.googleOAuthFetchImpl;
  }
  if (options.serviceAccountFetchImpl) {
    app.locals.serviceAccountFetchImpl = options.serviceAccountFetchImpl;
  }
  if (options.serviceAccountTokenUri) {
    app.locals.serviceAccountTokenUri = options.serviceAccountTokenUri;
  }
  if (options.allowLoopbackTokenUri) {
    app.locals.allowLoopbackTokenUri = Boolean(options.allowLoopbackTokenUri);
  }
  if (options.oauthAllowLoopback) {
    app.locals.oauthAllowLoopback = Boolean(options.oauthAllowLoopback);
  }
  if (options.oauthGitLabBaseUrl) {
    app.locals.oauthGitLabBaseUrl = options.oauthGitLabBaseUrl;
  }
  if (options.oauthKiloApiBaseUrl) {
    app.locals.oauthKiloApiBaseUrl = options.oauthKiloApiBaseUrl;
  }
  if (options.oauthNousPortalBaseUrl) {
    app.locals.oauthNousPortalBaseUrl = options.oauthNousPortalBaseUrl;
  }
  if (options.oauthTokenUrlOverride) {
    app.locals.oauthTokenUrlOverride = options.oauthTokenUrlOverride;
  }
  if (options.oauthUserinfoUrlOverride) {
    app.locals.oauthUserinfoUrlOverride = options.oauthUserinfoUrlOverride;
  }
  if (options.cliToolsHomeDir) {
    app.locals.cliToolsHomeDir = options.cliToolsHomeDir;
  }
  if (options.cliToolsEnvPath !== undefined) {
    app.locals.cliToolsEnvPath = options.cliToolsEnvPath;
  }

  const liveEvents = new LiveEventsHub();
  app.liveEvents = liveEvents;
  app.locals.liveEvents = liveEvents;
  if (options.headroomFetchImpl) {
    app.locals.headroomFetchImpl = options.headroomFetchImpl;
  }

  const routerService = new RouterService(storage, { appLocals: app.locals, liveEvents });
  app.routerService = routerService;
  app.locals.routerService = routerService;
  liveEvents.log("info", "server", `001Router initialized on ${bindHost}:${port}`);

  // Mandatory security headers & locked-down CORS middleware (Section 9.8 #4, #7)
  app.use(createSecurityHeadersMiddleware());
  app.use(createCorsMiddleware());

  // Body size caps: /api 6 MB, /v1 25 MB (Section 9.8 #9)
  app.use("/api", express.json({ limit: "6mb" }));
  app.use("/v1", express.json({ limit: "25mb" }));
  app.use(express.json({ limit: "6mb" }));

  // Prototype-pollution safe JSON body normalization
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === "object") {
      req.body = stripPrototypePollution(req.body);
    }
    next();
  });

  // Malformed JSON & body limit error handler
  app.use((err, req, res, next) => {
    if (err && err.type === "entity.parse.failed") {
      if (req.path.startsWith("/v1")) {
        return res.status(400).json({
          error: {
            message: "Invalid JSON request body",
            type: "invalid_request_error"
          }
        });
      }
      return res.status(400).json({ error: "Invalid JSON request body" });
    }
    if (err && err.type === "entity.too.large") {
      if (req.path.startsWith("/v1")) {
        return res.status(413).json({
          error: {
            message: "Request payload too large",
            type: "invalid_request_error"
          }
        });
      }
      return res.status(413).json({ error: "Request payload too large" });
    }
    next(err);
  });

  // CSRF / Origin protection on state-changing /api/* requests (Section 9.8 #5)
  app.use("/api", createCsrfMiddleware());

  // Healthcheck
  app.get("/health", (_req, res) => {
    return res.json({
      ok: true,
      service: "001router",
      port
    });
  });

  // Public Agent Skills endpoints (readable directly by AI agents without browser session)
  function buildSafeRequestOrigin(req) {
    const rawHost = String(req.get("host") || "").trim();
    const safeHost = /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(rawHost)
      ? rawHost
      : `localhost:${port}`;
    const proto = req.secure || req.headers?.["x-forwarded-proto"] === "https" ? "https" : "http";
    return `${proto}://${safeHost}`;
  }

  app.get("/api/skills", (req, res) => {
    const origin = buildSafeRequestOrigin(req);
    return res.json({
      origin,
      skills: AGENT_SKILLS.map((s) => ({
        ...s,
        rawUrl: `${origin}/api/skills/${s.id}/SKILL.md`
      }))
    });
  });

  app.get("/api/skills/:id/SKILL.md", (req, res) => {
    const origin = buildSafeRequestOrigin(req);
    const md = renderSkillMarkdown(req.params.id, origin);
    if (!md) {
      return res.status(404).type("text/plain").send("Skill not found");
    }
    return res.type("text/markdown; charset=utf-8").send(md);
  });

  // API & Unified Router Routes
  const v1Router = createV1Router(storage, routerService);
  app.use("/api", createDashboardRouter(storage, liveEvents));
  app.use("/api", createCatalogRouter(storage, routerService));
  app.use("/api", createCliToolsRouter(storage));
  // Mount `/v1/v1` first so Anthropic/OpenAI SDKs configured with `.../v1` never double-prefix
  app.use("/v1/v1", v1Router);
  app.use("/v1", v1Router);
  app.use("/v1", createMediaRouter(storage, routerService));

  // Google Gemini `/v1beta/models` compatibility endpoint (9Router parity)
  const v1betaRouter = express.Router();
  v1betaRouter.use(createRouterAuthMiddleware(storage));
  v1betaRouter.get("/models", (_req, res) => {
    const models = [];
    for (const combo of storage.getCombos()) {
      if (combo.enabled === false || !combo.name) continue;
      models.push({
        name: `models/${combo.name}`,
        displayName: combo.name,
        supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
      });
    }
    for (const provider of storage.getProviders()) {
      if (provider.enabled === false) continue;
      for (const m of provider.models || []) {
        if (storage.isModelDisabled?.(provider.slug, m)) continue;
        models.push({
          name: `models/${provider.slug}/${m}`,
          displayName: `${provider.name} / ${m}`,
          supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
        });
      }
    }
    return res.json({ models });
  });

  v1betaRouter.post("/models/{*modelAction}", async (req, res) => {
    const rawParam = Array.isArray(req.params.modelAction)
      ? req.params.modelAction.join("/")
      : String(req.params.modelAction || "");
    const colonIdx = rawParam.lastIndexOf(":");
    const modelId = colonIdx > 0 ? rawParam.slice(0, colonIdx) : rawParam;
    const action = colonIdx > 0 ? rawParam.slice(colonIdx + 1) : "generateContent";

    const contents = Array.isArray(req.body?.contents) ? req.body.contents : [];
    const messages = [];
    if (req.body?.systemInstruction?.parts) {
      const sysText = req.body.systemInstruction.parts.map((p) => p?.text || "").join("\n").trim();
      if (sysText) messages.push({ role: "system", content: sysText });
    }
    for (const c of contents) {
      const role = c?.role === "model" ? "assistant" : "user";
      const text = Array.isArray(c?.parts)
        ? c.parts.map((p) => p?.text || "").join("\n")
        : "";
      messages.push({ role, content: text });
    }

    const isStream = action === "streamGenerateContent";
    req.body = {
      model: modelId,
      messages,
      stream: isStream,
      ...(req.body?.generationConfig?.maxOutputTokens
        ? { max_tokens: req.body.generationConfig.maxOutputTokens }
        : {}),
      ...(req.body?.generationConfig?.temperature !== undefined
        ? { temperature: req.body.generationConfig.temperature }
        : {})
    };
    if (!isStream) {
      const origJson = res.json.bind(res);
      res.json = (payload) => {
        if (payload && Array.isArray(payload.choices)) {
          const text = payload.choices[0]?.message?.content ?? "";
          return origJson({
            candidates: [
              {
                content: { role: "model", parts: [{ text: typeof text === "string" ? text : JSON.stringify(text) }] },
                finishReason: "STOP",
                index: 0
              }
            ],
            usageMetadata: {
              promptTokenCount: payload.usage?.prompt_tokens || 0,
              candidatesTokenCount: payload.usage?.completion_tokens || 0,
              totalTokenCount: payload.usage?.total_tokens || 0
            },
            modelVersion: payload.model || modelId
          });
        }
        return origJson(payload);
      };
    }
    return routerService.handleChatCompletions(req, res);
  });
  app.use("/v1beta", v1betaRouter);

  // Static Dashboard UI + SPA fallback when built web/dist/index.html exists
  const webDistDir = options.webDistDir
    ? path.resolve(options.webDistDir)
    : DEFAULT_WEB_DIST;
  const indexHtmlPath = path.join(webDistDir, "index.html");

  if (fs.existsSync(indexHtmlPath)) {
    app.use(express.static(webDistDir, { redirect: false }));
    app.use((req, res, next) => {
      if (
        req.method === "GET" &&
        !req.path.startsWith("/api") &&
        !req.path.startsWith("/v1") &&
        req.path !== "/health"
      ) {
        return res.sendFile(indexHtmlPath);
      }
      next();
    });
  }

  // Fallback global error handler (redacts any secret patterns from error messages)
  app.use((err, req, res, _next) => {
    const status = Number(err?.status) || 500;
    const message = redactSecrets(err?.message || "Internal server error");
    if (res.headersSent) {
      return res.end();
    }
    if (req.path.startsWith("/v1")) {
      return res.status(status).json({
        error: {
          message,
          type: "api_error"
        }
      });
    }
    return res.status(status).json({ error: message });
  });

  return app;
}

// Start server when run directly
const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const host = process.env.HOST || DEFAULT_HOST;
  const app = await createApp({ port, host, enforceBindCheck: true });
  const initialKey = app.storage.peekInitialRouterKey();
  app.listen(port, host, () => {
    console.log(`001Router listening on http://${host}:${port}`);
    if (initialKey && initialKey.key) {
      console.log(
        `[FIRST BOOT] Default Router API Key (shown once in console; also retrievable once via /api/keys/reveal-initial): ${initialKey.key}`
      );
    }
    startDailyCatalogScheduler(app.storage);
  });
}

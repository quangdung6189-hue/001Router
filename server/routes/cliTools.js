import express from "express";
import { createDashboardAuthMiddleware, isPublicDeployment, isSecureRequest } from "../auth.js";
import { parseHostHeaderName } from "../security/headers.js";
import { redactSecrets } from "../security/redact.js";
import {
  applyCliToolConfig,
  getAllCliToolStatuses,
  getCliToolStatus,
  resetCliToolConfig
} from "../cliTools.js";

function extractCliToolsOptions(req) {
  const locals = req?.app?.locals || {};
  const port = Number(locals.port) || Number(req.socket?.localPort) || 20128;
  const rawHost = typeof req.headers?.host === "string" ? req.headers.host.trim() : "";
  const validHost = parseHostHeaderName(rawHost) && /^[a-zA-Z0-9.:\[\]-]+(?::\d{1,5})?$/.test(rawHost);
  const proto = isSecureRequest(req) ? "https" : "http";
  const baseUrl = validHost ? `${proto}://${rawHost}` : `http://127.0.0.1:${port}`;
  return {
    port,
    baseUrl,
    ...(locals.cliToolsHomeDir ? { homeDir: locals.cliToolsHomeDir } : {}),
    ...(locals.cliToolsEnvPath !== undefined ? { envPath: locals.cliToolsEnvPath } : {})
  };
}

/**
 * Create the Express router for `/api/cli-tools/*` (tool detection, 1-click config apply, reset).
 * Protected by dashboard session auth and disabled by default on public deployments.
 * @param {import("../storage.js").Storage} storage
 */
export function createCliToolsRouter(storage) {
  const router = express.Router();
  router.use("/cli-tools", createDashboardAuthMiddleware(storage));
  router.use("/cli-tools", (_req, res, next) => {
    if (isPublicDeployment(storage) && process.env.ROUTER001_ENABLE_CLI_TOOLS !== "1") {
      return res.status(403).json({
        error: "CLI tool local config management is disabled on public deployments"
      });
    }
    return next();
  });

  router.get("/cli-tools/statuses", (req, res) => {
    try {
      const statuses = getAllCliToolStatuses(extractCliToolsOptions(req));
      return res.json({ statuses });
    } catch (err) {
      return res
        .status(Number(err?.status) || 500)
        .json({ error: redactSecrets(err?.message || "Failed to inspect CLI tools") });
    }
  });

  router.get("/cli-tools/:tool", (req, res) => {
    try {
      const tool = String(req.params.tool || "").trim().toLowerCase();
      const status = getCliToolStatus(tool, extractCliToolsOptions(req));
      return res.json(status);
    } catch (err) {
      return res
        .status(Number(err?.status) || 400)
        .json({ error: redactSecrets(err?.message || "Failed to read CLI tool configuration") });
    }
  });

  router.post("/cli-tools/:tool/apply", (req, res) => {
    try {
      const tool = String(req.params.tool || "").trim().toLowerCase();
      const result = applyCliToolConfig(
        tool,
        req.body || {},
        storage,
        extractCliToolsOptions(req)
      );
      return res.json({ ok: true, status: result });
    } catch (err) {
      return res
        .status(Number(err?.status) || 400)
        .json({ error: redactSecrets(err?.message || "Failed to apply CLI tool configuration") });
    }
  });

  router.delete("/cli-tools/:tool/reset", (req, res) => {
    try {
      const tool = String(req.params.tool || "").trim().toLowerCase();
      const result = resetCliToolConfig(tool, extractCliToolsOptions(req));
      return res.json({ ok: true, status: result });
    } catch (err) {
      return res
        .status(Number(err?.status) || 400)
        .json({ error: redactSecrets(err?.message || "Failed to reset CLI tool configuration") });
    }
  });

  return router;
}

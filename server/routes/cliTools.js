import express from "express";
import { createDashboardAuthMiddleware } from "../auth.js";
import {
  applyCliToolConfig,
  getAllCliToolStatuses,
  getCliToolStatus,
  resetCliToolConfig
} from "../cliTools.js";

function extractCliToolsOptions(req) {
  const locals = req?.app?.locals || {};
  const port = Number(locals.port) || Number(req.socket?.localPort) || 20128;
  const hostHeader = typeof req.headers?.host === "string" ? req.headers.host : "";
  const baseUrl = hostHeader
    ? `${req.protocol || "http"}://${hostHeader}`
    : `http://127.0.0.1:${port}`;
  return {
    port,
    baseUrl,
    ...(locals.cliToolsHomeDir ? { homeDir: locals.cliToolsHomeDir } : {}),
    ...(locals.cliToolsEnvPath !== undefined ? { envPath: locals.cliToolsEnvPath } : {})
  };
}

/**
 * Create the Express router for `/api/cli-tools/*` (tool detection, 1-click config apply, reset).
 * Protected by dashboard session auth when dashboard auth is active.
 * @param {import("../storage.js").Storage} storage
 */
export function createCliToolsRouter(storage) {
  const router = express.Router();
  router.use("/cli-tools", createDashboardAuthMiddleware(storage));

  router.get("/cli-tools/statuses", (req, res) => {
    try {
      const statuses = getAllCliToolStatuses(extractCliToolsOptions(req));
      return res.json({ statuses });
    } catch (err) {
      return res
        .status(Number(err?.status) || 500)
        .json({ error: err?.message || "Failed to inspect CLI tools" });
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
        .json({ error: err?.message || "Failed to read CLI tool configuration" });
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
        .json({ error: err?.message || "Failed to apply CLI tool configuration" });
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
        .json({ error: err?.message || "Failed to reset CLI tool configuration" });
    }
  });

  return router;
}

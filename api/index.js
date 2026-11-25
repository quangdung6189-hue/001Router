import { createApp, shouldEnforcePasswordChange } from "../server/index.js";

let appPromise = null;
let lastPgSyncAt = 0;
const V1_PG_SYNC_TTL_MS = 1500;

function getApp() {
  if (!appPromise) {
    appPromise = createApp({
      host: process.env.HOST || "127.0.0.1",
      enforceBindCheck: false,
      enforcePasswordChange: shouldEnforcePasswordChange()
    }).catch((err) => {
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req, res) {
  const app = await getApp();
  if (app?.storage?.pgPool) {
    const url = String(req?.url || "");
    const isHotV1 = url.startsWith("/v1/") || url.startsWith("/v1beta/");
    const now = Date.now();
    if (!isHotV1 || now - lastPgSyncAt >= V1_PG_SYNC_TTL_MS) {
      await app.storage.refreshFromPostgres();
      lastPgSyncAt = Date.now();
    }
  }
  return app(req, res);
}

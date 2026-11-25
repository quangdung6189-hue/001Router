import { createApp, shouldEnforcePasswordChange } from "../server/index.js";

let appPromise = null;

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
    await app.storage.refreshFromPostgres();
  }
  return app(req, res);
}

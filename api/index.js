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
  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      res.off("finish", onDone);
      res.off("close", onDone);
      res.off("error", onError);
    };
    const onDone = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (res.headersSent || res.writableEnded) {
        resolve();
      } else {
        reject(err);
      }
    };
    res.once("finish", onDone);
    res.once("close", onDone);
    res.once("error", onError);
    app(req, res, (err) => {
      if (err) onError(err);
      else if (res.writableEnded) onDone();
    });
  });
  if (typeof app?.storage?.flushDeferred === "function") {
    await app.storage.flushDeferred().catch(() => {});
  }
}

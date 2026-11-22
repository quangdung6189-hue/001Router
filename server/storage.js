import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { Pool } from "pg";
import { maskKey } from "./auth.js";
import {
  decryptSecret,
  deriveRouterKeyFields,
  encryptSecret,
  isEncrypted,
  loadOrCreateMasterKey
} from "./security/crypto.js";
import { redactSecrets } from "./security/redact.js";

export const MAX_LOGS = 5000;
export const DEFAULT_PORT = 20128;

const DEFAULT_DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "001router-data")
  : path.resolve(import.meta.dirname, "../data");

/**
 * Create a default initial database object on first boot.
 * @param {number} port
 */
async function createInitialData(port = DEFAULT_PORT) {
  const now = new Date().toISOString();
  const defaultKeyId = nanoid();
  const defaultKeyValue = `sk-001r-${nanoid(24)}`;
  const { keyHash, prefix, last4 } = deriveRouterKeyFields(defaultKeyValue);
  const passwordHash = await bcrypt.hash("1234", 10);

  const initial = {
    version: 1,
    passwordHash,
    sessionSecret: crypto.randomBytes(32).toString("hex"),
    sessionVersion: 1,
    settings: {
      timeoutMs: 120000,
      tokenSaverEnabled: true,
      tokenSaverMaxChars: 20000,
      cavemanEnabled: false,
      cavemanLevel: "full",
      ponytailEnabled: false,
      ponytailLevel: "full",
      customPromptEnabled: false,
      customPrompt: "",
      headroomEnabled: false,
      headroomUrl: "http://localhost:8787",
      headroomTimeoutMs: 3000,
      capacityAdapter: {
        vision: { enabled: false, roundRobin: false, models: [] },
        audioInput: { enabled: false, roundRobin: false, models: [] }
      },
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 3,
      enableTranslator: true,
      requireLogin: true,
      catalogAutoSync: true,
      requireKey: true,
      port
    },
    providers: [],
    combos: [],
    modelAliases: {},
    disabledModels: {},
    customPricing: {},
    quotas: {},
    proxyPools: [],
    keys: [
      {
        id: defaultKeyId,
        name: "Default Key",
        keyHash,
        prefix,
        last4,
        keyPreview: maskKey(defaultKeyValue),
        enabled: true,
        requestCount: 0,
        lastUsedAt: null,
        createdAt: now
      }
    ],
    logs: []
  };

  Object.defineProperty(initial, "_initialPlaintextKey", {
    value: {
      id: defaultKeyId,
      name: "Default Key",
      key: defaultKeyValue,
      keyPreview: maskKey(defaultKeyValue)
    },
    enumerable: false,
    configurable: true
  });

  return initial;
}

/**
 * Atomic file rename with tiny retry on transient Windows file locks.
 * @param {string} src
 * @param {string} dest
 */
async function atomicRename(src, dest) {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err) {
      const retryable =
        err && (err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES");
      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 15 * attempt));
    }
  }
}

export class Storage {
  /**
   * @param {{ dataDir?: string, port?: number, bindHost?: string, databaseUrl?: string }} [options]
   */
  constructor(options = {}) {
    this.dataDir = options.dataDir ? path.resolve(options.dataDir) : DEFAULT_DATA_DIR;
    this.dbPath = path.join(this.dataDir, "db.json");
    this.port = Number(options.port) || DEFAULT_PORT;
    this.bindHost = options.bindHost || process.env.HOST || "127.0.0.1";
    this.databaseUrl =
      typeof options.databaseUrl === "string"
        ? options.databaseUrl.trim()
        : !options.dataDir
          ? String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim()
          : "";
    this.pgPool = this.databaseUrl
      ? new Pool({
          connectionString: this.databaseUrl,
          max: 3,
          idleTimeoutMillis: 10000,
          ssl: /sslmode=disable|localhost|127\.0\.0\.1/i.test(this.databaseUrl)
            ? undefined
            : { rejectUnauthorized: false }
        })
      : null;
    this.data = null;
    this.masterKey = null;
    this._isDefaultPassword = true;
    this._initialRouterKey = null;
    this._lastSecurityScan = null;
    this._writeQueue = Promise.resolve();
  }

  async _ensurePgTable() {
    if (!this.pgPool) return;
    await this.pgPool.query(`
      CREATE TABLE IF NOT EXISTS router001_state (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  /**
   * Initialize storage: load master key, load/migrate state from Postgres (when DATABASE_URL/POSTGRES_URL is set)
   * or local db.json atomically.
   */
  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    this.masterKey = await loadOrCreateMasterKey(this.dataDir);
    let loaded = null;
    let needsSave = false;

    if (this.pgPool) {
      await this._ensurePgTable();
      const res = await this.pgPool.query(
        "SELECT payload FROM router001_state WHERE id = 'primary' LIMIT 1"
      );
      if (res.rows[0]?.payload) {
        try {
          loaded = JSON.parse(res.rows[0].payload);
        } catch {
          loaded = null;
        }
      }
      if (!loaded) {
        loaded = await createInitialData(this.port);
        if (loaded._initialPlaintextKey) {
          this._initialRouterKey = loaded._initialPlaintextKey;
        }
        needsSave = true;
      }
    } else {
      try {
        const raw = await fs.readFile(this.dbPath, "utf8");
        loaded = JSON.parse(raw);
      } catch (err) {
        if (err && err.code !== "ENOENT") {
          // Backup corrupted file if unreadable JSON before reinitializing
          try {
            const backupPath = `${this.dbPath}.corrupt.${Date.now()}`;
            await fs.rename(this.dbPath, backupPath);
          } catch {
            // ignore backup failure
          }
        }
        loaded = await createInitialData(this.port);
        if (loaded._initialPlaintextKey) {
          this._initialRouterKey = loaded._initialPlaintextKey;
        }
        needsSave = true;
      }
    }

    // Ensure all expected fields exist cleanly
    if (!loaded || typeof loaded !== "object") {
      loaded = await createInitialData(this.port);
      if (loaded._initialPlaintextKey) {
        this._initialRouterKey = loaded._initialPlaintextKey;
      }
      needsSave = true;
    }
    if (!loaded.passwordHash) {
      loaded.passwordHash = await bcrypt.hash("1234", 10);
      needsSave = true;
    }
    if (!loaded.sessionSecret) {
      loaded.sessionSecret = crypto.randomBytes(32).toString("hex");
      needsSave = true;
    }
    if (typeof loaded.sessionVersion !== "number" || loaded.sessionVersion < 1) {
      loaded.sessionVersion = 1;
      needsSave = true;
    }
    if (!loaded.settings || typeof loaded.settings !== "object") {
      loaded.settings = {
        timeoutMs: 120000,
        tokenSaverEnabled: true,
        tokenSaverMaxChars: 20000,
        cavemanEnabled: false,
        cavemanLevel: "full",
        catalogAutoSync: true,
        requireKey: true,
        port: this.port
      };
      needsSave = true;
    } else {
      if (typeof loaded.settings.timeoutMs !== "number") {
        loaded.settings.timeoutMs = 120000;
        needsSave = true;
      }
      if (typeof loaded.settings.tokenSaverEnabled !== "boolean") {
        loaded.settings.tokenSaverEnabled = true;
        needsSave = true;
      }
      if (typeof loaded.settings.tokenSaverMaxChars !== "number") {
        loaded.settings.tokenSaverMaxChars = 20000;
        needsSave = true;
      }
      if (typeof loaded.settings.requireKey !== "boolean") {
        loaded.settings.requireKey = true;
        needsSave = true;
      }
      if (typeof loaded.settings.cavemanEnabled !== "boolean") {
        loaded.settings.cavemanEnabled = false;
        needsSave = true;
      }
      if (!["lite", "full", "ultra", "wenyan-lite", "wenyan", "wenyan-ultra"].includes(loaded.settings.cavemanLevel)) {
        loaded.settings.cavemanLevel = "full";
        needsSave = true;
      }
      if (typeof loaded.settings.ponytailEnabled !== "boolean") {
        loaded.settings.ponytailEnabled = false;
        needsSave = true;
      }
      if (!["lite", "full", "ultra"].includes(loaded.settings.ponytailLevel)) {
        loaded.settings.ponytailLevel = "full";
        needsSave = true;
      }
      if (typeof loaded.settings.customPromptEnabled !== "boolean") {
        loaded.settings.customPromptEnabled = false;
        needsSave = true;
      }
      if (typeof loaded.settings.customPrompt !== "string") {
        loaded.settings.customPrompt = "";
        needsSave = true;
      }
      if (typeof loaded.settings.headroomEnabled !== "boolean") {
        loaded.settings.headroomEnabled = false;
        needsSave = true;
      }
      if (typeof loaded.settings.headroomUrl !== "string") {
        loaded.settings.headroomUrl = "http://localhost:8787";
        needsSave = true;
      }
      if (typeof loaded.settings.headroomTimeoutMs !== "number") {
        loaded.settings.headroomTimeoutMs = 3000;
        needsSave = true;
      }
      if (!loaded.settings.capacityAdapter || typeof loaded.settings.capacityAdapter !== "object") {
        loaded.settings.capacityAdapter = {
          vision: { enabled: false, roundRobin: false, models: [] },
          audioInput: { enabled: false, roundRobin: false, models: [] }
        };
        needsSave = true;
      }
      if (!["fill-first", "round-robin", "sticky-round-robin"].includes(loaded.settings.fallbackStrategy)) {
        loaded.settings.fallbackStrategy = "round-robin";
        needsSave = true;
      }
      if (typeof loaded.settings.stickyRoundRobinLimit !== "number" || loaded.settings.stickyRoundRobinLimit < 1) {
        loaded.settings.stickyRoundRobinLimit = 3;
        needsSave = true;
      }
      if (typeof loaded.settings.enableTranslator !== "boolean") {
        loaded.settings.enableTranslator = true;
        needsSave = true;
      }
      if (typeof loaded.settings.requireLogin !== "boolean") {
        loaded.settings.requireLogin = true;
        needsSave = true;
      }
      if (typeof loaded.settings.catalogAutoSync !== "boolean") {
        loaded.settings.catalogAutoSync = true;
        needsSave = true;
      }
      if (loaded.settings.port !== this.port) {
        loaded.settings.port = this.port;
        needsSave = true;
      }
    }

    if (!Array.isArray(loaded.providers)) {
      loaded.providers = [];
      needsSave = true;
    }
    if (!Array.isArray(loaded.combos)) {
      loaded.combos = [];
      needsSave = true;
    }
    if (!loaded.modelAliases || typeof loaded.modelAliases !== "object" || Array.isArray(loaded.modelAliases)) {
      loaded.modelAliases = {};
      needsSave = true;
    }
    if (!loaded.disabledModels || typeof loaded.disabledModels !== "object" || Array.isArray(loaded.disabledModels)) {
      loaded.disabledModels = {};
      needsSave = true;
    }
    if (!loaded.customPricing || typeof loaded.customPricing !== "object" || Array.isArray(loaded.customPricing)) {
      loaded.customPricing = {};
      needsSave = true;
    }
    if (!loaded.quotas || typeof loaded.quotas !== "object" || Array.isArray(loaded.quotas)) {
      loaded.quotas = {};
      needsSave = true;
    }
    if (!Array.isArray(loaded.proxyPools)) {
      loaded.proxyPools = [];
      needsSave = true;
    }
    if (!Array.isArray(loaded.keys)) {
      const now = new Date().toISOString();
      const defaultKeyId = nanoid();
      const defaultKeyValue = `sk-001r-${nanoid(24)}`;
      const { keyHash, prefix, last4 } = deriveRouterKeyFields(defaultKeyValue);
      loaded.keys = [
        {
          id: defaultKeyId,
          name: "Default Key",
          keyHash,
          prefix,
          last4,
          keyPreview: maskKey(defaultKeyValue),
          enabled: true,
          requestCount: 0,
          lastUsedAt: null,
          createdAt: now
        }
      ];
      this._initialRouterKey = {
        id: defaultKeyId,
        name: "Default Key",
        key: defaultKeyValue,
        keyPreview: maskKey(defaultKeyValue)
      };
      needsSave = true;
    }

    // Transparent migration of legacy plaintext provider keys, service account JSONs, proxy URLs, and router keys
    for (const provider of loaded.providers) {
      if (!provider || !Array.isArray(provider.apiKeys)) continue;
      for (const keyEntry of provider.apiKeys) {
        if (!keyEntry || typeof keyEntry !== "object") continue;
        if (typeof keyEntry.key === "string" && keyEntry.key) {
          if (isEncrypted(keyEntry.key)) {
            keyEntry.key = decryptSecret(keyEntry.key, this.masterKey);
          } else {
            // Legacy plaintext key found on disk: mark for immediate encrypted re-save
            needsSave = true;
          }
        }
        if (typeof keyEntry.serviceAccountJson === "string" && keyEntry.serviceAccountJson) {
          if (isEncrypted(keyEntry.serviceAccountJson)) {
            keyEntry.serviceAccountJson = decryptSecret(
              keyEntry.serviceAccountJson,
              this.masterKey
            );
          } else {
            // Unencrypted service account JSON found on disk: mark for immediate encrypted re-save
            needsSave = true;
          }
        }
        if (typeof keyEntry.oauthCredentials === "string" && keyEntry.oauthCredentials) {
          if (isEncrypted(keyEntry.oauthCredentials)) {
            keyEntry.oauthCredentials = decryptSecret(
              keyEntry.oauthCredentials,
              this.masterKey
            );
          } else {
            // Unencrypted OAuth credentials found on disk: mark for immediate encrypted re-save
            needsSave = true;
          }
        } else if (
          keyEntry.oauthCredentials &&
          typeof keyEntry.oauthCredentials === "object"
        ) {
          keyEntry.oauthCredentials = JSON.stringify(keyEntry.oauthCredentials);
          needsSave = true;
        }
      }
    }

    for (const pool of loaded.proxyPools) {
      if (!pool || typeof pool.url !== "string" || !pool.url) continue;
      if (isEncrypted(pool.url)) {
        pool.url = decryptSecret(pool.url, this.masterKey);
      } else {
        needsSave = true;
      }
    }

    for (const keyObj of loaded.keys) {
      if (!keyObj || typeof keyObj !== "object") continue;
      if (typeof keyObj.key === "string" && keyObj.key.trim()) {
        const rawKey = keyObj.key.trim();
        const { keyHash, prefix, last4 } = deriveRouterKeyFields(rawKey);
        keyObj.keyHash = keyHash;
        keyObj.prefix = keyObj.prefix || prefix;
        keyObj.last4 = keyObj.last4 || last4;
        keyObj.keyPreview = keyObj.keyPreview || maskKey(rawKey);
        if (!this._initialRouterKey) {
          this._initialRouterKey = {
            id: keyObj.id,
            name: keyObj.name || "Default Key",
            key: rawKey,
            keyPreview: keyObj.keyPreview
          };
        }
        delete keyObj.key;
        needsSave = true;
      }
    }

    if (!Array.isArray(loaded.logs)) {
      loaded.logs = [];
      needsSave = true;
    } else if (loaded.logs.length > MAX_LOGS) {
      loaded.logs = loaded.logs.slice(0, MAX_LOGS);
      needsSave = true;
    }

    try {
      this._isDefaultPassword = await bcrypt.compare("1234", loaded.passwordHash);
    } catch {
      this._isDefaultPassword = false;
    }

    this.data = loaded;
    if (needsSave) {
      await this._persist();
    }
  }

  /**
   * Normalize in-memory state (ensuring in-memory provider keys/proxy URLs are decrypted
   * and router keys are hashed) and return a disk-ready clone where all provider keys
   * and proxy URLs are AES-256-GCM encrypted (`enc:v1:<iv>:<tag>:<ciphertext>`)
   * and no plaintext router keys exist.
   */
  _prepareDiskPayload() {
    const data = this.data;
    if (!data || typeof data !== "object") return "{}";

    // Normalize in-memory state first
    if (Array.isArray(data.providers)) {
      for (const p of data.providers) {
        if (!p || !Array.isArray(p.apiKeys)) continue;
        for (const k of p.apiKeys) {
          if (!k || typeof k !== "object") continue;
          if (typeof k.key === "string" && isEncrypted(k.key)) {
            k.key = decryptSecret(k.key, this.masterKey);
          }
          if (typeof k.serviceAccountJson === "string" && isEncrypted(k.serviceAccountJson)) {
            k.serviceAccountJson = decryptSecret(k.serviceAccountJson, this.masterKey);
          }
          if (typeof k.oauthCredentials === "string" && isEncrypted(k.oauthCredentials)) {
            k.oauthCredentials = decryptSecret(k.oauthCredentials, this.masterKey);
          } else if (k.oauthCredentials && typeof k.oauthCredentials === "object") {
            k.oauthCredentials = JSON.stringify(k.oauthCredentials);
          }
        }
      }
    }

    if (Array.isArray(data.proxyPools)) {
      for (const pool of data.proxyPools) {
        if (pool && typeof pool.url === "string" && isEncrypted(pool.url)) {
          pool.url = decryptSecret(pool.url, this.masterKey);
        }
      }
    }

    if (Array.isArray(data.keys)) {
      for (const k of data.keys) {
        if (k && typeof k.key === "string" && k.key.trim()) {
          const rawKey = k.key.trim();
          const { keyHash, prefix, last4 } = deriveRouterKeyFields(rawKey);
          k.keyHash = keyHash;
          k.prefix = k.prefix || prefix;
          k.last4 = k.last4 || last4;
          k.keyPreview = k.keyPreview || maskKey(rawKey);
          delete k.key;
        }
      }
    }

    // Build encrypted disk clone
    const diskClone = {
      ...data,
      providers: Array.isArray(data.providers)
        ? data.providers.map((p) => ({
            ...p,
            apiKeys: Array.isArray(p.apiKeys)
              ? p.apiKeys.map((k) => {
                  const cloned = {
                    ...k,
                    key:
                      typeof k.key === "string" && k.key
                        ? encryptSecret(k.key, this.masterKey)
                        : ""
                  };
                  if (typeof k.serviceAccountJson === "string" && k.serviceAccountJson) {
                    cloned.serviceAccountJson = encryptSecret(
                      k.serviceAccountJson,
                      this.masterKey
                    );
                  }
                  if (typeof k.oauthCredentials === "string" && k.oauthCredentials) {
                    cloned.oauthCredentials = encryptSecret(
                      k.oauthCredentials,
                      this.masterKey
                    );
                  }
                  return cloned;
                })
              : []
          }))
        : [],
      proxyPools: Array.isArray(data.proxyPools)
        ? data.proxyPools.map((pool) => ({
            ...pool,
            url:
              typeof pool.url === "string" && pool.url
                ? encryptSecret(pool.url, this.masterKey)
                : ""
          }))
        : [],
      keys: Array.isArray(data.keys)
        ? data.keys.map((k) => {
            const copy = { ...k };
            delete copy.key;
            return copy;
          })
        : []
    };

    return JSON.stringify(diskClone, null, 2);
  }

  async _writePayload(payload) {
    if (this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO router001_state (id, payload, updated_at)
         VALUES ('primary', $1, NOW())
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [payload]
      );
      return;
    }

    await fs.mkdir(this.dataDir, { recursive: true });
    const tmpPath = `${this.dbPath}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 8)}.tmp`;
    try {
      await fs.writeFile(tmpPath, payload, "utf8");
      await atomicRename(tmpPath, this.dbPath);
    } catch (err) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        // ignore cleanup failure
      }
      throw err;
    }
  }

  /**
   * Persist current in-memory data atomically via Postgres or temp file + rename on a serialized queue.
   * @returns {Promise<void>}
   */
  _persist() {
    const task = this._writeQueue.then(async () => {
      const payload = this._prepareDiskPayload();
      await this._writePayload(payload);
    });
    this._writeQueue = task.catch(() => {});
    return task;
  }

  /**
   * Run a serialized mutation on the database state and persist atomically.
   * @template T
   * @param {(data: any) => T | Promise<T>} mutator
   * @returns {Promise<T>}
   */
  update(mutator) {
    const task = this._writeQueue.then(async () => {
      const result = await mutator(this.data);
      const payload = this._prepareDiskPayload();
      await this._writePayload(payload);
      return result;
    });
    this._writeQueue = task.catch(() => {});
    return task;
  }

  encryptSecret(plaintext) {
    return encryptSecret(plaintext, this.masterKey);
  }

  decryptSecret(ciphertext) {
    return decryptSecret(ciphertext, this.masterKey);
  }

  getSessionSecret() {
    return this.data?.sessionSecret || "";
  }

  getSessionVersion() {
    return Number(this.data?.sessionVersion) || 1;
  }

  async bumpSessionVersion() {
    return this.update((data) => {
      data.sessionVersion = (Number(data.sessionVersion) || 1) + 1;
      return data.sessionVersion;
    });
  }

  getPasswordHash() {
    return this.data?.passwordHash || "";
  }

  isDefaultPasswordSync() {
    return Boolean(this._isDefaultPassword);
  }

  async isDefaultPassword() {
    return Boolean(this._isDefaultPassword);
  }

  async setPasswordHash(hash) {
    let isDefault = false;
    try {
      isDefault = await bcrypt.compare("1234", hash);
    } catch {
      isDefault = false;
    }
    return this.update((data) => {
      data.passwordHash = hash;
      data.sessionVersion = (Number(data.sessionVersion) || 1) + 1;
      this._isDefaultPassword = isDefault;
    });
  }

  peekInitialRouterKey() {
    return this._initialRouterKey;
  }

  consumeInitialRouterKey() {
    const key = this._initialRouterKey;
    this._initialRouterKey = null;
    return key;
  }

  getLastSecurityScan() {
    return this._lastSecurityScan;
  }

  setLastSecurityScan(scan) {
    this._lastSecurityScan = scan;
  }

  getSettings() {
    return { ...this.data.settings };
  }

  async updateSettings(partial) {
    return this.update((data) => {
      data.settings = {
        ...data.settings,
        ...partial,
        port: data.settings.port
      };
      return { ...data.settings };
    });
  }

  getProviders() {
    return this.data.providers;
  }

  getProviderById(id) {
    return this.data.providers.find((p) => p.id === id) || null;
  }

  getProviderBySlug(slug) {
    return this.data.providers.find((p) => p.slug === slug) || null;
  }

  getCombos() {
    return this.data.combos;
  }

  getModelAliases() {
    return { ...(this.data.modelAliases || {}) };
  }

  async setModelAlias(alias, target) {
    return this.update((data) => {
      if (!data.modelAliases || typeof data.modelAliases !== "object") data.modelAliases = {};
      data.modelAliases[alias] = target;
      return { ...data.modelAliases };
    });
  }

  async deleteModelAlias(alias) {
    return this.update((data) => {
      if (!data.modelAliases || typeof data.modelAliases !== "object") return false;
      if (!Object.prototype.hasOwnProperty.call(data.modelAliases, alias)) return false;
      delete data.modelAliases[alias];
      return true;
    });
  }

  getDisabledModels() {
    const out = {};
    for (const [k, v] of Object.entries(this.data.disabledModels || {})) {
      out[k] = Array.isArray(v) ? [...v] : [];
    }
    return out;
  }

  isModelDisabled(providerSlug, modelId) {
    const list = this.data.disabledModels?.[providerSlug];
    return Array.isArray(list) && list.includes(modelId);
  }

  async disableModels(providerSlug, modelIds) {
    return this.update((data) => {
      if (!data.disabledModels || typeof data.disabledModels !== "object") data.disabledModels = {};
      const prev = Array.isArray(data.disabledModels[providerSlug]) ? data.disabledModels[providerSlug] : [];
      data.disabledModels[providerSlug] = [...new Set([...prev, ...modelIds])];
      return [...data.disabledModels[providerSlug]];
    });
  }

  async enableModel(providerSlug, modelId) {
    return this.update((data) => {
      if (!data.disabledModels || !Array.isArray(data.disabledModels[providerSlug])) return [];
      data.disabledModels[providerSlug] = data.disabledModels[providerSlug].filter((id) => id !== modelId);
      if (data.disabledModels[providerSlug].length === 0) {
        delete data.disabledModels[providerSlug];
        return [];
      }
      return [...data.disabledModels[providerSlug]];
    });
  }

  getCustomPricing() {
    const out = {};
    for (const [prov, models] of Object.entries(this.data.customPricing || {})) {
      out[prov] = { ...(models || {}) };
    }
    return out;
  }

  async setCustomPricing(providerSlug, modelId, rate) {
    return this.update((data) => {
      if (!data.customPricing || typeof data.customPricing !== "object") data.customPricing = {};
      if (!data.customPricing[providerSlug]) data.customPricing[providerSlug] = {};
      data.customPricing[providerSlug][modelId] = rate;
      return { ...data.customPricing[providerSlug][modelId] };
    });
  }

  async resetCustomPricing(providerSlug = "", modelId = "") {
    return this.update((data) => {
      if (!data.customPricing || typeof data.customPricing !== "object") data.customPricing = {};
      if (!providerSlug) {
        data.customPricing = {};
      } else if (!modelId) {
        delete data.customPricing[providerSlug];
      } else if (data.customPricing[providerSlug]) {
        delete data.customPricing[providerSlug][modelId];
        if (Object.keys(data.customPricing[providerSlug]).length === 0) {
          delete data.customPricing[providerSlug];
        }
      }
      return true;
    });
  }

  getProxyPools() {
    return this.data.proxyPools || [];
  }

  getQuotas() {
    return this.data.quotas || {};
  }

  getQuota(providerId) {
    return this.data.quotas?.[providerId] || null;
  }

  async setQuota(providerId, budget) {
    return this.update((data) => {
      if (!data.quotas || typeof data.quotas !== "object" || Array.isArray(data.quotas)) {
        data.quotas = {};
      }
      data.quotas[providerId] = {
        dailyTokenLimit: budget.dailyTokenLimit ?? null,
        dailyRequestLimit: budget.dailyRequestLimit ?? null,
        monthlyTokenLimit: budget.monthlyTokenLimit ?? null
      };
      return { ...data.quotas[providerId] };
    });
  }

  getKeys() {
    return this.data.keys;
  }

  getLogs() {
    return this.data.logs;
  }

  /**
   * Prepend a request log entry and enforce the 5000-entry retention cap.
   * Never stores prompt/response bodies or headers; passes error strings through the redactor.
   * Also optionally updates router key requestCount and lastUsedAt in the same atomic write.
   * @param {any} entry
   * @param {string | null} [usedKeyId]
   */
  async recordRequestLog(entry, usedKeyId = null) {
    return this.update((data) => {
      const secrets = [];
      for (const p of data.providers || []) {
        for (const k of p.apiKeys || []) {
          if (k?.key) secrets.push(k.key);
          if (typeof k?.serviceAccountJson === "string" && k.serviceAccountJson) {
            secrets.push(k.serviceAccountJson);
            try {
              const sa = JSON.parse(k.serviceAccountJson);
              if (sa?.private_key) secrets.push(sa.private_key);
            } catch {
              // ignore non-JSON
            }
          }
          if (typeof k?.oauthCredentials === "string" && k.oauthCredentials) {
            secrets.push(k.oauthCredentials);
            try {
              const oc = JSON.parse(k.oauthCredentials);
              if (oc?.refreshToken) secrets.push(oc.refreshToken);
              if (oc?.clientSecret) secrets.push(oc.clientSecret);
            } catch {
              // ignore non-JSON
            }
          }
        }
      }

      const sanitizedEntry = { ...entry };
      delete sanitizedEntry.prompt;
      delete sanitizedEntry.messages;
      delete sanitizedEntry.body;
      delete sanitizedEntry.requestBody;
      delete sanitizedEntry.responseBody;
      delete sanitizedEntry.headers;
      delete sanitizedEntry.requestHeaders;
      delete sanitizedEntry.responseHeaders;

      if (typeof sanitizedEntry.error === "string" && sanitizedEntry.error) {
        sanitizedEntry.error = redactSecrets(sanitizedEntry.error, secrets);
      }

      if (Array.isArray(sanitizedEntry.attemptTrail)) {
        sanitizedEntry.attemptTrail = sanitizedEntry.attemptTrail.map((hop) => {
          if (!hop || typeof hop !== "object") return hop;
          const cleanHop = {
            target: hop.target || "",
            providerSlug: hop.providerSlug || null,
            model: hop.model || "",
            keyId: hop.keyId ?? null,
            status: hop.status ?? 0,
            latencyMs: hop.latencyMs ?? 0
          };
          if (typeof hop.error === "string" && hop.error) {
            cleanHop.error = redactSecrets(hop.error, secrets);
          }
          return cleanHop;
        });
      }

      data.logs.unshift(sanitizedEntry);
      if (data.logs.length > MAX_LOGS) {
        data.logs.length = MAX_LOGS;
      }
      if (usedKeyId) {
        const keyObj = data.keys.find((k) => k.id === usedKeyId);
        if (keyObj) {
          keyObj.requestCount = (keyObj.requestCount || 0) + 1;
          keyObj.lastUsedAt = sanitizedEntry.timestamp || new Date().toISOString();
        }
      }
    });
  }

  async clearLogs() {
    return this.update((data) => {
      data.logs = [];
    });
  }

  async markProviderKeyCooldown(providerId, keyId, cooldownUntil, lastError) {
    return this.update((data) => {
      const provider = data.providers.find((p) => p.id === providerId);
      if (!provider) return;
      const keyEntry = (provider.apiKeys || []).find((k) => k.id === keyId);
      if (!keyEntry) return;
      keyEntry.cooldownUntil = cooldownUntil;
      if (lastError) {
        keyEntry.lastError = lastError;
      }
    });
  }

  async clearProviderKeyCooldown(providerId, keyId) {
    return this.update((data) => {
      const provider = data.providers.find((p) => p.id === providerId);
      if (!provider) return;
      const keyEntry = (provider.apiKeys || []).find((k) => k.id === keyId);
      if (!keyEntry) return;
      if (keyEntry.cooldownUntil || keyEntry.lastError) {
        keyEntry.cooldownUntil = null;
        delete keyEntry.lastError;
      }
    });
  }
}

/**
 * Create and initialize a Storage instance.
 * @param {{ dataDir?: string, port?: number }} [options]
 */
export async function createStorage(options = {}) {
  const storage = new Storage(options);
  await storage.init();
  return storage;
}

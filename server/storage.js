import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { Pool } from "pg";
import { maskKey } from "./auth.js";
import {
  MASTER_KEY_FILENAME,
  decryptSecret,
  deriveDatabaseMasterKey,
  deriveRouterKeyFields,
  encryptSecret,
  isEncrypted,
  loadOrCreateMasterKey,
  normalizeMasterKeyBuffer
} from "./security/crypto.js";
import { isSafePropertyKey, redactSecrets } from "./security/redact.js";

export const MAX_LOGS = 5000;
/** Debounce / max-wait for coalesced hot-path persistence (request logs, cooldown clears). */
export const DEFERRED_PERSIST_MS = 250;
export const DEFERRED_PERSIST_MAX_MS = 2000;
export const DEFAULT_PORT = 20128;

const DEFAULT_DATA_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), "001router-data")
  : path.resolve(import.meta.dirname, "../data");

function resolveDatabaseUrlFromEnv() {
  const priorityKeys = [
    "DATABASE_URL",
    "POSTGRES_URL",
    "STORAGE_POSTGRES_URL",
    "SUPABASE_POSTGRES_URL",
    "POSTGRES_PRISMA_URL",
    "STORAGE_POSTGRES_PRISMA_URL",
    "POSTGRES_URL_NON_POOLING",
    "STORAGE_POSTGRES_URL_NON_POOLING"
  ];
  for (const key of priorityKeys) {
    const val = process.env[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (/_(POSTGRES_URL|DATABASE_URL)$/.test(k) && typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return "";
}

function buildPgPoolConfig(rawUrl) {
  let cleanUrl = rawUrl;
  let disableSsl = /sslmode=disable|localhost|127\.0\.0\.1/i.test(rawUrl);
  try {
    const parsed = new URL(rawUrl);
    const mode = (parsed.searchParams.get("sslmode") || "").toLowerCase();
    if (mode === "disable") {
      disableSsl = true;
    } else if (mode) {
      // Strip sslmode so pg-connection-string doesn't force strict verify on Supabase Pooler certs
      parsed.searchParams.delete("sslmode");
      cleanUrl = parsed.toString();
    }
  } catch {
    // Keep rawUrl if non-standard URI
  }
  return {
    connectionString: cleanUrl,
    max: 3,
    idleTimeoutMillis: 10000,
    ...(disableSsl ? {} : { ssl: { rejectUnauthorized: false } })
  };
}

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
          ? resolveDatabaseUrlFromEnv()
          : "";
    this.pgPool = this.databaseUrl ? new Pool(buildPgPoolConfig(this.databaseUrl)) : null;
    this.data = null;
    this.masterKey = null;
    /** @type {Buffer[]} */
    this.fallbackMasterKeys = [];
    this._isDefaultPassword = true;
    this._initialRouterKey = null;
    this._lastSecurityScan = null;
    this._writeQueue = Promise.resolve();
    // Coalesced background persistence for hot-path writes (request logs, cooldown clears).
    this._deferredTimer = null;
    this._deferredFirstAt = 0;
    this._deferredWaiters = [];
    this._pgUpdatedAt = 0;
    this._lastPgPayload = "";
    this._pgSyncInFlight = null;
    this._lastCheckedPasswordHash = null;
    this._dirEnsured = false;
    /** @type {string[] | null} */
    this._redactionSecretsCache = null;
    this._customPricingVersion = 0;
    /** @type {Map<string, any> | null} */
    this._providersById = null;
    /** @type {Map<string, any> | null} */
    this._providersBySlug = null;
    /** @type {Map<string, any> | null} */
    this._keysByHash = null;
  }

  _invalidateIndexes() {
    this._providersById = null;
    this._providersBySlug = null;
    this._keysByHash = null;
    this._redactionSecretsCache = null;
  }

  _ensureProviderIndexes() {
    if (this._providersById && this._providersBySlug) return;
    const byId = new Map();
    const bySlug = new Map();
    for (const p of this.data?.providers || []) {
      if (p?.id) byId.set(p.id, p);
      if (p?.slug) bySlug.set(p.slug, p);
    }
    this._providersById = byId;
    this._providersBySlug = bySlug;
  }

  getKeysByHashIndex() {
    if (!this._keysByHash) {
      const map = new Map();
      for (const k of this.data?.keys || []) {
        if (k && k.enabled !== false && typeof k.keyHash === "string" && k.keyHash) {
          map.set(k.keyHash, k);
        }
      }
      this._keysByHash = map;
    }
    return this._keysByHash;
  }

  getCustomPricingVersion() {
    return this._customPricingVersion;
  }

  getRedactionSecrets() {
    if (this._redactionSecretsCache) return this._redactionSecretsCache;
    const secrets = [];
    for (const p of this.data?.providers || []) {
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
            if (oc?.accessToken) secrets.push(oc.accessToken);
          } catch {
            // ignore non-JSON
          }
        }
      }
    }
    this._redactionSecretsCache = secrets;
    return secrets;
  }

  _safeDecryptSecret(value) {
    if (typeof value !== "string" || !value) {
      return { plaintext: "", ok: true, migrated: false };
    }
    if (!isEncrypted(value)) {
      return { plaintext: value, ok: true, migrated: true };
    }
    try {
      return { plaintext: decryptSecret(value, this.masterKey), ok: true, migrated: false };
    } catch {
      for (const fbKey of this.fallbackMasterKeys || []) {
        try {
          return { plaintext: decryptSecret(value, fbKey), ok: true, migrated: true };
        } catch {
          // Try next fallback master key
        }
      }
      return { plaintext: "", ok: false, migrated: false, rawCiphertext: value };
    }
  }

  _decryptField(obj, prop, rawProp) {
    const val = obj[prop];
    if (typeof val !== "string" || !val) return false;
    const res = this._safeDecryptSecret(val);
    obj[prop] = res.plaintext;
    if (!res.ok && res.rawCiphertext) {
      Object.defineProperty(obj, rawProp, {
        value: res.rawCiphertext,
        enumerable: false,
        configurable: true,
        writable: true
      });
    } else if (rawProp in obj) {
      delete obj[rawProp];
    }
    return res.migrated;
  }

  _decryptLoadedSecrets(loaded) {
    let needsSave = false;
    if (!loaded || typeof loaded !== "object") return false;

    if (Array.isArray(loaded.providers)) {
      for (const provider of loaded.providers) {
        if (!provider || !Array.isArray(provider.apiKeys)) continue;
        for (const keyEntry of provider.apiKeys) {
          if (!keyEntry || typeof keyEntry !== "object") continue;
          if (this._decryptField(keyEntry, "key", "_rawEncKey")) {
            needsSave = true;
          }
          if (this._decryptField(keyEntry, "serviceAccountJson", "_rawEncSa")) {
            needsSave = true;
          }
          if (typeof keyEntry.oauthCredentials === "string" && keyEntry.oauthCredentials) {
            if (this._decryptField(keyEntry, "oauthCredentials", "_rawEncOAuth")) {
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
    }

    if (Array.isArray(loaded.proxyPools)) {
      for (const pool of loaded.proxyPools) {
        if (!pool || typeof pool.url !== "string" || !pool.url) continue;
        if (this._decryptField(pool, "url", "_rawEncUrl")) {
          needsSave = true;
        }
      }
    }

    return needsSave;
  }

  async refreshFromPostgres(force = false) {
    if (!this.pgPool) return;
    if (this._pgSyncInFlight) return this._pgSyncInFlight;
    this._pgSyncInFlight = (async () => {
      try {
        const res = await this.pgPool.query(
          "SELECT payload, EXTRACT(EPOCH FROM updated_at) AS ts FROM router001_state WHERE id = 'primary' LIMIT 1"
        );
        const row = res.rows[0];
        if (!row?.payload) return;
        const remoteTs = Number(row.ts) || 0;
        if (!force && row.payload === this._lastPgPayload && this.data) {
          return;
        }
        const parsed = JSON.parse(row.payload);
        if (parsed && typeof parsed === "object") {
          this._decryptLoadedSecrets(parsed);
          this.data = parsed;
          this._lastPgPayload = row.payload;
          this._pgUpdatedAt = remoteTs;
          this._customPricingVersion += 1;
          this._invalidateIndexes();
          const nextPwHash = parsed.passwordHash || "";
          if (nextPwHash !== this._lastCheckedPasswordHash) {
            try {
              this._isDefaultPassword = await bcrypt.compare("1234", nextPwHash);
            } catch {
              this._isDefaultPassword = false;
            }
            this._lastCheckedPasswordHash = nextPwHash;
          }
        }
      } catch {
        // Keep existing in-memory state if transient DB read fails
      } finally {
        this._pgSyncInFlight = null;
      }
    })();
    return this._pgSyncInFlight;
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
    await this.pgPool.query(`
      ALTER TABLE router001_state
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
    // Lock down Supabase public PostgREST API (ANON/authenticated keys get 0 access)
    await this.pgPool.query(`
      DO $$
      BEGIN
        ALTER TABLE router001_state ENABLE ROW LEVEL SECURITY;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END $$;
    `);
  }

  /**
   * Initialize storage: load master key, load/migrate state from Postgres (when DATABASE_URL/POSTGRES_URL is set)
   * or local db.json atomically.
   */
  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    this.masterKey = await loadOrCreateMasterKey(this.dataDir, {
      databaseUrl: this.databaseUrl
    });
    this.fallbackMasterKeys = [];
    const addFallbackKey = (buf) => {
      if (
        Buffer.isBuffer(buf) &&
        buf.length === 32 &&
        !buf.equals(this.masterKey) &&
        !this.fallbackMasterKeys.some((k) => k.equals(buf))
      ) {
        this.fallbackMasterKeys.push(buf);
      }
    };
    if (this.databaseUrl) {
      addFallbackKey(deriveDatabaseMasterKey(this.databaseUrl));
    }
    try {
      const localKeyRaw = await fs.readFile(path.join(this.dataDir, MASTER_KEY_FILENAME), "utf8");
      if (localKeyRaw && localKeyRaw.trim()) {
        addFallbackKey(normalizeMasterKeyBuffer(localKeyRaw.trim()));
      }
    } catch {
      // ignore missing local .master.key
    }

    let loaded = null;
    let needsSave = false;

    if (this.pgPool) {
      await this._ensurePgTable();
      const res = await this.pgPool.query(
        "SELECT payload, EXTRACT(EPOCH FROM updated_at) AS ts FROM router001_state WHERE id = 'primary' LIMIT 1"
      );
      if (res.rows[0]?.payload) {
        try {
          loaded = JSON.parse(res.rows[0].payload);
          this._lastPgPayload = res.rows[0].payload;
          this._pgUpdatedAt = Number(res.rows[0].ts) || 0;
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
    }
    {
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
    if (this._decryptLoadedSecrets(loaded)) {
      needsSave = true;
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
            this._decryptField(k, "key", "_rawEncKey");
          }
          if (typeof k.serviceAccountJson === "string" && isEncrypted(k.serviceAccountJson)) {
            this._decryptField(k, "serviceAccountJson", "_rawEncSa");
          }
          if (typeof k.oauthCredentials === "string" && isEncrypted(k.oauthCredentials)) {
            this._decryptField(k, "oauthCredentials", "_rawEncOAuth");
          } else if (k.oauthCredentials && typeof k.oauthCredentials === "object") {
            k.oauthCredentials = JSON.stringify(k.oauthCredentials);
          }
        }
      }
    }

    if (Array.isArray(data.proxyPools)) {
      for (const pool of data.proxyPools) {
        if (pool && typeof pool.url === "string" && isEncrypted(pool.url)) {
          this._decryptField(pool, "url", "_rawEncUrl");
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

    // Build encrypted disk clone, preserving _rawEnc* if a ciphertext could not be decrypted
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
                    : k._rawEncKey || ""
              };
              if (typeof k.serviceAccountJson === "string" && k.serviceAccountJson) {
                cloned.serviceAccountJson = encryptSecret(k.serviceAccountJson, this.masterKey);
              } else if (k._rawEncSa) {
                cloned.serviceAccountJson = k._rawEncSa;
              }
              if (typeof k.oauthCredentials === "string" && k.oauthCredentials) {
                cloned.oauthCredentials = encryptSecret(k.oauthCredentials, this.masterKey);
              } else if (k._rawEncOAuth) {
                cloned.oauthCredentials = k._rawEncOAuth;
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
              : pool._rawEncUrl || ""
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

    return JSON.stringify(diskClone);
  }

  async _writePayload(payload) {
    if (this.pgPool) {
      const res = await this.pgPool.query(
        `INSERT INTO router001_state (id, payload, updated_at)
         VALUES ('primary', $1, NOW())
         ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
         RETURNING EXTRACT(EPOCH FROM updated_at) AS ts`,
        [payload]
      );
      this._lastPgPayload = payload;
      const writtenTs = Number(res.rows?.[0]?.ts) || 0;
      if (writtenTs) {
        this._pgUpdatedAt = writtenTs;
      }
      return;
    }

    if (!this._dirEnsured) {
      await fs.mkdir(this.dataDir, { recursive: true });
      this._dirEnsured = true;
    }
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
    this._writeQueue = task.catch(() => { });
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
      if (this.pgPool) {
        await this.refreshFromPostgres();
      }
      const result = await mutator(this.data);
      this._invalidateIndexes();
      const payload = this._prepareDiskPayload();
      await this._writePayload(payload);
      return result;
    });
    this._writeQueue = task.catch(() => { });
    return task;
  }

  /**
   * Apply a mutation to in-memory state immediately and persist it on a coalesced timer
   * (DEFERRED_PERSIST_MS debounce, DEFERRED_PERSIST_MAX_MS max wait). Used on the request hot
   * path so a proxied call never waits for a full re-encrypt + JSON.stringify + file write.
   * Postgres (multi-instance) keeps the strict refresh-mutate-write path via update().
   * @template T
   * @param {(data: any) => T} mutator synchronous mutator
   * @returns {Promise<T>} resolves right away with the mutator result
   */
  updateDeferred(mutator) {
    if (this.pgPool) return this.update(mutator);
    const result = mutator(this.data);
    this._invalidateIndexes();
    this._scheduleDeferredPersist();
    return Promise.resolve(result);
  }

  _scheduleDeferredPersist() {
    const now = Date.now();
    if (!this._deferredFirstAt) this._deferredFirstAt = now;
    if (this._deferredTimer) clearTimeout(this._deferredTimer);
    const waited = now - this._deferredFirstAt;
    const delay = waited >= DEFERRED_PERSIST_MAX_MS ? 0 : DEFERRED_PERSIST_MS;
    this._deferredTimer = setTimeout(() => {
      this.flushDeferred().catch(() => {});
    }, delay);
    // Do not keep the process (or test runner) alive just for a pending log write.
    this._deferredTimer.unref?.();
  }

  /**
   * Write any pending deferred mutations now. Safe to call repeatedly.
   * @returns {Promise<void>}
   */
  flushDeferred() {
    if (this._deferredTimer) {
      clearTimeout(this._deferredTimer);
      this._deferredTimer = null;
    }
    if (!this._deferredFirstAt) return this._writeQueue;
    this._deferredFirstAt = 0;
    return this._persist();
  }

  encryptSecret(plaintext) {
    return encryptSecret(plaintext, this.masterKey);
  }

  decryptSecret(ciphertext) {
    try {
      return decryptSecret(ciphertext, this.masterKey);
    } catch (firstErr) {
      for (const fbKey of this.fallbackMasterKeys || []) {
        try {
          return decryptSecret(ciphertext, fbKey);
        } catch {
          // Try next fallback master key
        }
      }
      throw firstErr;
    }
  }

  getSessionSecret() {
    if (typeof process.env.SESSION_SECRET === "string" && process.env.SESSION_SECRET.trim()) {
      return process.env.SESSION_SECRET.trim();
    }
    const hasDeterministicMaster =
      (typeof process.env.ROUTER001_MASTER_KEY === "string" &&
        process.env.ROUTER001_MASTER_KEY.trim()) ||
      Boolean(this.databaseUrl);
    if (hasDeterministicMaster && this.masterKey) {
      return crypto
        .createHmac("sha256", this.masterKey)
        .update("001router-session-secret-v1")
        .digest("hex");
    }
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
    if (!id) return null;
    this._ensureProviderIndexes();
    return this._providersById.get(id) || null;
  }

  getProviderBySlug(slug) {
    if (!slug) return null;
    this._ensureProviderIndexes();
    return this._providersBySlug.get(slug) || null;
  }

  getCombos() {
    return this.data.combos;
  }

  getModelAliases() {
    return { ...(this.data.modelAliases || {}) };
  }

  async setModelAlias(alias, target) {
    if (!isSafePropertyKey(alias)) {
      throw Object.assign(new Error("Invalid alias key"), { status: 400 });
    }
    return this.update((data) => {
      if (!data.modelAliases || typeof data.modelAliases !== "object") data.modelAliases = {};
      data.modelAliases[alias] = target;
      return { ...data.modelAliases };
    });
  }

  async deleteModelAlias(alias) {
    if (!isSafePropertyKey(alias)) return false;
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
    if (!isSafePropertyKey(providerSlug)) return false;
    const list = Object.hasOwn(this.data.disabledModels || {}, providerSlug)
      ? this.data.disabledModels[providerSlug]
      : null;
    return Array.isArray(list) && list.includes(modelId);
  }

  async disableModels(providerSlug, modelIds) {
    if (!isSafePropertyKey(providerSlug)) {
      throw Object.assign(new Error("Invalid provider slug"), { status: 400 });
    }
    return this.update((data) => {
      if (!data.disabledModels || typeof data.disabledModels !== "object") data.disabledModels = {};
      const prev = Array.isArray(data.disabledModels[providerSlug]) ? data.disabledModels[providerSlug] : [];
      data.disabledModels[providerSlug] = [...new Set([...prev, ...modelIds])];
      return [...data.disabledModels[providerSlug]];
    });
  }

  async enableModel(providerSlug, modelId) {
    if (!isSafePropertyKey(providerSlug)) return [];
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
    if (!isSafePropertyKey(providerSlug) || !isSafePropertyKey(modelId)) {
      throw Object.assign(new Error("Invalid provider or model key"), { status: 400 });
    }
    return this.update((data) => {
      if (!data.customPricing || typeof data.customPricing !== "object") data.customPricing = {};
      if (!data.customPricing[providerSlug]) data.customPricing[providerSlug] = {};
      data.customPricing[providerSlug][modelId] = rate;
      this._customPricingVersion += 1;
      return { ...data.customPricing[providerSlug][modelId] };
    });
  }

  async resetCustomPricing(providerSlug = "", modelId = "") {
    if ((providerSlug && !isSafePropertyKey(providerSlug)) || (modelId && !isSafePropertyKey(modelId))) {
      throw Object.assign(new Error("Invalid provider or model key"), { status: 400 });
    }
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
      this._customPricingVersion += 1;
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
    if (!isSafePropertyKey(providerId)) return null;
    return Object.hasOwn(this.data.quotas || {}, providerId) ? this.data.quotas[providerId] : null;
  }

  async setQuota(providerId, budget) {
    if (!isSafePropertyKey(providerId)) {
      throw Object.assign(new Error("Invalid providerId"), { status: 400 });
    }
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
   * Never stores prompt/response bodies or headers; lazily collects redaction secrets ONLY when errors exist.
   * @param {any} entry
   * @param {string | null} [usedKeyId]
   */
  async recordRequestLog(entry, usedKeyId = null) {
    return this.updateDeferred((data) => {
      const sanitizedEntry = { ...entry };
      delete sanitizedEntry.prompt;
      delete sanitizedEntry.messages;
      delete sanitizedEntry.body;
      delete sanitizedEntry.requestBody;
      delete sanitizedEntry.responseBody;
      delete sanitizedEntry.headers;
      delete sanitizedEntry.requestHeaders;
      delete sanitizedEntry.responseHeaders;

      if (typeof sanitizedEntry.requestedModel === "string" && sanitizedEntry.requestedModel.length > 256) {
        sanitizedEntry.requestedModel = sanitizedEntry.requestedModel.slice(0, 256);
      }

      const hasTopError = typeof sanitizedEntry.error === "string" && sanitizedEntry.error.length > 0;
      const hasTrailError =
        Array.isArray(sanitizedEntry.attemptTrail) &&
        sanitizedEntry.attemptTrail.some((h) => h && typeof h.error === "string" && h.error.length > 0);
      const secrets = hasTopError || hasTrailError ? this.getRedactionSecrets() : null;

      if (hasTopError) {
        sanitizedEntry.error = redactSecrets(sanitizedEntry.error, secrets).slice(0, 1024);
      }

      if (Array.isArray(sanitizedEntry.attemptTrail)) {
        const boundedTrail =
          sanitizedEntry.attemptTrail.length > 16
            ? sanitizedEntry.attemptTrail.slice(-16)
            : sanitizedEntry.attemptTrail;
        sanitizedEntry.attemptTrail = boundedTrail.map((hop) => {
          if (!hop || typeof hop !== "object") return hop;
          const cleanHop = {
            target: String(hop.target || "").slice(0, 256),
            providerSlug: hop.providerSlug || null,
            model: String(hop.model || "").slice(0, 256),
            keyId: hop.keyId ?? null,
            status: hop.status ?? 0,
            latencyMs: hop.latencyMs ?? 0
          };
          if (typeof hop.error === "string" && hop.error) {
            cleanHop.error = redactSecrets(hop.error, secrets).slice(0, 512);
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

  async persistProviderKeyOAuthCredentials(keyId, updatedCredentialsJson, expiresAt = 0) {
    if (!keyId || typeof updatedCredentialsJson !== "string" || !updatedCredentialsJson) {
      return false;
    }
    return this.updateDeferred((data) => {
      for (const provider of data.providers || []) {
        const targetKey = (provider?.apiKeys || []).find((k) => k && k.id === keyId);
        if (!targetKey) continue;
        targetKey.oauthCredentials = updatedCredentialsJson;
        if (expiresAt > 0) {
          targetKey.oauthMeta = {
            ...(targetKey.oauthMeta || {}),
            expiresAt: new Date(expiresAt).toISOString()
          };
        }
        return true;
      }
      return false;
    });
  }

  async markProviderKeyCooldown(providerId, keyId, cooldownUntil, lastError) {
    // Hot failover path: update in-memory cooldown immediately and coalesce disk write
    return this.updateDeferred((data) => {
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
    // Hot path: called after every successful upstream call. Skip the DB write entirely when
    // the in-memory key has no cooldown/error to clear (avoids redundant Postgres/disk rewrites).
    const current = this.getProviderById(providerId);
    const currentKey = (current?.apiKeys || []).find((k) => k.id === keyId);
    if (!currentKey || (!currentKey.cooldownUntil && !currentKey.lastError)) {
      return;
    }
    return this.updateDeferred((data) => {
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

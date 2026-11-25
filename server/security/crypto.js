import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

export const ENC_PREFIX = "enc:v1:";
export const MASTER_KEY_FILENAME = ".master.key";

/**
 * Check whether a string value is already encrypted with the v1 AES-256-GCM envelope.
 * Format: `enc:v1:<iv>:<tag>:<ciphertext>`
 * @param {unknown} value
 * @returns {boolean}
 */
export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

/**
 * Normalize an arbitrary key string (hex, base64, or passphrase) into a 32-byte Buffer.
 * @param {string | Buffer} raw
 * @returns {Buffer}
 */
export function normalizeMasterKeyBuffer(raw) {
  if (Buffer.isBuffer(raw)) {
    if (raw.length === 32) return Buffer.from(raw);
    return crypto.createHash("sha256").update(raw).digest();
  }
  const str = String(raw || "").trim();
  if (!str) {
    throw new Error("Empty master key input");
  }
  if (/^[0-9a-fA-F]{64}$/.test(str)) {
    return Buffer.from(str, "hex");
  }
  try {
    const b64 = Buffer.from(str, "base64");
    if (b64.length === 32 && b64.toString("base64").replace(/=+$/, "") === str.replace(/=+$/, "")) {
      return b64;
    }
  } catch {
    // fall through to sha256 derivation
  }
  return crypto.createHash("sha256").update(str, "utf8").digest();
}

/**
 * Deterministically derive a 32-byte master key from a shared database URL when
 * `ROUTER001_MASTER_KEY` is not explicitly configured, so multiple serverless instances
 * sharing the same Postgres DB derive the exact same encryption key.
 * @param {string} databaseUrl
 * @returns {Buffer}
 */
export function deriveDatabaseMasterKey(databaseUrl) {
  return crypto
    .createHmac("sha256", "001router-pg-master-key-v1")
    .update(String(databaseUrl || "").trim(), "utf8")
    .digest();
}

/**
 * Load the 32-byte master key from `process.env.ROUTER001_MASTER_KEY`, a shared
 * `options.databaseUrl`, or `<dataDir>/.master.key`.
 * Creates `<dataDir>/.master.key` with 32 cryptographically random bytes (mode 0600) on first boot.
 * @param {string} dataDir
 * @param {{ databaseUrl?: string }} [options]
 * @returns {Promise<Buffer>}
 */
export async function loadOrCreateMasterKey(dataDir, options = {}) {
  const envKey = process.env.ROUTER001_MASTER_KEY;
  if (typeof envKey === "string" && envKey.trim()) {
    return normalizeMasterKeyBuffer(envKey.trim());
  }

  const dbUrl = typeof options?.databaseUrl === "string" ? options.databaseUrl.trim() : "";
  if (dbUrl) {
    const dbKey = deriveDatabaseMasterKey(dbUrl);
    await fs.mkdir(dataDir, { recursive: true });
    const keyPath = path.join(dataDir, MASTER_KEY_FILENAME);
    try {
      await fs.access(keyPath);
    } catch {
      try {
        await fs.writeFile(keyPath, `${dbKey.toString("hex")}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx"
        });
      } catch {
        // ignore race or read-only filesystem
      }
    }
    return dbKey;
  }

  await fs.mkdir(dataDir, { recursive: true });
  const keyPath = path.join(dataDir, MASTER_KEY_FILENAME);

  try {
    const existing = await fs.readFile(keyPath, "utf8");
    if (existing && existing.trim()) {
      return normalizeMasterKeyBuffer(existing.trim());
    }
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      throw err;
    }
  }

  const randomBytes = crypto.randomBytes(32);
  const hexKey = randomBytes.toString("hex");
  const tmpPath = `${keyPath}.${process.pid}.${Date.now()}.tmp`;

  await fs.writeFile(tmpPath, `${hexKey}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await fs.chmod(tmpPath, 0o600);
  } catch {
    // chmod may be a no-op on Windows
  }
  try {
    await fs.rename(tmpPath, keyPath);
  } catch {
    // If concurrent initialization created it first, read existing
    try {
      await fs.unlink(tmpPath);
    } catch {
      // ignore
    }
    const existing = await fs.readFile(keyPath, "utf8");
    return normalizeMasterKeyBuffer(existing.trim());
  }
  try {
    await fs.chmod(keyPath, 0o600);
  } catch {
    // ignore on Windows
  }
  return randomBytes;
}

/**
 * Synchronous master key loader fallback.
 * @param {string} dataDir
 * @param {{ databaseUrl?: string }} [options]
 * @returns {Buffer}
 */
export function loadOrCreateMasterKeySync(dataDir, options = {}) {
  const envKey = process.env.ROUTER001_MASTER_KEY;
  if (typeof envKey === "string" && envKey.trim()) {
    return normalizeMasterKeyBuffer(envKey.trim());
  }

  const dbUrl = typeof options?.databaseUrl === "string" ? options.databaseUrl.trim() : "";
  if (dbUrl) {
    const dbKey = deriveDatabaseMasterKey(dbUrl);
    fsSync.mkdirSync(dataDir, { recursive: true });
    const keyPath = path.join(dataDir, MASTER_KEY_FILENAME);
    if (!fsSync.existsSync(keyPath)) {
      try {
        fsSync.writeFileSync(keyPath, `${dbKey.toString("hex")}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx"
        });
      } catch {
        // ignore race or read-only filesystem
      }
    }
    return dbKey;
  }

  fsSync.mkdirSync(dataDir, { recursive: true });
  const keyPath = path.join(dataDir, MASTER_KEY_FILENAME);
  if (fsSync.existsSync(keyPath)) {
    const raw = fsSync.readFileSync(keyPath, "utf8");
    if (raw && raw.trim()) {
      return normalizeMasterKeyBuffer(raw.trim());
    }
  }

  const randomBytes = crypto.randomBytes(32);
  const hexKey = randomBytes.toString("hex");
  fsSync.writeFileSync(keyPath, `${hexKey}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fsSync.chmodSync(keyPath, 0o600);
  } catch {
    // ignore on Windows
  }
  return randomBytes;
}

/**
 * Encrypt a plaintext secret string using AES-256-GCM into `enc:v1:<iv>:<tag>:<ciphertext>`.
 * If `plaintext` is empty, returns `""`. If already encrypted, returns it unchanged.
 * @param {string} plaintext
 * @param {Buffer} masterKey
 * @returns {string}
 */
export function encryptSecret(plaintext, masterKey) {
  if (typeof plaintext !== "string" || !plaintext) return "";
  if (isEncrypted(plaintext)) return plaintext;
  const key = normalizeMasterKeyBuffer(masterKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

/**
 * Decrypt an `enc:v1:<iv>:<tag>:<ciphertext>` string back to plaintext using AES-256-GCM.
 * If the input is not encrypted (e.g. legacy plaintext during migration), returns it as-is.
 * @param {string} value
 * @param {Buffer} masterKey
 * @returns {string}
 */
export function decryptSecret(value, masterKey) {
  if (typeof value !== "string" || !value) return "";
  if (!isEncrypted(value)) return value;

  const parts = value.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("Invalid enc:v1 ciphertext format");
  }

  const key = normalizeMasterKeyBuffer(masterKey);
  const iv = Buffer.from(parts[2], "base64url");
  const tag = Buffer.from(parts[3], "base64url");
  const ciphertext = Buffer.from(parts[4], "base64url");

  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("Invalid AES-256-GCM IV or auth tag length");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Compute SHA-256 hex hash of a router API key.
 * @param {string} rawKey
 * @returns {string}
 */
export function hashRouterKey(rawKey) {
  return crypto.createHash("sha256").update(String(rawKey || ""), "utf8").digest("hex");
}

/**
 * Extract non-sensitive prefix and last4 metadata from a plaintext router key.
 * @param {string} rawKey
 * @returns {{ keyHash: string, prefix: string, last4: string }}
 */
export function deriveRouterKeyFields(rawKey) {
  const trimmed = String(rawKey || "").trim();
  const keyHash = hashRouterKey(trimmed);
  const last4 = trimmed.length >= 4 ? trimmed.slice(-4) : trimmed;
  let prefix = trimmed.slice(0, 8);
  if (trimmed.startsWith("sk-001r-")) {
    prefix = "sk-001r-";
  } else {
    const dashIdx = trimmed.indexOf("-");
    if (dashIdx > 0 && dashIdx <= 7) {
      prefix = trimmed.slice(0, dashIdx + 1);
    }
  }
  return { keyHash, prefix, last4 };
}

/**
 * Constant-time string comparison using `crypto.timingSafeEqual`.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still execute timingSafeEqual on equal-sized digests to avoid leaking timing
    const hashA = crypto.createHash("sha256").update(bufA).digest();
    const hashB = crypto.createHash("sha256").update(bufB).digest();
    crypto.timingSafeEqual(hashA, hashB);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

const MAX_PASSPHRASE_BYTES = 1024;
const MAX_CONCURRENT_KDF = 2;
let activeKdfOps = 0;
/** @type {Array<() => void>} */
const kdfWaiters = [];

function deriveScryptKeyAsync(passphrase, salt) {
  if (typeof passphrase !== "string" || passphrase.length < 1) {
    return Promise.reject(new Error("Passphrase is required"));
  }
  if (Buffer.byteLength(passphrase, "utf8") > MAX_PASSPHRASE_BYTES) {
    return Promise.reject(new Error("Passphrase exceeds maximum length (1024 bytes)"));
  }
  return new Promise((resolve, reject) => {
    const run = () => {
      activeKdfOps += 1;
      crypto.scrypt(passphrase, salt, 32, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
        activeKdfOps -= 1;
        const next = kdfWaiters.shift();
        if (next) next();
        if (err) reject(err);
        else resolve(derivedKey);
      });
    };
    if (activeKdfOps < MAX_CONCURRENT_KDF) {
      run();
    } else if (kdfWaiters.length >= 16) {
      const busyErr = new Error("Too many concurrent encryption operations; try again shortly");
      busyErr.status = 429;
      reject(busyErr);
    } else {
      kdfWaiters.push(run);
    }
  });
}

/**
 * Encrypt an export bundle object with a user passphrase using scrypt + AES-256-GCM (sync).
 * @param {object} bundle
 * @param {string} passphrase
 */
export function encryptExportBundle(bundle, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 1) {
    throw new Error("Passphrase is required for encrypted export");
  }
  if (Buffer.byteLength(passphrase, "utf8") > MAX_PASSPHRASE_BYTES) {
    throw new Error("Passphrase exceeds maximum length (1024 bytes)");
  }
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(bundle), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: true,
    version: 1,
    secretsMode: "encrypted",
    exportedAt: new Date().toISOString(),
    kdf: "scrypt",
    cipher: "aes-256-gcm",
    salt: salt.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    data: ciphertext.toString("base64url")
  };
}

/**
 * Non-blocking concurrency-capped version of `encryptExportBundle` for HTTP request handlers.
 * @param {object} bundle
 * @param {string} passphrase
 */
export async function encryptExportBundleAsync(bundle, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 1) {
    throw new Error("Passphrase is required for encrypted export");
  }
  const salt = crypto.randomBytes(16);
  const key = await deriveScryptKeyAsync(passphrase, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(bundle), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: true,
    version: 1,
    secretsMode: "encrypted",
    exportedAt: new Date().toISOString(),
    kdf: "scrypt",
    cipher: "aes-256-gcm",
    salt: salt.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    data: ciphertext.toString("base64url")
  };
}

/**
 * Decrypt an encrypted export bundle using the user passphrase (sync).
 * @param {any} envelope
 * @param {string} passphrase
 * @returns {any}
 */
export function decryptExportBundle(envelope, passphrase) {
  if (!envelope || typeof envelope !== "object" || envelope.encrypted !== true) {
    throw new Error("Invalid encrypted bundle envelope");
  }
  if (typeof passphrase !== "string" || !passphrase) {
    throw new Error("Passphrase is required to decrypt bundle");
  }
  if (Buffer.byteLength(passphrase, "utf8") > MAX_PASSPHRASE_BYTES) {
    throw new Error("Passphrase exceeds maximum length (1024 bytes)");
  }
  const { salt, iv, tag, data } = envelope;
  if (
    typeof salt !== "string" ||
    typeof iv !== "string" ||
    typeof tag !== "string" ||
    typeof data !== "string"
  ) {
    throw new Error("Malformed encrypted bundle fields");
  }

  const saltBuf = Buffer.from(salt, "base64url");
  const ivBuf = Buffer.from(iv, "base64url");
  const tagBuf = Buffer.from(tag, "base64url");
  const cipherBuf = Buffer.from(data, "base64url");

  if (saltBuf.length < 8 || ivBuf.length !== 12 || tagBuf.length !== 16) {
    throw new Error("Invalid salt, IV, or authentication tag in encrypted bundle");
  }

  const key = crypto.scryptSync(passphrase, saltBuf, 32, { N: 16384, r: 8, p: 1 });
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivBuf);
  decipher.setAuthTag(tagBuf);
  const decrypted = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

/**
 * Non-blocking concurrency-capped version of `decryptExportBundle` for HTTP request handlers.
 * @param {any} envelope
 * @param {string} passphrase
 * @returns {Promise<any>}
 */
export async function decryptExportBundleAsync(envelope, passphrase) {
  if (!envelope || typeof envelope !== "object" || envelope.encrypted !== true) {
    throw new Error("Invalid encrypted bundle envelope");
  }
  if (typeof passphrase !== "string" || !passphrase) {
    throw new Error("Passphrase is required to decrypt bundle");
  }
  const { salt, iv, tag, data } = envelope;
  if (
    typeof salt !== "string" ||
    typeof iv !== "string" ||
    typeof tag !== "string" ||
    typeof data !== "string"
  ) {
    throw new Error("Malformed encrypted bundle fields");
  }

  const saltBuf = Buffer.from(salt, "base64url");
  const ivBuf = Buffer.from(iv, "base64url");
  const tagBuf = Buffer.from(tag, "base64url");
  const cipherBuf = Buffer.from(data, "base64url");

  if (saltBuf.length < 8 || ivBuf.length !== 12 || tagBuf.length !== 16) {
    throw new Error("Invalid salt, IV, or authentication tag in encrypted bundle");
  }

  const key = await deriveScryptKeyAsync(passphrase, saltBuf);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivBuf);
  decipher.setAuthTag(tagBuf);
  const decrypted = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

import net from "node:net";

const FORBIDDEN_PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const LOCAL_OR_CUSTOM_PRESETS = new Set([
  "local",
  "custom",
  "custom-openai",
  "custom-anthropic",
  "ollama",
  "lmstudio",
  "vllm",
  "llamacpp",
  "searxng"
]);

const ALWAYS_BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "100.100.100.200",
  "0.0.0.0",
  "::",
  "[::]"
]);

/**
 * Mask an API key so plaintext secrets are never returned in API responses or logs.
 * Examples:
 *  - "sk-1234567890abcd" -> "sk-…abcd"
 *  - "short1" -> "••••ort1"
 * @param {string} key
 * @returns {string}
 */
export function maskKey(key) {
  if (typeof key !== "string") return "";
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.includes("…") || trimmed.startsWith("••••")) return trimmed;
  if (trimmed.length <= 8) {
    if (trimmed.length <= 4) return "••••";
    return `••••${trimmed.slice(-4)}`;
  }
  const dashIdx = trimmed.indexOf("-");
  const underIdx = trimmed.indexOf("_");
  let prefixLen = 3;
  if (dashIdx > 0 && dashIdx <= 5) {
    prefixLen = dashIdx + 1;
  } else if (underIdx > 0 && underIdx <= 5) {
    prefixLen = underIdx + 1;
  } else if (trimmed.startsWith("AIza")) {
    prefixLen = 4;
  }
  return `${trimmed.slice(0, prefixLen)}…${trimmed.slice(-4)}`;
}

/**
 * Mask credentials in a proxy URL (e.g. `http://user:pass@1.2.3.4:8080` -> `http://***:***@1.2.3.4:8080`).
 * @param {string} urlStr
 * @returns {string}
 */
export function maskProxyUrl(urlStr) {
  if (typeof urlStr !== "string" || !urlStr.trim()) return "";
  const trimmed = urlStr.trim();
  try {
    const u = new URL(trimmed);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "***";
      return u.toString().replace(/\/$/, "");
    }
    return trimmed;
  } catch {
    return trimmed.replace(/((?:https?|socks5h?):\/\/)([^/\s:@]+(?::[^/\s@]*)?)@/gi, "$1***:***@");
  }
}

const KNOWN_KEY_PATTERN =
  /\b(sk-ant-[A-Za-z0-9_-]{6,}|sk-proj-[A-Za-z0-9_-]{6,}|sk-or-[A-Za-z0-9_-]{6,}|sk-001r-[A-Za-z0-9_-]{6,}|sk-[A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{6,}|ya29\.[A-Za-z0-9._-]{6,}|GOCSPX-[A-Za-z0-9_-]{6,}|gsk_[A-Za-z0-9_-]{6,}|xai-[A-Za-z0-9_-]{6,}|nvapi-[A-Za-z0-9_-]{6,}|hf_[A-Za-z0-9_-]{6,}|tvly-[A-Za-z0-9_-]{6,}|fc-[A-Za-z0-9_-]{6,}|r8_[A-Za-z0-9_-]{6,}|csk-[A-Za-z0-9_-]{6,}|fw_[A-Za-z0-9_-]{6,}|sn-[A-Za-z0-9_-]{6,})\b/g;

const BEARER_PATTERN = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{6,})/gi;
const HEADER_KEY_PATTERN = /\b(x-api-key|api-key|apikey)(\s*[:=]\s*["']?)([A-Za-z0-9._~+/=-]{6,})(["']?)/gi;
const PROXY_CRED_PATTERN = /((?:https?|socks5h?):\/\/)([^/\s:@]+:[^/\s@]+)@/gi;
const PEM_PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const LONG_TOKEN_PATTERN = /\b([A-Za-z0-9+/=_-]{36,})\b/g;

/**
 * Redact known secrets and common API key / Bearer / proxy credential patterns from a string.
 * @param {string} message
 * @param {string[]} [secrets]
 * @returns {string}
 */
export function redactSecrets(message, secrets = []) {
  if (typeof message !== "string" || !message) return message || "";
  let out = message;

  if (Array.isArray(secrets)) {
    for (const secret of secrets) {
      if (typeof secret === "string" && secret.length >= 6 && out.includes(secret)) {
        out = out.split(secret).join(maskKey(secret));
      }
    }
  }

  out = out.replace(PEM_PRIVATE_KEY_PATTERN, "[REDACTED PRIVATE KEY]");
  out = out.replace(PROXY_CRED_PATTERN, "$1***:***@");
  out = out.replace(KNOWN_KEY_PATTERN, (match) => maskKey(match));
  out = out.replace(BEARER_PATTERN, (_full, prefix, token) => `${prefix}${maskKey(token)}`);
  out = out.replace(
    HEADER_KEY_PATTERN,
    (_full, name, sep, token, quote) => `${name}${sep}${maskKey(token)}${quote}`
  );
  out = out.replace(LONG_TOKEN_PATTERN, (match) => {
    // Do not mask non-secret identifiers or ciphertext markers
    if (/[a-zA-Z]/.test(match) && /\d/.test(match)) {
      return maskKey(match);
    }
    return match;
  });

  return out;
}

/**
 * Check if a string contains any unredacted API key pattern.
 * Used by the security scanner to audit logs and db.json.
 * @param {string} text
 * @returns {boolean}
 */
export function containsUnredactedSecret(text) {
  if (typeof text !== "string" || !text) return false;
  if (text.includes("PRIVATE KEY")) return true;
  KNOWN_KEY_PATTERN.lastIndex = 0;
  if (KNOWN_KEY_PATTERN.test(text)) return true;
  BEARER_PATTERN.lastIndex = 0;
  if (BEARER_PATTERN.test(text)) return true;
  return false;
}

/**
 * Recursively clone an object/array and strip prototype-pollution keys
 * (`__proto__`, `constructor`, `prototype`).
 * @template T
 * @param {T} input
 * @returns {T}
 */
export function stripPrototypePollution(input) {
  if (input === null || typeof input !== "object") {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => stripPrototypePollution(item));
  }
  const clean = {};
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_PROTO_KEYS.has(key)) {
      continue;
    }
    clean[key] = stripPrototypePollution(input[key]);
  }
  return clean;
}

/**
 * Safe prototype-pollution-free shallow/deep merge of plain objects.
 * @param {Record<string, any>} target
 * @param {Record<string, any>} source
 */
export function safeMerge(target, source) {
  const out = stripPrototypePollution(target || {});
  const src = stripPrototypePollution(source || {});
  for (const key of Object.keys(src)) {
    if (FORBIDDEN_PROTO_KEYS.has(key)) continue;
    out[key] = src[key];
  }
  return out;
}

/**
 * Parse an IPv4 string (`a.b.c.d` or integer/hex notation) into 4 octets `[a, b, c, d]`, or null.
 * @param {string} host
 * @returns {number[] | null}
 */
function parseIPv4Octets(host) {
  if (net.isIPv4(host)) {
    return host.split(".").map((n) => Number(n));
  }
  // Check integer or hex single-number IPv4 representations (e.g. 2852039166 or 0xa9fea9fe)
  if (/^\d+$/.test(host)) {
    const num = Number(host);
    if (Number.isInteger(num) && num >= 0 && num <= 0xffffffff) {
      return [
        (num >>> 24) & 255,
        (num >>> 16) & 255,
        (num >>> 8) & 255,
        num & 255
      ];
    }
  }
  if (/^0x[0-9a-fA-F]+$/.test(host)) {
    const num = Number.parseInt(host, 16);
    if (Number.isInteger(num) && num >= 0 && num <= 0xffffffff) {
      return [
        (num >>> 24) & 255,
        (num >>> 16) & 255,
        (num >>> 8) & 255,
        num & 255
      ];
    }
  }
  return null;
}

/**
 * Classify a hostname for SSRF protection.
 * @param {string} rawHostname
 * @returns {{ isMetadataOrLinkLocal: boolean, isPrivateLan: boolean, isLoopback: boolean, reason?: string }}
 */
export function classifyHostForSSRF(rawHostname) {
  const host = String(rawHostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");

  if (!host) {
    return { isMetadataOrLinkLocal: true, isPrivateLan: false, isLoopback: false, reason: "Empty host" };
  }

  if (ALWAYS_BLOCKED_HOSTS.has(host) || host.endsWith(".internal")) {
    return {
      isMetadataOrLinkLocal: true,
      isPrivateLan: false,
      isLoopback: false,
      reason: `Blocked cloud metadata or internal host '${host}'`
    };
  }

  // IPv6 checks
  const ipv6Norm = host.replace(/^::ffff:/, "");
  if (
    host === "fd00:ec2::254" ||
    host.startsWith("fd00:ec2:") ||
    host.startsWith("fe80:") ||
    host.startsWith("fe90:") ||
    host.startsWith("fea0:") ||
    host.startsWith("feb0:") ||
    host === "::"
  ) {
    return {
      isMetadataOrLinkLocal: true,
      isPrivateLan: false,
      isLoopback: false,
      reason: `Blocked link-local or cloud metadata IPv6 address '${host}'`
    };
  }

  if (host === "::1" || host === "localhost" || host.endsWith(".localhost")) {
    return {
      isMetadataOrLinkLocal: false,
      isPrivateLan: false,
      isLoopback: true
    };
  }

  if (host.startsWith("fc") || host.startsWith("fd")) {
    if (net.isIPv6(host)) {
      return {
        isMetadataOrLinkLocal: false,
        isPrivateLan: true,
        isLoopback: false,
        reason: `Private IPv6 ULA address '${host}'`
      };
    }
  }

  const octets = parseIPv4Octets(ipv6Norm);
  if (octets) {
    const [a, b] = octets;
    // 0.0.0.0/8 or 169.254.0.0/16 (link-local & cloud metadata) or 100.100.100.200 (Alibaba metadata)
    if (
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 100 && b === 100 && octets[2] === 100 && octets[3] === 200)
    ) {
      return {
        isMetadataOrLinkLocal: true,
        isPrivateLan: false,
        isLoopback: false,
        reason: `Blocked link-local or cloud metadata address '${rawHostname}'`
      };
    }
    // 127.0.0.0/8 loopback
    if (a === 127) {
      return {
        isMetadataOrLinkLocal: false,
        isPrivateLan: false,
        isLoopback: true
      };
    }
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return {
        isMetadataOrLinkLocal: false,
        isPrivateLan: true,
        isLoopback: false,
        reason: `Private network address '${rawHostname}' is not allowed for cloud provider`
      };
    }
  }

  return {
    isMetadataOrLinkLocal: false,
    isPrivateLan: false,
    isLoopback: false
  };
}

/**
 * Validate a provider `baseUrl` against SSRF rules (Section 9.8 #9):
 * - Must be valid `http:` or `https:` URL
 * - Always block link-local / cloud metadata (`169.254.0.0/16`, `fd00:ec2::254`, `fe80::/10`, `0.0.0.0`, etc.)
 * - Block RFC1918 private hosts unless provider category is `local` or `custom` or `settings.allowPrivateUpstreams === true`
 * - Block loopback when `settings.allowPrivateUpstreams === false` explicitly (unless `local` or `custom`)
 * @param {string} urlStr
 * @param {{ preset?: string, category?: string, allowPrivateUpstreams?: boolean }} [options]
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateProviderBaseUrl(urlStr, options = {}) {
  if (typeof urlStr !== "string" || !urlStr.trim()) {
    return { valid: false, error: "Invalid baseUrl" };
  }
  let parsed;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    return { valid: false, error: "Invalid baseUrl" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: "baseUrl must use http or https protocol" };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, error: "baseUrl must not contain embedded credentials" };
  }

  const classification = classifyHostForSSRF(parsed.hostname);
  if (classification.isMetadataOrLinkLocal) {
    return {
      valid: false,
      error: `SSRF guard: ${classification.reason || "link-local and metadata addresses are forbidden"}`
    };
  }

  const preset = String(options.preset || "").toLowerCase();
  const category = String(options.category || "").toLowerCase();
  const isLocalOrCustom =
    category === "local" ||
    category === "custom" ||
    LOCAL_OR_CUSTOM_PRESETS.has(preset) ||
    preset.startsWith("custom");

  if (classification.isPrivateLan) {
    if (!isLocalOrCustom && options.allowPrivateUpstreams !== true) {
      return {
        valid: false,
        error: `SSRF guard: ${classification.reason || "private network upstream blocked"}`
      };
    }
  }

  if (classification.isLoopback) {
    if (!isLocalOrCustom && options.allowPrivateUpstreams === false) {
      return {
        valid: false,
        error: "SSRF guard: loopback upstream blocked by allowPrivateUpstreams=false"
      };
    }
  }

  return { valid: true };
}

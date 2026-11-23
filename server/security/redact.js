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
  return stripPrototypePollutionAt(input, 0);
}

/** Maximum JSON nesting accepted from clients (legit chat/tool schemas stay far below this). */
export const MAX_JSON_DEPTH = 200;

function stripPrototypePollutionAt(input, depth) {
  if (input === null || typeof input !== "object") {
    return input;
  }
  if (depth > MAX_JSON_DEPTH) {
    // Reject pathological nesting with a client error instead of blowing the call stack (HTTP 500)
    const err = new Error("JSON nesting too deep");
    err.status = 400;
    err.type = "entity.parse.failed";
    throw err;
  }
  if (Array.isArray(input)) {
    return input.map((item) => stripPrototypePollutionAt(item, depth + 1));
  }
  // Only sanitise plain JSON-like objects. Class instances (undici dispatchers, Buffers, Dates ...) are
  // never produced by a JSON parser; cloning them into `{}` would silently destroy them.
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) {
    return input;
  }
  const clean = {};
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_PROTO_KEYS.has(key)) {
      continue;
    }
    clean[key] = stripPrototypePollutionAt(input[key], depth + 1);
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
 * Parse an IPv6 literal (with optional embedded dotted-IPv4 tail) into 16 bytes, or null.
 * @param {string} host
 * @returns {number[] | null}
 */
function parseIPv6Bytes(host) {
  const bare = String(host || "").split("%")[0];
  if (!net.isIPv6(bare)) return null;
  let h = bare;
  const tail = h.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (tail) {
    const o = tail.slice(2).map(Number);
    h = `${tail[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  let groups;
  if (h.includes("::")) {
    const [headStr, restStr] = h.split("::");
    const left = headStr ? headStr.split(":") : [];
    const right = restStr ? restStr.split(":") : [];
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    groups = [...left, ...Array(fill).fill("0"), ...right];
  } else {
    groups = h.split(":");
  }
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const g of groups) {
    const v = Number.parseInt(g, 16);
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) return null;
    bytes.push((v >> 8) & 255, v & 255);
  }
  return bytes;
}

/**
 * Classify four IPv4 octets for SSRF purposes.
 * @param {number[]} octets
 * @param {string} label  original host text used in messages
 */
function classifyIPv4Octets(octets, label) {
  const [a, b] = octets;
  // 0.0.0.0/8, 169.254.0.0/16 (link-local & cloud metadata), 100.100.100.200 (Alibaba metadata)
  if (
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 100 && b === 100 && octets[2] === 100 && octets[3] === 200)
  ) {
    return {
      isMetadataOrLinkLocal: true,
      isPrivateLan: false,
      isLoopback: false,
      reason: `Blocked link-local or cloud metadata address '${label}'`
    };
  }
  // 127.0.0.0/8 loopback
  if (a === 127) {
    return { isMetadataOrLinkLocal: false, isPrivateLan: false, isLoopback: true };
  }
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 (CGNAT)
  if (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  ) {
    return {
      isMetadataOrLinkLocal: false,
      isPrivateLan: true,
      isLoopback: false,
      reason: `Private network address '${label}' is not allowed for cloud provider`
    };
  }
  return { isMetadataOrLinkLocal: false, isPrivateLan: false, isLoopback: false };
}

/**
 * Classify a hostname for SSRF protection.
 * Handles IPv4 (dotted / integer / hex), IPv6 literals including IPv4-mapped (`::ffff:a.b.c.d`),
 * IPv4-compatible, NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) forms, and trailing-dot FQDNs.
 * NOTE: this is a static check; it cannot see where a DNS name resolves.
 * @param {string} rawHostname
 * @returns {{ isMetadataOrLinkLocal: boolean, isPrivateLan: boolean, isLoopback: boolean, reason?: string }}
 */
export function classifyHostForSSRF(rawHostname) {
  const host = String(rawHostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");

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

  if (host === "localhost" || host.endsWith(".localhost")) {
    return { isMetadataOrLinkLocal: false, isPrivateLan: false, isLoopback: true };
  }

  const v6 = parseIPv6Bytes(host);
  if (v6) {
    const first12Zero = v6.slice(0, 12).every((x) => x === 0);
    if (first12Zero && v6.slice(12, 15).every((x) => x === 0) && v6[15] === 0) {
      return {
        isMetadataOrLinkLocal: true,
        isPrivateLan: false,
        isLoopback: false,
        reason: `Blocked unspecified IPv6 address '${rawHostname}'`
      };
    }
    if (first12Zero && v6.slice(12, 15).every((x) => x === 0) && v6[15] === 1) {
      return { isMetadataOrLinkLocal: false, isPrivateLan: false, isLoopback: true };
    }
    // Embedded IPv4: ::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d, 2002:aabb:ccdd::
    const mapped =
      v6.slice(0, 10).every((x) => x === 0) && v6[10] === 0xff && v6[11] === 0xff;
    const nat64 =
      v6[0] === 0x00 && v6[1] === 0x64 && v6[2] === 0xff && v6[3] === 0x9b &&
      v6.slice(4, 12).every((x) => x === 0);
    if (mapped || nat64 || first12Zero) {
      return classifyIPv4Octets(v6.slice(12, 16), rawHostname);
    }
    if (v6[0] === 0x20 && v6[1] === 0x02) {
      return classifyIPv4Octets(v6.slice(2, 6), rawHostname);
    }
    // fd00:ec2::/32 (AWS IMDS over IPv6)
    if (v6[0] === 0xfd && v6[1] === 0x00 && v6[2] === 0x0e && v6[3] === 0xc2) {
      return {
        isMetadataOrLinkLocal: true,
        isPrivateLan: false,
        isLoopback: false,
        reason: `Blocked link-local or cloud metadata IPv6 address '${host}'`
      };
    }
    // fe80::/10 link-local
    if (v6[0] === 0xfe && (v6[1] & 0xc0) === 0x80) {
      return {
        isMetadataOrLinkLocal: true,
        isPrivateLan: false,
        isLoopback: false,
        reason: `Blocked link-local or cloud metadata IPv6 address '${host}'`
      };
    }
    // fec0::/10 site-local and fc00::/7 unique-local
    if ((v6[0] === 0xfe && (v6[1] & 0xc0) === 0xc0) || (v6[0] & 0xfe) === 0xfc) {
      return {
        isMetadataOrLinkLocal: false,
        isPrivateLan: true,
        isLoopback: false,
        reason: `Private IPv6 address '${host}'`
      };
    }
    return { isMetadataOrLinkLocal: false, isPrivateLan: false, isLoopback: false };
  }

  const octets = parseIPv4Octets(host);
  if (octets) {
    return classifyIPv4Octets(octets, rawHostname);
  }

  return { isMetadataOrLinkLocal: false, isPrivateLan: false, isLoopback: false };
}

/**
 * Decide which address classes a provider's upstream may reach (cloud-metadata/link-local is ALWAYS blocked).
 * - private LAN: blocked unless the provider is local/custom or `allowPrivateUpstreams === true`
 * - loopback: blocked only when `allowPrivateUpstreams === false` explicitly (and provider is not local/custom)
 * @param {{ preset?: string, category?: string, allowPrivateUpstreams?: boolean }} [options]
 * @returns {{ blockPrivate: boolean, blockLoopback: boolean }}
 */
export function resolveUpstreamPolicy(options = {}) {
  const preset = String(options.preset || "").toLowerCase();
  const category = String(options.category || "").toLowerCase();
  const isLocalOrCustom =
    category === "local" ||
    category === "custom" ||
    LOCAL_OR_CUSTOM_PRESETS.has(preset) ||
    preset.startsWith("custom");
  return {
    blockPrivate: !isLocalOrCustom && options.allowPrivateUpstreams !== true,
    blockLoopback: !isLocalOrCustom && options.allowPrivateUpstreams === false
  };
}

/**
 * Check an already-resolved IP address (or hostname) against an upstream policy.
 * @param {string} address
 * @param {{ blockPrivate: boolean, blockLoopback: boolean }} policy
 * @returns {string | null} a human readable reason when blocked, otherwise null
 */
export function checkAddressAgainstPolicy(address, policy) {
  const c = classifyHostForSSRF(address);
  if (c.isMetadataOrLinkLocal) return c.reason || "link-local or cloud metadata address";
  if (c.isPrivateLan && policy.blockPrivate) return c.reason || "private network address";
  if (c.isLoopback && policy.blockLoopback) return "loopback address";
  return null;
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

  const policy = resolveUpstreamPolicy(options);

  if (classification.isPrivateLan && policy.blockPrivate) {
    return {
      valid: false,
      error: `SSRF guard: ${classification.reason || "private network upstream blocked"}`
    };
  }

  if (classification.isLoopback && policy.blockLoopback) {
    return {
      valid: false,
      error: "SSRF guard: loopback upstream blocked by allowPrivateUpstreams=false"
    };
  }

  return { valid: true };
}

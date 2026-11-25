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
const LONG_TOKEN_PATTERN = /\b([A-Za-z0-9+/=_-]{36,})\b/g;

/**
 * Linear-time PEM private key block redactor (avoids O(n^2) ReDoS on repeated unclosed headers).
 * @param {string} text
 * @returns {string}
 */
function stripPemPrivateKeys(text) {
  if (!text.includes("-----BEGIN ") || !text.includes("PRIVATE KEY-----")) {
    return text;
  }
  let out = "";
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf("-----BEGIN ", pos);
    if (start === -1) {
      out += text.slice(pos);
      break;
    }
    const headerEnd = text.indexOf("PRIVATE KEY-----", start + 11);
    if (headerEnd === -1 || headerEnd - start > 64) {
      out += text.slice(pos, start + 11);
      pos = start + 11;
      continue;
    }
    const headerLabel = text.slice(start + 11, headerEnd);
    if (!/^[A-Z0-9 ]*$/.test(headerLabel)) {
      out += text.slice(pos, start + 11);
      pos = start + 11;
      continue;
    }
    const afterHeader = headerEnd + "PRIVATE KEY-----".length;
    const endMarkerStart = text.indexOf("-----END ", afterHeader);
    if (endMarkerStart === -1) {
      // No closing END marker anywhere in the rest of the string: stop scanning (O(n))
      out += text.slice(pos);
      break;
    }
    const endMarkerEnd = text.indexOf("PRIVATE KEY-----", endMarkerStart + 9);
    if (endMarkerEnd === -1 || endMarkerEnd - endMarkerStart > 64) {
      out += text.slice(pos, afterHeader);
      pos = afterHeader;
      continue;
    }
    const endLabel = text.slice(endMarkerStart + 9, endMarkerEnd);
    if (!/^[A-Z0-9 ]*$/.test(endLabel)) {
      out += text.slice(pos, afterHeader);
      pos = afterHeader;
      continue;
    }
    out += text.slice(pos, start) + "[REDACTED PRIVATE KEY]";
    pos = endMarkerEnd + "PRIVATE KEY-----".length;
  }
  return out;
}

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

  out = stripPemPrivateKeys(out);
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
 * Check whether a user-supplied string is safe to use as a plain-object dictionary key.
 * Rejects prototype-pollution keys (`__proto__`, `constructor`, `prototype`).
 * @param {unknown} key
 * @returns {boolean}
 */
export function isSafePropertyKey(key) {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    key.length <= 256 &&
    !FORBIDDEN_PROTO_KEYS.has(key)
  );
}

/**
 * Recursively sanitize an already-fresh parsed JSON object/array in-place to strip
 * prototype-pollution keys and enforce `MAX_JSON_DEPTH` with zero object allocations on clean inputs.
 * @template T
 * @param {T} input
 * @returns {T}
 */
export function sanitizePrototypePollutionInPlace(input) {
  sanitizeInPlaceAt(input, 0);
  return input;
}

function sanitizeInPlaceAt(input, depth) {
  if (input === null || typeof input !== "object") {
    return;
  }
  if (depth > MAX_JSON_DEPTH) {
    const err = new Error("JSON nesting too deep");
    err.status = 400;
    err.type = "entity.parse.failed";
    throw err;
  }
  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i++) {
      sanitizeInPlaceAt(input[i], depth + 1);
    }
    return;
  }
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) {
    return;
  }
  const keys = Object.keys(input);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (FORBIDDEN_PROTO_KEYS.has(key)) {
      delete input[key];
      continue;
    }
    sanitizeInPlaceAt(input[key], depth + 1);
  }
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
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 (CGNAT),
  // 198.18.0.0/15 (benchmarking), 224.0.0.0/4 (multicast), 240.0.0.0/4 (reserved)
  if (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  ) {
    return {
      isMetadataOrLinkLocal: false,
      isPrivateLan: true,
      isLoopback: false,
      reason: `Private or non-routable network address '${label}' is not allowed for cloud provider`
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
    // Embedded IPv4: ::ffff:a.b.c.d, ::ffff:0:a.b.c.d (RFC 2765), ::a.b.c.d,
    // 64:ff9b::a.b.c.d (RFC 6052), 64:ff9b:1::/48 (RFC 8215), 2002:aabb:ccdd:: (6to4), 2001:0000::/32 (Teredo)
    const mapped =
      v6.slice(0, 10).every((x) => x === 0) && v6[10] === 0xff && v6[11] === 0xff;
    const translated =
      v6.slice(0, 8).every((x) => x === 0) &&
      v6[8] === 0xff &&
      v6[9] === 0xff &&
      v6[10] === 0x00 &&
      v6[11] === 0x00;
    const nat64WellKnown =
      v6[0] === 0x00 && v6[1] === 0x64 && v6[2] === 0xff && v6[3] === 0x9b &&
      v6.slice(4, 12).every((x) => x === 0);
    const nat64Local =
      v6[0] === 0x00 && v6[1] === 0x64 && v6[2] === 0xff && v6[3] === 0x9b &&
      v6[4] === 0x00 && v6[5] === 0x01;
    if (mapped || translated || nat64WellKnown || first12Zero) {
      return classifyIPv4Octets(v6.slice(12, 16), rawHostname);
    }
    if (nat64Local) {
      const embedded = classifyIPv4Octets(v6.slice(12, 16), rawHostname);
      if (embedded.isMetadataOrLinkLocal || embedded.isLoopback || embedded.isPrivateLan) {
        return embedded;
      }
      return {
        isMetadataOrLinkLocal: false,
        isPrivateLan: true,
        isLoopback: false,
        reason: `Local-use NAT64 IPv6 address '${host}'`
      };
    }
    if (v6[0] === 0x20 && v6[1] === 0x02) {
      return classifyIPv4Octets(v6.slice(2, 6), rawHostname);
    }
    // 2001:0000::/32 Teredo (embedded client IPv4 in bytes 12..15 XOR 0xff)
    if (v6[0] === 0x20 && v6[1] === 0x01 && v6[2] === 0x00 && v6[3] === 0x00) {
      const teredoClient = [v6[12] ^ 0xff, v6[13] ^ 0xff, v6[14] ^ 0xff, v6[15] ^ 0xff];
      const embedded = classifyIPv4Octets(teredoClient, rawHostname);
      if (embedded.isMetadataOrLinkLocal || embedded.isLoopback || embedded.isPrivateLan) {
        return embedded;
      }
      return {
        isMetadataOrLinkLocal: false,
        isPrivateLan: true,
        isLoopback: false,
        reason: `Teredo tunneled IPv6 address '${host}'`
      };
    }
    // ff00::/8 multicast
    if (v6[0] === 0xff) {
      return {
        isMetadataOrLinkLocal: false,
        isPrivateLan: true,
        isLoopback: false,
        reason: `Multicast IPv6 address '${host}'`
      };
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

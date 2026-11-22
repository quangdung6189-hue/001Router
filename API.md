# 001Router — Internal & Public API Contract

001Router is a local AI router and gateway running on **port 20128** (`http://localhost:20128`).
- Dashboard UI: `http://localhost:20128/` (served statically from `app/web/dist`)
- Unified AI API Base: `http://localhost:20128/v1`
- Default dashboard password: `1234` (stored as bcrypt hash in `app/data/db.json`; changeable in Settings)
- Provider auth: **Official API keys only** (no OAuth, no subscription hijacking, no client spoofing/impersonation).

---

## 1. Data Model & Conventions

### Provider Presets
Each provider has:
- `id`: nanoid string
- `slug`: URL-safe lowercase identifier (unique, e.g., `openai`, `anthropic`, `gemini`, `openrouter`, `groq`, `deepseek`, `mistral`, `xai`, `together`, `cerebras`, `ollama`, `lmstudio`, `custom-1`)
- `preset`: `"openai" | "anthropic" | "gemini" | "openrouter" | "groq" | "deepseek" | "mistral" | "xai" | "together" | "cerebras" | "ollama" | "lmstudio" | "custom"`
- `name`: Display name (e.g. `"OpenAI"`, `"Anthropic"`)
- `baseUrl`: Upstream base URL without trailing slash:
  - `openai`: `https://api.openai.com/v1`
  - `anthropic`: `https://api.anthropic.com` (requests go to `${baseUrl}/v1/messages` or `/v1/models` depending on trailing `/v1` — backend normalizes `${baseUrl}` cleanly so both `https://api.anthropic.com` and `https://api.anthropic.com/v1` work!)
  - `gemini`: `https://generativelanguage.googleapis.com/v1beta/openai`
  - `openrouter`: `https://openrouter.ai/api/v1`
  - `groq`: `https://api.groq.com/openai/v1`
  - `deepseek`: `https://api.deepseek.com/v1`
  - `mistral`: `https://api.mistral.ai/v1`
  - `xai`: `https://api.x.ai/v1`
  - `together`: `https://api.together.xyz/v1`
  - `cerebras`: `https://api.cerebras.ai/v1`
  - `ollama`: `http://localhost:11434/v1`
  - `lmstudio`: `http://localhost:1234/v1`
  - `custom`: user provided
- `formatType`: `"openai" | "anthropic" | "gemini-openai"`
- `apiKeys`: array of key entries `{ id, label?, key, enabled: true, cooldownUntil: number|null, lastError?: string }`
  - **SECURITY**: On all `/api/providers*` responses, `key` is NEVER returned in plain text; return `maskedKey` (e.g. `sk-…abcd`, or `••••abcd` if short) and keep `{ id, label, maskedKey, enabled, cooldownUntil, lastError }`.
  - On `POST /api/providers`, `apiKeys` accepts array of strings OR array of `{ key, label?, enabled? }`.
  - On `PUT /api/providers/:id`, `apiKeys` accepts array of `{ id?, key?, label?, enabled? }`: if an item has `id` matching an existing key and `key` is omitted/empty or equals the masked value, preserve the stored plaintext key; if `key` is a new non-masked string, update/add it.
- `models`: array of strings (e.g. `["gpt-4o", "gpt-4o-mini"]`)
- `enabled`: boolean (default `true`)
- `createdAt`, `updatedAt`: ISO strings

### Model Routing Syntax
1. **Direct provider/model**: Split on the **first** `/` (`idx = model.indexOf("/")`):
   - `providerSlug = model.slice(0, idx)`
   - `upstreamModel = model.slice(idx + 1)`
   - Supports OpenRouter models containing slashes like `openrouter/anthropic/claude-3.5-sonnet`.
2. **Combo alias**: If `model` matches an enabled combo's `name` (or `id`), route sequentially through `combo.targets` (each target is `"<providerSlug>/<upstreamModel>"`).
3. **Fallback / Retry rules**:
   - Retries/falls back across combo targets (and across available keys within a provider) on HTTP `429`, `5xx`, timeout, network error, or quota/billing error (`401`/`402`/`403` when quota/auth fails on a key puts that key into 60s cooldown and tries next key/target).
   - For `429` or `401`: put the failing API key on a **60-second cooldown** (`Date.now() + 60_000`) and try another active key in the same provider before moving to the next combo target.
   - **Streaming rule**: Fallback is ONLY allowed **before the first byte/chunk is sent** to the downstream client. Once SSE headers/data are flushed, abort cleanly on upstream failure.

---

## 2. Dashboard Authentication & Session (`/api/*`)

Session cookie: `r001_session` (HMAC-SHA256 signed with secret stored in `db.json`, `HttpOnly`, `SameSite=Lax`, `Path=/`).
All `/api/*` routes EXCEPT `POST /api/login`, `POST /api/logout`, and `GET /api/me` MUST require a valid authenticated session and return `401 { error: "Unauthorized" }` if missing/invalid.

- `POST /api/login`
  - Body: `{ password: string }`
  - `200`: `{ ok: true }` + `Set-Cookie: r001_session=...`
  - `401`: `{ error: "Invalid password" }`
- `POST /api/logout`
  - `200`: `{ ok: true }` (clears cookie)
- `GET /api/me`
  - If valid session: `200`: `{ authenticated: true }`
  - If not authenticated: `401`: `{ authenticated: false, error: "Unauthorized" }`

---

## 3. Providers API

- `GET /api/providers`
  - `200`: `{ providers: ProviderPublic[], presets: ProviderPreset[] }`
- `POST /api/providers`
  - Body: `{ preset, name, slug?, baseUrl, formatType, apiKeys: Array<string | { key, label?, enabled? }>, models?: string[], enabled?: boolean }`
  - `201`: `{ provider: ProviderPublic }`
  - `400`: `{ error: string }` (e.g. duplicate slug or invalid URL)
- `PUT /api/providers/:id`
  - Body: partial/full provider fields
  - `200`: `{ provider: ProviderPublic }`
  - `404`: `{ error: "Provider not found" }`
- `DELETE /api/providers/:id`
  - `200`: `{ ok: true }`
- `POST /api/providers/:id/test`
  - Optional Body: `{ model?: string }`
  - Tests connectivity with active key (calls `/models`, or minimal 1-token chat/messages call if `/models` unsupported e.g. Anthropic if needed, though Anthropic also supports `GET /v1/models` with `x-api-key` + `anthropic-version`).
  - `200`: `{ ok: boolean, status: number, latencyMs: number, message: string, modelsCount?: number }`
- `POST /api/providers/:id/models`
  - Fetches upstream models list, updates `provider.models` (merging or replacing cleanly while keeping custom added ones if requested, or replacing with fetched list + preserving custom), and saves `db.json`.
  - `200`: `{ ok: boolean, models: string[], message?: string }`

---

## 4. Combos API

- `GET /api/combos`
  - `200`: `{ combos: Combo[] }`
  - `Combo`: `{ id, name, description, targets: string[], enabled: boolean, createdAt, updatedAt }`
- `POST /api/combos`
  - Body: `{ name, description?, targets: string[], enabled?: boolean }`
  - `201`: `{ combo: Combo }`
- `PUT /api/combos/:id`
  - Body: `{ name?, description?, targets?, enabled? }`
  - `200`: `{ combo: Combo }`
- `DELETE /api/combos/:id`
  - `200`: `{ ok: true }`

---

## 5. Router API Keys (`/api/keys`)

Used by external CLI/IDE tools connecting to `/v1/*`.
- `GET /api/keys`
  - `200`: `{ keys: RouterKey[] }`
  - `RouterKey`: `{ id, name, key, keyPreview, enabled, requestCount, lastUsedAt, createdAt }`
- `POST /api/keys`
  - Body: `{ name: string }`
  - `201`: `{ key: RouterKey }` (format `sk-001r-<nanoid>`)
- `PATCH /api/keys/:id`
  - Body: `{ name?, enabled? }`
  - `200`: `{ key: RouterKey }`
- `DELETE /api/keys/:id`
  - `200`: `{ ok: true }`

---

## 6. Usage, Logs & Settings

- `GET /api/usage?range=24h|7d|30d|all`
  - `200`:
    ```json
    {
      "range": "7d",
      "summary": {
        "totalRequests": 0,
        "successRequests": 0,
        "errorRequests": 0,
        "promptTokens": 0,
        "completionTokens": 0,
        "totalTokens": 0,
        "savedChars": 0,
        "avgLatencyMs": 0
      },
      "byDay": [{ "date": "2026-11-22", "requests": 0, "tokens": 0, "errors": 0, "savedChars": 0 }],
      "byProvider": [{ "provider": "openai", "requests": 0, "tokens": 0, "errors": 0 }],
      "byModel": [{ "model": "openai/gpt-4o", "requests": 0, "tokens": 0, "errors": 0 }]
    }
    ```
- `GET /api/logs?limit=100&offset=0&status=&provider=&model=`
  - `200`: `{ logs: LogEntry[], total: number }`
  - `LogEntry`: `{ id, timestamp, keyId, keyName, requestedModel, resolvedModel, providerSlug, endpoint, status, latencyMs, promptTokens, completionTokens, savedChars, fallbackHops, attemptTrail, error? }`
  - Storage retains the newest **5000** logs.
- `DELETE /api/logs`
  - `200`: `{ ok: true }`
- `GET /api/settings`
  - `200`: `{ settings: { timeoutMs, tokenSaverEnabled, tokenSaverMaxChars, requireKey, port } }`
- `PUT /api/settings`
  - Body: partial `{ timeoutMs?, tokenSaverEnabled?, tokenSaverMaxChars?, requireKey? }`
  - `200`: `{ settings: { ... } }`
- `POST /api/settings/password`
  - Body: `{ currentPassword: string, newPassword: string }`
  - `200`: `{ ok: true }`
  - `400` / `401`: `{ error: string }`
- `GET /api/export`
  - `200`: `{ exportedAt, version: 1, providers, combos, keys, settings }` (contains unmasked upstream API keys — UI must warn user!)
- `POST /api/import`
  - Body: `{ providers?, combos?, keys?, settings?, mode?: "replace" | "merge" }`
  - `200`: `{ ok: true, counts: { providers, combos, keys } }`

---

## 7. Unified Router Endpoints (`/v1/*` and `/health`)

Auth for `/v1/*`:
- When `settings.requireKey === true` (default `true`):
  - Check `Authorization: Bearer <token>` OR `x-api-key: <token>`.
  - Must match an enabled key in `db.keys`. Otherwise `401 { error: { message: "Invalid or missing router API key", type: "authentication_error" } }`.
- When `settings.requireKey === false`: allow requests even without key (still resolve key metadata if provided).

Endpoints:
- `GET /health` -> `200 { ok: true, service: "001router", port: 20128 }`
- `GET /v1/models` -> `200 { object: "list", data: [{ id, object: "model", created, owned_by }] }` (combos + `providerSlug/modelId` for enabled providers)
- `POST /v1/chat/completions` -> OpenAI Chat Completions (stream SSE & non-stream JSON). Translates to/from Anthropic automatically if target provider `formatType === "anthropic"`.
- `POST /v1/embeddings` -> OpenAI Embeddings passthrough for `openai` / `gemini-openai` providers.
- `POST /v1/messages` -> Anthropic Messages API (stream SSE & non-stream JSON). Translates to/from OpenAI automatically if target provider `formatType !== "anthropic"`.
  - Streaming SSE emits valid Anthropic event sequence: `message_start`, `content_block_start`, `content_block_delta` (`text_delta` / `thinking_delta` / `input_json_delta`), `content_block_stop`, `message_delta`, `message_stop`.
  - Supports `system` (string or text blocks), `messages` (text, image base64, `tool_use`, `tool_result`), `tools`, `tool_choice`, `max_tokens`, `temperature`, `stop_sequences`.
- `POST /v1/messages/count_tokens` -> `200 { input_tokens: number }` (approximate token count).

### Token Saver (RTK-like)
When `settings.tokenSaverEnabled === true`:
Applies to `tool` role messages (OpenAI) / `tool_result` blocks (Anthropic) AND long `user` text (> 2000 chars, or configurable threshold):
1. Normalize line endings (`\r\n` -> `\n`), strip trailing spaces on lines.
2. Collapse >2 consecutive blank lines down to 2 blank lines.
3. Deduplicate repeated consecutive identical lines (when 3+ consecutive lines match, keep first 2 and replace excess with `... (${n} similar lines)`).
4. Truncate content exceeding `tokenSaverMaxChars` (default `20000`), keeping head (60%) and tail (35%) with a clear marker `\n... [truncated ${omitted} chars by 001Router Token Saver] ...\n`.
5. Track total `savedChars` (`originalChars - compressedChars`) and record in request logs & usage stats.


---

## 8. 9Router UI/UX Parity Extensions (v1.1)

All extensions below are strictly backward-compatible with v1.0 endpoints and tests.

### Extended Presets (`GET /api/providers`)
Each item in `presets` now includes:
`{ preset, name, category: "free-tier" | "apikey" | "local" | "custom", badge?: string, color: string, monogram: string, baseUrl: string, formatType: "openai" | "anthropic" | "gemini-openai", docsUrl?: string, keyOptional?: boolean, models: string[] }`.
Contains 30+ official API-key / free-tier developer API / local self-hosted providers (NO OAuth, NO web cookies, NO cloaking).

### Batch Provider Connection Test
- `POST /api/providers/test-all`
  - Body: `{ category?: string, providerIds?: string[] }`
  - `200`: `{ results: [{ providerId, slug, name, ok, status, latencyMs, message, modelsCount? }] }`

### Combo Routing Strategy
- `Combo` adds optional `strategy?: "fallback" | "round-robin"` (default `"fallback"`).
- `"fallback"`: tries `targets[0]`, then `targets[1]`, etc.
- `"round-robin"`: rotates the starting target index per combo on each request and falls back circularly through remaining targets on failure.

### Quota & Budget Tracker (`/api/quota`)
- `GET /api/quota`
  - `200`:
    ```json
    {
      "items": [
        {
          "providerId": "...",
          "slug": "gemini",
          "name": "Google Gemini",
          "preset": "gemini",
          "enabled": true,
          "activeKeys": 1,
          "cooldownKeys": 0,
          "maxCooldownRemainingMs": 0,
          "today": { "requests": 0, "tokens": 0, "errors": 0 },
          "month": { "requests": 0, "tokens": 0, "errors": 0 },
          "budget": { "dailyTokenLimit": null, "dailyRequestLimit": null, "monthlyTokenLimit": null }
        }
      ]
    }
    ```
- `PUT /api/quota/:providerId`
  - Body: `{ dailyTokenLimit?: number | null, dailyRequestLimit?: number | null, monthlyTokenLimit?: number | null }`
  - `200`: `{ ok: true, budget: { ... } }`

### Live Token Saver Tester
- `POST /api/token-saver/test`
  - Body: `{ text: string, maxChars?: number }`
  - `200`: `{ originalChars, compressedChars, savedChars, savedPercent, estTokensSaved, compressedText }`

### Live Translator Debugger
- `POST /api/debug/translate`
  - Body: `{ direction: "claude-to-openai" | "openai-to-claude", payload: object }`
  - `200`: `{ ok: true, direction, translated }`


---

## 9. v1.2 — 9Router 99% Parity, Latest Model Catalog, Logos & Security Hardening

### 9.1 Provider logos
- 166 MIT-licensed logos copied from `decolua/9router` into `app/web/public/providers/<logo>.png|svg` (served statically at `/providers/<file>`).
- Every preset has `logo: "<basename>"` (e.g. `"openai"`) and `logoExt: "png" | "svg"`. Frontend renders `<img src="/providers/<logo>.<ext>">` and falls back to colored monogram on `onError`.
- Preset → logo basename map (when file exists): openai→openai, anthropic→anthropic, gemini→gemini, groq→groq, cerebras→cerebras, openrouter→openrouter, nvidia→nvidia, sambanova→sambanova, huggingface→huggingface, mistral→mistral, cloudflare→cloudflare-ai, deepseek→deepseek, xai→xai, together→together, fireworks→fireworks, perplexity→perplexity, cohere→cohere, glm→glm, kimi→kimi, minimax→minimax, alibaba→qwen, siliconflow→siliconflow, nebius→nebius, hyperbolic→hyperbolic, chutes→chutes, venice→venice, vercel→vercel-ai-gateway, featherless→featherless, ollama→ollama, lmstudio/vllm/llamacpp→local-device, azure→azure, bedrock→bedrock, vertex→vertex, novita→novita, reka→reka, deepgram→deepgram, assemblyai→assemblyai, elevenlabs→elevenlabs, tavily→tavily, brave→brave-search, serper→serper, exa→exa, firecrawl→firecrawl, jina→jina-ai, fal→fal-ai, stability→stability-ai, bfl→black-forest-labs, recraft→recraft, runway→runwayml, voyage→voyage-ai, searxng→searxng, google-pse→google-pse, linkup→linkup, searchapi→searchapi, longcat→longcat, poolside→poolside, nous→nous, morph→morph, codebuddy etc. only if requested.

### 9.2 Preset extensions (`GET /api/providers` → `presets[]`)
Adds to each preset: `logo`, `logoExt`, `tier: "premium" | "cheap" | "free" | "local"`, `serviceKinds: Array<"chat"|"embedding"|"image"|"vision"|"tts"|"stt"|"video"|"search"|"fetch">`, `modelCatalog: Array<{ id, name, kind, contextWindow?, maxOutput?, free?, released?, inputPrice?, outputPrice?, vision?, reasoning?, tools? }>`, `catalogUpdatedAt`.
`models` (string[]) remains = ids of chat `modelCatalog` entries for backward compatibility.
New presets (official API key / free tier only): azure (Azure OpenAI, custom base URL), bedrock (via OpenAI-compatible base URL), vertex (OpenAI-compatible base URL + access token), novita, reka, + service providers (kind-only): deepgram, assemblyai, elevenlabs, tavily, brave, serper, exa, firecrawl, jina, fal, stability, bfl, recraft, runway, voyage, searxng, google-pse, linkup, searchapi. Category for these = `"service"`.
Source of truth for model data: `app/server/catalog/modelCatalog.json`:
`{ "generatedAt": ISO, "sources": string[], "providers": { "<preset>": { "models": [ModelEntry...] } } }`.

### 9.3 Catalog API
- `GET /api/catalog` → `{ generatedAt, kinds: [{ id, label, icon, endpoint:{method,path} }], providers: [{ preset, name, tier, logo, logoExt, serviceKinds, models: ModelEntry[] }] }`
- `GET /api/catalog/models?kind=chat&q=` → flat `{ models: [{ preset, id, fullId: "<preset>/<id>", name, kind, contextWindow, free, released }] }` for model pickers.
- `POST /api/providers/:id/models` (existing) fetches the live list from upstream and merges: `models` = live ∪ catalog chat ids; response adds `{ live: string[], catalogOnly: string[] }`.

### 9.4 Service kinds (OpenAI-compatible endpoints, same router-key auth)
- `POST /v1/embeddings` (existing)
- `POST /v1/images/generations` → passthrough to openai-format providers (OpenAI, Together, Fireworks, etc.)
- `POST /v1/audio/speech` → passthrough, binary response streamed back
- `POST /v1/audio/transcriptions` → multipart passthrough
- `POST /v1/search` body `{ query, provider?: "tavily"|"brave"|"serper"|"exa"|"linkup"|"searchapi", max_results? }` → `{ provider, results: [{ title, url, snippet }] }`
- `POST /v1/web/fetch` body `{ url, provider?: "firecrawl"|"jina"|"tavily"|"exa" }` → `{ provider, url, title?, content }`
- `GET /v1/models` lists combos + chat models; accepts `?kind=` filter.
All use ONLY the provider's official API key and official endpoint.

### 9.5 Caveman Mode (output saver) — setting additions
`settings.cavemanEnabled: boolean (default false)`, `settings.cavemanLevel: "lite"|"full"|"ultra"` (default "full"). When enabled, router prepends/merges a terse-style instruction into the system prompt (OpenAI `system` message / Anthropic `system`) for chat requests. Never alters tool schemas. Logged in LogEntry as `caveman: true`.
`GET /api/settings` additionally returns `{ cavemanEnabled, cavemanLevel, proxyEnabled? }`.

### 9.6 Tier presets for combos
`GET /api/combos/templates` → `{ templates: [{ id: "3-tier", name, description, tiers: [{ tier:"premium"|"cheap"|"free", candidates: string[] }] }, ...] }` and `POST /api/combos/templates/:id/generate` body `{ name? }` → creates combo from candidates whose provider is configured+enabled, ordered premium → cheap → free. `409` if no connected provider matches.

### 9.7 Proxy Pools (outbound proxy for region-restricted official APIs)
- `GET /api/proxy-pools` → `{ pools: [{ id, name, type: "http"|"https"|"socks5", urlMasked, enabled, createdAt }] }` (credentials in URL always masked).
- `POST /api/proxy-pools` `{ name, url }`, `PUT /api/proxy-pools/:id`, `DELETE /api/proxy-pools/:id`, `POST /api/proxy-pools/:id/test` → `{ ok, latencyMs, message }`.
- Provider gets optional `proxyPoolId`; router uses it for upstream fetch.

### 9.8 Security hardening (MANDATORY)
1. **Encryption at rest**: upstream provider API keys and proxy URLs stored in `db.json` as `enc:v1:<iv>:<tag>:<ciphertext>` (AES-256-GCM). Master key = random 32 bytes in `app/data/.master.key` (created on first boot, file mode 0600 where supported) or env `ROUTER001_MASTER_KEY`. Transparent migration of existing plaintext db.json on boot. Plaintext never written to disk, never to logs, never in API responses, never in error messages (global redactor for `sk-…`, `AIza…`, `Bearer …`, `x-api-key`, `gsk_`, `xai-`, `sk-ant-`, long base64-ish tokens).
2. **Router keys** stored as SHA-256 hash + `prefix` + `last4`; full key shown ONCE on creation (`POST /api/keys` returns `key` once). `GET /api/keys` returns `{ id, name, keyPreview, enabled, requestCount, lastUsedAt, createdAt }` only. Existing plaintext router keys migrated to hashes automatically; the seeded default key is shown once in the first-boot console + first dashboard load via `GET /api/keys/reveal-initial` (one-time; then deleted).
3. **Network exposure**: server binds `127.0.0.1` by default (env `HOST` to override; when HOST is non-loopback, startup prints warning and requires the dashboard password to differ from default `1234`, else refuses non-loopback bind).
4. **CORS lockdown**: `/api/*` same-origin only (no reflected Origin + credentials). `/v1/*` allows `*` WITHOUT credentials (Bearer-token auth only). Preflight handled accordingly.
5. **CSRF/Origin check** on state-changing `/api/*` (POST/PUT/PATCH/DELETE): `Origin`/`Sec-Fetch-Site` must be same-origin or absent for non-browser clients with valid cookie+custom header `X-Requested-With: 001router` (frontend sends it on every call).
6. **Login protection**: per-IP and global rate limit + exponential lockout (5 failures → 1 min, 10 → 15 min), constant-time password compare, bcrypt cost ≥ 10, session rotation on login/password change, session cookie `HttpOnly; SameSite=Strict; Path=/` (+ `Secure` when behind HTTPS/x-forwarded-proto https), 7-day max, invalidated on password change/logout (server-side session version in db).
7. **Security headers** on all responses: `Content-Security-Policy` (default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` minimal, `Cache-Control: no-store` for `/api/*`.
8. **Export/Import**: `GET /api/export` now default `?secrets=redacted` (keys omitted → `"***redacted***"`); `?secrets=encrypted&passphrase=` returns an AES-GCM(scrypt) encrypted bundle; `?secrets=plain` requires re-sending dashboard password in header `X-Confirm-Password`. Import accepts redacted (keeps existing keys), encrypted (needs passphrase) or plain bundles; validates schema, size ≤ 5 MB, strips prototype-pollution keys (`__proto__`, `constructor`, `prototype`).
9. **Input validation / SSRF guard**: provider `baseUrl` must be http(s); block link-local/metadata (`169.254.0.0/16`, `fd00:ec2::254`) always; block private/loopback hosts unless provider is `category: local|custom` explicit or `settings.allowPrivateUpstreams` true. Body size caps (`/v1` 25 MB, `/api` 6 MB). JSON prototype-pollution safe merge.
10. **Logging**: request logs never store prompt/response bodies or headers; error strings pass through the redactor; `attemptTrail` contains provider slug/status only.
11. **Default-password banner**: `GET /api/me` returns `{ authenticated, defaultPassword: boolean }`; UI shows a persistent warning until the password is changed (default stays `1234` as requested by the user for first check).
12. **Dependency & code scan**: `npm audit` clean (or documented), no `eval`/`child_process` usage, `npm run security:scan` script (`node scripts/security-scan.js`) verifies: no plaintext keys in `data/db.json`, no secrets in logs, headers present, CORS correct, bind address, default-password state; prints PASS/FAIL table.
13. `GET /api/security/status` → `{ encryptionAtRest: true, routerKeysHashed: true, bindHost, defaultPassword, corsLocked: true, headers: true, lastScan?: {...} }` for the Settings → Security card.
14. `app/data/` and `.master.key` are git-ignored.

### 9.9 UI fidelity requirements (9Router 99%)
- Port look & feel from `d:\001router\_ref9router\src\shared\components\*` (Sidebar.js, Header.js, Card.js, Button.js, Badge.js, Modal.js, Toggle.js, Input.js, Select.js, ProviderIcon.js) and `src\app\globals.css` (tokens already similar) and screenshot `d:\001router\_ref9router\images\9router.png`.
- Provider cards show REAL logos (`/providers/*.png`), `N Connected` pill, free badge, cooldown/error tag, toggle switch on connected cards; click → `/providers/:preset` detail page (connections table, models list from catalog with copy-id, per-model availability test, add custom model, proxy pool selector, delete).
- Provider sections follow 9Router order: Free Forever → Cheap/Coding plans → Official API Key providers → Local → Service kinds (embedding/image/tts/stt/search/fetch) → API Key Compatible (+Anthropic/+OpenAI compatible buttons).
- Public marketing landing at `/landing` (no auth) replicating 9router.com sections (hero, 9 service kinds, How it works / 3-tier, Providers, Integrations, Features, Bonus RTK & Caveman, Get Started, CTA, footer) with 001Router wording; NO fake testimonials.
- Endpoint page: per-service-kind endpoint rows (chat, embeddings, images, tts, stt, search, fetch, messages) each with copy button.
- Usage page: provider topology/bar charts like 9Router; Token Saver page adds Caveman Mode card (toggle + 3 levels + before/after example).
- Settings → Security card (reads `/api/security/status`, "Run scan" button calls `POST /api/security/scan`) and Proxy Pools page `/proxy-pools` (sidebar SYSTEM section).

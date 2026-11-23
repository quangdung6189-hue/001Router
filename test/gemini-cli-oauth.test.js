import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GEMINI_CLI_DEFAULT_REDIRECT,
  GEMINI_CLI_GENERATE_URL,
  buildGeminiCliHeaders,
  clearGeminiCliStore,
  exchangeGeminiCliOAuth,
  getGeminiCliAccessToken,
  normalizeGeminiCliRedirect,
  startGeminiCliOAuth
} from "../server/geminiCliOAuth.js";
import {
  buildCloudCodeRequest,
  cloudCodeChunkToOpenAI,
  cloudCodeToOpenAIResponse
} from "../server/geminiCliTranslator.js";

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

function makeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    for (const h of handlers) {
      const res = await h(url, init);
      if (res) return res;
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetchImpl, calls };
}

const okToken = {
  access_token: "ya29.test-access-token",
  refresh_token: "1//test-refresh-token",
  expires_in: 3600
};

const loadCodeAssistBody = {
  cloudaicompanionProject: "cloudshell-test-123456",
  currentTier: { name: "Starter" },
  paidTier: { id: "free-tier", name: "Antigravity Starter Quota" }
};

describe("Gemini CLI (Cloud Code Assist) OAuth", () => {
  it("1. start builds a Google auth URL with the public CLI client and S256 PKCE", () => {
    clearGeminiCliStore();
    const started = startGeminiCliOAuth({
      callbackUrl: GEMINI_CLI_DEFAULT_REDIRECT,
      selectAccount: true
    });
    const url = new URL(started.authUrl);
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.match(url.searchParams.get("client_id"), /apps\.googleusercontent\.com$/);
    assert.equal(url.searchParams.get("redirect_uri"), GEMINI_CLI_DEFAULT_REDIRECT);
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.match(url.searchParams.get("scope"), /auth\/cloud-platform/);
    assert.equal(started.expiresInSec, 600);
    assert.equal(started.redirectUri, GEMINI_CLI_DEFAULT_REDIRECT);
  });

  it("2. redirect validation only accepts loopback or same origin and strips query/hash", () => {
    assert.equal(
      normalizeGeminiCliRedirect("http://127.0.0.1:1455/oauth2callback?x=1#y"),
      "http://127.0.0.1:1455/oauth2callback"
    );
    assert.equal(
      normalizeGeminiCliRedirect("http://localhost:9999/cb"),
      "http://localhost:9999/cb"
    );
    assert.throws(
      () => normalizeGeminiCliRedirect("https://evil.example.com/cb"),
      /same origin|loopback/
    );
    assert.throws(() => normalizeGeminiCliRedirect(""), /Missing required 'callbackUrl'/);
  });

  it("3. exchange reads the pasted loopback URL, stores the refresh token, and resolves the plan", async () => {
    clearGeminiCliStore();
    const started = startGeminiCliOAuth({ callbackUrl: GEMINI_CLI_DEFAULT_REDIRECT });

    const { fetchImpl, calls } = makeFetch([
      (url) => (url.includes("oauth2.googleapis.com/token") ? json(200, okToken) : null),
      (url) => (url.includes("loadCodeAssist") ? json(200, loadCodeAssistBody) : null),
      (url) =>
        url.includes("oauth2/v1/userinfo")
          ? json(200, { email: "veta@example.com", name: "Veta" })
          : null,
      (url) =>
        url.includes("retrieveUserQuota")
          ? json(200, {
              buckets: [
                {
                  modelId: "gemini-2.5-pro",
                  remainingFraction: 0.75,
                  resetTime: "2026-01-01T00:00:00Z"
                }
              ]
            })
          : null
    ]);

    const result = await exchangeGeminiCliOAuth({
      pastedUrl: `${GEMINI_CLI_DEFAULT_REDIRECT}?state=${started.state}&code=4%2F0Aabc`,
      fetchImpl
    });

    assert.equal(result.oauthCredentials.refreshToken, "1//test-refresh-token");
    assert.equal(result.oauthCredentials.flow, "gemini_cli");
    assert.equal(result.oauthCredentials.projectId, "cloudshell-test-123456");
    assert.equal(result.oauthMeta.email, "veta@example.com");
    assert.equal(result.oauthMeta.tier, "free");
    assert.equal(result.oauthMeta.quotaBuckets.length, 1);
    assert.equal(result.oauthMeta.quotaBuckets[0].remainingFraction, 0.75);

    const tokenCall = calls.find((c) => c.url.includes("oauth2.googleapis.com/token"));
    const body = new URLSearchParams(tokenCall.init.body);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("redirect_uri"), GEMINI_CLI_DEFAULT_REDIRECT);
    assert.ok(body.get("code_verifier"));
    assert.equal(body.get("code"), "4/0Aabc");
  });

  it("4. the same state cannot be replayed", async () => {
    clearGeminiCliStore();
    const started = startGeminiCliOAuth({ callbackUrl: GEMINI_CLI_DEFAULT_REDIRECT });
    const { fetchImpl } = makeFetch([
      (url) => (url.includes("oauth2.googleapis.com/token") ? json(200, okToken) : null),
      (url) => (url.includes("loadCodeAssist") ? json(200, loadCodeAssistBody) : null),
      (url) => (url.includes("userinfo") ? json(200, { email: "v@e.com" }) : null),
      (url) => (url.includes("retrieveUserQuota") ? json(200, { buckets: [] }) : null)
    ]);

    const pasted = `${GEMINI_CLI_DEFAULT_REDIRECT}?state=${started.state}&code=4%2F0Aabc`;
    await exchangeGeminiCliOAuth({ pastedUrl: pasted, fetchImpl });
    await assert.rejects(
      () => exchangeGeminiCliOAuth({ pastedUrl: pasted, fetchImpl }),
      /not found, was already used, or has expired/
    );
  });

  it("5. an unknown state is rejected before any network call", async () => {
    clearGeminiCliStore();
    const { fetchImpl, calls } = makeFetch([]);
    await assert.rejects(
      () =>
        exchangeGeminiCliOAuth({
          pastedUrl: `${GEMINI_CLI_DEFAULT_REDIRECT}?state=forged&code=x`,
          fetchImpl
        }),
      /not found, was already used, or has expired/
    );
    assert.equal(calls.length, 0);
  });

  it("6. access token refresh uses the stored refresh_token and caches the result", async () => {
    clearGeminiCliStore();
    const { fetchImpl, calls } = makeFetch([
      (url) =>
        url.includes("oauth2.googleapis.com/token")
          ? json(200, { access_token: "ya29.refreshed", expires_in: 3600 })
          : null
    ]);
    const creds = JSON.stringify({
      clientId: "681255809395-test.apps.googleusercontent.com",
      clientSecret: "GOCSPX-test",
      refreshToken: "1//refresh",
      projectId: "proj-1"
    });

    const first = await getGeminiCliAccessToken(creds, { fetchImpl });
    assert.equal(first.accessToken, "ya29.refreshed");
    assert.equal(first.projectId, "proj-1");

    const second = await getGeminiCliAccessToken(creds, { fetchImpl });
    assert.equal(second.accessToken, "ya29.refreshed");
    assert.equal(calls.length, 1, "second call must hit the in-memory cache");
  });

  it("7. CLI headers carry the ClientMetadata handshake Google fingerprints", () => {
    const headers = buildGeminiCliHeaders("ya29.token", { model: "gemini-2.5-pro" });
    assert.equal(headers.authorization, "Bearer ya29.token");
    assert.match(headers["user-agent"], /^GeminiCLI\//);
    assert.match(headers["x-goog-api-client"], /google-genai-sdk/);
    const meta = JSON.parse(headers["client-metadata"]);
    assert.equal(meta.ideType, 9);
    assert.equal(meta.pluginType, 2);
    assert.ok(Number.isInteger(meta.platform));
  });
});

describe("Gemini CLI wire translation", () => {
  it("8. OpenAI messages become a Cloud Code envelope", () => {
    const body = {
      messages: [
        { role: "system", content: "You are terse." },
        { role: "user", content: "Hi" }
      ],
      temperature: 0.4,
      max_tokens: 128,
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              additionalProperties: false
            }
          }
        }
      ]
    };
    const env = buildCloudCodeRequest("gemini-2.5-pro", body, "proj-1");
    assert.equal(env.project, "proj-1");
    assert.equal(env.model, "gemini-2.5-pro");
    assert.equal(env.userAgent, "gemini-cli");
    assert.equal(env.request.contents[0].role, "user");
    assert.equal(env.request.systemInstruction.parts[0].text, "You are terse.");
    assert.equal(env.request.generationConfig.temperature, 0.4);
    assert.equal(env.request.generationConfig.maxOutputTokens, 128);
    assert.equal(env.request.tools[0].functionDeclarations[0].name, "read_file");
    assert.equal(
      env.request.tools[0].functionDeclarations[0].parameters.additionalProperties,
      undefined
    );
    assert.equal(env.request.toolConfig.functionCallingConfig.mode, "VALIDATED");
  });

  it("9. tool calls and tool results map to functionCall / functionResponse", () => {
    const body = {
      messages: [
        { role: "user", content: "read it" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"a.txt"}' }
            }
          ]
        },
        { role: "tool", tool_call_id: "call_1", content: '{"ok":true}' }
      ]
    };
    const env = buildCloudCodeRequest("gemini-2.5-flash", body, "p");
    const modelTurn = env.request.contents.find((c) => c.role === "model");
    assert.equal(modelTurn.parts[0].functionCall.name, "read_file");
    assert.deepEqual(modelTurn.parts[0].functionCall.args, { path: "a.txt" });
    const toolTurn = env.request.contents.find((c) => c.parts?.[0]?.functionResponse);
    assert.equal(toolTurn.parts[0].functionResponse.name, "read_file");
    assert.deepEqual(toolTurn.parts[0].functionResponse.response, { result: { ok: true } });
  });

  it("10. Cloud Code responses unwrap into OpenAI chat completions", () => {
    const data = {
      response: {
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hello " }, { text: "Veta" }] },
            finishReason: "STOP"
          }
        ],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 }
      }
    };
    const out = cloudCodeToOpenAIResponse(data, "gemini-2.5-pro");
    assert.equal(out.object, "chat.completion");
    assert.equal(out.choices[0].message.content, "Hello Veta");
    assert.equal(out.choices[0].finish_reason, "stop");
    assert.equal(out.usage.total_tokens, 18);
  });

  it("11. streaming frames become OpenAI chunks and drop empty ones", () => {
    const frame = {
      response: {
        candidates: [{ content: { role: "model", parts: [{ text: "chunk" }] } }]
      }
    };
    const chunk = cloudCodeChunkToOpenAI(frame, "gemini-2.5-flash", "chatcmpl-1");
    assert.equal(chunk.object, "chat.completion.chunk");
    assert.equal(chunk.choices[0].delta.content, "chunk");
    assert.equal(chunk.choices[0].finish_reason, null);

    assert.equal(
      cloudCodeChunkToOpenAI({ response: { candidates: [{ content: { parts: [] } }] } }, "m", "id"),
      null
    );
  });

  it("13. tuple-style items and nested exclusiveMinimum are stripped (Gemini proto rejects both)", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "write",
            description: "Write a file",
            parameters: {
              $schema: "http://json-schema.org/draft-07/schema#",
              type: "object",
              properties: {
                // The exact shape that failed live: tuple items whose members carry exclusiveMinimum
                entries: {
                  type: "array",
                  items: [
                    { type: "string", minLength: 1 },
                    {
                      type: "object",
                      properties: {
                        value: {
                          type: "array",
                          items: [
                            { type: "number", exclusiveMinimum: 0 },
                            { type: "number", exclusiveMaximum: 100 }
                          ]
                        }
                      }
                    }
                  ]
                },
                nested: {
                  type: "object",
                  properties: {
                    deep: { type: "integer", exclusiveMinimum: 1, exclusiveMaximum: 9 }
                  },
                  additionalProperties: false
                }
              }
            }
          }
        }
      ]
    };

    const env = buildCloudCodeRequest("gemini-2.5-pro", body, "p");
    const schema = env.request.tools[0].functionDeclarations[0].parameters;

    // No forbidden keyword may survive anywhere in the tree.
    const serialized = JSON.stringify(schema);
    for (const forbidden of [
      "exclusiveMinimum",
      "exclusiveMaximum",
      "additionalProperties",
      "$schema"
    ]) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} must be stripped`);
    }

    // Gemini only accepts `items` as an object, never a tuple array.
    assert.equal(Array.isArray(schema.properties.entries.items), false);
    assert.equal(typeof schema.properties.entries.items, "object");
  });

  it("14. null unions and const collapse into Gemini-safe equivalents", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "pick",
            parameters: {
              type: "object",
              properties: {
                mode: { anyOf: [{ type: "string" }, { type: "null" }] },
                fixed: { const: "always" }
              }
            }
          }
        }
      ]
    };

    const env = buildCloudCodeRequest("gemini-2.5-pro", body, "p");
    const props = env.request.tools[0].functionDeclarations[0].parameters.properties;
    assert.equal(props.mode.type, "string");
    assert.equal(props.mode.anyOf, undefined);
    assert.deepEqual(props.fixed.enum, ["always"]);
    assert.equal(props.fixed.const, undefined);
  });

  it("15. generateContent endpoint constant points at Cloud Code Assist", () => {
    assert.equal(
      GEMINI_CLI_GENERATE_URL,
      "https://cloudcode-pa.googleapis.com/v1internal:generateContent"
    );
  });
});

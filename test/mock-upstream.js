import http from "node:http";

/**
 * Create a programmable mock upstream HTTP server simulating OpenAI and Anthropic official APIs.
 */
export async function createMockUpstream() {
  /** @type {Array<{ method: string, url: string, headers: Record<string, any>, body: any, aborted: boolean }>} */
  const requests = [];

  /** @type {(ctx: { method: string, url: string, headers: Record<string, any>, body: any, req: http.IncomingMessage, res: http.ServerResponse, record: any }) => Promise<boolean> | boolean} */
  let customHandler = null;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let parsedBody = null;
      if (rawBody) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = rawBody;
        }
      }

      const record = {
        method: req.method,
        url: req.url,
        headers: { ...req.headers },
        body: parsedBody,
        aborted: false
      };
      requests.push(record);

      res.on("close", () => {
        if (!res.writableFinished) {
          record.aborted = true;
        }
      });

      try {
        if (customHandler) {
          const handled = await customHandler({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: parsedBody,
            req,
            res,
            record
          });
          if (handled) return;
        }

        // Default responses for /models, /chat/completions, /embeddings, /messages
        if (req.method === "GET" && (req.url === "/v1/models" || req.url.endsWith("/models"))) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              object: "list",
              data: [
                { id: "gpt-4o", object: "model" },
                { id: "gpt-4o-mini", object: "model" },
                { id: "claude-sonnet-4-20250514", object: "model" }
              ]
            })
          );
          return;
        }

        if (req.method === "POST" && req.url.endsWith("/embeddings")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              object: "list",
              data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
              model: parsedBody?.model || "text-embedding-3-small",
              usage: { prompt_tokens: 4, total_tokens: 4 }
            })
          );
          return;
        }

        if (req.method === "POST" && req.url.endsWith("/chat/completions")) {
          if (parsedBody?.stream) {
            res.writeHead(200, {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-cache"
            });
            res.write(
              `data: ${JSON.stringify({
                id: "chatcmpl-mock-1",
                object: "chat.completion.chunk",
                model: parsedBody.model,
                choices: [{ index: 0, delta: { role: "assistant", content: "Hello " }, finish_reason: null }]
              })}\n\n`
            );
            setTimeout(() => {
              if (res.writableEnded || record.aborted) return;
              res.write(
                `data: ${JSON.stringify({
                  id: "chatcmpl-mock-1",
                  object: "chat.completion.chunk",
                  model: parsedBody.model,
                  choices: [{ index: 0, delta: { content: "world!" }, finish_reason: "stop" }],
                  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
                })}\n\n`
              );
              res.write("data: [DONE]\n\n");
              res.end();
            }, 10);
            return;
          }

          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: "chatcmpl-mock-1",
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: parsedBody?.model || "gpt-4o",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "Mock OpenAI reply" },
                  finish_reason: "stop"
                }
              ],
              usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 }
            })
          );
          return;
        }

        if (req.method === "POST" && req.url.endsWith("/messages")) {
          if (parsedBody?.stream) {
            res.writeHead(200, {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-cache"
            });
            res.write(
              `event: message_start\ndata: ${JSON.stringify({
                type: "message_start",
                message: {
                  id: "msg_mock_1",
                  type: "message",
                  role: "assistant",
                  model: parsedBody.model,
                  content: [],
                  stop_reason: null,
                  stop_sequence: null,
                  usage: { input_tokens: 14, output_tokens: 0 }
                }
              })}\n\n`
            );
            res.write(
              `event: content_block_start\ndata: ${JSON.stringify({
                type: "content_block_start",
                index: 0,
                content_block: { type: "text", text: "" }
              })}\n\n`
            );
            res.write(
              `event: content_block_delta\ndata: ${JSON.stringify({
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: "Mock Anthropic stream" }
              })}\n\n`
            );
            res.write(
              `event: content_block_stop\ndata: ${JSON.stringify({
                type: "content_block_stop",
                index: 0
              })}\n\n`
            );
            res.write(
              `event: message_delta\ndata: ${JSON.stringify({
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: { output_tokens: 7 }
              })}\n\n`
            );
            res.write(
              `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
            );
            res.end();
            return;
          }

          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: "msg_mock_1",
              type: "message",
              role: "assistant",
              model: parsedBody?.model || "claude-sonnet-4-20250514",
              content: [{ type: "text", text: "Mock Anthropic reply" }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 15, output_tokens: 8 }
            })
          );
          return;
        }

        if (req.method === "POST" && req.url.endsWith("/images/generations")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              created: Math.floor(Date.now() / 1000),
              data: [
                {
                  url: "https://example.com/mock-generated-image.png",
                  revised_prompt: parsedBody?.prompt || "mock prompt"
                }
              ]
            })
          );
          return;
        }

        if (req.method === "POST" && req.url.endsWith("/audio/speech")) {
          const fakeMp3 = Buffer.from("ID3-MOCK-MP3-AUDIO-BINARY-STREAM", "utf8");
          res.writeHead(200, {
            "content-type": "audio/mpeg",
            "content-length": String(fakeMp3.length)
          });
          res.end(fakeMp3);
          return;
        }

        if (req.method === "POST" && req.url.endsWith("/audio/transcriptions")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              text: "Mock transcribed audio text"
            })
          );
          return;
        }

        const cleanPath = req.url.split("?")[0];
        if (
          cleanPath.endsWith("/search") ||
          cleanPath.endsWith("/web/search") ||
          cleanPath.endsWith("/customsearch/v1")
        ) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              results: [
                {
                  title: "Mock Search Result 1",
                  url: "https://example.com/result-1",
                  content: "Mock search snippet one"
                },
                {
                  title: "Mock Search Result 2",
                  url: "https://example.com/result-2",
                  snippet: "Mock search snippet two"
                }
              ]
            })
          );
          return;
        }

        if (
          req.method === "POST" &&
          (cleanPath.endsWith("/scrape") ||
            cleanPath.endsWith("/extract") ||
            cleanPath.endsWith("/contents"))
        ) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                markdown: "# Mock Fetched Page\nHello from mock web fetch",
                metadata: {
                  title: "Mock Fetched Page"
                }
              }
            })
          );
          return;
        }

        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Not found" } }));
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
        }
        res.end(JSON.stringify({ error: { message: err?.message || "Mock error" } }));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    requests,
    setHandler(fn) {
      customHandler = fn;
    },
    reset() {
      requests.length = 0;
      customHandler = null;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

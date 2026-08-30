import * as http from "node:http";
import * as crypto from "node:crypto";
import { loadCredentials } from "../auth/credential-store.js";
import { adaptOpenAIToZed, createChatCompletionResponse, createSSEChunk } from "./adapter.js";
import { ZedCloudClient } from "./client.js";
import type { OpenAIChatRequest } from "./types.js";
import { ZED_MODELS } from "../models.js";
import { recordTokenUsage } from "../usage/tracker.js";
export interface BridgeServerInstance {
  port: number;
  baseUrl: string;
  stop: () => Promise<void>;
}

/**
 * Creates and starts an in-process OpenAI-compatible HTTP bridge server for Zed.
 */
export async function startBridgeServer(preferredPort = 38142): Promise<BridgeServerInstance> {
  const client = new ZedCloudClient();

  const server = http.createServer(async (req, res) => {
    // CORS headers for local tools
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlPath = req.url?.split("?")[0] || "";

    // 1. Health check
    if (urlPath === "/health" || urlPath === "/") {
      const creds = loadCredentials();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        service: "omp-extension-zed-bridge",
        authenticated: Boolean(creds?.accessToken || creds?.sessionCookie),
      }));
      return;
    }

    // 2. GET /v1/models
    if (req.method === "GET" && (urlPath === "/v1/models" || urlPath === "/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        object: "list",
        data: ZED_MODELS.map((m) => ({
          id: m.id,
          object: "model",
          created: 1700000000,
          owned_by: "zed",
        })),
      }));
      return;
    }

    // 3. POST /v1/chat/completions
    if (req.method === "POST" && (urlPath === "/v1/chat/completions" || urlPath === "/chat/completions")) {
      let bodyStr = "";
      req.on("data", (chunk) => {
        bodyStr += chunk;
      });

      req.on("end", async () => {
        try {
          const creds = loadCredentials();
          if (!creds || (!creds.accessToken && !creds.sessionCookie)) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              error: {
                message: "No Zed credentials found. Please run '/zed login' inside OMP.",
                type: "authentication_error",
                code: "unauthorized",
              },
            }));
            return;
          }

          const chatReq = JSON.parse(bodyStr) as OpenAIChatRequest;
          const zedReq = adaptOpenAIToZed(chatReq);
          const completionId = `chatcmpl-${crypto.randomUUID()}`;
          const isStream = chatReq.stream ?? true;

          if (isStream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
            });

            // Initial role chunk
            res.write(createSSEChunk(completionId, chatReq.model, { role: "assistant" }));

            let totalCompletionTokens = 0;

            try {
              for await (const event of client.streamCompletion(zedReq, creds)) {
                if (event.error) {
                  // Forward upstream error as SSE error before closing
                  const errChunk = JSON.stringify({
                    id: completionId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: chatReq.model,
                    choices: [{ index: 0, delta: { content: `Error: ${event.error}` }, finish_reason: "stop" }],
                  });
                  res.write(`data: ${errChunk}\n\n`);
                  break;
                }
                if (event.done) {
                  break;
                }
                if (event.reasoning) {
                  res.write(createSSEChunk(completionId, chatReq.model, { reasoning_content: event.reasoning }));
                }
                if (event.text) {
                  totalCompletionTokens += Math.max(1, Math.ceil(event.text.length / 4));
                  res.write(createSSEChunk(completionId, chatReq.model, { content: event.text }));
                }
                if (event.toolCall) {
                  totalCompletionTokens += Math.max(1, Math.ceil(event.toolCall.arguments.length / 4));
                  res.write(
                    createSSEChunk(completionId, chatReq.model, {
                      tool_calls: [
                        {
                          index: event.toolCall.index ?? 0,
                          id: event.toolCall.id,
                          type: "function",
                          function: {
                            name: event.toolCall.name,
                            arguments: event.toolCall.arguments,
                          },
                        },
                      ],
                    }),
                  );
                }
              }
              // Final stop chunk and [DONE]
              res.write(createSSEChunk(completionId, chatReq.model, {}, "stop"));
              res.write("data: [DONE]\n\n");
              res.end();

              const promptEstTokens = Math.ceil(bodyStr.length / 4);
              recordTokenUsage(chatReq.model, promptEstTokens, totalCompletionTokens);
            } catch (streamErr: unknown) {
              const errorMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
              // Streaming has already sent 200 headers – we must close the SSE stream gracefully
              // instead of hanging. Send an error delta then [DONE] so the OMP client stops "thinking".
              try {
                const errChunk = JSON.stringify({
                  id: completionId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: chatReq.model,
                  choices: [{ index: 0, delta: { content: `\n\n[Zed Error: ${errorMsg}]` }, finish_reason: "stop" }],
                });
                res.write(`data: ${errChunk}\n\n`);
                res.write(createSSEChunk(completionId, chatReq.model, {}, "stop"));
                res.write("data: [DONE]\n\n");
              } catch {}
              try {
                res.end();
              } catch {}
            }
          } else {
            try {
              const result = await client.complete(zedReq, creds);
              const promptEstTokens = Math.ceil(bodyStr.length / 4);
              const complEstTokens = Math.ceil(result.content.length / 4);

              recordTokenUsage(chatReq.model, promptEstTokens, complEstTokens);

              const respObj = createChatCompletionResponse(
                completionId,
                chatReq.model,
                result.content,
                promptEstTokens,
                complEstTokens,
              );

              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(respObj));
            } catch (nonStreamErr: unknown) {
              const errorMsg = nonStreamErr instanceof Error ? nonStreamErr.message : String(nonStreamErr);
              if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                  error: {
                    message: errorMsg,
                    type: "api_error",
                  },
                }));
              } else {
                try { res.end(); } catch {}
              }
            }
          }
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              error: {
                message: errorMsg,
                type: "api_error",
              },
            }));
          } else {
            try {
              res.end();
            } catch {}
          }
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Not found" } }));
  });

  return new Promise<BridgeServerInstance>((resolve, reject) => {
    // Try preferred port, or fall back to port 0 (dynamic available port)
    server.listen(preferredPort, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : preferredPort;
      const baseUrl = `http://127.0.0.1:${actualPort}/v1`;

      resolve({
        port: actualPort,
        baseUrl,
        stop: () => new Promise<void>((res) => server.close(() => res())),
      });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Fall back to dynamic OS-assigned port
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          const actualPort = typeof address === "object" && address ? address.port : 0;
          const baseUrl = `http://127.0.0.1:${actualPort}/v1`;
          resolve({
            port: actualPort,
            baseUrl,
            stop: () => new Promise<void>((res) => server.close(() => res())),
          });
        });
      } else {
        reject(err);
      }
    });
  });
}

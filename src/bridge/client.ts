import * as crypto from "node:crypto";
import type { ZedCredentials } from "../auth/types.js";
import type { ZedAssistantRequest } from "./types.js";
import { ZED_ENDPOINT, ZED_VERSION } from "./types.js";

export interface StreamEvent {
  text?: string;
  reasoning?: string;
  done?: boolean;
  error?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
    index?: number;
  };
}

function normalizeToken(raw: string | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/^Bearer\s+/i, "").replace(/\s+/g, "");
}

/**
 * Client for dispatching completion requests to Zed Cloud / API backend.
 * Verified against live endpoint 2026-08-12: POST https://cloud.zed.dev/completions
 */
export class ZedCloudClient {
  private readonly baseUrl: string;
  private readonly version: string;

  constructor(baseUrl = ZED_ENDPOINT, version = ZED_VERSION) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.version = version;
  }

  /**
   * Builds request headers with appropriate auth credentials.
   * Zed expects Bearer JWT plus Zed version headers.
   */
  private buildHeaders(creds: ZedCredentials): Record<string, string> {
    const token = normalizeToken(creds.accessToken);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "*/*",
      "User-Agent": `Zed/${this.version} (windows; x86_64)`,
      "X-Zed-Version": this.version,
      "X-Zed-Client-Supports-Status-Messages": "true",
      "X-Zed-Client-Supports-Stream-Ended-Request-Completion-Status": "true",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (creds.sessionCookie) {
      headers["Cookie"] = creds.sessionCookie.startsWith("zed.session=")
        ? creds.sessionCookie
        : `zed.session=${creds.sessionCookie}`;
    }

    return headers;
  }

  /**
   * Sends a completion request to Zed and streams back text / events.
   * Zed streams NDJSON (newline-delimited JSON) with event types:
   * - message_start
   * - content_block_start (tool_use)
   * - content_block_delta (text, partial_json, thinking)
   * - content_block_stop
   * - message_delta / message_stop
   * - status: stream_ended
   */
  async *streamCompletion(
    req: ZedAssistantRequest,
    creds: ZedCredentials,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const url = this.baseUrl; // already is https://cloud.zed.dev/completions
    const headers = this.buildHeaders(creds);

    // The token is required; fail fast with clear message
    if (!headers["Authorization"]) {
      throw new Error("Zed Authentication Failed: No access token found. Please run /zed login.");
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(req),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      let detail = errorText;
      try {
        const parsed = JSON.parse(errorText);
        detail = parsed.message || parsed.error?.message || errorText;
      } catch {
        // keep raw text
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Zed Authentication Failed (${response.status}): Please run /zed login. ${detail}`);
      }
      if (response.status === 429) {
        throw new Error(`Zed Rate Limit or Quota Exceeded: ${detail}`);
      }
      if (response.status === 451) {
        throw new Error(`Zed Geo-Blocked (451): Access not available from this data center. ${detail}`);
      }
      throw new Error(`Zed Cloud API error (${response.status}): ${detail}`);
    }

    if (!response.body) {
      throw new Error("Empty response body received from Zed API.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let currentToolCall: { id: string; name: string; arguments: string; index: number } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          // Skip SSE keepalives if any
          if (line.startsWith(":")) continue;

          // Zed may occasionally send SSE-style data: prefix, but primary is NDJSON.
          // Handle both.
          let jsonStr = line;
          if (line.startsWith("data: ")) {
            jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") {
              if (currentToolCall) {
                yield { toolCall: { ...currentToolCall } };
                currentToolCall = null;
              }
              yield { done: true };
              return;
            }
          }

          let json: Record<string, unknown>;
          try {
            json = JSON.parse(jsonStr);
          } catch {
            // Not JSON, treat as raw text (fallback for non-NDJSON)
            if (jsonStr) yield { text: jsonStr };
            continue;
          }

          // Handle status sentinel (some Zed versions send {status: "stream_ended"})
          if ((json as { status?: string }).status === "stream_ended") {
            if (currentToolCall) {
              yield { toolCall: { ...currentToolCall } };
              currentToolCall = null;
            }
            yield { done: true };
            return;
          }

          const event = (json as { event?: Record<string, unknown> }).event as Record<string, unknown> | undefined;
          if (!event || typeof event.type !== "string") {
            // Check for error payloads
            if (json.error || (json as { message?: string }).message) {
              const msg = (json as { error?: { message?: string } }).error?.message || (json as { message?: string }).message || JSON.stringify(json);
              yield { error: String(msg) };
            }
            continue;
          }

          const type = event.type as string;

          if (type === "message_start") {
            // Role preamble, nothing to yield except maybe usage
            continue;
          } else if (type === "content_block_start") {
            const block = event.content_block as { type?: string; id?: string; name?: string; input?: unknown } | undefined;
            if (block?.type === "tool_use") {
              currentToolCall = {
                index: typeof event.index === "number" ? event.index as number : 0,
                id: block.id || crypto.randomUUID(),
                name: block.name || "unknown",
                arguments: "",
              };
              const input = block.input;
              if (input && typeof input === "object" && Object.keys(input as object).length > 0) {
                currentToolCall.arguments += JSON.stringify(input);
              }
            } else if (block?.type === "thinking") {
              // Some models send thinking as a block; treat subsequent deltas as reasoning
              // No immediate yield, wait for delta
            }
          } else if (type === "content_block_delta") {
            const delta = event.delta as { text?: string; partial_json?: string; thinking?: string; reasoning?: string } | undefined;
            if (!delta) continue;
            if (typeof delta.text === "string" && delta.text.length > 0) {
              yield { text: delta.text };
            } else if (typeof delta.partial_json === "string" && delta.partial_json.length > 0) {
              if (currentToolCall) currentToolCall.arguments += delta.partial_json;
            } else if (typeof delta.thinking === "string" && delta.thinking.length > 0) {
              yield { reasoning: delta.thinking };
            } else if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
              yield { reasoning: delta.reasoning };
            } else if (typeof (delta as { reasoning_content?: string }).reasoning_content === "string" && (delta as { reasoning_content?: string }).reasoning_content!.length > 0) {
              yield { reasoning: (delta as { reasoning_content?: string }).reasoning_content! };
            }
          } else if (type === "content_block_stop") {
            if (currentToolCall) {
              yield { toolCall: { ...currentToolCall } };
              currentToolCall = null;
            }
          } else if (type === "message_delta") {
            const delta = event.delta as { stop_reason?: string } | undefined;
            const usage = event.usage as unknown;
            // finish reason handling is done by caller; we just note done if needed
            // If stop_reason is present, the next message_stop will finalize
            if (delta?.stop_reason) {
              // will be handled on message_stop, but also yield done if no further blocks
            }
            void usage;
          } else if (type === "message_stop") {
            if (currentToolCall) {
              yield { toolCall: { ...currentToolCall } };
              currentToolCall = null;
            }
            // End of message, but Zed may still send stream_ended status; we yield done
            // and wait for status or just continue until stream ends
            yield { done: true };
            // Don't return immediately; let stream_ended or done break close
          }
        }
      }

      // Flush remaining buffer as last line (could be incomplete JSON)
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        try {
          const json = JSON.parse(trimmed);
          const event = (json as { event?: { type?: string } }).event;
          if (event?.type === "content_block_delta" && (event as unknown as { delta?: { text?: string } }).delta?.text) {
            yield { text: (event as unknown as { delta: { text: string } }).delta.text };
          }
        } catch {
          // If it's not JSON but has text, yield it
          if (trimmed && !trimmed.startsWith("{")) {
            yield { text: trimmed };
          }
        }
      }

      if (currentToolCall) {
        yield { toolCall: { ...currentToolCall } };
      }
      yield { done: true };
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
  }

  /**
   * Executes a non-streaming completion request.
   */
  async complete(
    req: ZedAssistantRequest,
    creds: ZedCredentials,
    signal?: AbortSignal,
  ): Promise<{ content: string; reasoning?: string }> {
    let fullText = "";
    let fullReasoning = "";

    for await (const event of this.streamCompletion(req, creds, signal)) {
      if (event.text) fullText += event.text;
      if (event.reasoning) fullReasoning += event.reasoning;
      if (event.done) break;
    }

    return { content: fullText, reasoning: fullReasoning || undefined };
  }
}

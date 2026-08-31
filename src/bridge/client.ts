import * as crypto from "node:crypto";
import type { ZedCredentials } from "../auth/types.js";
import type { ZedAssistantRequest } from "./types.js";
import { ZED_ENDPOINT, ZED_VERSION } from "./types.js";
import { decodeJwtExp, isEncryptedPayload, isJwt, normalizeToken } from "../auth/token.js";

export interface StreamEvent {
  text?: string;
  reasoning?: string;
  done?: boolean;
  error?: string;
  toolCall?: { id: string; name: string; arguments: string; index?: number };
}

/**
 * Client for dispatching completion requests to Zed Cloud.
 */
export class ZedCloudClient {
  private readonly baseUrl: string;
  private readonly version: string;
  private cachedJwt: string | null = null;
  private cachedJwtExp = 0;

  constructor(baseUrl = ZED_ENDPOINT, version = ZED_VERSION) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.version = version;
  }

  private async resolveJwt(creds: ZedCredentials): Promise<string> {
    const rawAccess = creds.accessToken?.trim() || "";
    if (isEncryptedPayload(rawAccess)) throw new Error("Invalid Zed token: appears to be an encrypted value that was not decrypted. Please run /zed logout then /zed login again.");
    const normalized = normalizeToken(rawAccess);
    if (isJwt(normalized)) {
      const exp = decodeJwtExp(normalized);
      if (exp && Date.now() + 5 * 60 * 1000 < exp) return normalized;
      if (this.cachedJwt && Date.now() + 5 * 60 * 1000 < this.cachedJwtExp) return this.cachedJwt;
      if (!creds.userId) return normalized;
    }
    if (this.cachedJwt && Date.now() + 5 * 60 * 1000 < this.cachedJwtExp) return this.cachedJwt;
    const userId = creds.userId?.trim();
    const secretJson = rawAccess;
    if (userId && secretJson && secretJson.trim().startsWith("{")) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const resp = await fetch("https://cloud.zed.dev/client/llm_tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `${userId} ${secretJson}` },
          body: "{}",
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
        if (resp.ok) {
          const data = (await resp.json()) as { token?: string };
          if (data.token) {
            const jwt = normalizeToken(data.token);
            const exp = decodeJwtExp(jwt);
            this.cachedJwt = jwt;
            this.cachedJwtExp = exp || Date.now() + 55 * 60 * 1000;
            return jwt;
          }
        } else {
          const text = await resp.text().catch(() => "");
          if (!isJwt(normalized)) throw new Error(`JWT exchange failed (${resp.status}): ${text}`);
        }
      } catch (e) {
        if (!isJwt(normalized)) throw new Error(`Failed to exchange Zed access token for JWT. Please run /zed login again. ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (normalized) return normalized;
    throw new Error("No valid Zed JWT available. Please run /zed login.");
  }

  private buildHeadersWithJwt(jwt: string, sessionCookie?: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "*/*",
      "User-Agent": `Zed/${this.version} (windows; x86_64)`,
      "X-Zed-Version": this.version,
      "X-Zed-Client-Supports-Status-Messages": "true",
      "X-Zed-Client-Supports-Stream-Ended-Request-Completion-Status": "true",
    };
    if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
    if (sessionCookie) headers["Cookie"] = sessionCookie.startsWith("zed.session=") ? sessionCookie : `zed.session=${sessionCookie}`;
    return headers;
  }

  async *streamCompletion(req: ZedAssistantRequest, creds: ZedCredentials, signal?: AbortSignal): AsyncGenerator<StreamEvent, void, unknown> {
    const url = this.baseUrl;
    const jwt = await this.resolveJwt(creds);
    const headers = this.buildHeadersWithJwt(jwt, creds.sessionCookie);
    if (!headers["Authorization"]) throw new Error("Zed Authentication Failed: No access token found. Please run /zed login.");
    const effectiveSignal = signal || AbortSignal.timeout(60000);
    let response = await fetch(url, { method: "POST", headers, body: JSON.stringify(req), signal: effectiveSignal });

    if (!response.ok && response.status === 401) {
      const canRefresh = Boolean(this.cachedJwt || (creds.userId && creds.accessToken?.trim().startsWith("{")));
      if (canRefresh) {
        this.cachedJwt = null; this.cachedJwtExp = 0;
        try {
          const freshJwt = await this.resolveJwt(creds);
          if (freshJwt && freshJwt !== jwt) {
            const retryHeaders = this.buildHeadersWithJwt(freshJwt, creds.sessionCookie);
            const retrySignal = signal || AbortSignal.timeout(60000);
            response = await fetch(url, { method: "POST", headers: retryHeaders, body: JSON.stringify(req), signal: retrySignal });
          }
        } catch {}
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      let detail = errorText;
      try { const p = JSON.parse(errorText); detail = p.message || p.error?.message || errorText; } catch {}
      if (response.status === 401 || response.status === 403) throw new Error(`Zed Authentication Failed (${response.status}): Please run /zed login. ${detail}`);
      if (response.status === 429) throw new Error(`Zed Rate Limit or Quota Exceeded: ${detail}`);
      if (response.status === 451) throw new Error(`Zed Geo-Blocked (451): Access not available from this data center. ${detail}`);
      throw new Error(`Zed Cloud API error (${response.status}): ${detail}`);
    }
    if (!response.body) throw new Error("Empty response body received from Zed API.");

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
          if (!line || line.startsWith(":")) continue;
          let jsonStr = line;
          if (line.startsWith("data: ")) {
            jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") {
              if (currentToolCall) { yield { toolCall: { ...currentToolCall } }; currentToolCall = null; }
              yield { done: true }; return;
            }
          }
          let json: Record<string, unknown>;
          try { json = JSON.parse(jsonStr); } catch {
            if (jsonStr) yield { text: jsonStr };
            continue;
          }
          if (json && typeof json === "object" && "status" in json) {
            const statusVal = json.status;
            if (statusVal === "stream_ended") {
              if (currentToolCall) { yield { toolCall: { ...currentToolCall } }; currentToolCall = null; }
              yield { done: true }; return;
            }
            if (statusVal && typeof statusVal === "object" && "failed" in (statusVal as Record<string, unknown>)) {
              const failedObj = (statusVal as { failed: { message?: string; code?: string } }).failed;
              yield { error: failedObj?.message || (failedObj as { code?: string })?.code || JSON.stringify(failedObj) }; return;
            }
          }
          if (json && typeof json === "object" && ("candidates" in json || (json.event && typeof (json.event as Record<string, unknown>).candidates !== "undefined"))) {
            yield { error: "Unsupported Gemini stream shape (candidates) — re-add google parser if live. Payload: " + JSON.stringify(json).slice(0, 300) }; return;
          }
          const event = json && typeof json === "object" && "event" in json && json.event && typeof json.event === "object" ? (json.event as Record<string, unknown>) : (json as Record<string, unknown>);
          if (event && typeof event.type === "string" && event.type.startsWith("response.")) {
            yield { error: `Unsupported OpenAI Responses shape ${event.type} — re-add response.* parser if live` }; return;
          }
          if (!event || typeof event.type !== "string") {
            if (json && typeof json === "object" && ("error" in json || "message" in json)) {
              const errObj = "error" in json ? json.error : undefined;
              const errMsg = (errObj && typeof errObj === "object" && "message" in (errObj as Record<string, unknown>) ? (errObj as { message: unknown }).message : undefined) || ("message" in json ? json.message : undefined) || JSON.stringify(json);
              yield { error: String(errMsg) };
            }
            continue;
          }
          const type = event.type as string;
          if (type === "message_start") continue;
          else if (type === "content_block_start") {
            const block = event.content_block as { type?: string; id?: string; name?: string; input?: unknown } | undefined;
            if (block?.type === "tool_use") {
              if (currentToolCall) yield { toolCall: { ...currentToolCall } };
              currentToolCall = { index: typeof event.index === "number" ? event.index as number : 0, id: block.id || crypto.randomUUID(), name: block.name || "unknown", arguments: "" };
              const input = block.input;
              if (input && typeof input === "object" && Object.keys(input as object).length > 0) currentToolCall.arguments += JSON.stringify(input);
            }
          } else if (type === "content_block_delta") {
            const delta = event.delta as { text?: string; partial_json?: string; thinking?: string; reasoning?: string; reasoning_content?: string } | undefined;
            if (!delta) continue;
            if (typeof delta.text === "string" && delta.text.length > 0) yield { text: delta.text };
            else if (typeof delta.partial_json === "string" && delta.partial_json.length > 0) { if (currentToolCall) currentToolCall.arguments += delta.partial_json; }
            else if (typeof delta.thinking === "string" && delta.thinking.length > 0) yield { reasoning: delta.thinking };
            else if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) yield { reasoning: delta.reasoning };
            else if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) yield { reasoning: delta.reasoning_content };
          } else if (type === "content_block_stop") {
            if (currentToolCall) { yield { toolCall: { ...currentToolCall } }; currentToolCall = null; }
          } else if (type === "message_stop") {
            if (currentToolCall) { yield { toolCall: { ...currentToolCall } }; currentToolCall = null; }
            yield { done: true };
          }
        }
      }
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        try {
          const json = JSON.parse(trimmed);
          const event = (json as { event?: { type?: string } }).event;
          if (event?.type === "content_block_delta" && (event as unknown as { delta?: { text?: string } }).delta?.text) yield { text: (event as unknown as { delta: { text: string } }).delta.text };
        } catch {
          if (trimmed && !trimmed.startsWith("{")) yield { text: trimmed };
        }
      }
      if (currentToolCall) yield { toolCall: { ...currentToolCall } };
      yield { done: true };
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  async complete(req: ZedAssistantRequest, creds: ZedCredentials, signal?: AbortSignal): Promise<{ content: string; reasoning?: string }> {
    let fullText = ""; let fullReasoning = "";
    for await (const event of this.streamCompletion(req, creds, signal)) {
      if (event.text) fullText += event.text;
      if (event.reasoning) fullReasoning += event.reasoning;
      if (event.done) break;
    }
    return { content: fullText, reasoning: fullReasoning || undefined };
  }
}

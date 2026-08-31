import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startBridgeServer } from "../src/bridge/server.js";
import { saveCredentials, deleteCredentialsFile } from "../src/auth/credential-store.js";
const clearCredentials = deleteCredentialsFile;
import { ZED_ENDPOINT } from "../src/bridge/types.js";

// Helper to mock Zed NDJSON streaming response
function createMockZedResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c + "\n"));
        // small delay to simulate streaming
        await new Promise((r) => setTimeout(r, 5));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Zed Bridge Integration - Hang Fixes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearCredentials();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearCredentials();
  });

  it("streams successfully and terminates with [DONE] without hanging", async () => {
    // Save dummy JWT
    saveCredentials({ accessToken: "eyJhbGciOiJIUzI1NiJ9.test.payload" });

    const mockChunks = [
      JSON.stringify({ event: { type: "message_start", message: { model: "claude-sonnet-4-6" } } }),
      JSON.stringify({ event: { type: "content_block_delta", delta: { text: "Hello " } } }),
      JSON.stringify({ event: { type: "content_block_delta", delta: { text: "world!" } } }),
      JSON.stringify({ event: { type: "message_delta", delta: { stop_reason: "stop" } } }),
      JSON.stringify({ event: { type: "message_stop" } }),
      JSON.stringify({ status: "stream_ended" }),
    ];

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string | URL | Request, init?: unknown) => {
      const u = String(url);
      if (u === ZED_ENDPOINT || u === "https://cloud.zed.dev/completions") {
        return Promise.resolve(createMockZedResponse(mockChunks));
      }
      // For any other URL (bridge internal), use original fetch
      return originalFetch(u, init as RequestInit);
    });

    const bridge = await startBridgeServer(0);

    const res = await fetch(`http://127.0.0.1:${bridge.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "zed/claude-sonnet-4-6",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // Read SSE stream with timeout to detect hang
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let sseText = "";
    let done = false;
    const start = Date.now();
    const timeout = 5000;
    while (!done) {
      if (Date.now() - start > timeout) {
        throw new Error("Hang detected: SSE stream did not complete within 5s. Current buffer: " + sseText.slice(0, 500));
      }
      const { done: readerDone, value } = await reader.read();
      if (readerDone) break;
      sseText += decoder.decode(value, { stream: true });
      if (sseText.includes("data: [DONE]")) done = true;
    }

    expect(sseText).toContain("Hello");
    expect(sseText).toContain("world");
    expect(sseText).toContain("data: [DONE]");
    expect(sseText).toContain("chatcmpl-");

    // Ensure server properly closed – subsequent request should still work
    await bridge.stop();
    global.fetch = originalFetch;
  });

  it("does not hang when Zed returns 401 – forwards error and closes", async () => {
    saveCredentials({ accessToken: "invalid_jwt" });

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string | URL | Request, init?: unknown) => {
      const u = String(url);
      if (u === ZED_ENDPOINT || u === "https://cloud.zed.dev/completions") {
        return Promise.resolve(new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } }));
      }
      return originalFetch(u, init as RequestInit);
    });

    const bridge = await startBridgeServer(0);

    const res = await fetch(`http://127.0.0.1:${bridge.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "zed/gpt-5.4",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    });

    // For streaming, the bridge sends 200 + SSE error chunk, not 500, and must still terminate
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let sse = "";
    const start = Date.now();
    while (Date.now() - start < 3000) {
      const { done, value } = await reader.read();
      if (done) break;
      sse += decoder.decode(value, { stream: true });
      if (sse.includes("data: [DONE]")) break;
    }
    // Should contain error forwarding and still close with [DONE] – not hang
    expect(sse).toContain("data: [DONE]");
    expect(sse).toContain("Zed Error");

    await bridge.stop();
    global.fetch = originalFetch;
  });

  it("correctly translates OpenAI request to Zed envelope (provider mapping)", async () => {
    const { adaptOpenAIToZed, getZedProvider } = await import("../src/bridge/adapter.js");

    // Claude -> anthropic
    const claudeReq = adaptOpenAIToZed({ model: "zed/claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] } as any);
    expect(claudeReq.provider).toBe("anthropic");
    expect(claudeReq.model).toBe("claude-sonnet-4-6");
    expect(getZedProvider("claude-sonnet-5")).toBe("anthropic");

    // GPT -> open_ai
    const gptReq = adaptOpenAIToZed({ model: "zed/gpt-5.4", messages: [{ role: "user", content: "hi" }] } as any);
    expect(gptReq.provider).toBe("open_ai");
    expect(gptReq.model).toBe("gpt-5.4");
    expect(getZedProvider("gpt-5.6-sol")).toBe("open_ai");

    // Gemini -> google
    const gemReq = adaptOpenAIToZed({ model: "zed/gemini-3.5-flash", messages: [{ role: "user", content: "hi" }] } as any);
    expect(gemReq.provider).toBe("google");
    expect(gemReq.model).toBe("gemini-3.5-flash");

    // Dash variant handling
    const dashReq = adaptOpenAIToZed({ model: "zed/gpt-5-6-sol", messages: [{ role: "user", content: "hi" }] } as any);
    expect(dashReq.model).toBe("gpt-5.6-sol");
    expect(dashReq.provider).toBe("open_ai");
  });

  it("handles tool_use events without hanging", async () => {
    saveCredentials({ accessToken: "eyJhbGciOiJIUzI1NiJ9.test" });

    const mockChunks = [
      JSON.stringify({ event: { type: "message_start" } }),
      JSON.stringify({ event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "read_file", input: {} } } }),
      JSON.stringify({ event: { type: "content_block_delta", delta: { partial_json: '{"path":' } } }),
      JSON.stringify({ event: { type: "content_block_delta", delta: { partial_json: '"/tmp/test"}' } } }),
      JSON.stringify({ event: { type: "content_block_stop" } }),
      JSON.stringify({ event: { type: "message_delta", delta: { stop_reason: "tool_use" } } }),
      JSON.stringify({ event: { type: "message_stop" } }),
      JSON.stringify({ status: "stream_ended" }),
    ];

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string | URL | Request, init?: unknown) => {
      const u = String(url);
      if (u === ZED_ENDPOINT || u === "https://cloud.zed.dev/completions") {
        return Promise.resolve(createMockZedResponse(mockChunks));
      }
      return originalFetch(u, init as RequestInit);
    });

    const bridge = await startBridgeServer(0);
    const res = await fetch(`http://127.0.0.1:${bridge.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "zed/claude-sonnet-4-6",
        messages: [{ role: "user", content: "read file" }],
        tools: [{ type: "function", function: { name: "read_file", description: "read", parameters: { type: "object" } } }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("tool_calls");
    expect(text).toContain("read_file");
    expect(text).toContain("data: [DONE]");

    await bridge.stop();
    global.fetch = originalFetch;
  });
});

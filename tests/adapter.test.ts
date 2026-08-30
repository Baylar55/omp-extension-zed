import { describe, expect, it } from "vitest";
import {
  adaptOpenAIToZed,
  createChatCompletionResponse,
  createSSEChunk,
  extractTextContent,
  normalizeModelId,
} from "../src/bridge/adapter.js";
import type { OpenAIChatRequest } from "../src/bridge/types.js";

describe("Adapter utilities", () => {
  it("normalizes model IDs correctly", () => {
    expect(normalizeModelId("zed/claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(normalizeModelId("zed/claude-sonnet-4-6")).toBe("claude-sonnet-4.6");
    expect(normalizeModelId("claude-sonnet-4-5")).toBe("claude-sonnet-4.5");
    expect(normalizeModelId("gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(normalizeModelId("gpt-5-6-terra")).toBe("gpt-5.6-terra");
    expect(normalizeModelId("gpt-5.4")).toBe("gpt-5.4");
    expect(normalizeModelId("gpt-5-nano")).toBe("gpt-5-nano");
    expect(normalizeModelId("gemini-3.5-flash")).toBe("gemini-3.5-flash");
    expect(normalizeModelId("gemini-3-flash")).toBe("gemini-3-flash");
    expect(normalizeModelId("custom-model")).toBe("custom-model");
  });

  it("extracts text content from string and array shapes", () => {
    expect(extractTextContent("Hello world")).toBe("Hello world");
    expect(
      extractTextContent([
        { type: "text", text: "Line 1" },
        { type: "text", text: "Line 2" },
      ]),
    ).toBe("Line 1\nLine 2");
    expect(extractTextContent(undefined)).toBe("");
  });

  it("adapts OpenAI chat requests into Zed assistant format", () => {
    const req: OpenAIChatRequest = {
      model: "zed/claude-sonnet-4-6",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Write a quicksort in Python" },
        {
          role: "assistant",
          content: "Sure, here it is.",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: { name: "test_tool", arguments: '{"arg": 1}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_123", content: "Result: 42" },
      ],
      stream: true,
      temperature: 0.7,
    };

    const zedReq = adaptOpenAIToZed(req);

    expect(zedReq.model).toBe("claude-sonnet-4.6");
    expect(zedReq.messages.length).toBe(4);
    expect(zedReq.messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
    expect(zedReq.messages[1]).toEqual({
      role: "user",
      content: "Write a quicksort in Python",
    });
    expect(zedReq.messages[2]?.content).toContain("[Tool Call: test_tool");
    expect(zedReq.messages[3]?.content).toContain("[Tool Result for call_123]: Result: 42");
  });

  it("creates valid OpenAI SSE data chunks", () => {
    const chunkStr = createSSEChunk("chatcmpl-123", "claude-sonnet-4.6", { content: "Hello" });
    expect(chunkStr.startsWith("data: ")).toBe(true);
    expect(chunkStr.endsWith("\n\n")).toBe(true);

    const parsed = JSON.parse(chunkStr.replace(/^data: /, "").trim());
    expect(parsed.id).toBe("chatcmpl-123");
    expect(parsed.choices[0].delta.content).toBe("Hello");
  });

  it("creates valid ChatCompletion response objects", () => {
    const resp = createChatCompletionResponse("chatcmpl-456", "gpt-5.4", "Complete output", 10, 20);
    expect(resp.id).toBe("chatcmpl-456");
    expect(resp.choices[0]?.message.content).toBe("Complete output");
    expect(resp.usage?.total_tokens).toBe(30);
  });
});

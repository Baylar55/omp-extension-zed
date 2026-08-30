import * as crypto from "node:crypto";
import type {
  OpenAIChatChunk,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIMessage,
  ZedAssistantRequest,
} from "./types.js";

export const ZED_VERSION = "0.228.0+stable.203.8421009ef8a022df1196d54bb42fd94366ec0988";

/**
 * Maps public/OMP model IDs to internal Zed model identifiers.
 */
export function normalizeModelId(modelId: string): string {
  const cleanId = modelId.replace(/^zed\//, "");
  switch (cleanId) {
    // Claude series
    case "claude-sonnet-5":
      return "claude-sonnet-5";
    case "claude-sonnet-4-6":
    case "claude-sonnet-4.6":
      return "claude-sonnet-4.6";
    case "claude-sonnet-4-5":
    case "claude-sonnet-4.5":
      return "claude-sonnet-4.5";
    case "claude-haiku-4-5":
    case "claude-haiku-4.5":
      return "claude-haiku-4.5";

    // GPT-5.6 Sol, Terra, Luna
    case "gpt-5-6-sol":
    case "gpt-5.6-sol":
      return "gpt-5.6-sol";
    case "gpt-5-6-terra":
    case "gpt-5.6-terra":
      return "gpt-5.6-terra";
    case "gpt-5-6-luna":
    case "gpt-5.6-luna":
      return "gpt-5.6-luna";

    // GPT series
    case "gpt-5-5":
    case "gpt-5.5":
      return "gpt-5.5";
    case "gpt-5-4":
    case "gpt-5.4":
      return "gpt-5.4";
    case "gpt-5-3-codex":
    case "gpt-5.3-codex":
      return "gpt-5.3-codex";
    case "gpt-5-2":
    case "gpt-5.2":
      return "gpt-5.2";
    case "gpt-5-mini":
      return "gpt-5-mini";
    case "gpt-5-nano":
      return "gpt-5-nano";

    // Gemini series - note: Zed catalog uses preview suffix for 3.1
    case "gemini-3-1-pro":
    case "gemini-3.1-pro":
      return "gemini-3.1-pro-preview";
    case "gemini-3-1-pro-preview":
    case "gemini-3.1-pro-preview":
      return "gemini-3.1-pro-preview";
    case "gemini-3-5-flash":
    case "gemini-3.5-flash":
      return "gemini-3.5-flash";
    case "gemini-3-flash":
      return "gemini-3-flash";

    default:
      return cleanId;
  }
}

/**
 * Resolves the Zed provider key for a given model id.
 * Verified against GET https://cloud.zed.dev/models (2026-08-12):
 * - anthropic: claude-*
 * - open_ai: gpt-*
 * - google: gemini-*
 */
export function getZedProvider(modelId: string): string {
  const clean = normalizeModelId(modelId);
  if (clean.startsWith("claude-")) return "anthropic";
  if (clean.startsWith("gpt-")) return "open_ai";
  if (clean.startsWith("gemini-")) return "google";
  return "anthropic";
}

/**
 * Extracts pure string text from an OpenAI message content field.
 */
export function extractTextContent(content: OpenAIMessage["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" && part.text ? part.text : ""))
    .join("\n");
}

function safeJsonParse(str: string | undefined): unknown | null {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function openAiContentToZedBlocks(content: OpenAIMessage["content"]): unknown[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: unknown[] = [];
  for (const block of content) {
    if (!block) continue;
    const b = block as { type: string; text?: string; image_url?: { url: string } };
    if (b.type === "text" || (b.text !== undefined && b.type !== "image_url")) {
      if (b.text) blocks.push({ type: "text", text: b.text });
    } else if (b.type === "image_url") {
      const url = b.image_url?.url || "";
      const m = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
      if (m) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: m[1], data: m[2] },
        });
      }
      // non-data-URI images are skipped (Zed only accepts base64)
    } else if (b.type === "input_text" || b.type === "input_image") {
      // OpenAI Responses API blocks
      if (b.type === "input_text" && b.text) {
        blocks.push({ type: "text", text: b.text });
      } else if (b.type === "input_image") {
        const url = (b as unknown as { image_url?: string }).image_url || "";
        const m2 = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
        if (m2) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: m2[1], data: m2[2] },
          });
        }
      }
    }
  }
  return blocks;
}

function openAiToolToZed(tool: unknown): { name: string; description?: string; input_schema: unknown } | null {
  if (!tool) return null;
  const t = tool as { function?: { name?: string; description?: string; parameters?: unknown; input_schema?: unknown } ; name?: string; description?: string; parameters?: unknown };
  const fn = (t as { function?: unknown }).function ? (t as { function: { name?: string; description?: string; parameters?: unknown; input_schema?: unknown } }).function : (t as { name?: string; description?: string; parameters?: unknown; input_schema?: unknown });
  const name = (fn as { name?: string }).name || (t as { name?: string }).name;
  if (!name) return null;
  return {
    name,
    description: (fn as { description?: string }).description,
    input_schema: (fn as { parameters?: unknown }).parameters || (fn as { input_schema?: unknown }).input_schema || { type: "object", properties: {} },
  };
}

function openAiMessagesToZed(messages: OpenAIMessage[]): { messages: Array<{ role: string; content: unknown[] }>; system: string } {
  const zed: Array<{ role: string; content: unknown[] }> = [];
  const systemParts: string[] = [];

  for (const m of messages || []) {
    if (!m) continue;
    if (m.role === "system" || m.role === "developer") {
      const text = typeof m.content === "string"
        ? m.content
        : (m.content || []).map((b) => (b as { text?: string }).text || "").join("");
      if (text) systemParts.push(text);
      continue;
    }
    if (m.role === "user") {
      zed.push({ role: "user", content: openAiContentToZedBlocks(m.content) });
    } else if (m.role === "assistant") {
      const blocks: unknown[] = [];
      const textBlocks = openAiContentToZedBlocks(m.content);
      if (textBlocks.length) blocks.push(...textBlocks);
      for (const tc of m.tool_calls || []) {
        blocks.push({
          type: "tool_use",
          id: tc.id || crypto.randomUUID(),
          name: tc.function?.name,
          input: safeJsonParse(tc.function?.arguments) || {},
        });
      }
      if (blocks.length) zed.push({ role: "assistant", content: blocks });
      else if (textBlocks.length === 0 && (m.tool_calls?.length || 0) === 0) {
        // ensure at least empty assistant message if needed
      }
    } else if (m.role === "tool") {
      let text = "";
      if (typeof m.content === "string") text = m.content;
      else if (Array.isArray(m.content)) text = m.content.map((b) => (b as { text?: string }).text ?? "").join("");
      else if (m.content) text = JSON.stringify(m.content);
      zed.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id,
            content: [{ type: "text", text: text || "" }],
          },
        ],
      });
    } else {
      zed.push({ role: m.role === "assistant" ? "assistant" : "user", content: openAiContentToZedBlocks(m.content) });
    }
  }

  return { messages: zed, system: systemParts.join("\n\n") };
}

/**
 * Converts an OpenAI chat completions request into Zed's proprietary completions envelope.
 * Verified against live endpoint 2026-08-12 (cloud.zed.dev/completions).
 */
export function adaptOpenAIToZed(req: OpenAIChatRequest): ZedAssistantRequest {
  const modelId = normalizeModelId(req.model);
  const provider = getZedProvider(modelId);
  const { messages, system } = openAiMessagesToZed(req.messages);

  let tools: Array<{ name: string; description?: string; input_schema: unknown }> | undefined;
  if (Array.isArray(req.tools)) {
    const mapped = req.tools.map(openAiToolToZed).filter(Boolean) as Array<{ name: string; description?: string; input_schema: unknown }>;
    if (mapped.length > 0) tools = mapped;
  }

  const maxTokens = req.max_tokens || req.max_completion_tokens || 64000;
  const temperature = req.temperature ?? 1.0;

  // Tool protocol suffix is required for correct tool_use behavior (per verified proxy)
  const systemPrompt = system
    ? `${system}\n\n## Tool Protocol\n- Use native tool_use API only.\n- NEVER output XML tags like <tool>.\n- The user already sees tool output. Do not repeat it.`
    : "";

  const providerRequest: ZedAssistantRequest["provider_request"] = {
    model: modelId,
    max_tokens: maxTokens,
    messages,
    ...(tools && tools.length > 0 && { tools }),
    system: systemPrompt,
  };

  return {
    thread_id: crypto.randomUUID(),
    prompt_id: crypto.randomUUID(),
    intent: "user_prompt",
    provider,
    model: modelId,
    provider_request: providerRequest,
    system: systemPrompt,
    temperature,
  };
}

/**
 * Creates an OpenAI SSE data chunk formatted as `data: {...}\n\n`.
 */
export function createSSEChunk(
  id: string,
  model: string,
  delta: OpenAIChatChunk["choices"][0]["delta"],
  finishReason: string | null = null,
): string {
  const chunk: OpenAIChatChunk = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };

  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Creates a standard non-streaming OpenAI chat completion response object.
 */
export function createChatCompletionResponse(
  id: string,
  model: string,
  content: string,
  promptTokens = 0,
  completionTokens = 0,
): OpenAIChatResponse {
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

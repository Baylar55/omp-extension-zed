import * as crypto from "node:crypto";
import type {
  OpenAIChatChunk,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIMessage,
  OpenAITool,
  ZedAssistantRequest,
} from "./types.js";

export const ZED_VERSION = "0.228.0+stable.203.8421009ef8a022df1196d54bb42fd94366ec0988";

/**
 * Maps public/OMP model IDs to internal Zed model identifiers.
 */
export function normalizeModelId(modelId: string): string {
  const cleanId = modelId.replace(/^zed\//, "");
  switch (cleanId) {
    // Claude series (Zed catalog uses hyphenated version numbers)
    case "claude-sonnet-5":
      return "claude-sonnet-5";
    case "claude-sonnet-4-6":
    case "claude-sonnet-4.6":
      return "claude-sonnet-4-6";
    case "claude-sonnet-4-5":
    case "claude-sonnet-4.5":
      return "claude-sonnet-4-5";
    case "claude-haiku-4-5":
    case "claude-haiku-4.5":
      return "claude-haiku-4-5";

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
    case "gemini-3-1-pro-preview":
    case "gemini-3.1-pro-preview":
      return "gemini-3.1-pro-preview";
    case "gemini-3-5-flash":
    case "gemini-3.5-flash":
      return "gemini-3.5-flash";
    case "gemini-3-flash":
    case "gemini-3.0-flash":
      return "gemini-3-flash";

    // Short aliases (harness may send bare names)
    case "luna":
    case "gpt-luna":
    case "sol":
    case "gpt-sol":
      return cleanId.includes("luna") ? "gpt-5.6-luna" : "gpt-5.6-sol";
    case "terra":
    case "gpt-terra":
      return "gpt-5.6-terra";

    default: {
      const lower = cleanId.toLowerCase();
      if (lower === "luna" || lower.endsWith("/luna") || lower.includes("luna")) return "gpt-5.6-luna";
      if (lower === "sol" || lower.endsWith("/sol") || lower.includes("sol")) return "gpt-5.6-sol";
      if (lower === "terra" || lower.endsWith("/terra") || lower.includes("terra")) return "gpt-5.6-terra";
      return cleanId;
    }
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
  const lower = clean.toLowerCase();
  if (lower.startsWith("claude-") || lower.includes("claude")) return "anthropic";
  if (lower.startsWith("gpt-") || lower.includes("gpt") || lower.includes("luna") || lower.includes("sol") || lower.includes("terra")) return "open_ai";
  if (lower.startsWith("gemini-") || lower.includes("gemini")) return "google";
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

function extractSystemAndMessages(messages: OpenAIMessage[]): {
  cleanMessages: OpenAIMessage[];
  systemPrompt: string;
} {
  const systemParts: string[] = [];
  const cleanMessages: OpenAIMessage[] = [];

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
      const rawText = typeof m.content === "string"
        ? m.content
        : (m.content || []).map((b) => (b as { text?: string }).text || "").join("\n");

      if (rawText.includes("<system-reminder>") || rawText.includes("<system-reminder")) {
        const withoutReminder = rawText.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
        const reminderMatch = rawText.match(/<system-reminder>[\s\S]*?<\/system-reminder>/g);
        if (reminderMatch) systemParts.push(reminderMatch.join("\n"));
        if (withoutReminder) {
          cleanMessages.push({ ...m, content: withoutReminder });
        }
        continue;
      }
    }

    cleanMessages.push(m);
  }

  const combinedSystem = systemParts.join("\n\n");
  const systemPrompt = combinedSystem
    ? `${combinedSystem}\n\n## Tool Protocol\n- Use native tool_use API only.\n- NEVER output XML tags like <tool>.\n- The user already sees tool output. Do not repeat it.`
    : "";

  return { cleanMessages, systemPrompt };
}

function buildAnthropicRequest(
  modelId: string,
  cleanMessages: OpenAIMessage[],
  tools: OpenAITool[] | undefined,
  systemPrompt: string,
  maxTokens: number,
): ZedAssistantRequest["provider_request"] {
  const anthropicMessages: Array<{ role: string; content: unknown[] }> = [];

  for (const m of cleanMessages) {
    if (m.role === "user") {
      const blocks: unknown[] = [];
      if (typeof m.content === "string") {
        if (m.content) blocks.push({ type: "text", text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (!b) continue;
          const item = b as { type: string; text?: string; image_url?: { url: string } };
          if (item.type === "text" && item.text) {
            blocks.push({ type: "text", text: item.text });
          } else if (item.type === "image_url") {
            const url = item.image_url?.url || "";
            const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
            if (match) {
              blocks.push({
                type: "image",
                source: { type: "base64", media_type: match[1], data: match[2] },
              });
            }
          }
        }
      }
      if (blocks.length > 0) {
        anthropicMessages.push({ role: "user", content: blocks });
      }
    } else if (m.role === "assistant") {
      const blocks: unknown[] = [];
      const text = extractTextContent(m.content);
      if (text) blocks.push({ type: "text", text });
      for (const tc of m.tool_calls || []) {
        blocks.push({
          type: "tool_use",
          id: tc.id || crypto.randomUUID(),
          name: tc.function?.name,
          input: safeJsonParse(tc.function?.arguments) || {},
        });
      }
      if (blocks.length > 0) {
        anthropicMessages.push({ role: "assistant", content: blocks });
      }
    } else if (m.role === "tool") {
      let text = "";
      if (typeof m.content === "string") text = m.content;
      else if (Array.isArray(m.content)) text = m.content.map((b) => (b as { text?: string }).text ?? "").join("");
      else if (m.content) text = JSON.stringify(m.content);
      anthropicMessages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id,
            content: [{ type: "text", text: text || "" }],
          },
        ],
      });
    }
  }

  let mappedTools: unknown[] | undefined;
  if (tools && tools.length > 0) {
    mappedTools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters || { type: "object", properties: {} },
    }));
  }

  return {
    model: modelId,
    stream: true,
    max_tokens: maxTokens,
    messages: anthropicMessages,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    ...(mappedTools && mappedTools.length > 0 ? { tools: mappedTools } : {}),
  };
}

function buildOpenAiRequest(
  modelId: string,
  cleanMessages: OpenAIMessage[],
  tools: OpenAITool[] | undefined,
  systemPrompt: string,
  maxTokens: number,
): ZedAssistantRequest["provider_request"] {
  const input: unknown[] = [];

  for (const m of cleanMessages) {
    if (m.role === "user") {
      const blocks: unknown[] = [];
      if (typeof m.content === "string") {
        if (m.content) blocks.push({ type: "input_text", text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (!b) continue;
          const item = b as { type: string; text?: string; image_url?: { url?: string } | string };
          if ((item.type === "text" || item.type === "input_text") && item.text) {
            blocks.push({ type: "input_text", text: item.text });
          } else if (item.type === "image_url" || item.type === "input_image") {
            const url = typeof item.image_url === "object" ? item.image_url?.url : item.image_url;
            if (url) {
              blocks.push({ type: "input_image", image_url: url });
            }
          }
        }
      }
      if (blocks.length > 0) {
        input.push({ type: "message", role: "user", content: blocks });
      }
    } else if (m.role === "assistant") {
      const text = extractTextContent(m.content);
      if (text) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }
      for (const tc of m.tool_calls || []) {
        input.push({
          type: "function_call",
          call_id: tc.id || crypto.randomUUID(),
          name: tc.function?.name || "unknown",
          arguments: tc.function?.arguments || "{}",
        });
      }
    } else if (m.role === "tool") {
      let text = "";
      if (typeof m.content === "string") text = m.content;
      else if (Array.isArray(m.content)) text = m.content.map((b) => (b as { text?: string }).text ?? "").join("");
      else if (m.content) text = JSON.stringify(m.content);
      input.push({
        type: "function_call_output",
        call_id: m.tool_call_id,
        output: text || "",
      });
    }
  }

  let mappedTools: unknown[] | undefined;
  if (tools && tools.length > 0) {
    mappedTools = tools.map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters || { type: "object", properties: {} },
    }));
  }

  return {
    model: modelId,
    stream: true,
    input,
    max_output_tokens: maxTokens,
    ...(systemPrompt ? { instructions: systemPrompt } : {}),
    ...(mappedTools && mappedTools.length > 0 ? { tools: mappedTools } : {}),
  };
}

function buildGoogleRequest(
  modelId: string,
  cleanMessages: OpenAIMessage[],
  tools: OpenAITool[] | undefined,
  systemPrompt: string,
  maxTokens: number,
): ZedAssistantRequest["provider_request"] {
  const contents: unknown[] = [];
  // Map of tool_call_id -> tool_name to help associate tool responses
  const toolNameMap = new Map<string, string>();

  for (const m of cleanMessages) {
    if (m.role === "user") {
      const parts: unknown[] = [];
      if (typeof m.content === "string") {
        if (m.content) parts.push({ text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (!b) continue;
          const item = b as { type: string; text?: string; image_url?: { url: string } };
          if (item.type === "text" && item.text) {
            parts.push({ text: item.text });
          } else if (item.type === "image_url") {
            const url = item.image_url?.url || "";
            const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
            if (match) {
              parts.push({
                inlineData: { mimeType: match[1], data: match[2] },
              });
            }
          }
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "user", parts });
      }
    } else if (m.role === "assistant") {
      const parts: unknown[] = [];
      const text = extractTextContent(m.content);
      if (text) parts.push({ text });
      for (const tc of m.tool_calls || []) {
        if (tc.id && tc.function?.name) {
          toolNameMap.set(tc.id, tc.function.name);
        }
        parts.push({
          functionCall: {
            name: tc.function?.name || "unknown",
            args: safeJsonParse(tc.function?.arguments) || {},
          },
        });
      }
      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
    } else if (m.role === "tool") {
      let text = "";
      if (typeof m.content === "string") text = m.content;
      else if (Array.isArray(m.content)) text = m.content.map((b) => (b as { text?: string }).text ?? "").join("");
      else if (m.content) text = JSON.stringify(m.content);
      const toolName = (m.tool_call_id && toolNameMap.get(m.tool_call_id)) || "tool";
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: toolName,
              response: { output: text || "" },
            },
          },
        ],
      });
    }
  }

  let mappedTools: unknown[] | undefined;
  if (tools && tools.length > 0) {
    mappedTools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters || { type: "OBJECT", properties: {} },
        })),
      },
    ];
  }

  return {
    model: modelId,
    stream: true,
    contents,
    max_output_tokens: maxTokens,
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
    ...(mappedTools && mappedTools.length > 0 ? { tools: mappedTools } : {}),
  };
}

/**
 * Converts an OpenAI chat completions request into Zed's proprietary completions envelope.
 * Verified against live endpoint 2026-08-12 (cloud.zed.dev/completions).
 */
export function adaptOpenAIToZed(req: OpenAIChatRequest): ZedAssistantRequest {
  const modelId = normalizeModelId(req.model);
  const provider = getZedProvider(modelId);
  const { cleanMessages, systemPrompt } = extractSystemAndMessages(req.messages);

  let tools: OpenAITool[] | undefined = Array.isArray(req.tools) && req.tools.length > 0 ? req.tools : undefined;
  // For simple greeting with no tool need, skip tools
  const isSimpleGreeting =
    cleanMessages.length === 1 &&
    cleanMessages[0].role === "user" &&
    typeof cleanMessages[0].content === "string" &&
    cleanMessages[0].content.trim().toLowerCase() === "hi";

  if (isSimpleGreeting && tools && tools.length > 0) {
    tools = undefined;
  }

  const maxTokens = req.max_tokens || req.max_completion_tokens || 16384;
  const temperature = req.temperature ?? 1.0;

  let providerRequest: ZedAssistantRequest["provider_request"];
  if (provider === "open_ai") {
    providerRequest = buildOpenAiRequest(modelId, cleanMessages, tools, systemPrompt, maxTokens);
  } else if (provider === "google") {
    providerRequest = buildGoogleRequest(modelId, cleanMessages, tools, systemPrompt, maxTokens);
  } else {
    providerRequest = buildAnthropicRequest(modelId, cleanMessages, tools, systemPrompt, maxTokens);
  }

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

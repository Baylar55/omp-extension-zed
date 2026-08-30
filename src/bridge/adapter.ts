import type {
  OpenAIChatChunk,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIMessage,
  ZedAssistantRequest,
} from "./types.js";

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

    // Gemini series
    case "gemini-3-1-pro":
    case "gemini-3.1-pro":
      return "gemini-3.1-pro";
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
 * Extracts pure string text from an OpenAI message content field.
 */
export function extractTextContent(content: OpenAIMessage["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" && part.text ? part.text : ""))
    .join("\n");
}

/**
 * Converts an OpenAI chat completions request into Zed's internal assistant format.
 */
export function adaptOpenAIToZed(req: OpenAIChatRequest): ZedAssistantRequest {
  const zedMessages: Array<{ role: string; content: string }> = [];

  for (const msg of req.messages) {
    const text = extractTextContent(msg.content);

    if (msg.role === "system" || msg.role === "developer") {
      zedMessages.push({
        role: "system",
        content: text,
      });
    } else if (msg.role === "user") {
      zedMessages.push({
        role: "user",
        content: text,
      });
    } else if (msg.role === "assistant") {
      let content = text;
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const toolDescriptions = msg.tool_calls
          .map((tc) => `[Tool Call: ${tc.function.name}(${tc.function.arguments})]`)
          .join("\n");
        content = content ? `${content}\n${toolDescriptions}` : toolDescriptions;
      }
      zedMessages.push({
        role: "assistant",
        content,
      });
    } else if (msg.role === "tool") {
      zedMessages.push({
        role: "user",
        content: `[Tool Result for ${msg.tool_call_id || "call"}]: ${text}`,
      });
    }
  }

  return {
    model: normalizeModelId(req.model),
    messages: zedMessages,
    stream: req.stream ?? true,
    temperature: req.temperature,
    tools: req.tools,
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

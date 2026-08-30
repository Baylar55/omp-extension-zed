/**
 * OpenAI Chat Completions and Zed Protocol Types.
 */

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer";
  content?: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?: unknown;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
}

export interface OpenAIChatChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export const ZED_ENDPOINT = "https://cloud.zed.dev/completions";
export const ZED_VERSION = "0.228.0+stable.203.8421009ef8a022df1196d54bb42fd94366ec0988";

export interface ZedAssistantRequest {
  thread_id: string;
  prompt_id: string;
  intent: "user_prompt";
  provider: string;
  model: string;
  provider_request: {
    model: string;
    max_tokens: number;
    messages: Array<{
      role: string;
      content: unknown[];
    }>;
    tools?: Array<{
      name: string;
      description?: string;
      input_schema: unknown;
    }>;
    system: string;
  };
  system: string;
  temperature: number;
}

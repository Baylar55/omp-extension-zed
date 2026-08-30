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

export interface ZedAssistantRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  stream?: boolean;
  temperature?: number;
  tools?: unknown[];
}

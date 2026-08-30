import type { OpenAIChatChunk, OpenAIChatRequest, OpenAIChatResponse, OpenAIMessage, ZedAssistantRequest } from "./types.js";
/**
 * Maps public/OMP model IDs to internal Zed model identifiers.
 */
export declare function normalizeModelId(modelId: string): string;
/**
 * Extracts pure string text from an OpenAI message content field.
 */
export declare function extractTextContent(content: OpenAIMessage["content"]): string;
/**
 * Converts an OpenAI chat completions request into Zed's internal assistant format.
 */
export declare function adaptOpenAIToZed(req: OpenAIChatRequest): ZedAssistantRequest;
/**
 * Creates an OpenAI SSE data chunk formatted as `data: {...}\n\n`.
 */
export declare function createSSEChunk(id: string, model: string, delta: OpenAIChatChunk["choices"][0]["delta"], finishReason?: string | null): string;
/**
 * Creates a standard non-streaming OpenAI chat completion response object.
 */
export declare function createChatCompletionResponse(id: string, model: string, content: string, promptTokens?: number, completionTokens?: number): OpenAIChatResponse;
//# sourceMappingURL=adapter.d.ts.map
import type { OpenAIChatChunk, OpenAIChatRequest, OpenAIChatResponse, OpenAIMessage, ZedAssistantRequest } from "./types.js";
export declare const ZED_VERSION = "0.228.0+stable.203.8421009ef8a022df1196d54bb42fd94366ec0988";
/**
 * Maps public/OMP model IDs to internal Zed model identifiers.
 */
export declare function normalizeModelId(modelId: string): string;
/**
 * Resolves the Zed provider key for a given model id.
 * Verified against GET https://cloud.zed.dev/models (2026-08-12):
 * - anthropic: claude-*
 * - open_ai: gpt-*
 * - google: gemini-*
 */
export declare function getZedProvider(modelId: string): string;
/**
 * Extracts pure string text from an OpenAI message content field.
 */
export declare function extractTextContent(content: OpenAIMessage["content"]): string;
/**
 * Converts an OpenAI chat completions request into Zed's proprietary completions envelope.
 * Verified against live endpoint 2026-08-12 (cloud.zed.dev/completions).
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
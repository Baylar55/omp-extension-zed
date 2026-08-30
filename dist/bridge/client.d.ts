import type { ZedCredentials } from "../auth/types.js";
import type { ZedAssistantRequest } from "./types.js";
export interface StreamEvent {
    text?: string;
    reasoning?: string;
    done?: boolean;
    error?: string;
    toolCall?: {
        id: string;
        name: string;
        arguments: string;
        index?: number;
    };
}
/**
 * Client for dispatching completion requests to Zed Cloud / API backend.
 * Verified against live endpoint 2026-08-12: POST https://cloud.zed.dev/completions
 */
export declare class ZedCloudClient {
    private readonly baseUrl;
    private readonly version;
    constructor(baseUrl?: string, version?: string);
    /**
     * Builds request headers with appropriate auth credentials.
     * Zed expects Bearer JWT plus Zed version headers.
     */
    private buildHeaders;
    /**
     * Sends a completion request to Zed and streams back text / events.
     * Zed streams NDJSON (newline-delimited JSON) with event types:
     * - message_start
     * - content_block_start (tool_use)
     * - content_block_delta (text, partial_json, thinking)
     * - content_block_stop
     * - message_delta / message_stop
     * - status: stream_ended
     */
    streamCompletion(req: ZedAssistantRequest, creds: ZedCredentials, signal?: AbortSignal): AsyncGenerator<StreamEvent, void, unknown>;
    /**
     * Executes a non-streaming completion request.
     */
    complete(req: ZedAssistantRequest, creds: ZedCredentials, signal?: AbortSignal): Promise<{
        content: string;
        reasoning?: string;
    }>;
}
//# sourceMappingURL=client.d.ts.map
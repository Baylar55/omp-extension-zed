import type { ZedCredentials } from "../auth/types.js";
import type { ZedAssistantRequest } from "./types.js";
export interface StreamEvent {
    text?: string;
    reasoning?: string;
    done?: boolean;
    error?: string;
}
/**
 * Client for dispatching completion requests to Zed Cloud / API backend.
 */
export declare class ZedCloudClient {
    private readonly baseUrl;
    constructor(baseUrl?: string);
    /**
     * Builds request headers with appropriate auth credentials.
     */
    private buildHeaders;
    /**
     * Sends a completion request to Zed and streams back text / events.
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
export interface BridgeServerInstance {
    port: number;
    baseUrl: string;
    stop: () => Promise<void>;
}
/**
 * Creates and starts an in-process OpenAI-compatible HTTP bridge server for Zed.
 */
export declare function startBridgeServer(preferredPort?: number): Promise<BridgeServerInstance>;
//# sourceMappingURL=server.d.ts.map
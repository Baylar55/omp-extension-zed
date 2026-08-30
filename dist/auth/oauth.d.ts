import type { ZedCredentials } from "./types.js";
/**
 * Opens a URL in the user's default web browser across Windows, macOS, and Linux.
 */
export declare function openBrowser(targetUrl: string): void;
/**
 * Runs a local loopback server to capture Zed's OAuth / session callback.
 */
export declare function startOAuthFlow(port?: number): Promise<ZedCredentials>;
//# sourceMappingURL=oauth.d.ts.map
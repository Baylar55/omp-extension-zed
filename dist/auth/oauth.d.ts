import type { ZedCredentials } from "./types.js";
/**
 * Opens a URL in the user's default web browser across Windows, macOS, and Linux.
 */
export declare function openBrowser(targetUrl: string): void;
/**
 * Runs a local loopback server and initiates Zed's native RSA PKCS#1 sign-in flow.
 */
export declare function startOAuthFlow(preferredPort?: number): Promise<ZedCredentials>;
//# sourceMappingURL=oauth.d.ts.map
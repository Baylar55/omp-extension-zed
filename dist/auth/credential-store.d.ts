import type { ZedCredentials } from "./types.js";
/**
 * Returns the directory where OMP agent configuration and extension secrets reside.
 */
export declare function getOmpAgentDir(): string;
/**
 * Returns the path to the stored Zed credentials file.
 */
export declare function getCredentialsFilePath(): string;
/**
 * Reads stored credentials from disk, checking environment variables first.
 */
export declare function loadCredentials(): ZedCredentials | null;
/**
 * Persists Zed credentials to disk.
 */
export declare function saveCredentials(creds: ZedCredentials): void;
/**
 * Clears stored credentials from disk.
 */
export declare function clearCredentials(): boolean;
/**
 * Formats a secret string with masking for safe console / UI display.
 */
export declare function maskSecret(secret: string | undefined): string;
//# sourceMappingURL=credential-store.d.ts.map
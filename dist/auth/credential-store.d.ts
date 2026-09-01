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
 * Attempts to read Zed credentials from the operating system's native keychain / credential manager.
 */
export declare function getSystemZedCredentials(): ZedCredentials | null;
/**
 * Options for loading credentials.
 */
export interface LoadCredentialsOptions {
    /** Skip scanning OS keychain / Credential Manager */
    skipSystem?: boolean;
}
/**
 * Reads stored credentials from disk or environment variables.
 */
export declare function loadCredentials(options?: LoadCredentialsOptions): ZedCredentials | null;
/**
 * Persists Zed credentials to disk, merging with existing values.
 */
export declare function saveCredentials(creds: Partial<ZedCredentials>): void;
/**
 * Removes stored credential file entirely from disk.
 */
export declare function deleteCredentialsFile(): boolean;
/**
 * Formats a secret string with masking for safe console / UI display.
 */
export declare function maskSecret(secret: string | undefined): string;
//# sourceMappingURL=credential-store.d.ts.map
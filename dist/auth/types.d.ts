/**
 * Authentication and credential types for Zed.
 */
export interface ZedCredentials {
    /** Access token or credential JSON token for Zed Cloud / API */
    accessToken?: string;
    /** Browser session cookie (`zed.session=...`) for dashboard.zed.dev / billing API */
    sessionCookie?: string;
    /** User's GitHub username or display name */
    githubUsername?: string;
    /** Zed user identifier */
    userId?: string;
    /** Timestamp in milliseconds when the credential was saved */
    savedAt?: number;
    /** Source where credentials were discovered from */
    source?: "env" | "file" | "system_keychain" | "oauth" | "manual";
    /** Whether the user explicitly logged out */
    loggedOut?: boolean;
}
export type AuthMethod = "oauth" | "cookie" | "token" | "env";
export interface LoginResult {
    success: boolean;
    credentials?: ZedCredentials;
    error?: string;
}
//# sourceMappingURL=types.d.ts.map
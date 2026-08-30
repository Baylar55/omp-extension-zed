/**
 * Authentication and credential types for Zed.
 */
export interface ZedCredentials {
    /** Bearer access token for Zed Cloud / API */
    accessToken?: string;
    /** Browser session cookie (`zed.session=...`) for dashboard.zed.dev / billing API */
    sessionCookie?: string;
    /** User's GitHub username */
    githubUsername?: string;
    /** Zed user identifier */
    userId?: string;
    /** Timestamp in milliseconds when the credential was saved */
    savedAt?: number;
}
export type AuthMethod = "oauth" | "cookie" | "token" | "env";
export interface LoginResult {
    success: boolean;
    credentials?: ZedCredentials;
    error?: string;
}
//# sourceMappingURL=types.d.ts.map
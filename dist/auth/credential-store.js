import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
/**
 * Returns the directory where OMP agent configuration and extension secrets reside.
 */
export function getOmpAgentDir() {
    if (process.env["PI_CODING_AGENT_DIR"]) {
        return process.env["PI_CODING_AGENT_DIR"];
    }
    const xdgData = process.env["XDG_DATA_HOME"];
    if (xdgData) {
        return path.join(xdgData, "omp", "agent");
    }
    return path.join(os.homedir(), ".omp", "agent");
}
/**
 * Returns the path to the stored Zed credentials file.
 */
export function getCredentialsFilePath() {
    return path.join(getOmpAgentDir(), "zed_auth.json");
}
/**
 * Attempts to read Zed credentials from the operating system's native keychain / credential manager.
 */
export function getSystemZedCredentials() {
    const platform = os.platform();
    try {
        if (platform === "win32") {
            const psScript = `
$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class CredManager {
    [DllImport("Advapi32.dll", SetLastError = true, EntryPoint = "CredReadW", CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("Advapi32.dll", SetLastError = true, EntryPoint = "CredFree")]
    public static extern void CredFree(IntPtr credentialPtr);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    public static string Read(string target) {
        IntPtr credPtr;
        if (CredRead(target, 1, 0, out credPtr)) {
            try {
                CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
                if (cred.CredentialBlob != IntPtr.Zero && cred.CredentialBlobSize > 0) {
                    byte[] bytes = new byte[cred.CredentialBlobSize];
                    Marshal.Copy(cred.CredentialBlob, bytes, 0, cred.CredentialBlobSize);
                    return cred.UserName + "|" + Encoding.UTF8.GetString(bytes);
                }
            } finally {
                CredFree(credPtr);
            }
        }
        return null;
    }
}
"@
Add-Type -TypeDefinition $code -Language CSharp
$targets = @('zed:url=https://zed.dev', 'https://zed.dev', 'zed.dev')
foreach ($t in $targets) {
    $res = [CredManager]::Read($t)
    if ($res) {
        Write-Output "FOUND|$res"
        break
    }
}
`;
            const encoded = Buffer.from(psScript, "utf16le").toString("base64");
            const out = execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
                encoding: "utf-8",
                timeout: 4000,
                stdio: ["ignore", "pipe", "ignore"],
            });
            const match = out.split("\n").find((l) => l.startsWith("FOUND|"));
            if (match) {
                const raw = match.trim().slice(6);
                const [userName, ...rest] = raw.split("|");
                const token = rest.join("|");
                if (token) {
                    return {
                        accessToken: token,
                        userId: userName || undefined,
                        source: "system_keychain",
                        savedAt: Date.now(),
                    };
                }
            }
        }
        else if (platform === "darwin") {
            const targets = ["https://zed.dev", "zed.dev"];
            for (const target of targets) {
                try {
                    const out = execSync(`security find-generic-password -s "${target}" -w`, {
                        encoding: "utf-8",
                        timeout: 2000,
                        stdio: ["ignore", "pipe", "ignore"],
                    }).trim();
                    if (out) {
                        return {
                            accessToken: out,
                            source: "system_keychain",
                            savedAt: Date.now(),
                        };
                    }
                }
                catch {
                    // Try next target
                }
            }
        }
        else if (platform === "linux") {
            try {
                const out = execSync(`secret-tool lookup service https://zed.dev`, {
                    encoding: "utf-8",
                    timeout: 2000,
                    stdio: ["ignore", "pipe", "ignore"],
                }).trim();
                if (out) {
                    return {
                        accessToken: out,
                        source: "system_keychain",
                        savedAt: Date.now(),
                    };
                }
            }
            catch {
                // Secret-tool not found or empty
            }
        }
    }
    catch {
        // Ignore system credential errors
    }
    return null;
}
/**
 * Attempts to find a live `zed.session` cookie from local browser profiles (e.g. Firefox).
 */
export function findBrowserSessionCookie() {
    try {
        const appData = process.env["APPDATA"] || path.join(os.homedir(), "AppData", "Roaming");
        const ffProfilesDir = path.join(appData, "Mozilla", "Firefox", "Profiles");
        if (fs.existsSync(ffProfilesDir)) {
            const profiles = fs.readdirSync(ffProfilesDir);
            for (const prof of profiles) {
                const cookieDbPath = path.join(ffProfilesDir, prof, "cookies.sqlite");
                if (fs.existsSync(cookieDbPath)) {
                    try {
                        const tmpPath = path.join(os.tmpdir(), `ff_cookie_scan_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`);
                        fs.copyFileSync(cookieDbPath, tmpPath);
                        // Read SQLite using binary buffer scan for fast dependency-free extraction
                        const dbBuf = fs.readFileSync(tmpPath);
                        try {
                            fs.unlinkSync(tmpPath);
                        }
                        catch { }
                        const text = dbBuf.toString("latin1");
                        const sessionIdx = text.indexOf("zed.session");
                        if (sessionIdx !== -1) {
                            // Find cookie signature pattern (e.g. standard base64 signature with sid json)
                            const match = text.slice(Math.max(0, sessionIdx - 100), sessionIdx + 400).match(/([A-Za-z0-9+/=]{40,}==?\{"sid":"[a-f0-9-]+"\})/);
                            if (match?.[1]) {
                                return match[1];
                            }
                        }
                    }
                    catch {
                        // Ignore individual profile read errors
                    }
                }
            }
        }
    }
    catch {
        // Ignore browser scan errors
    }
    return null;
}
function isPlausibleJwt(token) {
    const t = token.trim();
    return t.startsWith("eyJ") && t.split(".").length === 3 && t.length > 20;
}
function isEncryptedPayload(token) {
    const t = token.trim();
    // RSA 2048 encrypted payload is 256 bytes -> 344 chars base64/base64url, not JWT, not JSON
    return t.length >= 300 && t.length <= 500 && !isPlausibleJwt(t) && !t.trim().startsWith("{") && /^[A-Za-z0-9-_+/=]+$/.test(t);
}
/**
 * Reads stored credentials from disk, checking environment variables and system keychain.
 */
export function loadCredentials(options) {
    // 1. Check environment variables
    const envToken = process.env["ZED_AUTH_TOKEN"] || process.env["ZED_TOKEN"] || process.env["ZED_ACCESS_TOKEN"];
    const envCookie = process.env["ZED_SESSION_COOKIE"] || process.env["ZED_COOKIE"];
    const envUserId = process.env["ZED_USER_ID"];
    if (envToken || envCookie) {
        // Validate env token is not an undecrypted payload
        if (envToken && isEncryptedPayload(envToken)) {
            // Treat as invalid, force re-login
            return null;
        }
        return {
            accessToken: envToken,
            sessionCookie: envCookie,
            userId: envUserId,
            source: "env",
            savedAt: Date.now(),
        };
    }
    // 2. Check stored file in OMP agent directory
    const filePath = getCredentialsFilePath();
    let fileCreds = null;
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed.loggedOut) {
                return null;
            }
            if (parsed.accessToken || parsed.sessionCookie) {
                fileCreds = {
                    ...parsed,
                    source: parsed.source || "file",
                };
            }
        }
    }
    catch {
        // Ignore corrupt/unreadable files
    }
    if (fileCreds) {
        // Detect undecrypted RSA payload saved due to prior bug – treat as logged out
        if (fileCreds.accessToken && isEncryptedPayload(fileCreds.accessToken)) {
            // Auto-clear invalid file to force re-login
            try {
                const fp = getCredentialsFilePath();
                if (fs.existsSync(fp))
                    fs.unlinkSync(fp);
            }
            catch { }
            return null;
        }
        if (!fileCreds.sessionCookie && !options?.skipSystem) {
            const browserCookie = findBrowserSessionCookie();
            if (browserCookie) {
                fileCreds.sessionCookie = browserCookie;
            }
        }
        return fileCreds;
    }
    // 3. Auto-discover from OS native Credential Manager / Keychain if enabled
    if (!options?.skipSystem) {
        const sysCreds = getSystemZedCredentials();
        if (sysCreds && sysCreds.accessToken) {
            const browserCookie = findBrowserSessionCookie();
            if (browserCookie) {
                sysCreds.sessionCookie = browserCookie;
            }
            // Cache discovered credentials for subsequent instantaneous lookups
            saveCredentials(sysCreds);
            return sysCreds;
        }
    }
    return null;
}
/**
 * Persists Zed credentials to disk, merging with existing values.
 */
export function saveCredentials(creds) {
    const existing = loadCredentials({ skipSystem: true }) || {};
    const toSave = {
        ...existing,
        ...creds,
        savedAt: Date.now(),
    };
    delete toSave.loggedOut;
    const dir = getOmpAgentDir();
    fs.mkdirSync(dir, { recursive: true });
    const filePath = getCredentialsFilePath();
    fs.writeFileSync(filePath, JSON.stringify(toSave, null, 2), "utf-8");
}
/**
 * Clears stored credentials and marks state as logged out.
 */
export function clearCredentials() {
    const filePath = getCredentialsFilePath();
    try {
        const dir = getOmpAgentDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify({ loggedOut: true, savedAt: Date.now() }, null, 2), "utf-8");
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Removes stored credential file entirely from disk.
 */
export function deleteCredentialsFile() {
    const filePath = getCredentialsFilePath();
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
    }
    catch {
        // Ignore
    }
    return false;
}
/**
 * Formats a secret string with masking for safe console / UI display.
 */
export function maskSecret(secret) {
    if (!secret)
        return "None";
    if (secret.length <= 8)
        return "••••••••";
    return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}
//# sourceMappingURL=credential-store.js.map
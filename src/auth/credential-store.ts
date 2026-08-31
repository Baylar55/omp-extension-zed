import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import type { ZedCredentials } from "./types.js";

/**
 * Returns the directory where OMP agent configuration and extension secrets reside.
 */
export function getOmpAgentDir(): string {
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
export function getCredentialsFilePath(): string {
  return path.join(getOmpAgentDir(), "zed_auth.json");
}

/**
 * Attempts to read Zed credentials from the operating system's native keychain / credential manager.
 */
export function getSystemZedCredentials(): ZedCredentials | null {
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
    } else if (platform === "darwin") {
      const targets = ["https://zed.dev", "zed.dev"];
      for (const target of targets) {
        try {
          const out = execFileSync("security", ["find-generic-password", "-s", target, "-w"], {
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
        } catch {
          // Try next target
        }
      }
    } else if (platform === "linux") {
      try {
        const out = execFileSync("secret-tool", ["lookup", "service", "https://zed.dev"], {
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
      } catch {
        // Secret-tool not found or empty
      }
    }
  } catch {
    // Ignore system credential errors
  }
  return null;
}


/**
 * Options for loading credentials.
 */
export interface LoadCredentialsOptions {
  /** Skip scanning OS keychain / Credential Manager */
  skipSystem?: boolean;
}
import { isEncryptedPayload } from "./token.js";

/**
 * Reads stored credentials from disk, checking environment variables and system keychain.
 */
export function loadCredentials(options?: LoadCredentialsOptions): ZedCredentials | null {
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
  let fileCreds: ZedCredentials | null = null;
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as ZedCredentials;
      if (!parsed.loggedOut && (parsed.accessToken || parsed.sessionCookie)) {
        fileCreds = {
          ...parsed,
          source: parsed.source || "file",
        };
      }
    }
  } catch {
    // Ignore corrupt/unreadable files
  }

  if (fileCreds) {
    if (fileCreds.accessToken && isEncryptedPayload(fileCreds.accessToken)) {
      try {
        const fp = getCredentialsFilePath();
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch {}
      return null;
    }
    return fileCreds;
  }

  if (!options?.skipSystem) {
    const sysCreds = getSystemZedCredentials();
    if (sysCreds && sysCreds.accessToken) {
      saveCredentials(sysCreds);
      return sysCreds;
    }
  }
  return null;
}

/**
 * Persists Zed credentials to disk, merging with existing values.
 */
export function saveCredentials(creds: Partial<ZedCredentials>): void {
  const existing = loadCredentials({ skipSystem: true }) || {};
  const toSave: ZedCredentials = {
    ...existing,
    ...creds,
    savedAt: Date.now(),
  };
  delete toSave.loggedOut;

  const dir = getOmpAgentDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const filePath = getCredentialsFilePath();
  fs.writeFileSync(filePath, JSON.stringify(toSave, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {}
}
/**
 * Removes stored credential file entirely from disk.
 */
export function deleteCredentialsFile(): boolean {
  const filePath = getCredentialsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Formats a secret string with masking for safe console / UI display.
 */
export function maskSecret(secret: string | undefined): string {
  if (!secret) return "None";
  if (secret.length <= 8) return "••••••••";
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

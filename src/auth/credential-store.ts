import * as crypto from "node:crypto";
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

function getWindowsChromiumKey(localStatePath: string): Buffer | null {
  if (!fs.existsSync(localStatePath)) return null;
  try {
    const localState = JSON.parse(fs.readFileSync(localStatePath, "utf-8")) as { os_crypt?: { encrypted_key?: string } };
    const encryptedKeyB64 = localState?.os_crypt?.encrypted_key;
    if (!encryptedKeyB64) return null;
    const encryptedKey = Buffer.from(encryptedKeyB64, "base64");
    const keyData = encryptedKey.subarray(5);

    const psScript = `
$csharp = @"
using System;
using System.Runtime.InteropServices;
public class Dpapi {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DATA_BLOB {
        public int cbData;
        public IntPtr pbData;
    }
    [DllImport("Crypt32.dll", SetLastError=true, CharSet=CharSet.Auto)]
    public static extern bool CryptUnprotectData(
        ref DATA_BLOB pDataIn,
        string szDataDescr,
        ref DATA_BLOB pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        ref DATA_BLOB pDataOut
    );
    public static byte[] Decrypt(byte[] cipherText) {
        DATA_BLOB inBlob = new DATA_BLOB();
        DATA_BLOB outBlob = new DATA_BLOB();
        DATA_BLOB entropy = new DATA_BLOB();
        inBlob.cbData = cipherText.Length;
        inBlob.pbData = Marshal.AllocHGlobal(cipherText.Length);
        Marshal.Copy(cipherText, 0, inBlob.pbData, cipherText.Length);
        try {
            if (CryptUnprotectData(ref inBlob, null, ref entropy, IntPtr.Zero, IntPtr.Zero, 0, ref outBlob)) {
                byte[] result = new byte[outBlob.cbData];
                Marshal.Copy(outBlob.pbData, result, 0, outBlob.cbData);
                return result;
            }
        } finally {
            if (inBlob.pbData != IntPtr.Zero) Marshal.FreeHGlobal(inBlob.pbData);
        }
        return null;
    }
}
"@
Add-Type -TypeDefinition $csharp
$enc = [Convert]::FromBase64String('${keyData.toString("base64")}')
$dec = [Dpapi]::Decrypt($enc)
if ($dec) { [Convert]::ToBase64String($dec) }
`;
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");
    const out = execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
      encoding: "utf-8",
      timeout: 4000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = out.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("<") && !l.startsWith("#"));
    const b64 = lines[lines.length - 1];
    return b64 ? Buffer.from(b64, "base64") : null;
  } catch {
    return null;
  }
}

function decryptChromiumValue(key: Buffer, buffer: Buffer): string | null {
  try {
    const prefix = buffer.subarray(0, 3).toString("utf8");
    if (prefix !== "v10" && prefix !== "v11") return null;
    const nonce = buffer.subarray(3, 15);
    const ciphertextWithTag = buffer.subarray(15);
    const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
    const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, undefined, "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

function copyLockedFileWindows(src: string, dst: string): boolean {
  try {
    const psScript = `
$src = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(src, "utf-8").toString("base64")}'))
$dst = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(dst, "utf-8").toString("base64")}'))
$s = [System.IO.File]::Open($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$ms = New-Object System.IO.MemoryStream
$s.CopyTo($ms)
$s.Close()
[System.IO.File]::WriteAllBytes($dst, $ms.ToArray())
`;
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");
    execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
      stdio: "ignore",
      timeout: 3000,
    });
    return fs.existsSync(dst) && fs.statSync(dst).size > 0;
  } catch {
    return false;
  }
}

/**
 * Attempts to find a live `zed.session` cookie from local browser profiles (Chrome, Edge, Brave, Firefox).
 */
export function findBrowserSessionCookie(): string | null {
  const platform = os.platform();
  const candidates: string[] = [];

  // 1. Scan Firefox profiles across platforms
  try {
    const ffBase =
      platform === "win32"
        ? path.join(process.env["APPDATA"] || path.join(os.homedir(), "AppData", "Roaming"), "Mozilla", "Firefox", "Profiles")
        : platform === "darwin"
          ? path.join(os.homedir(), "Library", "Application Support", "Firefox", "Profiles")
          : path.join(os.homedir(), ".mozilla", "firefox");

    if (fs.existsSync(ffBase)) {
      const profiles = fs.readdirSync(ffBase);
      for (const prof of profiles) {
        const cookieDbPath = path.join(ffBase, prof, "cookies.sqlite");
        if (!fs.existsSync(cookieDbPath)) continue;
        const tmpPath = path.join(os.tmpdir(), `ff_c_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`);
        try {
          fs.copyFileSync(cookieDbPath, tmpPath);
          const dbBuf = fs.readFileSync(tmpPath);
          try { fs.unlinkSync(tmpPath); } catch {}

          const text = dbBuf.toString("latin1");
          const needle = "zed.session";
          let idx = 0;
          while ((idx = text.indexOf(needle, idx)) !== -1) {
            const after = text.slice(idx + needle.length, idx + needle.length + 500);
            const match = after.match(/([A-Za-z0-9+/=_-]{30,}==?\{"sid":"[a-f0-9-]+"\})/);
            if (match?.[1]) {
              candidates.push(match[1]);
            }
            idx += needle.length;
          }
        } catch {
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
        }
      }
    }
  } catch {}

  // 2. Scan Chromium browsers (Chrome, Edge, Brave) on Windows
  if (platform === "win32") {
    try {
      const localAppData = process.env["LOCALAPPDATA"] || path.join(os.homedir(), "AppData", "Local");
      const chromiumBrowsers = [
        path.join(localAppData, "Google", "Chrome", "User Data"),
        path.join(localAppData, "Microsoft", "Edge", "User Data"),
        path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data"),
      ];

      for (const root of chromiumBrowsers) {
        const localState = path.join(root, "Local State");
        if (!fs.existsSync(localState)) continue;
        const key = getWindowsChromiumKey(localState);
        if (!key) continue;

        let profiles: string[] = [];
        try {
          profiles = fs.readdirSync(root).filter((d) => d === "Default" || d.startsWith("Profile "));
        } catch {
          continue;
        }

        for (const prof of profiles) {
          const cookiePaths = [
            path.join(root, prof, "Network", "Cookies"),
            path.join(root, prof, "Cookies"),
          ];

          for (const cp of cookiePaths) {
            if (!fs.existsSync(cp)) continue;
            const tmp = path.join(os.tmpdir(), `cr_c_${Date.now()}_${Math.random().toString(36).slice(2)}.sqlite`);
            if (copyLockedFileWindows(cp, tmp)) {
              try {
                const buf = fs.readFileSync(tmp);
                try { fs.unlinkSync(tmp); } catch {}
                const needle = Buffer.from("zed.session");
                let offset = 0;
                while ((offset = buf.indexOf(needle, offset)) !== -1) {
                  const slice = buf.subarray(offset, offset + 600);
                  let v10Idx = slice.indexOf(Buffer.from("v10"));
                  if (v10Idx === -1) v10Idx = slice.indexOf(Buffer.from("v11"));
                  if (v10Idx !== -1) {
                    for (let len = 40; len < 400; len++) {
                      const dec = decryptChromiumValue(key, slice.subarray(v10Idx, v10Idx + len));
                      if (dec && dec.includes('"sid":')) {
                        candidates.push(dec);
                        break;
                      }
                    }
                  }
                  offset += needle.length;
                }
              } catch {
                try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
              }
            }
          }
        }
      }
    } catch {}
  }

  return candidates[0] || null;
}

/**
 * Options for loading credentials.
 */
export interface LoadCredentialsOptions {
  /** Skip scanning OS keychain / Credential Manager */
  skipSystem?: boolean;
  /** Allow scanning browser cookie stores (only for explicit sync) */
  allowBrowserScan?: boolean;
}
function isPlausibleJwt(token: string): boolean {
  const t = token.trim();
  return t.startsWith("eyJ") && t.split(".").length === 3 && t.length > 20;
}

function isEncryptedPayload(token: string): boolean {
  const t = token.trim();
  // RSA 2048 encrypted payload is 256 bytes -> 344 chars base64/base64url, not JWT, not JSON
  return t.length >= 300 && t.length <= 500 && !isPlausibleJwt(t) && !t.trim().startsWith("{") && /^[A-Za-z0-9-_+/=]+$/.test(t);
}

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
    // Detect undecrypted RSA payload saved due to prior bug – treat as logged out
    if (fileCreds.accessToken && isEncryptedPayload(fileCreds.accessToken)) {
      // Auto-clear invalid file to force re-login
      try {
        const fp = getCredentialsFilePath();
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch {}
      return null;
    }
    if (!fileCreds.sessionCookie && options?.allowBrowserScan) {
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
      if (options?.allowBrowserScan) {
        const browserCookie = findBrowserSessionCookie();
        if (browserCookie) {
          sysCreds.sessionCookie = browserCookie;
        }
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
 * Clears stored credentials and marks state as logged out.
 */
export function clearCredentials(): boolean {
  return deleteCredentialsFile();
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

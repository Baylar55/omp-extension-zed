import * as crypto from "node:crypto";
import * as http from "node:http";
import * as url from "node:url";
import { execFile } from "node:child_process";
import type { ZedCredentials } from "./types.js";
import { saveCredentials } from "./credential-store.js";

const DEFAULT_CALLBACK_PORT = 35711;

const ALLOWED_BROWSER_HOSTS: Record<string, true> = {
  "zed.dev": true,
  "dashboard.zed.dev": true,
  "cloud.zed.dev": true,
};

/**
 * Validates that a target URL belongs to trusted Zed domains and uses HTTPS.
 */
export function isValidZedUrl(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "https:") return false;
    return Boolean(ALLOWED_BROWSER_HOSTS[parsed.hostname.toLowerCase()]);
  } catch {
    return false;
  }
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isLocalHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true;
  const clean = hostHeader.split(":")[0]?.toLowerCase();
  return clean === "127.0.0.1" || clean === "localhost";
}

/**
 * Opens a URL in the user's default web browser across Windows, macOS, and Linux.
 */
export function openBrowser(targetUrl: string): void {
  if (!isValidZedUrl(targetUrl)) {
    return;
  }
  const platform = process.platform;
  if (platform === "win32") {
    execFile("cmd.exe", ["/c", "start", "", targetUrl], () => {});
  } else if (platform === "darwin") {
    execFile("open", [targetUrl], () => {});
  } else {
    execFile("xdg-open", [targetUrl], () => {});
  }
}

/**
 * Generates an RSA 2048-bit keypair formatted for Zed's PKCS#1 DER native_app_signin.
 */
function generateZedKeypair(): {
  publicKeyBase64Url: string;
  privateKeyPem: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "pkcs1",
      format: "der",
    },
    privateKeyEncoding: {
      type: "pkcs1",
      format: "pem",
    },
  });

  const publicKeyBase64Url = publicKey.toString("base64url");
  return { publicKeyBase64Url, privateKeyPem: privateKey };
}

/**
 * Decrypts the Base64URL-encoded token sent back by zed.dev.
 * Tries multiple encodings (base64url, base64) and paddings (PKCS1, OAEP)
 * because Zed's behavior has varied across versions.
 */
function decryptZedToken(encryptedTokenBase64Url: string, privateKeyPem: string): string {
  const candidates: Buffer[] = [];
  // Try base64url first, then standard base64, then URL-decoded
  const trimmed = encryptedTokenBase64Url.trim();
  const urlDecoded = decodeURIComponent(trimmed);
  for (const enc of [trimmed, urlDecoded]) {
    for (const encoding of ["base64url", "base64"] as const) {
      try {
        const buf = Buffer.from(enc, encoding);
        if (buf.length === 256 || buf.length === 128) {
          candidates.push(buf);
        } else if (buf.length > 0) {
          candidates.push(buf);
        }
      } catch {}
    }
  }
  // Deduplicate
  const seen = new Set<string>();
  const unique: Buffer[] = [];
  for (const b of candidates) {
    const key = b.toString("base64");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(b);
    }
  }

  const paddings = [
    crypto.constants.RSA_PKCS1_PADDING,
    crypto.constants.RSA_PKCS1_OAEP_PADDING,
  ];

  let lastErr: unknown;
  for (const buf of unique) {
    for (const padding of paddings) {
      try {
        const opts: any = {
          key: privateKeyPem,
          padding,
        };
        if (padding === crypto.constants.RSA_PKCS1_OAEP_PADDING) {
          // Try both sha1 and sha256 for OAEP
          for (const oaepHash of ["sha1", "sha256"] as const) {
            try {
              const decrypted = crypto.privateDecrypt(
                { ...opts, oaepHash } as any,
                buf,
              );
              const text = decrypted.toString("utf-8").trim();
              if (text) return text;
            } catch (e) {
              lastErr = e;
            }
          }
          continue;
        }
        const decrypted = crypto.privateDecrypt(opts as any, buf);
        const text = decrypted.toString("utf-8").trim();
        if (text) return text;
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function isPlausibleJwt(token: string): boolean {
  const t = token.trim();
  return t.startsWith("eyJ") && t.split(".").length === 3 && t.length > 20;
}

/**
 * Runs a local loopback server and initiates Zed's native RSA PKCS#1 sign-in flow.
 */
export async function startOAuthFlow(preferredPort = DEFAULT_CALLBACK_PORT): Promise<ZedCredentials> {
  return new Promise<ZedCredentials>((resolve, reject) => {
    // Generate RSA keypair for this login session
    const { publicKeyBase64Url, privateKeyPem } = generateZedKeypair();

    const server = http.createServer((req, res) => {
      try {
        const host = req.headers["host"];
        if (!isLocalHost(host)) {
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end("Forbidden: Invalid host header.");
          return;
        }

        const parsedUrl = url.parse(req.url || "", true);
        const query = parsedUrl.query;
        const rawAccessToken = (query["access_token"] || query["token"]) as string | undefined;
        const userId = query["user_id"] as string | undefined;
        const sessionCookie = query["session"] as string | undefined;

        if (rawAccessToken) {
          let accessToken = rawAccessToken.trim();
          let wasEncrypted = false;

          // Detect encrypted RSA payload (344 chars base64 for 2048-bit, not a JWT)
          const looksEncrypted = accessToken.length >= 300 && !isPlausibleJwt(accessToken) && !accessToken.trim().startsWith("{");
          if (looksEncrypted) {
            wasEncrypted = true;
            try {
              const decrypted = decryptZedToken(accessToken, privateKeyPem);
              // Only use decrypted if it looks like a real token
              if (isPlausibleJwt(decrypted) || decrypted.trim().startsWith("{")) {
                accessToken = decrypted;
              } else {
                throw new Error(`Decrypted token does not look valid: ${decrypted.slice(0, 20)}...`);
              }
            } catch (e) {
              const safeError = escapeHtml(e instanceof Error ? e.message : String(e));
              res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
              res.end(`
                <!DOCTYPE html><html><body style="font-family:system-ui;background:#121212;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh"><div style="background:#1e1e1e;padding:2rem;border-radius:12px;text-align:center;max-width:480px;border:1px solid #333">
                <h1 style="color:#f87171">Decryption failed</h1>
                <p>Could not decrypt Zed token. Please close this window, run <code>/zed logout</code> then <code>/zed login</code> again.</p>
                <p style="color:#a1a1aa;font-size:0.9rem">Error: ${safeError}</p>
                </div></body></html>
              `);
              server.close();
              reject(new Error(`Failed to decrypt Zed token: ${e instanceof Error ? e.message : String(e)}`));
              return;
            }
          } else {
            // Try decryption opportunistically for any non-JWT token that might be encrypted
            if (!isPlausibleJwt(accessToken) && accessToken.length > 100) {
              try {
                const maybe = decryptZedToken(accessToken, privateKeyPem);
                if (isPlausibleJwt(maybe) || maybe.trim().startsWith("{")) {
                  accessToken = maybe;
                  wasEncrypted = true;
                }
              } catch {
                // keep original
              }
            }
          }

          // Final validation: must be JWT or JSON secret
          if (!isPlausibleJwt(accessToken) && !accessToken.trim().startsWith("{") && accessToken.length < 20) {
            res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`
              <!DOCTYPE html><html><body style="font-family:system-ui;background:#121212;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh"><div style="background:#1e1e1e;padding:2rem;border-radius:12px;text-align:center;max-width:480px;border:1px solid #333">
              <h1 style="color:#f87171">Invalid token</h1>
              <p>Received token does not look valid. Please try <code>/zed login</code> again.</p>
              </div></body></html>
            `);
            server.close();
            reject(new Error(`Invalid token received from Zed (length ${accessToken.length}, encrypted=${wasEncrypted})`));
            return;
          }

          const creds: ZedCredentials = {
            accessToken,
            sessionCookie,
            userId,
          };

          saveCredentials(creds);

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Zed Pro Authenticated</title>
              <style>
                body { font-family: system-ui, sans-serif; background: #121212; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                .card { background: #1e1e1e; padding: 2.5rem; border-radius: 14px; box-shadow: 0 8px 30px rgba(0,0,0,0.6); text-align: center; max-width: 420px; border: 1px solid #333; }
                h1 { color: #4ade80; font-size: 1.6rem; margin-bottom: 0.75rem; }
                p { color: #a1a1aa; font-size: 1rem; line-height: 1.5; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>✓ Zed Pro Authenticated!</h1>
                <p>Your Zed account is now successfully connected to Oh My Pi.</p>
                <p>You can close this browser window and return to your terminal.</p>
              </div>
            </body>
            </html>
          `);

          server.close();
          resolve(creds);
        } else {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Authentication failed: No access token received in redirect.");
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal error processing callback.");
        server.close();
        reject(err);
      }
    });

    server.listen(preferredPort, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : preferredPort;

      // Zed's official native signin endpoint
      const signinUrl = `https://zed.dev/native_app_signin?native_app_port=${actualPort}&native_app_public_key=${publicKeyBase64Url}`;
      openBrowser(signinUrl);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Retry with a dynamic port if default port is taken
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          const actualPort = typeof address === "object" && address ? address.port : 0;
          const signinUrl = `https://zed.dev/native_app_signin?native_app_port=${actualPort}&native_app_public_key=${publicKeyBase64Url}`;
          openBrowser(signinUrl);
        });
      } else {
        reject(err);
      }
    });

    // Auto-timeout after 3 minutes if user abandons browser
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Zed login timed out after 3 minutes."));
    }, 180000);

    server.on("close", () => {
      clearTimeout(timeout);
    });
  });
}

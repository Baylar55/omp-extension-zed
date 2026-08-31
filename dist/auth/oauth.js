import * as crypto from "node:crypto";
import * as http from "node:http";
import * as url from "node:url";
import { execFile } from "node:child_process";
import { saveCredentials } from "./credential-store.js";
import { isPlausibleJwt } from "./token.js";
const DEFAULT_CALLBACK_PORT = 35711;
const ALLOWED_BROWSER_HOSTS = {
    "zed.dev": true,
    "dashboard.zed.dev": true,
    "cloud.zed.dev": true,
};
/**
 * Validates that a target URL belongs to trusted Zed domains and uses HTTPS.
 */
export function isValidZedUrl(targetUrl) {
    try {
        const parsed = new URL(targetUrl);
        if (parsed.protocol !== "https:")
            return false;
        return Boolean(ALLOWED_BROWSER_HOSTS[parsed.hostname.toLowerCase()]);
    }
    catch {
        return false;
    }
}
function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function isLocalHost(hostHeader) {
    if (!hostHeader)
        return true;
    const clean = hostHeader.split(":")[0]?.toLowerCase();
    return clean === "127.0.0.1" || clean === "localhost";
}
/**
 * Opens a URL in the user's default web browser across Windows, macOS, and Linux.
 */
export function openBrowser(targetUrl) {
    if (!isValidZedUrl(targetUrl)) {
        return;
    }
    const platform = process.platform;
    if (platform === "win32") {
        execFile("cmd.exe", ["/c", "start", "", targetUrl], () => { });
    }
    else if (platform === "darwin") {
        execFile("open", [targetUrl], () => { });
    }
    else {
        execFile("xdg-open", [targetUrl], () => { });
    }
}
/**
 * Generates an RSA 2048-bit keypair formatted for Zed's PKCS#1 DER native_app_signin.
 */
function generateZedKeypair() {
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
function decryptZedToken(encryptedTokenBase64Url, privateKeyPem) {
    const buf = Buffer.from(encryptedTokenBase64Url.trim(), "base64url");
    const dec = crypto.privateDecrypt({ key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING }, buf);
    return dec.toString("utf-8").trim();
}
/**
 * Runs a local loopback server and initiates Zed's native RSA PKCS#1 sign-in flow.
 */
export async function startOAuthFlow(preferredPort = DEFAULT_CALLBACK_PORT) {
    return new Promise((resolve, reject) => {
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
                const rawAccessToken = (query["access_token"] || query["token"]);
                const userId = query["user_id"];
                const sessionCookie = query["session"];
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
                            }
                            else {
                                throw new Error(`Decrypted token does not look valid: ${decrypted.slice(0, 20)}...`);
                            }
                        }
                        catch (e) {
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
                    const creds = {
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
                }
                else {
                    res.writeHead(400, { "Content-Type": "text/plain" });
                    res.end("Authentication failed: No access token received in redirect.");
                }
            }
            catch (err) {
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
        server.on("error", (err) => {
            if (err.code === "EADDRINUSE") {
                // Retry with a dynamic port if default port is taken
                server.listen(0, "127.0.0.1", () => {
                    const address = server.address();
                    const actualPort = typeof address === "object" && address ? address.port : 0;
                    const signinUrl = `https://zed.dev/native_app_signin?native_app_port=${actualPort}&native_app_public_key=${publicKeyBase64Url}`;
                    openBrowser(signinUrl);
                });
            }
            else {
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
//# sourceMappingURL=oauth.js.map
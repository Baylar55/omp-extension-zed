import * as http from "node:http";
import * as url from "node:url";
import { exec } from "node:child_process";
import { saveCredentials } from "./credential-store.js";
const DEFAULT_CALLBACK_PORT = 35711;
/**
 * Opens a URL in the user's default web browser across Windows, macOS, and Linux.
 */
export function openBrowser(targetUrl) {
    const platform = process.platform;
    let command = "";
    if (platform === "win32") {
        command = `start "" "${targetUrl}"`;
    }
    else if (platform === "darwin") {
        command = `open "${targetUrl}"`;
    }
    else {
        command = `xdg-open "${targetUrl}"`;
    }
    exec(command, (err) => {
        if (err) {
            // Browser launch failed; user can still manually open the URL
        }
    });
}
/**
 * Runs a local loopback server to capture Zed's OAuth / session callback.
 */
export async function startOAuthFlow(port = DEFAULT_CALLBACK_PORT) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            try {
                const parsedUrl = url.parse(req.url || "", true);
                const query = parsedUrl.query;
                // Check for access token or session cookie returned in callback
                const accessToken = (query["access_token"] || query["token"]);
                const sessionCookie = query["session"];
                const githubUsername = query["username"];
                const userId = query["user_id"];
                if (accessToken || sessionCookie) {
                    const creds = {
                        accessToken,
                        sessionCookie,
                        githubUsername,
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
                .card { background: #1e1e1e; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); text-align: center; max-width: 400px; }
                h1 { color: #4ade80; font-size: 1.5rem; margin-bottom: 0.5rem; }
                p { color: #a1a1aa; font-size: 0.95rem; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>✓ Zed Pro Authenticated!</h1>
                <p>You have successfully connected your Zed Pro account to Oh My Pi.</p>
                <p>You may now close this tab and return to your terminal.</p>
              </div>
            </body>
            </html>
          `);
                    server.close();
                    resolve(creds);
                }
                else {
                    res.writeHead(400, { "Content-Type": "text/plain" });
                    res.end("Authentication failed: No token or session received.");
                }
            }
            catch (err) {
                res.writeHead(500, { "Content-Type": "text/plain" });
                res.end("Internal error processing callback.");
                server.close();
                reject(err);
            }
        });
        server.on("error", (err) => {
            if (err.code === "EADDRINUSE") {
                reject(new Error(`OAuth callback port ${port} is already in use.`));
            }
            else {
                reject(err);
            }
        });
        server.listen(port, "127.0.0.1", () => {
            const loginUrl = `https://zed.dev/auth/login?redirect_uri=http://127.0.0.1:${port}/`;
            openBrowser(loginUrl);
        });
        // Auto-timeout after 3 minutes if user abandons the browser tab
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import { startBridgeServer, type BridgeServerInstance } from "../src/bridge/server.js";
import { isValidZedUrl } from "../src/auth/oauth.js";
import { getCredentialsFilePath, saveCredentials, clearCredentials } from "../src/auth/credential-store.js";

describe("Security hardening tests", () => {
  let bridge: BridgeServerInstance;

  beforeAll(async () => {
    clearCredentials();
    bridge = await startBridgeServer(0);
  });

  afterAll(async () => {
    clearCredentials();
    await bridge.stop();
  });

  describe("Bridge server origin & host validation", () => {
    it("rejects cross-origin requests from untrusted external web origins with 403", async () => {
      const res = await fetch(`http://127.0.0.1:${bridge.port}/health`, {
        headers: {
          Origin: "https://malicious-website.com",
        },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.type).toBe("security_error");
    });

    it("allows requests from trusted local loopback origins with reflected CORS", async () => {
      const res = await fetch(`http://127.0.0.1:${bridge.port}/health`, {
        headers: {
          Origin: "http://localhost:5173",
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    });

    it("allows non-browser CLI requests without Origin header", async () => {
      const res = await fetch(`http://127.0.0.1:${bridge.port}/health`);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("rejects requests with untrusted Host headers (DNS rebinding protection)", async () => {
      const statusCode = await new Promise<number>((resolve) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: bridge.port,
            path: "/health",
            headers: { Host: "attacker.com" },
          },
          (res) => {
            resolve(res.statusCode || 0);
          },
        );
        req.end();
      });

      expect(statusCode).toBe(403);
    });

    it("rejects payloads exceeding size threshold with 413 Payload Too Large", async () => {
      const oversizedChunk = Buffer.alloc(16 * 1024 * 1024, "a"); // 16 MB
      const statusCode = await new Promise<number>((resolve) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: bridge.port,
            path: "/v1/chat/completions",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": String(oversizedChunk.length),
            },
          },
          (res) => {
            resolve(res.statusCode || 0);
          },
        );
        req.on("error", () => {
          // Stream may be destroyed by server upon exceeding limit
          resolve(413);
        });
        req.write(oversizedChunk);
        req.end();
      });

      expect(statusCode).toBe(413);
    });
  });

  describe("URL validation for openBrowser (OAuth flow)", () => {
    it("accepts valid official Zed HTTPS URLs", () => {
      expect(isValidZedUrl("https://zed.dev/native_app_signin?native_app_port=35711")).toBe(true);
      expect(isValidZedUrl("https://dashboard.zed.dev/")).toBe(true);
      expect(isValidZedUrl("https://cloud.zed.dev/completions")).toBe(true);
    });

    it("rejects non-HTTPS and untrusted/spoofed domains", () => {
      expect(isValidZedUrl("http://zed.dev/login")).toBe(false);
      expect(isValidZedUrl("https://evil-zed.dev")).toBe(false);
      expect(isValidZedUrl("https://zed.dev.attacker.com")).toBe(false);
      expect(isValidZedUrl("javascript:alert(1)")).toBe(false);
      expect(isValidZedUrl("file:///etc/passwd")).toBe(false);
      expect(isValidZedUrl("")).toBe(false);
    });
  });

  describe("File permission security", () => {
    it("creates credential file with strict user-only permissions", () => {
      saveCredentials({
        accessToken: "test_secure_token",
        githubUsername: "testsec",
      });

      const filePath = getCredentialsFilePath();
      expect(fs.existsSync(filePath)).toBe(true);

      const stat = fs.statSync(filePath);
      // On POSIX systems, verify mode is 0600 (read/write only by owner)
      if (process.platform !== "win32") {
        const mode = stat.mode & 0o777;
        expect(mode).toBe(0o600);
      }
    });
  });
});

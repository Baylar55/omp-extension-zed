import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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
 * Reads stored credentials from disk, checking environment variables first.
 */
export function loadCredentials(): ZedCredentials | null {
  // 1. Check environment variables
  const envToken = process.env["ZED_AUTH_TOKEN"] || process.env["ZED_TOKEN"];
  const envCookie = process.env["ZED_SESSION_COOKIE"];

  if (envToken || envCookie) {
    return {
      accessToken: envToken,
      sessionCookie: envCookie,
      savedAt: Date.now(),
    };
  }

  // 2. Check stored file
  const filePath = getCredentialsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as ZedCredentials;
      if (parsed.accessToken || parsed.sessionCookie) {
        return parsed;
      }
    }
  } catch {
    // Ignore corrupt/unreadable files
  }

  return null;
}

/**
 * Persists Zed credentials to disk.
 */
export function saveCredentials(creds: ZedCredentials): void {
  const dir = getOmpAgentDir();
  fs.mkdirSync(dir, { recursive: true });

  const toSave: ZedCredentials = {
    ...creds,
    savedAt: Date.now(),
  };

  const filePath = getCredentialsFilePath();
  fs.writeFileSync(filePath, JSON.stringify(toSave, null, 2), "utf-8");
}

/**
 * Clears stored credentials from disk.
 */
export function clearCredentials(): boolean {
  const filePath = getCredentialsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    // Ignore
  }
  return false;
}

/**
 * Formats a secret string with masking for safe console / UI display.
 */
export function maskSecret(secret: string | undefined): string {
  if (!secret) return "None";
  if (secret.length <= 8) return "••••••••";
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

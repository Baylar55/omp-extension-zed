import { afterEach, describe, expect, it } from "vitest";
import {
  clearCredentials,
  getCredentialsFilePath,
  loadCredentials,
  maskSecret,
  saveCredentials,
} from "../src/auth/credential-store.js";

describe("Credential store", () => {
  afterEach(() => {
    clearCredentials();
    delete process.env["ZED_AUTH_TOKEN"];
    delete process.env["ZED_SESSION_COOKIE"];
  });

  it("masks secrets appropriately", () => {
    expect(maskSecret(undefined)).toBe("None");
    expect(maskSecret("short")).toBe("••••••••");
    expect(maskSecret("1234567890abcdef")).toBe("1234••••cdef");
  });

  it("saves and loads credentials from disk", () => {
    saveCredentials({
      accessToken: "test_token_12345",
      githubUsername: "testuser",
    });

    const loaded = loadCredentials();
    expect(loaded).not.toBeNull();
    expect(loaded?.accessToken).toBe("test_token_12345");
    expect(loaded?.githubUsername).toBe("testuser");

    clearCredentials();
    const afterClear = loadCredentials();
    expect(afterClear).toBeNull();
  });

  it("prioritizes environment variables when set", () => {
    process.env["ZED_AUTH_TOKEN"] = "env_token_abc";
    const loaded = loadCredentials();
    expect(loaded?.accessToken).toBe("env_token_abc");
  });
});

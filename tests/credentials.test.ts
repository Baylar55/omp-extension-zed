import { afterEach, describe, expect, it } from "vitest";
import {
  deleteCredentialsFile,
  getCredentialsFilePath,
  loadCredentials,
  maskSecret,
  saveCredentials,
} from "../src/auth/credential-store.js";
const clearCredentials = deleteCredentialsFile;

describe("Credential store", () => {
  afterEach(() => {
    clearCredentials();
    delete process.env["ZED_AUTH_TOKEN"];
    delete process.env["ZED_SESSION_COOKIE"];
    delete process.env["ZED_USER_ID"];
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

    const loaded = loadCredentials({ skipSystem: true });
    expect(loaded).not.toBeNull();
    expect(loaded?.accessToken).toBe("test_token_12345");
    expect(loaded?.githubUsername).toBe("testuser");

    clearCredentials();
    const afterClear = loadCredentials({ skipSystem: true });
    expect(afterClear).toBeNull();
  });

  it("prioritizes environment variables when set", () => {
    process.env["ZED_AUTH_TOKEN"] = "env_token_abc";
    process.env["ZED_USER_ID"] = "123456";
    const loaded = loadCredentials();
    expect(loaded?.accessToken).toBe("env_token_abc");
    expect(loaded?.userId).toBe("123456");
    expect(loaded?.source).toBe("env");
  });

  it("clears credentials and handles re-saving", () => {
    saveCredentials({
      accessToken: "first_token",
    });
    expect(loadCredentials({ skipSystem: true })?.accessToken).toBe("first_token");

    clearCredentials();
    expect(loadCredentials({ skipSystem: true })).toBeNull();

    saveCredentials({
      accessToken: "second_token",
    });
    expect(loadCredentials({ skipSystem: true })?.accessToken).toBe("second_token");
  });
});

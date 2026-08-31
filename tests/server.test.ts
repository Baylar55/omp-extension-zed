import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startBridgeServer, type BridgeServerInstance } from "../src/bridge/server.js";
import * as credStore from "../src/auth/credential-store.js";

describe("Bridge HTTP Server", () => {
  let bridge: BridgeServerInstance;

  beforeAll(async () => {
    credStore.deleteCredentialsFile();
    bridge = await startBridgeServer(0);
  });

  afterAll(async () => {
    await bridge.stop();
  });

  it("serves health check endpoint", async () => {
    const res = await fetch(`http://127.0.0.1:${bridge.port}/health`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.service).toBe("omp-zed-bridge");
  });

  it("serves /v1/models endpoint listing Zed models", async () => {
    const res = await fetch(`http://127.0.0.1:${bridge.port}/v1/models`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.object).toBe("list");
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.some((m: { id: string }) => m.id === "claude-sonnet-4-6")).toBe(true);
  });

  it("rejects unauthorized completions request without credentials", async () => {
    const spy = vi.spyOn(credStore, "loadCredentials").mockReturnValue(null);

    try {
      const res = await fetch(`http://127.0.0.1:${bridge.port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "zed/claude-sonnet-4-6",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.code).toBe("unauthorized");
    } finally {
      spy.mockRestore();
    }
  });
});

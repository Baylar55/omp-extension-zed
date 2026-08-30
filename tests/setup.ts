import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll } from "vitest";

const testAgentDir = path.join(
  os.tmpdir(),
  `omp-test-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);

// Set isolated directory for OMP credentials and usage logs during tests
process.env["PI_CODING_AGENT_DIR"] = testAgentDir;

beforeAll(() => {
  fs.mkdirSync(testAgentDir, { recursive: true });
});

afterAll(() => {
  try {
    if (fs.existsSync(testAgentDir)) {
      fs.rmSync(testAgentDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors on Windows
  }
});

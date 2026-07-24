import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The real module is `import "server-only"` guarded; that marker throws when
// evaluated outside a React Server Component (which is the whole point — it
// blocks client bundling). Neutralize only the marker so we can exercise the
// actual client configuration under vitest's node environment.
vi.mock("server-only", () => ({}));

const ENV: Record<string, string> = {
  NEXT_PUBLIC_SANITY_PROJECT_ID: "test-project",
  NEXT_PUBLIC_SANITY_DATASET: "test-dataset",
  NEXT_PUBLIC_SANITY_API_VERSION: "2024-07-23",
  SANITY_API_READ_TOKEN: "test-read-token",
};

async function loadModule() {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.resetModules();
  return import("@/sanity/lib/operationalClient");
}

describe("operational clients", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("canonical client reads only the published perspective, without the CDN", async () => {
    const { operationalClient } = await loadModule();
    const cfg = operationalClient.config();
    expect(cfg.perspective).toBe("published");
    expect(cfg.useCdn).toBe(false);
  });

  it("raw-integrity client reads the raw perspective, tokened, without the CDN", async () => {
    const { rawIntegrityClient } = await loadModule();
    const cfg = rawIntegrityClient.config();
    expect(cfg.perspective).toBe("raw");
    expect(cfg.useCdn).toBe(false);
    expect(cfg.token).toBe("test-read-token");
  });

  it("both clients target the configured project, dataset, and api version", async () => {
    const { operationalClient, rawIntegrityClient } = await loadModule();
    for (const c of [operationalClient, rawIntegrityClient]) {
      const cfg = c.config();
      expect(cfg.projectId).toBe("test-project");
      expect(cfg.dataset).toBe("test-dataset");
      expect(cfg.apiVersion).toBe("2024-07-23");
    }
  });

  it("is server-only guarded against client bundling", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../sanity/lib/operationalClient.ts"),
      "utf8",
    );
    expect(src).toMatch(/^import ["']server-only["'];?\s*$/m);
  });
});

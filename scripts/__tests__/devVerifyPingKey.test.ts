import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PING_KEY } from "../lib/dev-verify/pingKey";

describe("dev-verify PING_KEY", () => {
  it("matches the sessionStorage key ActivityPing.tsx guards its heartbeat with", () => {
    const source = readFileSync(
      path.join(process.cwd(), "app/components/ActivityPing.tsx"),
      "utf8",
    );
    const match = /const PING_KEY = "([^"]+)"/.exec(source);
    expect(match, "expected a PING_KEY literal in ActivityPing.tsx").not.toBeNull();
    expect(PING_KEY).toBe(match![1]);
  });
});

// Solver v3 C6 RQ-6, U8 — the v3 pin cap is ONE TS constant equal to C5's literal `PIN_CAP = 250`,
// which C5 keeps exactly once under gcf_v3/owt_v3/ (its own test pins the "exactly once").
// Fails when either side changes alone. v2's PINNED_CAP (100) is unrelated and untouched.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { V3_PIN_CAP } from "../v3Copy";
import { PINNED_CAP } from "../pinModel";

const PKG = path.join(process.cwd(), "gcf_v3", "owt_v3");

describe("the v3 pin cap mirrors C5's literal", () => {
  it("equals the one `PIN_CAP = <n>` line in gcf_v3/owt_v3", () => {
    const hits = readdirSync(PKG)
      .filter((f) => f.endsWith(".py"))
      .flatMap((f) => readFileSync(path.join(PKG, f), "utf8").split("\n").filter((l) => /^PIN_CAP = \d+$/.test(l)));
    expect(hits).toHaveLength(1);
    expect(V3_PIN_CAP).toBe(Number(hits[0].split("=")[1]));
  });

  it("leaves v2's cap alone", () => expect(PINNED_CAP).toBe(100));
});

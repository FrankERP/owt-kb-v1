// Solver v3 C3 §6.10 — the Studio declares `sundayCadence` on `solverRestriction`
// for inspection only: a string titled «Domingo», one listed value «Mes por medio»
// = `alternate`, described «Interno: vacío = Normal». The type stays hidden and
// read-only; the Content Lake is schemaless, so nothing at runtime depends on it.
import { describe, expect, it } from "vitest";

import { solverConfig } from "@/sanity/schemas/solverConfig";

interface Field {
  name: string;
  title?: string;
  type: string;
  description?: string;
  options?: { list?: Array<{ title: string; value: string }> };
  of?: Array<{ name?: string; fields?: Field[] }>;
}

describe("solverConfig schema — «Mes por medio» (C3 §6.10)", () => {
  it("declares `sundayCadence` on `solverRestriction` with its one listed value", () => {
    expect(solverConfig.hidden).toBe(true);
    expect(solverConfig.readOnly).toBe(true);
    const restrictions = (solverConfig.fields as unknown as Field[]).find((f) => f.name === "restrictions");
    const restriction = restrictions?.of?.find((o) => o.name === "solverRestriction");
    const field = restriction?.fields?.find((f) => f.name === "sundayCadence");
    expect(field).toEqual({
      name: "sundayCadence",
      title: "Domingo",
      type: "string",
      description: "Interno: vacío = Normal",
      options: { list: [{ title: "Mes por medio", value: "alternate" }] },
    });
  });
});

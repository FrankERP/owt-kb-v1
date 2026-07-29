import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Guards docs/adr/ against the two ways an index rots: a record that exists but
// was never indexed, and an index row pointing at a file that moved or was
// renamed. Same spirit as routeMatcher.test.ts and agentDocsParity.test.ts.

const ADR_DIR = resolve(__dirname, "../../../docs/adr");

const recordFiles = readdirSync(ADR_DIR)
  .filter((f) => /^\d{4}-.+\.md$/.test(f))
  .sort();

const indexBody = readFileSync(resolve(ADR_DIR, "README.md"), "utf8");
const linked = [...indexBody.matchAll(/\]\((\d{4}-[^)]+\.md)\)/g)].map((m) => m[1]);

describe("docs/adr index", () => {
  it("indexes every record", () => {
    expect(recordFiles.filter((f) => !linked.includes(f))).toEqual([]);
  });

  it("links only records that exist", () => {
    expect(linked.filter((l) => !recordFiles.includes(l))).toEqual([]);
  });

  it("numbers records uniquely and consecutively from 0001", () => {
    const numbers = recordFiles.map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("gives every record a title, date and status", () => {
    for (const file of recordFiles) {
      const text = readFileSync(resolve(ADR_DIR, file), "utf8");
      expect(text, `${file} needs an "# ADR-NNNN: …" title`).toMatch(/^# ADR-\d{4}: .+/);
      expect(text, `${file} needs a Date and Status line`).toMatch(/\*\*Date:\*\*.+\*\*Status:\*\*/);
    }
  });
});

// The banner/navbar offset is a two-file contract with no code path between
// the halves: `ImpersonationBanner` publishes a class and a custom property on
// <html>, and `brand.css` is the only thing that reads them. A one-sided rename
// degrades silently — the navbar falls back to the :root default and creeps
// back under the banner on a phone, where the banner is tallest — so the
// coupling gets the same kind of guard `routeMatcher.test.ts` gives its pair.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const component = read("app/components/ImpersonationBanner.tsx");
const css = read("app/brand.css");

/** The literal names the component publishes, read out of its own source. */
const CLASS_NAME = component.match(/const BANNER_CLASS = "([^"]+)"/)?.[1];
const VAR_NAME = component.match(/const BANNER_H_VAR = "([^"]+)"/)?.[1];

describe("impersonation banner ↔ navbar offset", () => {
  it("the component still declares both names", () => {
    expect(CLASS_NAME).toBe("impersonating");
    expect(VAR_NAME).toBe("--impersonation-h");
  });

  it("brand.css keys the navbar offset off the class the component adds", () => {
    expect(css).toContain(`.${CLASS_NAME} .brand-navbar`);
  });

  it("brand.css both declares and consumes the property the component sets", () => {
    // Declared, so the navbar has a sane offset before the measurement lands —
    // and so brandCss.test.ts's dangling-var guard passes by declaration.
    expect(css).toMatch(new RegExp(`${VAR_NAME}:\\s*[^;]+;`));
    expect(css).toContain(`var(${VAR_NAME})`);
  });

  it("the component actually publishes the property it names", () => {
    expect(component).toContain("setProperty(BANNER_H_VAR");
    expect(component).toContain("removeProperty(BANNER_H_VAR");
  });
});

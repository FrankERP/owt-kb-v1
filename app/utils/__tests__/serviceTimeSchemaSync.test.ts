// The Studio schema hard-codes the "HH:mm" regex because `sanity/` cannot import
// from `app/` (the Studio bundle must stay free of the app's server modules).
// This is the guard that keeps the copy honest: if either side is edited without
// the other, this test fails rather than letting the Studio accept — or refuse —
// a time the app disagrees about.
import { describe, expect, it } from "vitest";
import { specialRole } from "@/sanity/schemas/specialRole";
import { SERVICE_TIME_RE } from "@/app/utils/serviceTime";

type Field = {
  name: string;
  type: string;
  validation?: (rule: unknown) => unknown;
};

const time = (specialRole.fields as Field[]).find((f) => f.name === "time");

describe("special_role `time` mirrors SERVICE_TIME_RE", () => {
  it("is a plain string field", () => {
    expect(time).toBeTruthy();
    expect(time?.type).toBe("string");
  });

  it("validates with a regex byte-identical to SERVICE_TIME_RE", () => {
    const seen: RegExp[] = [];
    const rule = { regex: (re: RegExp) => { seen.push(re); return rule; } };
    time?.validation?.(rule);
    expect(seen).toHaveLength(1);
    expect(seen[0].source).toBe(SERVICE_TIME_RE.source);
    expect(seen[0].flags).toBe(SERVICE_TIME_RE.flags);
  });
});

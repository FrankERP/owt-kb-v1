// app/mcp/oauth/__tests__/registrationAge.test.ts
//
// The consent page's «hace N minutos/horas/días» (spec O8: show how long ago
// the client registered). Relative time needs no timezone; the boundaries and
// the singular forms are what is worth pinning.

import { describe, expect, it } from "vitest";

import { registrationAgeLabel } from "../registrationAge";

describe("registrationAgeLabel", () => {
  it.each([
    [0, "hace menos de un minuto"],
    [59, "hace menos de un minuto"],
    [60, "hace 1 minuto"],
    [119, "hace 1 minuto"],
    [120, "hace 2 minutos"],
    [3599, "hace 59 minutos"],
    [3600, "hace 1 hora"],
    [7199, "hace 1 hora"],
    [7200, "hace 2 horas"],
    [86399, "hace 23 horas"],
    [86400, "hace 1 día"],
    [172800, "hace 2 días"],
    [400 * 86400, "hace 400 días"],
  ])("%i s → %s", (seconds, label) => {
    expect(registrationAgeLabel(seconds)).toBe(label);
  });

  it("a negative or non-finite age reads as just now, never as a negative count", () => {
    expect(registrationAgeLabel(-5)).toBe("hace menos de un minuto");
    expect(registrationAgeLabel(Number.NaN)).toBe("hace menos de un minuto");
  });
});

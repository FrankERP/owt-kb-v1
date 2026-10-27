import { describe, expect, it } from "vitest";
import { PROPOSAL_STATUS_WORD, dateRunParts, dayBlock, formatDateRun, joinEs, proposalSublineMiddle } from "../adminRowCopy";

describe("adminRowCopy — the hairline rows' Spanish", () => {
  it("joinEs reads a list the Spanish way", () => {
    expect(joinEs([])).toBe("");
    expect(joinEs(["20"])).toBe("20");
    expect(joinEs(["20", "21"])).toBe("20 y 21");
    expect(joinEs(["20", "21", "22"])).toBe("20, 21 y 22");
  });

  it("dayBlock splits a service date at local noon — never the day before", () => {
    expect(dayBlock("2026-11-01")).toEqual({ day: "1", month: "nov" });
    expect(dayBlock("2026-12-31")).toEqual({ day: "31", month: "dic" });
  });

  it("formatDateRun groups a month's days and names another year only when it differs", () => {
    expect(formatDateRun(["2026-11-20", "2026-11-21", "2026-11-22"], 2026)).toBe("20, 21 y 22 de noviembre");
    expect(formatDateRun(["2026-11-07"], 2026)).toBe("7 de noviembre");
    expect(formatDateRun(["2026-11-14", "2026-11-15", "2026-12-24"], 2026)).toBe("14 y 15 de noviembre; 24 de diciembre");
    expect(formatDateRun(["2027-01-03"], 2026)).toBe("3 de enero de 2027");
    expect(formatDateRun([], 2026)).toBe("");
  });

  it("dateRunParts keeps the order and tags each day with its date, so one day can be coloured", () => {
    expect(dateRunParts(["2026-11-20", "2026-11-21", "2026-12-24"], 2026)).toEqual([
      { text: "20", iso: "2026-11-20" },
      { text: " y " },
      { text: "21", iso: "2026-11-21" },
      { text: " de noviembre" },
      { text: "; " },
      { text: "24", iso: "2026-12-24" },
      { text: " de diciembre" },
    ]);
  });

  it("proposalSublineMiddle names the co-leads and the count; the status has one word each", () => {
    expect(proposalSublineMiddle({ songCount: 4, coContributors: [] })).toBe("4 canciones");
    expect(proposalSublineMiddle({ songCount: 1, coContributors: ["Hugo", "Liu"] })).toBe("con Hugo y Liu · 1 canción");
    expect(PROPOSAL_STATUS_WORD).toEqual({
      draft: "Borrador",
      pending: "Pendiente",
      approved: "Aprobada",
      changes_requested: "Cambios solicitados",
    });
  });
});

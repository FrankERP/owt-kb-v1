import { describe, expect, it } from "vitest";

import {
  describeClearableRole,
  isDraftRole,
  mutationErrorMessage,
  selectClearMonthRoles,
  summarizeClearMonth,
  type ClearableRole,
} from "../clearMonthModel";

function role(overrides: Partial<ClearableRole> & { _id: string }): ClearableRole {
  return { _rev: `rev-${overrides._id}`, _type: "sunday_role", date: "2026-09-06", ...overrides };
}

describe("isDraftRole", () => {
  it("treats ONLY published === false as a draft; absent means visible", () => {
    expect(isDraftRole({ published: false })).toBe(true);
    expect(isDraftRole({ published: true })).toBe(false);
    expect(isDraftRole({})).toBe(false);
  });
});

describe("selectClearMonthRoles", () => {
  const roles = [
    role({ _id: "oct-draft", date: "2026-10-04", published: false }),
    role({ _id: "sep-pub-legacy", date: "2026-09-27" }),
    role({ _id: "sep-draft-2", date: "2026-09-13", published: false }),
    role({ _id: "sep-special", _type: "special_role", date: "2026-09-06", service_name: "Bodas", published: false }),
    role({ _id: "sep-sat", _type: "saturday_role", date: "2026-09-05", published: false }),
    role({ _id: "sep-draft-1", date: "2026-09-06", published: false }),
    role({ _id: "sep-pub", date: "2026-09-20", published: true }),
  ];

  it("keeps only the month, sorted by date then Saturday/Sunday/Special", () => {
    const { drafts, published } = selectClearMonthRoles(roles, "2026-09", false);
    expect(drafts.map((r) => r._id)).toEqual(["sep-sat", "sep-draft-1", "sep-special", "sep-draft-2"]);
    expect(published.map((r) => r._id)).toEqual(["sep-pub", "sep-pub-legacy"]);
  });

  it("selects drafts alone by default and everything when published are included", () => {
    expect(selectClearMonthRoles(roles, "2026-09", false).selected.map((r) => r._id))
      .toEqual(["sep-sat", "sep-draft-1", "sep-special", "sep-draft-2"]);
    expect(selectClearMonthRoles(roles, "2026-09", true).selected.map((r) => r._id))
      .toEqual(["sep-sat", "sep-draft-1", "sep-special", "sep-draft-2", "sep-pub", "sep-pub-legacy"]);
  });

  it("never lets a legacy field-less service into a drafts-only clear", () => {
    const { selected } = selectClearMonthRoles([role({ _id: "legacy", date: "2026-09-06" })], "2026-09", false);
    expect(selected).toEqual([]);
  });

  it("returns empty partitions for a month with nothing stored", () => {
    expect(selectClearMonthRoles(roles, "2027-01", true)).toEqual({ drafts: [], published: [], selected: [] });
  });
});

describe("mutationErrorMessage", () => {
  it("names the dependency count for a dependency refusal", () => {
    expect(mutationErrorMessage({ code: "role_has_dependencies", status: 409, dependencyCount: 2, fallback: "x" }))
      .toBe("Hay 2 registro(s) dependientes (setlist o propuestas) en esa fecha. No se modificó nada.");
  });

  it("reads any unknown 409 as a stale view, and everything else as the fallback", () => {
    expect(mutationErrorMessage({ status: 409, fallback: "Error al eliminar." }))
      .toBe("Alguien más cambió este servicio. Recarga e intenta de nuevo.");
    expect(mutationErrorMessage({ status: 500, fallback: "Error al eliminar." })).toBe("Error al eliminar.");
    expect(mutationErrorMessage({ code: "something_new", status: 400, fallback: "Error al eliminar." }))
      .toBe("Error al eliminar.");
  });

  it("translates the known codes", () => {
    expect(mutationErrorMessage({ code: "not_found", status: 404, fallback: "x" }))
      .toBe("Este servicio ya no existe. Recarga la lista.");
    expect(mutationErrorMessage({ code: "stale_revision", status: 409, fallback: "x" }))
      .toBe("Alguien más cambió este servicio. Recarga e intenta de nuevo.");
    expect(mutationErrorMessage({ code: "integrity_conflict", status: 409, fallback: "x" }))
      .toBe("Los datos guardados no pasaron una revisión de integridad. No se modificó nada.");
  });
});

describe("describeClearableRole", () => {
  it("prints day/month, the service kind, and a special's name", () => {
    expect(describeClearableRole(role({ _id: "a", _type: "saturday_role", date: "2026-09-05" }))).toBe("05/09 · Sábado");
    expect(describeClearableRole(role({ _id: "b", date: "2026-09-06" }))).toBe("06/09 · Domingo");
    expect(describeClearableRole(role({ _id: "c", _type: "special_role", date: "2026-09-14", service_name: "Bodas" })))
      .toBe("14/09 · Especial (Bodas)");
  });
});

describe("summarizeClearMonth", () => {
  it("reports a clean sweep with correct pluralisation", () => {
    const one = summarizeClearMonth([{ role: role({ _id: "a" }), ok: true }], "Septiembre 2026");
    expect(one).toEqual({ attempted: 1, deleted: 1, failures: [], message: "Septiembre 2026: 1 servicio eliminado." });
    const two = summarizeClearMonth(
      [{ role: role({ _id: "a" }), ok: true }, { role: role({ _id: "b" }), ok: true }],
      "Septiembre 2026",
    );
    expect(two.message).toBe("Septiembre 2026: 2 servicios eliminados.");
  });

  it("never claims a clean sweep when a delete was refused, and lists each failure", () => {
    const summary = summarizeClearMonth([
      { role: role({ _id: "a", date: "2026-09-06" }), ok: true },
      { role: role({ _id: "b", _type: "special_role", date: "2026-09-14", service_name: "Bodas" }), ok: false, reason: "Hay 1 registro(s) dependientes (setlist o propuestas) en esa fecha. No se modificó nada." },
      { role: role({ _id: "c", date: "2026-09-20" }), ok: false },
    ], "Septiembre 2026");
    expect(summary.attempted).toBe(3);
    expect(summary.deleted).toBe(1);
    expect(summary.failures).toEqual([
      "14/09 · Especial (Bodas): Hay 1 registro(s) dependientes (setlist o propuestas) en esa fecha. No se modificó nada.",
      "20/09 · Domingo: Error al eliminar.",
    ]);
    expect(summary.message).toBe("Septiembre 2026: eliminados 1 de 3. No se pudieron eliminar 2.");
  });

  it("handles an empty attempt without dividing by zero or claiming success", () => {
    expect(summarizeClearMonth([], "Septiembre 2026").message).toBe("Septiembre 2026: 0 servicios eliminados.");
  });
});

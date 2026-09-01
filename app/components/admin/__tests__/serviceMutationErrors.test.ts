import { describe, expect, it } from "vitest";

import { mutationErrorMessage } from "../serviceMutationErrors";

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

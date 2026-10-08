// Solver v3 C6 §7 — the formatters and a sample of every family of lines, with fictitious people.
import { describe, expect, it } from "vitest";

import {
  V3_CAP_REFUSAL, V3_CONFIRM_REFUSAL, V3_LINES, V3_RESOLVER_ISSUE, V3_RESOLVER_REFUSAL, V3_ROUTE_COPY,
  datesList, lineLabel, missedLine, monthName, monthNameCap, monthsList, noticeLine, refusalLine, stageLabel,
  transportLine, violationLine, type V3Names,
} from "../v3Copy";

const names: V3Names = {
  person: (id) => ({ "m-ana": "Ana", "m-bruno": "Bruno" })[id] ?? "alguien que ya no está en la lista",
  rule: (id) => ({ c1: "Ana · Sun.Lead <= 1", r1: "Ana, Bruno en Sun.BGV c/sem" })[id] ?? "regla de presencia registrada",
  service: (id) => ({ s1: "domingo 8 nov" })[id] ?? id,
};

describe("formatters", () => {
  it("months and lists", () => {
    expect(monthName("2026-11")).toBe("noviembre");
    expect(monthNameCap("2026-11")).toBe("Noviembre");
    expect(monthsList(["2026-11", "2026-12"])).toBe("noviembre y diciembre");
    expect(monthsList(["2026-11", "2026-12"], true)).toBe("Noviembre y diciembre");
  });

  it("dates: one month, across months, three or more", () => {
    expect(datesList(["2026-11-15", "2026-11-08"])).toBe("8 y 15 nov");
    expect(datesList(["2026-10-31", "2026-11-07"])).toBe("31 oct y 7 nov");
    expect(datesList(["2026-11-01", "2026-11-08", "2026-11-15"])).toBe("1, 8 y 15 nov");
  });

  it("lines, with a presence sub-line named by its card", () => {
    expect(lineLabel("DL", names)).toBe("Dom Lead");
    expect(lineLabel("SL", names)).toBe("Sáb Lead");
    expect(lineLabel("CORO", names)).toBe("Coro");
    expect(lineLabel("P:r1", names)).toBe("BGV (Ana, Bruno en Sun.BGV c/sem)");
  });
});

describe("registry-keyed lines (§7.1–§7.5)", () => {
  it("stages, including a templated balance stage on a presence line", () => {
    expect(stageLabel("sunday_cap", names)).toBe("Un domingo al mes");
    expect(stageLabel("balance_max:DL", names)).toBe("Equidad Dom Lead: el más pendiente");
    expect(stageLabel("balance_sq:P:r1", names)).toBe("Equidad BGV (Ana, Bruno en Sun.BGV c/sem): reparto");
  });

  it("a missed protection carries its cause as a suffix", () => {
    expect(missedLine({ code: "cadence_on_missed", person: "m-ana", month: "2026-11", cause: "unavailable" }, names))
      .toBe("Ana no dirigió domingo en noviembre, su mes de dirigir («Mes por medio») — no tenía fechas disponibles.");
    expect(missedLine({ code: "consecutive_sundays", person: "m-bruno", dates: ["2026-11-08", "2026-11-15"], cause: "pins" }, names))
      .toBe("Bruno dirige domingos seguidos: 8 y 15 nov — por lo que ya estaba puesto.");
  });

  it("notices and rule breaks name the rule by its card label", () => {
    expect(noticeLine("exact_clamped", { rule: "c1", person: "m-ana", month: "2026-11", value: 2, available: 1 }, names))
      .toBe("«Ana · Sun.Lead <= 1» pide 2 en noviembre, pero Ana solo está disponible 1: se ajustó a 1.");
    expect(violationLine({ code: "count", rule: "c1", cause: "forced", person: "m-ana", month: "2026-11", observed: 2, limit: 1 }, names))
      .toBe("No se cumplió «Ana · Sun.Lead <= 1» en noviembre: quedó en 2 (pide 1) — no había forma de cumplirla junto con las demás reglas.");
    expect(violationLine({ code: "mandatory_lead", rule: "mandatory_lead", cause: "pins", service: "s1" }, names))
      .toBe("El domingo 8 nov quedó sin líder aunque alguien podía dirigir — por lo que ya estaba puesto.");
  });

  it("refusals by code, an unknown code generically", () => {
    expect(refusalLine("timeout", { stage: "fill", seconds: 25 })).toBe(V3_ROUTE_COPY.timeout);
    expect(refusalLine("invalid_request", { field: "pins[3].role", detail: "role_not_in_service" }))
      .toBe("El solver rechazó la solicitud por un error del planificador (invalid_request: pins[3].role). No se aplicó nada.");
    expect(refusalLine("misconfigured", {})).toBe("No se pudo usar el solver (misconfigured). No se aplicó nada; avisa a quien administra la app.");
    expect(refusalLine("never_heard_of_it", {})).toBe("El solver informó algo que el planificador no reconoce (never_heard_of_it).");
  });
});

describe("route outcomes (§7.6): timeout and connection are distinct (A24)", () => {
  it("maps each transport reason to its family", () => {
    expect(transportLine("timeout")).toBe(V3_ROUTE_COPY.timeout);
    expect(transportLine("unreachable")).toBe(V3_ROUTE_COPY.connection);
    expect(transportLine("not_json")).toBe(V3_ROUTE_COPY.connection);
    expect(transportLine("not_configured")).toBe("No se pudo usar el solver (not_configured). No se aplicó nada; avisa a quien administra la app.");
    expect(V3_ROUTE_COPY.timeout).not.toBe(V3_ROUTE_COPY.connection);
  });
});

describe("C6's own lines", () => {
  it("resolver refusals and issues are keyed on IF2-15's unions (§7.9)", () => {
    expect(V3_RESOLVER_REFUSAL.ambiguous("Ana", "2026-11", null))
      .toBe("No se puede correr Auto: «Ana» en las reglas coincide con más de una persona. Corrige el nombre en la regla.");
    expect(V3_RESOLVER_REFUSAL.exact_count_range("Ana", "2026-11", null))
      .toBe("No se puede correr Auto: la regla fija de Ana no da un número entero de 0 a 31 lugares en noviembre. Corrígela.");
    expect(V3_RESOLVER_ISSUE.too_many_people).toBe("No se puede correr Auto: hay más de 100 personas de voz.");
  });

  it("IF2-17 refusals name the card, never the key (§7.3)", () => {
    expect(V3_CAP_REFUSAL.not_whole("Ana · Sun.Lead <= 1.5", ["2026-11", "2026-12"]))
      .toBe("No se puede correr Auto: «Ana · Sun.Lead <= 1.5» no da un número entero de lugares en noviembre y diciembre. Corrige su número.");
    expect(V3_CAP_REFUSAL.negative("Ana · Sun.Lead >= -1", ["2026-11"]))
      .toBe("No se puede correr Auto: «Ana · Sun.Lead >= -1» pide un número negativo de lugares. Corrige su número.");
  });

  it("the past and ceiling lines (HZ-7, HZ-9, CF-1)", () => {
    expect(V3_LINES.horizonPast).toBe("Auto no planea meses que ya pasaron. Crea esos servicios a mano.");
    expect(V3_LINES.horizonCeiling("2027-11", "2027-10"))
      .toBe("Auto no planea más de 12 meses adelante: Noviembre queda fuera. Elige un mes hasta octubre.");
  });

  it("confirm refusals are keyed on IF2-6 (§7.8)", () => {
    expect(V3_CONFIRM_REFUSAL.month_has_services("2026-11"))
      .toBe("Se guardaron servicios en noviembre mientras planeabas, así que su registro ya no se puede reemplazar. No se creó nada; vuelve a correr Auto.");
    expect(V3_CONFIRM_REFUSAL.engine_not_v3("2026-11")).toBe("El solver cambió de versión. Recarga la página; no se creó nada.");
  });
});

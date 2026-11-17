// The words a refused write shows, and the URLs the editors call (ADR-0081; «Mi parte», ADR-0089).

import { describe, expect, it } from "vitest";
import { eventUrl, partUrl, programUrl, writeMessage } from "../eventWrite";

describe("writeMessage — «Mi parte» and the program", () => {
  it("a refused part names its two limits in words a pastor can act on", () => {
    const words = writeMessage(400, { error: "invalid_part" });
    expect(words).toContain("300 caracteres");
    expect(words).toContain("una sola línea");
  });

  it("a refused program tells an old tab to reload (a part line it does not know is a 400)", () => {
    expect(writeMessage(400, { error: "invalid_program" })).toContain("recarga la página");
  });

  it("the writer's own Spanish sentence passes through; an unknown code never does", () => {
    expect(writeMessage(403, { error: "No puedes editar esta parte." })).toBe("No puedes editar esta parte.");
    expect(writeMessage(400, { error: "invalid_whatever" })).toBe("No se pudo guardar. Intenta de nuevo.");
  });
});

describe("the event URLs", () => {
  it("name the meeting by its token, never by its id", () => {
    const id = "anything.0b6f5c1e-7d2a-4e7b-9a55-1c2d3e4f5a6b";
    expect(eventUrl("jovenes", id)).toBe("/api/ministries/jovenes/events/0b6f5c1e-7d2a-4e7b-9a55-1c2d3e4f5a6b");
    expect(programUrl("jovenes", id)).toBe(`${eventUrl("jovenes", id)}/program`);
    expect(partUrl("jovenes", id, "oracion")).toBe(`${eventUrl("jovenes", id)}/parts/oracion`);
  });
});

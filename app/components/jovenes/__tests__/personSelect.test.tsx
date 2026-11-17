/** @vitest-environment jsdom */
// «No disponible» in the picker (ADR-0090): it informs, only with the meeting's day, only for the
// people the planner's read marked. Everywhere else the picker is what it always was.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PersonSelect from "../PersonSelect";

afterEach(cleanup);

const people = [
  { id: "ana", name: "Ana", groups: [], away: ["2026-11-21"] },
  { id: "beto", name: "Beto", groups: [] },
];
const options = () => screen.getAllByRole("option").map((o) => o.textContent);
const show = (value: string | null, date?: string | null, extra: Partial<Parameters<typeof PersonSelect>[0]> = {}) =>
  render(<PersonSelect ariaLabel="Encargado" value={value} onChange={() => {}} people={people} date={date} {...extra} />);

describe("PersonSelect and a marked day", () => {
  it("marks the person in the list on the day they marked, and says so once they are picked", () => {
    show("ana", "2026-11-21");
    expect(options()).toEqual(["Sin asignar", "Ana · no disponible", "Beto"]);
    expect(screen.getByRole("status").textContent).toBe("No disponible ese día.");
  });

  it("in the list only, while somebody else is picked", () => {
    show("beto", "2026-11-21");
    expect(options()).toContain("Ana · no disponible");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says nothing on another day, without a day, or for people who carry no `away`", () => {
    show("ana", "2026-11-28");
    expect(options()).toEqual(["Sin asignar", "Ana", "Beto"]);
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    show("ana");
    expect(options()).toEqual(["Sin asignar", "Ana", "Beto"]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a typed name is nobody's day", () => {
    // The seat still names Ana's id while the planner types another name over it.
    show("ana", "2026-11-21", { typedName: "Ana de visita", onTypedName: () => {} });
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    // The same seat, not in typed mode, does say it: the line above is the guard's doing.
    show("ana", "2026-11-21", { typedName: null, onTypedName: () => {} });
    expect(screen.getByRole("status").textContent).toBe("No disponible ese día.");
  });
});

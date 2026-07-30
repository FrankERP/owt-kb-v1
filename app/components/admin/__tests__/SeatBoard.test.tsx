/** @vitest-environment jsdom */
// The board's whole reason for existing is that the roster is visible and honest.
// These pin the three things the old sheet could not do: show the entire pool at
// once, mark unavailability and existing assignment before the save, and refuse a
// same-category double booking — the last one all the way from a DOM click through
// to the saved payload, because that boundary (SeatBoard building `assigned` in
// seat order, then candidateRanking consuming it) is exactly where a Map keyed by
// member id once silently dropped a member's earlier seat and let a second
// same-category booking through unblocked. See candidateRanking.ts.
import { fireEvent, render, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SeatBoard from "../SeatBoard";

afterEach(() => cleanup());

const members = [
  { _id: "m1", member_name: "Frank", memberType: ["voz", "instrumento"] },
  { _id: "m2", member_name: "Gaby", memberType: ["voz"] },
  { _id: "m3", member_name: "Liu", memberType: ["voz"], unavailableDates: ["2026-08-09"] },
  { _id: "m4", member_name: "Samo", memberType: ["instrumento"] },
];

const base = {
  members,
  windowRoles: [],
  onSubmit: vi.fn(),
  onClose: vi.fn(),
  loading: false,
};

describe("SeatBoard", () => {
  it("never evicts an occupant from a seat that already holds two people", () => {
    // 18 production services run TWO drummers on one Drums seat (every service
    // from 2026-06-07 to 2026-08-30). A `max: 1` on the seat made `toggle`
    // replace rather than add, so opening one of those services and clicking
    // anyone silently dropped a drummer. This is that case.
    const drummers = [
      { _id: "d1", member_name: "Samo", memberType: ["instrumento"] },
      { _id: "d2", member_name: "Tony", memberType: ["instrumento"] },
      { _id: "d3", member_name: "Fanta", memberType: ["instrumento"] },
    ];
    const onSubmit = vi.fn();
    const initial = {
      _type: "sunday_role",
      date: "2026-08-09",
      leads: [], bgvs: [], chorus: [],
      instruments: [
        { instrument: "Drums", person: drummers[0] },
        { instrument: "Drums", person: drummers[1] },
      ],
      foh: [],
    };
    render(
      <SeatBoard {...base} members={drummers} onSubmit={onSubmit} initial={initial as never} />,
    );

    // Target the Drums seat, then add a third person.
    fireEvent.click(screen.getAllByText("Drums")[0]);
    fireEvent.click(screen.getByText("Fanta"));
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    const drums = onSubmit.mock.calls[0][0].instruments.filter(
      (s: { instrument: string }) => s.instrument === "Drums",
    );
    const ids = drums.map((s: { personId: string }) => s.personId).sort();
    // Both original drummers survive; the third is added, not swapped in.
    expect(ids).toEqual(["d1", "d2", "d3"]);
  });

  it("shows the whole eligible pool at once, not a 4-row window", () => {
    render(<SeatBoard {...base} />);
    // All three voz members are in the document simultaneously.
    expect(screen.getByText("Frank")).toBeTruthy();
    expect(screen.getByText("Gaby")).toBeTruthy();
    expect(screen.getByText("Liu")).toBeTruthy();
  });

  it("marks an unavailable member before anything is saved", () => {
    render(<SeatBoard {...base} initial={{ _type: "sunday_role", date: "2026-08-09" } as never} />);
    expect(screen.getByText(/no disp/i)).toBeTruthy();
  });

  it("seats a person into the targeted seat on click", () => {
    render(<SeatBoard {...base} />);
    fireEvent.click(screen.getByText("Gaby"));
    // The chip for the seated person appears inside the seat pane (the "Voces"
    // section), not merely somewhere else in the document (e.g. still only in
    // the roster).
    const seatPane = screen.getByText("Voces").closest("section");
    expect(seatPane).toBeTruthy();
    expect(within(seatPane as HTMLElement).getByText("Gaby")).toBeTruthy();
  });

  it("uses «Ya asignado», never «sentado»", () => {
    const { container } = render(<SeatBoard {...base} />);
    fireEvent.click(screen.getByText("Frank"));
    expect(container.textContent?.toLowerCase()).not.toContain("sentad");
  });

  it("submits the same payload shape the API already accepts", () => {
    const onSubmit = vi.fn();
    render(<SeatBoard {...base} onSubmit={onSubmit} initial={{ _type: "sunday_role", date: "2026-08-09" } as never} />);
    fireEvent.click(screen.getByText("Gaby"));
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({ _type: "sunday_role", date: "2026-08-09", leads: ["m2"] });
    expect(Array.isArray(payload.instruments)).toBe(true);
    expect(Array.isArray(payload.foh)).toBe(true);
  });

  it("disables save while a submit block is in force, and shows the reason", () => {
    render(<SeatBoard {...base} submitBlockedReason="Datos incompletos." />);
    // Create mode renders both "Crear" and "Crear y publicar" simultaneously,
    // so the selector must be exact rather than matching either.
    const save = screen.getByRole("button", { name: /^crear$/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe("Datos incompletos.");
  });

  it("create mode renders two separate, always-visible submit actions", () => {
    render(<SeatBoard {...base} />);
    expect(screen.getByRole("button", { name: /^crear$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crear y publicar" })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("submits with published: false from the plain Crear button, and published: true from Crear y publicar", () => {
    const onSubmit = vi.fn();
    render(<SeatBoard {...base} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /^crear$/i }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ published: false });

    fireEvent.click(screen.getByRole("button", { name: "Crear y publicar" }));
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ published: true });
  });

  // Both panes scroll independently (the seat pane now has its own
  // `overflow-y-auto` alongside the roster's), which is fine — that's not the
  // defect the old five-stacked-scrollers sheet had. What actually protects
  // the user is that no scroll region is nested inside another (so the user
  // never has to scroll a scroller to find the rest of a scroller) and that
  // the footer's action buttons are never trapped inside one, so they stay
  // reachable regardless of how many seats or roster rows exist.
  it("has no scroll region nested inside another", () => {
    const { container } = render(<SeatBoard {...base} />);
    const scrollers = Array.from(container.querySelectorAll(".overflow-y-auto"));
    expect(scrollers.length).toBeGreaterThan(0);
    for (const outer of scrollers) {
      for (const inner of scrollers) {
        if (outer !== inner) expect(outer.contains(inner)).toBe(false);
      }
    }
  });

  it("keeps the footer's submit controls outside every scroll region", () => {
    const { container } = render(<SeatBoard {...base} />);
    const scrollers = Array.from(container.querySelectorAll(".overflow-y-auto"));
    const cancel = screen.getByRole("button", { name: /cancelar/i });
    const crear = screen.getByRole("button", { name: /^crear$/i });
    const crearYPublicar = screen.getByRole("button", { name: "Crear y publicar" });
    for (const scroller of scrollers) {
      expect(scroller.contains(cancel)).toBe(false);
      expect(scroller.contains(crear)).toBe(false);
      expect(scroller.contains(crearYPublicar)).toBe(false);
    }
  });

  it("rejects a new seat name that only differs from an existing one by case", () => {
    render(<SeatBoard {...base} />);
    const input = screen.getByPlaceholderText("Nuevo instrumento") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "Trombone" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(screen.getAllByText("Trombone")).toHaveLength(1);

    fireEvent.change(input, { target: { value: "trombone" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    // Still exactly one seat — the lowercase spelling was rejected, not
    // silently created as a second seat with a different casing.
    expect(screen.getAllByText("Trombone")).toHaveLength(1);
    expect(screen.getByText(/ya existe/i)).toBeTruthy();
  });

  // This is the seam the Critical bug lived in: SeatBoard builds `assigned` in
  // seat order (voces, then instrumentos, then FOH) and candidateRanking used to
  // keep only the LAST seat per member (a Map keyed by memberId), so an
  // instrument seat silently overwrote a voice one and hid the same-category
  // conflict. Frank here holds Lead (voz) AND EG (instrumento) — legitimate,
  // D4 — then a second voz seat (BGV) must be blocked. Unit tests on
  // candidateRanking already cover the ranking logic in isolation; this pins the
  // behaviour at the level a user (and the saved document) actually experiences,
  // which is the only place the regression would show up again if some future
  // change filtered or deduped `assigned` before it reaches candidateRanking.
  it("blocks a same-category double booking end-to-end and the saved payload proves it", () => {
    const onSubmit = vi.fn();
    render(<SeatBoard {...base} onSubmit={onSubmit} />);

    // Once Frank is seated anywhere, "Frank" also renders as an occupant chip
    // in a seat pane, so every click-to-seat must target the roster row
    // specifically — the only occurrence that is an <li> — never a bare
    // getByText("Frank"), which becomes ambiguous after the first seat.
    const frankRosterRow = () =>
      screen
        .getAllByText("Frank")
        .map((el) => el.closest("li"))
        .find((li): li is HTMLLIElement => li !== null)!;

    // Default target is the first voice seat (Lead). Seat Frank there.
    fireEvent.click(frankRosterRow());
    const vocesPane = screen.getByText("Voces").closest("section") as HTMLElement;
    expect(within(vocesPane).getByText("Frank")).toBeTruthy();

    // Target the EG instrument seat and seat Frank there too — voz + instrumento
    // on one service is real (Frank and Mkz both lead and play), not a conflict.
    fireEvent.click(screen.getByText("EG"));
    fireEvent.click(frankRosterRow());
    const instrumentosPane = screen.getByText("Instrumentos").closest("section") as HTMLElement;
    expect(within(instrumentosPane).getByText("Frank")).toBeTruthy();

    // Target a DIFFERENT voice seat (BGV). Frank already holds one voz seat
    // (Lead), so he must now be blocked in the roster — same category, two seats.
    fireEvent.click(screen.getByText("BGV"));

    const blockedRow = frankRosterRow();
    expect(blockedRow.getAttribute("aria-disabled")).toBe("true");
    expect(blockedRow.getAttribute("title")).toMatch(/Lead/);

    // Clicking the blocked row must not seat him.
    fireEvent.click(blockedRow);

    // The payload is the assertion that would have caught the original bug: a
    // Map-collapse would have let Frank end up in BOTH leads and bgvs.
    fireEvent.click(screen.getByRole("button", { name: "Crear y publicar" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.leads).toEqual(["m1"]);
    expect(payload.bgvs).not.toContain("m1");
  });
});

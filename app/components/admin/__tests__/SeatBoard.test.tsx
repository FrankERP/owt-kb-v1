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

import SeatBoard, { occupancyAfterPick, withSeatOverrides } from "../SeatBoard";
import type { RankedCandidate } from "../candidateRanking";

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

  it("offers no Coro seat on a Saturday service, and never writes one", () => {
    // A Saturday service has no Coro. The old form showed one Coro picker for
    // every service type, which is where the stray capability came from; 0 of 8
    // stored saturday_role documents carry a Chorus, against 19 of 19 Sundays.
    const onSubmit = vi.fn();
    const { queryAllByText, getByRole } = render(
      <SeatBoard
        {...base}
        onSubmit={onSubmit}
        initial={{
          _type: "saturday_role", date: "2026-08-08",
          leads: [], bgvs: [], chorus: [{ _id: "m2", member_name: "Gaby" }],
          instruments: [], foh: [],
        } as never}
      />,
    );
    // No Coro seat is offered...
    expect(queryAllByText("Coro")).toHaveLength(0);
    // ...and a chorus that arrived on the stored document is not written back.
    fireEvent.click(getByRole("button", { name: /guardar/i }));
    expect(onSubmit.mock.calls[0][0].chorus).toEqual([]);
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

// ── P6: the shared rule set, enforced on this surface too ───────────────────
//
// Until Task 9 the Tablero enforced NOTHING: `rankCandidates` was called with no
// `config`, so a pair the planner grid refuses could be seated here without a
// word. These pin the hard block newly appearing on a shipped surface — and they
// use data where alias ≠ member_name deliberately, because every seeded rule
// names people by ALIAS (fact 12/E11). Resolving rule names through
// `member_name` alone would make every rule match nobody and ship enforcing
// nothing with every test green.
describe("SeatBoard — hard rules (P6)", () => {
  const aliased = [
    { _id: "m1", member_name: "Francisco Rocha", alias: "Frank", memberType: ["voz"] },
    { _id: "m2", member_name: "Gabriela Núñez", alias: "Gaby", memberType: ["voz"] },
    { _id: "m3", member_name: "Lucía Herrera", alias: "Lucía", memberType: ["voz"] },
  ];

  const config = {
    sundayLeads: [],
    saturdayLeads: [],
    support: [],
    restrictions: [
      {
        id: "r-frank",
        person: "Frank", // an ALIAS, exactly as the rules are written
        excludedPatterns: ["Sun.BGV"],
        fairness: "none" as const,
        fairnessSlack: 1,
        weekExclusions: [{ id: "w1", week: 3, pattern: "*.*" }],
        caps: [],
      },
    ],
    conflicts: [{ id: "c1", personA: "Gaby", personB: "Lucía", pattern: "*.Lead" }],
    presence: [],
  };

  /** The roster <li> for a member. The roster renders the ALIAS (`displayName`),
   *  which is also how the rules name people — while `evaluate` compares against
   *  `member_name` internally, so a resolver that only knew `member_name` would
   *  match nobody here and every one of these tests would go green enforcing
   *  nothing. That asymmetry is the point of the alias-bearing fixture. */
  const rosterRow = (name: string) =>
    screen
      .getAllByText(name)
      .map((el) => el.closest("li"))
      .find((li): li is HTMLLIElement => li !== null)!;

  it("refuses a pair the planner grid refuses, all the way to the payload", () => {
    // `Gaby !with Lucía on *.Lead` — the exact rule shape the user asked for
    // ("exclude two people from being together"), which a special never gets
    // from the solver because a special is never solved.
    const onSubmit = vi.fn();
    render(
      <SeatBoard
        {...base}
        members={aliased}
        config={config}
        onSubmit={onSubmit}
        initial={{ _type: "special_role", date: "2026-08-14", service_name: "Vigilia" } as never}
      />,
    );

    fireEvent.click(rosterRow("Gaby")); // seats Gaby on Lead
    const blocked = rosterRow("Lucía");
    expect(blocked.getAttribute("aria-disabled")).toBe("true");
    expect(blocked.getAttribute("title")).toMatch(/no puede coincidir con Gaby/);

    // The click must not seat her — the disabled attribute alone proves nothing.
    fireEvent.click(blocked);
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));
    expect(onSubmit.mock.calls[0][0].leads).toEqual(["m2"]);
  });

  it("enforces nothing at all without a config — the surface's original behaviour", () => {
    // The same two clicks, no config. This is what makes the test above
    // discriminating rather than a description of `rankCandidates`.
    const onSubmit = vi.fn();
    render(
      <SeatBoard
        {...base}
        members={aliased}
        onSubmit={onSubmit}
        initial={{ _type: "special_role", date: "2026-08-14" } as never}
      />,
    );
    fireEvent.click(rosterRow("Gaby"));
    fireEvent.click(rosterRow("Lucía"));
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));
    expect(onSubmit.mock.calls[0][0].leads).toEqual(["m2", "m3"]);
  });

  it("scopes an exclusion by the pattern's SERVICE half, not by the rule alone", () => {
    // `Frank !in Sun.BGV`. On a Sunday BGV seat he is refused; on a special he is
    // not, because a special answers to `*` and nothing else (E15) — passing the
    // column is what makes that true, and dropping it would block him everywhere.
    const { unmount } = render(
      <SeatBoard
        {...base}
        members={aliased}
        config={config}
        initial={{ _type: "sunday_role", date: "2026-08-09" } as never}
      />,
    );
    fireEvent.click(screen.getByText("BGV"));
    expect(rosterRow("Frank").getAttribute("aria-disabled")).toBe("true");
    unmount();

    render(
      <SeatBoard
        {...base}
        members={aliased}
        config={config}
        initial={{ _type: "special_role", date: "2026-08-14" } as never}
      />,
    );
    fireEvent.click(screen.getByText("BGV"));
    expect(rosterRow("Frank").getAttribute("aria-disabled")).toBeNull();
  });

  it("leaves week exclusions unevaluated here — this board has no month spine", () => {
    // `Frank !in week 3 *.*`. 2026-08-16 is the third Sunday of August 2026, so
    // the planner grid refuses him there. This board edits ONE service and cannot
    // know which week that is, so the rule simply does not fire. Stated as a
    // pinned property rather than left as an accident: `Math.ceil(day / 7)` is
    // the tempting wrong answer (E21) and it lands a hard rule on wrong dates.
    render(
      <SeatBoard
        {...base}
        members={aliased}
        config={config}
        initial={{ _type: "sunday_role", date: "2026-08-16" } as never}
      />,
    );
    expect(rosterRow("Frank").getAttribute("aria-disabled")).toBeNull();
  });

  it("still refuses a same-category double booking when a config is present", () => {
    // The two refusal channels are separate fields on purpose; reading only the
    // rule verdict would have silently dropped this one.
    render(
      <SeatBoard
        {...base}
        members={aliased}
        config={config}
        initial={{ _type: "sunday_role", date: "2026-08-09" } as never}
      />,
    );
    fireEvent.click(rosterRow("Gaby")); // Lead
    fireEvent.click(screen.getByText("BGV"));
    const row = rosterRow("Gaby");
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.getAttribute("title")).toMatch(/Lead/);
  });

  it("names every rule person who resolves to nobody, so a silent no-op cannot hide", () => {
    // A rule naming someone who does not exist enforces NOTHING, and on a special
    // there is no solve to surface it. This warning is the only safeguard.
    render(
      <SeatBoard
        {...base}
        members={aliased}
        config={{
          ...config,
          conflicts: [{ id: "c9", personA: "Gaby", personB: "Fantasma", pattern: "*.Lead" }],
          presence: [{ id: "p9", persons: ["Nadie"], pattern: "Sun.BGV" }],
        }}
      />,
    );
    const warning = screen.getByRole("status");
    expect(warning.textContent).toContain("Fantasma");
    expect(warning.textContent).toContain("Nadie");
    // Resolvable names are NOT reported.
    expect(warning.textContent).not.toContain("Gaby");
  });

  it("shows no unresolved-names warning when every rule name resolves", () => {
    render(<SeatBoard {...base} members={aliased} config={config} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ── P10: a human may override a hard block; the automation may not ─────────
  //
  // Task 9 brought the hard blocks to this surface and left the override behind,
  // so against the LIVE rule set an admin editing a Saturday service could no
  // longer seat Frank, Mkz or Gaby in any voice row — the only escape being to
  // delete the rule globally, which also changes the solver for every future
  // month. These pin the two-interaction shape the planner grid already ships:
  // the blocked row stays inert, and a second, separate action seats them and
  // records WHICH rule was waived.
  describe("the override takes a second, deliberate action", () => {
    const overrideButtons = () =>
      screen.queryAllByRole("button", { name: "Asignar de todos modos" });
    /** The seat pane's Voces section — where the persistent marker belongs. */
    const voicePane = () => screen.getByText("Voces").closest("section") as HTMLElement;

    it("leaves the blocked row inert and seats only via «Asignar de todos modos»", () => {
      const onSubmit = vi.fn();
      render(
        <SeatBoard
          {...base}
          members={aliased}
          config={config}
          onSubmit={onSubmit}
          initial={{ _type: "special_role", date: "2026-08-14", service_name: "Vigilia" } as never}
        />,
      );

      fireEvent.click(rosterRow("Gaby")); // seats Gaby on Lead
      const blocked = rosterRow("Lucía");
      expect(blocked.getAttribute("aria-disabled")).toBe("true");

      // The primary row first: clicking and keying it must do nothing at all.
      fireEvent.click(blocked);
      fireEvent.keyDown(blocked, { key: "Enter" });
      fireEvent.keyDown(blocked, { key: " " });
      expect(within(voicePane()).queryByText("Lucía")).toBeNull();

      // Exactly one candidate offers the override — the rule-blocked one.
      const buttons = overrideButtons();
      expect(buttons).toHaveLength(1);
      expect(
        within(rosterRow("Lucía")).getByRole("button", { name: "Asignar de todos modos" }),
      ).toBeTruthy();

      fireEvent.click(buttons[0]);
      fireEvent.click(screen.getByRole("button", { name: /guardar/i }));
      expect(onSubmit.mock.calls[0][0].leads).toEqual(["m2", "m3"]);
    });

    it("marks the seat with the waived rule instead of going silently green", () => {
      render(
        <SeatBoard
          {...base}
          members={aliased}
          config={config}
          initial={{ _type: "special_role", date: "2026-08-14" } as never}
        />,
      );
      fireEvent.click(rosterRow("Gaby"));
      fireEvent.click(overrideButtons()[0]);
      // Names WHO was seated past WHICH rule — an override that only says
      // "Lucía, here" is indistinguishable from a rule nobody ever wrote.
      expect(
        within(voicePane()).getByText(/Regla anulada — Lucía: Regla: no puede coincidir con Gaby/),
      ).toBeTruthy();
    });

    it("offers NO override for a same-category double — D6 is not a judgement call", () => {
      // Frank carries BOTH refusals here: he holds Lead (the double) and
      // `Frank !in Sun.BGV` refuses him on BGV (the rule). Either term alone
      // would leave the other deletable with every test still green.
      render(
        <SeatBoard
          {...base}
          members={aliased}
          config={config}
          initial={{ _type: "sunday_role", date: "2026-08-09" } as never}
        />,
      );
      fireEvent.click(rosterRow("Frank")); // Lead
      fireEvent.click(screen.getByText("BGV"));
      const row = rosterRow("Frank");
      expect(row.getAttribute("aria-disabled")).toBe("true");
      expect(row.getAttribute("title")).toMatch(/Lead/); // the double wins the wording
      expect(overrideButtons()).toHaveLength(0);
    });

    // Removing the member must CLEAR their record, not merely stop rendering it.
    // The marker is drawn from who currently occupies the seat, so a stale entry
    // is invisible until the person comes back — and then it credits an override
    // to a plain, unblocked click nobody ever waived a rule for. Both removal
    // routes are walked all the way to that re-seating.
    const overrideLucia = () => {
      fireEvent.click(rosterRow("Gaby")); // seats Gaby on Lead — the conflict
      fireEvent.click(overrideButtons()[0]); // seats Lucía past it, recorded
      expect(within(voicePane()).queryByText(/Regla anulada/)).toBeTruthy();
    };
    /** Dissolve the rule (un-seat Gaby), then seat Lucía with a normal click. */
    const reseatLuciaCleanly = () => {
      fireEvent.click(rosterRow("Gaby"));
      const row = rosterRow("Lucía");
      expect(row.getAttribute("aria-disabled")).toBeNull(); // nothing blocks her now
      fireEvent.click(row);
      expect(within(voicePane()).getByText("Lucía")).toBeTruthy();
    };

    it("clears the record when the roster row un-seats them", () => {
      render(
        <SeatBoard
          {...base}
          members={aliased}
          config={config}
          initial={{ _type: "special_role", date: "2026-08-14" } as never}
        />,
      );
      overrideLucia();
      fireEvent.click(rosterRow("Lucía")); // selectable once seated (self-exempt)
      expect(within(voicePane()).queryByText(/Regla anulada/)).toBeNull();
      reseatLuciaCleanly();
      expect(within(voicePane()).queryByText(/Regla anulada/)).toBeNull();
    });

    it("clears the record when the seat chip's × removes them", () => {
      render(
        <SeatBoard
          {...base}
          members={aliased}
          config={config}
          initial={{ _type: "special_role", date: "2026-08-14" } as never}
        />,
      );
      overrideLucia();
      // Both removals go through the CHIP, so no roster toggle intervenes to
      // prune on this seat's behalf — this is what makes the × route's own
      // pruning the thing under test.
      fireEvent.click(screen.getByRole("button", { name: /Quitar a Gaby de Lead/ }));
      fireEvent.click(screen.getByRole("button", { name: /Quitar a Lucía de Lead/ }));
      expect(within(voicePane()).queryByText(/Regla anulada/)).toBeNull();

      const row = rosterRow("Lucía");
      expect(row.getAttribute("aria-disabled")).toBeNull(); // nothing blocks her now
      fireEvent.click(row);
      expect(within(voicePane()).getByText("Lucía")).toBeTruthy();
      expect(within(voicePane()).queryByText(/Regla anulada/)).toBeNull();
    });

    it("offers no override at all where no rule blocks anyone", () => {
      // Without a config nothing is rule-blocked, so the secondary action never
      // appears — the surface keeps its original one-click behaviour.
      render(
        <SeatBoard {...base} members={aliased} initial={{ _type: "special_role", date: "2026-08-14" } as never} />,
      );
      fireEvent.click(rosterRow("Gaby"));
      expect(overrideButtons()).toHaveLength(0);
    });
  });
});

// ── The pick's own refusal, pinned directly ─────────────────────────────────
//
// `RosterRow` blocks its own `onClick`/`onKeyDown`, so no DOM path can reach the
// pick with a blocked candidate — which is why dropping the `ruleBlockedReason`
// term from it once passed every test with only the render side pinned. These
// call it directly.
describe("occupancyAfterPick", () => {
  const seat = { max: null };
  const candidate = (over: Partial<RankedCandidate>): RankedCandidate => ({
    id: "m1",
    name: "Frank",
    available: true,
    alreadyAssigned: false,
    blockedReason: null,
    ruleBlockedReason: null,
    eligible: true,
    load: 0,
    recent: [],
    ...over,
  });

  it("refuses a pick a RULE blocks, with no same-category double in sight", () => {
    expect(
      occupancyAfterPick([], seat, candidate({ ruleBlockedReason: "Regla: excluido de Sat.*" }), "m1"),
    ).toBeNull();
  });

  it("refuses a pick a same-category double blocks", () => {
    expect(occupancyAfterPick([], seat, candidate({ blockedReason: "Ya está en Lead" }), "m1")).toBeNull();
  });

  it("adds an unblocked pick, and REMOVES a seated one even while blocked", () => {
    expect(occupancyAfterPick([], seat, candidate({}), "m1")).toEqual(["m1"]);
    // Un-seating is never refused, or a pair a rule now forbids could not be
    // taken apart.
    expect(
      occupancyAfterPick(["m1"], seat, candidate({ ruleBlockedReason: "Regla: …" }), "m1"),
    ).toEqual([]);
  });

  it("replaces rather than grows a single-occupant seat", () => {
    expect(occupancyAfterPick(["m9"], { max: 1 }, candidate({}), "m1")).toEqual(["m1"]);
  });
});

// ── The override record, pruned against who is actually seated ───────────────
describe("withSeatOverrides", () => {
  it("drops an entry for anyone no longer seated", () => {
    const prev = { lead: { m2: "Regla: A", m3: "Regla: B" } };
    expect(withSeatOverrides(prev, "lead", ["m3"])).toEqual({ lead: { m3: "Regla: B" } });
  });

  it("records a new override only for someone the seating actually kept", () => {
    expect(withSeatOverrides({}, "lead", ["m2"], { memberId: "m2", reason: "Regla: A" })).toEqual({
      lead: { m2: "Regla: A" },
    });
    // Evicted by a single-occupant seat in the same edit: no entry survives.
    expect(withSeatOverrides({}, "lead", ["m9"], { memberId: "m2", reason: "Regla: A" })).toEqual({
      lead: {},
    });
  });

  it("leaves other seats alone", () => {
    const prev = { lead: { m2: "Regla: A" }, bgv: { m3: "Regla: B" } };
    expect(withSeatOverrides(prev, "lead", [])).toEqual({ lead: {}, bgv: { m3: "Regla: B" } });
  });
});

// Ordering and date-windowing of the admin proposals list (Release 1).
//
// Pinned to a NEGATIVE-offset zone like its sibling handoff suite: every date
// here is a `YYYY-MM-DD` calendar day and must never be read through a UTC
// day-flip.
process.env.TZ = "Pacific/Honolulu";

import { describe, expect, it } from "vitest";

import { resolveProposalHandoff, type ProposalReviewStatus } from "../proposalHandoff";
import {
  WIDEN_STEP_MONTHS,
  applyProposalWindow,
  compareProposals,
  isWithinWindow,
  sortProposals,
  widenStepsForTargets,
  windowStartMonth,
  type ProposalListItem,
} from "../proposalListView";

const TODAY = "2026-08-24";

function p(
  _id: string,
  status: ProposalReviewStatus,
  service_date: string,
): ProposalListItem {
  return { _id, status, service_date };
}

const ids = (items: readonly ProposalListItem[]) => items.map((i) => i._id);

// ── Order ────────────────────────────────────────────────────────────────────

describe("sortProposals: buckets", () => {
  it("keeps the status bucket order pending → changes_requested → approved → draft", () => {
    const sorted = sortProposals([
      p("d", "draft", "2026-08-01"),
      p("a", "approved", "2026-08-01"),
      p("c", "changes_requested", "2026-08-01"),
      p("b", "pending", "2026-08-01"),
    ]);
    expect(ids(sorted)).toEqual(["b", "c", "a", "d"]);
  });

  it("does not mutate the caller's array", () => {
    const input = [p("b", "pending", "2026-09-06"), p("a", "pending", "2026-08-30")];
    sortProposals(input);
    expect(ids(input)).toEqual(["b", "a"]);
  });
});

describe("sortProposals: direction inside a bucket", () => {
  it("sorts approved NEWEST-first — the archive opens on the last setlist published", () => {
    const sorted = sortProposals([
      p("jun", "approved", "2026-06-28"),
      p("aug", "approved", "2026-08-16"),
      p("jul", "approved", "2026-07-05"),
    ]);
    expect(ids(sorted)).toEqual(["aug", "jul", "jun"]);
  });

  it("sorts pending SOONEST-first — the queue opens on the next service", () => {
    const sorted = sortProposals([
      p("late", "pending", "2026-09-20"),
      p("soon", "pending", "2026-08-30"),
      p("mid", "pending", "2026-09-06"),
    ]);
    expect(ids(sorted)).toEqual(["soon", "mid", "late"]);
  });

  it("sorts changes_requested and draft ascending too", () => {
    expect(
      ids(
        sortProposals([
          p("c2", "changes_requested", "2026-09-06"),
          p("c1", "changes_requested", "2026-08-30"),
        ]),
      ),
    ).toEqual(["c1", "c2"]);
    expect(
      ids(
        sortProposals([p("d2", "draft", "2026-09-06"), p("d1", "draft", "2026-08-30")]),
      ),
    ).toEqual(["d1", "d2"]);
  });

  it("tie-breaks on _id, in both directions, so the order is stable", () => {
    expect(
      ids(
        sortProposals([
          p("z", "approved", "2026-08-16"),
          p("a", "approved", "2026-08-16"),
        ]),
      ),
    ).toEqual(["a", "z"]);
    expect(
      ids(sortProposals([p("z", "pending", "2026-08-16"), p("a", "pending", "2026-08-16")])),
    ).toEqual(["a", "z"]);
  });

  it("tie-breaks by CODEPOINT, so a collator can never call two ids equal", () => {
    // `"Z".localeCompare("a")` is positive under ICU and negative by codepoint:
    // the comparator must be the locale-independent one.
    expect(compareProposals(p("Z", "pending", "2026-08-16"), p("a", "pending", "2026-08-16")))
      .toBeLessThan(0);
    expect(compareProposals(p("a", "pending", "2026-08-16"), p("a", "pending", "2026-08-16")))
      .toBe(0);
  });

  it("is antisymmetric across the approved flip", () => {
    const older = p("a", "approved", "2026-06-28");
    const newer = p("b", "approved", "2026-08-16");
    expect(compareProposals(newer, older)).toBeLessThan(0);
    expect(compareProposals(older, newer)).toBeGreaterThan(0);
  });
});

// ── Window ───────────────────────────────────────────────────────────────────

describe("windowStartMonth", () => {
  it("starts at the current month at step 0", () => {
    expect(windowStartMonth(TODAY, 0)).toBe("2026-08");
  });

  it("steps back exactly 3 months per widen", () => {
    expect(WIDEN_STEP_MONTHS).toBe(3);
    expect(windowStartMonth(TODAY, 1)).toBe("2026-05");
    expect(windowStartMonth(TODAY, 2)).toBe("2026-02");
    expect(windowStartMonth(TODAY, 3)).toBe("2025-11");
  });

  it("crosses the year boundary correctly", () => {
    expect(windowStartMonth("2026-01-05", 0)).toBe("2026-01");
    expect(windowStartMonth("2026-01-05", 1)).toBe("2025-10");
    expect(windowStartMonth("2026-01-05", 4)).toBe("2025-01");
    expect(windowStartMonth("2026-01-05", 5)).toBe("2024-10");
  });

  it("treats a malformed or negative input defensively, never as a crash", () => {
    expect(windowStartMonth(TODAY, -3)).toBe("2026-08");
    expect(windowStartMonth("2026-08-24T00:00:00Z", 0)).toBe("2026-08");
    // A malformed "today" falls back to the app timezone's real today.
    expect(windowStartMonth("nope", 0)).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("applyProposalWindow: the queue is never hidden", () => {
  const queue = [
    p("q1", "pending", "2020-01-05"),
    p("q2", "changes_requested", "2019-06-30"),
  ];

  it("keeps pending and changes_requested however old they are", () => {
    const win = applyProposalWindow(queue, TODAY, 0);
    expect(ids(win.visible)).toEqual(["q1", "q2"]);
    expect(win.hiddenCount).toBe(0);
    expect(win.canWiden).toBe(false);
  });

  it("windows approved and draft only", () => {
    expect(isWithinWindow(p("x", "pending", "2020-01-05"), TODAY, 0)).toBe(true);
    expect(isWithinWindow(p("x", "changes_requested", "2020-01-05"), TODAY, 0)).toBe(true);
    expect(isWithinWindow(p("x", "approved", "2020-01-05"), TODAY, 0)).toBe(false);
    expect(isWithinWindow(p("x", "draft", "2020-01-05"), TODAY, 0)).toBe(false);
  });
});

describe("applyProposalWindow: the default window", () => {
  const history = [
    p("aug", "approved", "2026-08-02"), // current month
    p("sep", "approved", "2026-09-06"), // future
    p("jul", "approved", "2026-07-05"), // 1 month back
    p("jun", "approved", "2026-06-28"), // 2 months back
    p("may", "approved", "2026-05-03"), // 3 months back
    p("mar", "draft", "2026-03-01"), // 5 months back
    p("jan", "approved", "2026-01-04"), // 7 months back
  ];

  it("keeps the current month and the future, hides everything older", () => {
    const win = applyProposalWindow(history, TODAY, 0);
    expect(ids(win.visible)).toEqual(["aug", "sep"]);
    expect(win.hiddenCount).toBe(5);
    expect(win.canWiden).toBe(true);
  });

  it("keeps a service on the first day of the current month", () => {
    expect(isWithinWindow(p("x", "approved", "2026-08-01"), TODAY, 0)).toBe(true);
    expect(isWithinWindow(p("x", "approved", "2026-07-31"), TODAY, 0)).toBe(false);
  });

  it("reveals exactly three more months per widen step", () => {
    const step1 = applyProposalWindow(history, TODAY, 1); // back to 2026-05
    expect(ids(step1.visible)).toEqual(["aug", "sep", "jul", "jun", "may"]);
    expect(step1.hiddenCount).toBe(2);

    const step2 = applyProposalWindow(history, TODAY, 2); // back to 2026-02
    expect(ids(step2.visible)).toEqual(["aug", "sep", "jul", "jun", "may", "mar"]);
    expect(step2.hiddenCount).toBe(1);

    const step3 = applyProposalWindow(history, TODAY, 3); // back to 2025-11
    expect(step3.hiddenCount).toBe(0);
    expect(step3.canWiden).toBe(false);
  });

  it("counts only the rows it actually hides", () => {
    const mixed = [...history, p("q", "pending", "2019-01-01")];
    expect(applyProposalWindow(mixed, TODAY, 0).hiddenCount).toBe(5);
  });

  it("preserves the incoming order", () => {
    const sorted = sortProposals(history);
    expect(ids(applyProposalWindow(sorted, TODAY, 5).visible)).toEqual(ids(sorted));
  });

  it("sizes a widen press at one step while history is contiguous", () => {
    // The common case must feel exactly like the old fixed `+ 1`.
    expect(applyProposalWindow(history, TODAY, 0).stepsToShowMore).toBe(1);
    expect(applyProposalWindow(history, TODAY, 1).stepsToShowMore).toBe(2);
    expect(applyProposalWindow(history, TODAY, 2).stepsToShowMore).toBe(3);
  });

  it("reports the current steps when nothing is hidden", () => {
    expect(applyProposalWindow(history, TODAY, 3).stepsToShowMore).toBe(3);
  });

  it("jumps over a gap so the FIRST press always reveals a row", () => {
    // The broken-button case: a lone approved row almost a year back. A fixed
    // `+ 1` leaves presses 1, 2 and 3 changing nothing at all.
    const far = "2027-06-15";
    const lone = [p("old", "approved", "2026-07-05")];

    const win = applyProposalWindow(lone, far, 0);
    expect(win.hiddenCount).toBe(1);
    expect(win.canWiden).toBe(true);
    expect(applyProposalWindow(lone, far, 1).visible).toEqual([]);

    const after = applyProposalWindow(lone, far, win.stepsToShowMore);
    expect(ids(after.visible)).toEqual(["old"]);
    expect(after.hiddenCount).toBe(0);
  });

  it("jumps to the NEWEST hidden row, not the oldest", () => {
    const far = "2027-06-15";
    const gapped = [p("mid", "approved", "2026-12-06"), p("old", "approved", "2026-07-05")];
    const steps = applyProposalWindow(gapped, far, 0).stepsToShowMore;
    const after = applyProposalWindow(gapped, far, steps);
    expect(ids(after.visible)).toEqual(["mid"]);
    expect(after.hiddenCount).toBe(1);
    // And the next press keeps making progress until the list is exhausted.
    expect(ids(applyProposalWindow(gapped, far, after.stepsToShowMore).visible))
      .toEqual(["mid", "old"]);
  });

  it("shows a row with an unusable date rather than hiding it", () => {
    const win = applyProposalWindow([p("bad", "approved", "nope")], TODAY, 0);
    expect(ids(win.visible)).toEqual(["bad"]);
    expect(win.hiddenCount).toBe(0);
  });
});

// ── Widening for a handoff target ────────────────────────────────────────────

describe("widenStepsForTargets", () => {
  const history = [
    p("aug", "approved", "2026-08-02"),
    p("jun", "approved", "2026-06-28"),
    p("jan", "approved", "2026-01-04"),
    p("old", "draft", "2025-02-14"),
    p("q", "pending", "2019-01-01"),
  ];

  it("leaves the window alone when the target is already visible", () => {
    expect(widenStepsForTargets(TODAY, 0, history, ["aug"])).toBe(0);
  });

  it("leaves the window alone for a queue target, however old", () => {
    expect(widenStepsForTargets(TODAY, 0, history, ["q"])).toBe(0);
  });

  it("widens just enough to include an approved target outside the window", () => {
    // 2026-06 is 2 months back → one 3-month step.
    expect(widenStepsForTargets(TODAY, 0, history, ["jun"])).toBe(1);
    // 2026-01 is 7 months back → three steps (back to 2025-11).
    expect(widenStepsForTargets(TODAY, 0, history, ["jan"])).toBe(3);
    expect(
      applyProposalWindow(history, TODAY, widenStepsForTargets(TODAY, 0, history, ["jan"]))
        .visible.map((i) => i._id),
    ).toContain("jan");
  });

  it("never narrows an already-widened window", () => {
    expect(widenStepsForTargets(TODAY, 6, history, ["aug"])).toBe(6);
    expect(widenStepsForTargets(TODAY, 6, history, ["jun"])).toBe(6);
  });

  it("widens for the OLDEST id of a conflict group", () => {
    const steps = widenStepsForTargets(TODAY, 0, history, ["jun", "old"]);
    const visible = applyProposalWindow(history, TODAY, steps).visible.map((i) => i._id);
    expect(visible).toContain("jun");
    expect(visible).toContain("old");
  });

  it("ignores unknown ids and an empty target list", () => {
    expect(widenStepsForTargets(TODAY, 0, history, [])).toBe(0);
    expect(widenStepsForTargets(TODAY, 0, history, ["ghost"])).toBe(0);
  });

  it("crosses a year boundary when widening for a target", () => {
    const jan = "2026-01-05";
    const items = [p("nov", "approved", "2025-11-30")];
    expect(widenStepsForTargets(jan, 0, items, ["nov"])).toBe(1);
    expect(windowStartMonth(jan, 1)).toBe("2025-10");
    expect(ids(applyProposalWindow(items, jan, 1).visible)).toEqual(["nov"]);
  });

  it("renders the card a consumed handoff scrolls to (the silent-no-op guard)", () => {
    // The panel's real sequence: resolve the target, then widen for its ids.
    const target = {
      kind: "proposal_review" as const,
      serviceRef: "role-a",
      serviceDate: "2026-01-04",
      serviceType: "sunday_role" as const,
      proposalIds: ["jan"],
      conflict: null,
      status: "approved" as const,
    };
    const result = resolveProposalHandoff(target, {
      state: "ready",
      records: history.map((i) => ({ id: i._id, status: i.status })),
      currentFilter: "approved",
    });
    expect(result.outcome).toBe("focus");
    if (result.outcome !== "focus") return;

    // Without widening the target is consumed but its card is never rendered.
    const beforeIds = ids(
      applyProposalWindow(
        history.filter((i) => i.status === result.nextFilter),
        TODAY,
        0,
      ).visible,
    );
    expect(beforeIds).not.toContain("jan");

    const steps = widenStepsForTargets(TODAY, 0, history, result.ids);
    const afterIds = ids(
      applyProposalWindow(
        history.filter((i) => i.status === result.nextFilter),
        TODAY,
        steps,
      ).visible,
    );
    expect(afterIds).toContain("jan");
  });
});

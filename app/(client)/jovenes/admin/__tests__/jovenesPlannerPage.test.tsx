// Planear Jóvenes (`/jovenes/admin`): its gates (sign-in, the rollout on the server, membership,
// a planner level), and that it reads through the one reader in EDITOR mode for the month asked
// (ADR-0081; plan R1, R4, G6, PR C).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

class NavSignal extends Error {
  constructor(readonly target: string) {
    super(`NAV ${target}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (t: string) => {
    throw new NavSignal(t);
  },
  notFound: () => {
    throw new NavSignal("404");
  },
}));

const h = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  getMemberAccess: vi.fn(),
  readMinistryEvents: vi.fn(),
  readJovenesPeople: vi.fn(),
  planner: vi.fn(),
  groups: vi.fn(),
  classes: vi.fn(),
  rolloutOpen: false,
}));
vi.mock("@/app/utils/authGuards", () => ({ requireActiveSession: () => h.requireActiveSession() }));
vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: (id: string) => h.getMemberAccess(id) }));
vi.mock("@/app/utils/ministryEventReads", async () => {
  class MinistryEventReadUnavailable extends Error {}
  return { MinistryEventReadUnavailable, readMinistryEvents: (a: unknown, o: unknown) => h.readMinistryEvents(a, o) };
});
vi.mock("@/app/utils/jovenesPeople", () => ({ readJovenesPeople: () => h.readJovenesPeople() }));
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/jovenes/SaturdayPlanner", () => ({
  default: (props: { month: string; rows: unknown[]; people: unknown[]; canEdit: boolean }) => {
    h.planner(props);
    return `[planner ${props.month} edit=${props.canEdit}]`;
  },
}));
vi.mock("@/app/components/jovenes/GroupCalendar", () => ({
  default: (props: { events: Array<{ _id: string }>; viewer: unknown; defaultDate: string }) => {
    h.groups(props);
    return `[groups ${props.events.map((e) => e._id).join(",")}]`;
  },
}));
vi.mock("@/app/components/jovenes/GroupClasses", () => ({
  default: (props: { events: Array<{ _id: string }>; viewer: unknown; people: unknown[]; today: string }) => {
    h.classes(props);
    return `[classes ${props.events.map((e) => e._id).join(",")}]`;
  },
}));
vi.mock("@/app/utils/rollout", async (orig) => {
  const real = await orig<typeof import("@/app/utils/rollout")>();
  return { ...real, rolloutAllows: (f: never, a: never) => h.rolloutOpen || real.rolloutAllows(f, a) };
});

import JovenesPlannerPage from "../page";
import { MinistryEventReadUnavailable } from "@/app/utils/ministryEventReads";

async function visit(mes?: string | string[]): Promise<string> {
  try {
    return renderToStaticMarkup(await JovenesPlannerPage({ searchParams: Promise.resolve(mes === undefined ? {} : { mes }) }));
  } catch (e) {
    if (e instanceof NavSignal) return `→ ${e.target}`;
    throw e;
  }
}

const session = { user: { role: "super-admin", sanityId: "s1", email: "x@y.z" } };
const SUPER = { active: true, role: "super-admin", ministries: ["worship"], managesMinistries: [], ministryRoles: [] };
/** A NORMALIZED access snapshot (what `getMemberAccess` returns): a leader leads `leaderOf`,
 *  which defaults to all their groups (L1's reading of a legacy leader). */
const role = (level: string, groups: string[] = ["otro-nivel"], leaderOf: string[] = level === "leader" ? groups : []) => ({
  active: true,
  role: "member",
  ministries: ["jovenes"],
  managesMinistries: [],
  ministryRoles: [{ ministry: "jovenes", level, groups, leaderOf }],
});

beforeEach(() => {
  for (const f of Object.values(h)) if (typeof f === "function") f.mockReset();
  h.rolloutOpen = false;
  h.requireActiveSession.mockResolvedValue(session);
  h.getMemberAccess.mockResolvedValue(SUPER);
  h.readMinistryEvents.mockResolvedValue([]);
  h.readJovenesPeople.mockResolvedValue([{ id: "p1", name: "Ana", groups: [] }]);
});

describe("/jovenes/admin gates", () => {
  it("no session goes to sign-in, before any read", async () => {
    h.requireActiveSession.mockResolvedValue(null);
    expect(await visit()).toBe("→ /auth/signin?callbackUrl=/jovenes/admin");
    expect(h.readMinistryEvents).not.toHaveBeenCalled();
  });

  it("while the stage is superAdmin, a Jóvenes admin gets 404 and nothing is read", async () => {
    h.getMemberAccess.mockResolvedValue(role("admin", []));
    expect(await visit()).toBe("→ 404");
    expect(h.readMinistryEvents).not.toHaveBeenCalled();
  });

  it("once open: a non-member goes to /, a pastor with no planner level to /jovenes", async () => {
    h.rolloutOpen = true;
    h.getMemberAccess.mockResolvedValue({ ...SUPER, role: "member" });
    expect(await visit()).toBe("→ /");
    h.getMemberAccess.mockResolvedValue(role("member"));
    expect(await visit()).toBe("→ /jovenes");
    h.getMemberAccess.mockResolvedValue({ ...role("admin", []), active: false });
    expect(await visit()).toBe("→ /");
    expect(h.readMinistryEvents).not.toHaveBeenCalled();
  });

  it("once open: a `leader` who leads no group is a pastor here — back to /jovenes, nothing read", async () => {
    h.rolloutOpen = true;
    h.getMemberAccess.mockResolvedValue(role("leader", ["otro-nivel", "invencibles"], []));
    expect(await visit()).toBe("→ /jovenes");
    expect(h.readMinistryEvents).not.toHaveBeenCalled();
  });
});

describe("/jovenes/admin read", () => {
  it("reads the month asked in EDITOR mode, as the session's member", async () => {
    await visit("2026-12");
    const [access, opts] = h.readMinistryEvents.mock.calls[0];
    expect(access).toBe(SUPER);
    expect(opts).toEqual({ me: "s1", ministry: "jovenes", from: "2026-12-01", to: "2026-12-31", mode: "editor" });
  });

  it("a malformed month falls back to this CDMX month", async () => {
    await visit("2026-13");
    const month = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" }).slice(0, 7);
    expect(h.readMinistryEvents.mock.calls[0][1].from).toBe(`${month}-01`);
  });

  it("an admin edits the roster; a leader sees it read-only — both get the people, for the classes' responsables", async () => {
    expect(await visit("2026-11")).toContain("[planner 2026-11 edit=true]");
    expect(h.planner.mock.calls[0][0].people).toEqual([{ id: "p1", name: "Ana", groups: [] }]);
    expect(h.planner.mock.calls[0][0].rows).toHaveLength(4);

    h.rolloutOpen = true;
    h.getMemberAccess.mockResolvedValue(role("leader"));
    expect(await visit("2026-11")).toContain("[planner 2026-11 edit=false]");
    expect(h.classes.mock.calls[1][0].people).toEqual([{ id: "p1", name: "Ana", groups: [] }]);
  });

  it("«Clases del grupo» reads the same way over a year back and the whole future (plan 2026-11-12 L3)", async () => {
    await visit("2026-12");
    expect(h.readMinistryEvents).toHaveBeenCalledTimes(2);
    const [access, opts] = h.readMinistryEvents.mock.calls[1];
    expect(access).toBe(SUPER);
    expect(opts).toEqual({ me: "s1", ministry: "jovenes", from: "2025-12-01", to: "9999-12-31", mode: "editor" });
  });

  it("without the read token it says it could not read; any other failure is not swallowed", async () => {
    h.readMinistryEvents.mockRejectedValue(new MinistryEventReadUnavailable());
    expect(await visit()).toContain("No pudimos leer las reuniones");
    h.readMinistryEvents.mockRejectedValue(new Error("boom"));
    await expect(visit()).rejects.toThrow("boom");
  });
});

describe("/jovenes/admin groups' calendars (PR D)", () => {
  // A month well past the current one, so the new meeting's default date is its first day.
  const meeting = (id: string, audience: unknown, date = "2031-11-12") => ({
    _id: id, rev: "r", ministry: "jovenes", audience, kind: "group", date, time: null, arrival: null, title: null,
    notes: null, lesson: null, published: true, seats: [], program: [], createdById: null, createdByName: null,
  });

  it("hands the month's group meetings (never the Saturday ones) and who is looking", async () => {
    h.readMinistryEvents.mockResolvedValue([
      meeting("sat", { kind: "ministry" }, "2031-11-08"),
      meeting("g1", { kind: "groups", groups: ["otro-nivel"] }),
    ]);
    expect(await visit("2031-11")).toContain("[groups g1]");
    expect(h.groups.mock.calls[0][0].viewer).toEqual({ me: "s1", isManager: true, led: [] });
    expect(h.groups.mock.calls[0][0].defaultDate).toBe("2031-11-01");
  });

  it("a leader's view names the groups they lead; a new meeting starts today in the current month", async () => {
    h.rolloutOpen = true;
    h.getMemberAccess.mockResolvedValue(role("leader", ["otro-nivel", "invencibles"]));
    await visit();
    const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
    expect(h.groups.mock.calls[0][0].viewer).toEqual({ me: "s1", isManager: false, led: ["otro-nivel", "invencibles"] });
    expect(h.groups.mock.calls[0][0].defaultDate).toBe(today);
  });
});

describe("/jovenes/admin per-group leadership (plan 2026-11-11 §5.1)", () => {
  it("a leader of some groups: `viewer.led` is the groups they LEAD, not every group they are in", async () => {
    h.rolloutOpen = true;
    h.getMemberAccess.mockResolvedValue(role("leader", ["otro-nivel", "invencibles"], ["otro-nivel"]));
    await visit();
    expect(h.groups.mock.calls[0][0].viewer).toEqual({ me: "s1", isManager: false, led: ["otro-nivel"] });
    expect(h.readMinistryEvents.mock.calls[0][1].mode).toBe("editor");
  });
});

// The Calendario's ministry filter (2026-10-29), at the page: who receives Oasis Kids
// Sundays at all, and which view the server hands the client. A worship-only reader
// must receive no Kids day and no filter — the isolation half of the feature; a member
// of both gets the Kids days and the view their cookie remembers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const { fetchMock, accessMock, cookieValue } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  accessMock: vi.fn(),
  cookieValue: { current: undefined as string | undefined },
}));

vi.mock("@/app/utils/worshipPageGate", () => ({
  requireWorshipPage: vi.fn(async () => ({ user: { sanityId: "m1", role: "member", name: "Ana" } })),
}));
vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: accessMock }));
vi.mock("@/sanity/lib/operationalClient", () => ({ operationalClient: { fetch: fetchMock } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "owt_calendar_view" && cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("@/app/components/Navbar", () => ({ default: () => null }));
vi.mock("@/app/components/CalendarView", () => ({ default: () => null }));

import SchedulePage from "../page";
import CalendarView from "@/app/components/CalendarView";

type ViewProps = { activeDays: Record<string, Array<{ day: string; kids?: unknown }>>; ministryView?: string };

/** The props the page hands `CalendarView`, found in the returned tree. */
function calendarProps(tree: ReactElement): ViewProps {
  const walk = (node: unknown): ViewProps | null => {
    if (!node || typeof node !== "object") return null;
    const el = node as ReactElement<{ children?: unknown }>;
    if (el.type === CalendarView) return el.props as unknown as ViewProps;
    const kids = el.props?.children;
    for (const child of Array.isArray(kids) ? kids : [kids]) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  const found = walk(tree);
  if (!found) throw new Error("CalendarView not rendered");
  return found;
}

const KIDS_ROW = {
  date: "2026-11-01",
  ensenanza: { name: "Ana y Luis", mine: true },
  chiquitos: null,
  medianos: { name: "Beto y Sofi", mine: false },
  grandes: { name: "Mkz y Caro", mine: false },
};

beforeEach(() => {
  fetchMock.mockReset();
  cookieValue.current = undefined;
  fetchMock.mockImplementation(async (_q: string, params: { withKids: boolean }) => ({
    sundays: [{ _id: "sun1", week: "2026-11-01", Lead: [{ member_name: "Ana" }] }],
    saturdays: [],
    sunSetlists: [],
    satSetlists: [],
    specials: [],
    viewer: null,
    // What the real query returns: nothing unless `$withKids`.
    kids: params.withKids ? [KIDS_ROW] : [],
  }));
});

const render = async () => calendarProps((await SchedulePage({ searchParams: Promise.resolve({}) })) as ReactElement);

describe("/schedule — Oasis Kids in the Calendario", () => {
  it("a worship-only reader: the query asks for no Kids days, and no filter is offered", async () => {
    accessMock.mockResolvedValue({ role: "member", ministries: ["worship"], managesMinistries: [] });
    const props = await render();
    expect(fetchMock.mock.calls[0][1].withKids).toBe(false);
    expect(props.ministryView).toBeUndefined();
    expect(props.activeDays["2026-11-01"].map((e) => e.day)).toEqual(["Domingo"]);
  });

  it("a Kids MANAGER who is not a Kids member still gets no Kids days (management ≠ membership)", async () => {
    accessMock.mockResolvedValue({ role: "member", ministries: ["worship"], managesMinistries: ["kids"] });
    await render();
    expect(fetchMock.mock.calls[0][1].withKids).toBe(false);
  });

  it("a member of both: the Kids Sunday joins the day, and the view defaults to «Todos»", async () => {
    accessMock.mockResolvedValue({ role: "member", ministries: ["worship", "kids"], managesMinistries: [] });
    const props = await render();
    expect(fetchMock.mock.calls[0][1].withKids).toBe(true);
    expect(props.ministryView).toBe("all");
    expect(props.activeDays["2026-11-01"].map((e) => e.day)).toEqual(["Domingo", "Oasis Kids"]);
  });

  it("reads the remembered view from the cookie", async () => {
    accessMock.mockResolvedValue({ role: "member", ministries: ["worship", "kids"], managesMinistries: [] });
    cookieValue.current = "kids";
    expect((await render()).ministryView).toBe("kids");
  });

  it("the super-admin spans every ministry, so gets the Kids days too", async () => {
    accessMock.mockResolvedValue({ role: "super-admin", ministries: ["worship"], managesMinistries: [] });
    expect((await render()).ministryView).toBe("all");
  });

  it("drops a Sunday with two Kids schedules instead of guessing (fails closed)", async () => {
    accessMock.mockResolvedValue({ role: "member", ministries: ["worship", "kids"], managesMinistries: [] });
    fetchMock.mockImplementation(async () => ({
      sundays: [], saturdays: [], sunSetlists: [], satSetlists: [], specials: [], viewer: null,
      kids: [KIDS_ROW, { ...KIDS_ROW }],
    }));
    expect((await render()).activeDays["2026-11-01"]).toBeUndefined();
  });

  it("filters the Kids read on `published == true` and gates it on `$withKids`", async () => {
    accessMock.mockResolvedValue({ role: "member", ministries: ["worship"], managesMinistries: [] });
    await render();
    const query = fetchMock.mock.calls[0][0] as string;
    expect(query).toMatch(/_type == "kidsSchedule" && \$withKids && published == true/);
  });
});

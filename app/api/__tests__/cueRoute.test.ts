// `GET /api/cue` — the navbar strip's one read.
//
// The properties worth pinning are not "it returns a date":
//
//   1. MINISTRY ISOLATION IS A SKIPPED QUERY, not a filtered result. A kids-only
//      volunteer must never cause a worship read at all, and a worship member
//      must never cause a `kidsSchedule` one — so the assertions are on the GROQ
//      that was SENT, not on what came back.
//   2. The two `published` spellings are different on purpose and neither is a
//      typo: `!= false` for the three worship role types (they predate the
//      field, so an absent value means visible), `== true` for `kidsSchedule`
//      (minted with the field; a field-less doc is a bug). `draftGatingCoverage`
//      scans for both, but this route is where they meet in one handler.
//   3. No session is 401 — the client treats any non-ok as "no strip".

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  getMemberAccess: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({ requireActiveSession: () => h.requireActiveSession() }));
vi.mock("@/app/utils/memberAccess", () => ({ getMemberAccess: (id: string) => h.getMemberAccess(id) }));
vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (q: string, p: Record<string, unknown>) => h.fetch(q, p) },
}));

import { GET } from "../cue/route";

const session = { user: { sanityId: "member-1" } };
/** Every GROQ string the handler sent, in call order. */
const queries = () => h.fetch.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  vi.clearAllMocks();
  h.requireActiveSession.mockResolvedValue(session);
  h.getMemberAccess.mockResolvedValue({ active: true, role: "member", ministries: ["worship"], managesMinistries: [] });
  h.fetch.mockResolvedValue(null);
});

describe("GET /api/cue", () => {
  it("401s with no session and reads nothing", async () => {
    h.requireActiveSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("gives a worship member the earliest of the three role types, and never touches kidsSchedule", async () => {
    h.fetch.mockResolvedValue({ sunday: "2026-09-13", saturday: "2026-09-12", special: null });
    const res = await GET();
    expect(await res.json()).toEqual({ cue: { dateKey: "2026-09-12", kind: "worship", day: "Sábado" } });
    expect(queries().join("\n")).not.toContain("kidsSchedule");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
  });

  it("filters `published != false` on each worship type and passes CDMX today", async () => {
    await GET();
    const [query, params] = h.fetch.mock.calls[0];
    for (const type of ["sunday_role", "saturday_role", "special_role"]) expect(query).toContain(type);
    expect(query.match(/published != false/g)).toHaveLength(3);
    expect(params.today).toBe(new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" }));
  });

  it("gives a kids-only volunteer the next published Sunday and never queries a worship type", async () => {
    h.getMemberAccess.mockResolvedValue({ active: true, role: "member", ministries: ["kids"], managesMinistries: [] });
    h.fetch.mockResolvedValue("2026-09-13");
    const res = await GET();
    expect(await res.json()).toEqual({ cue: { dateKey: "2026-09-13", kind: "kids", day: "Domingo" } });
    const sent = queries().join("\n");
    expect(sent).toContain("kidsSchedule");
    expect(sent).toContain("published == true");
    for (const type of ["sunday_role", "saturday_role", "special_role"]) expect(sent).not.toContain(type);
  });

  it("gives a member of both the earlier of the two", async () => {
    h.getMemberAccess.mockResolvedValue({ active: true, role: "member", ministries: ["worship", "kids"], managesMinistries: [] });
    h.fetch.mockImplementation(async (q: string) =>
      q.includes("kidsSchedule") ? "2026-09-06" : { sunday: "2026-09-13", saturday: null, special: null },
    );
    const res = await GET();
    expect(await res.json()).toEqual({ cue: { dateKey: "2026-09-06", kind: "kids", day: "Domingo" } });
  });

  it("answers `{cue:null}` with a 200 when nothing is upcoming", async () => {
    h.fetch.mockResolvedValue({ sunday: null, saturday: null, special: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cue: null });
  });

  it("carries `Vary: Cookie`, since the response is keyed on the session cookie", async () => {
    h.fetch.mockResolvedValue({ sunday: null, saturday: null, special: null });
    const res = await GET();
    expect(res.headers.get("Vary")).toBe("Cookie");
  });

  it("propagates a Sanity read failure rather than answering with a silent empty cue", async () => {
    h.fetch.mockRejectedValue(new Error("Sanity is down"));
    await expect(GET()).rejects.toThrow();
  });
});

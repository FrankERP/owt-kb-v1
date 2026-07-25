import { beforeEach, describe, expect, it, vi } from "vitest";

// operationalClient is `import "server-only"` guarded; neutralize the marker so
// the route modules load under vitest's node environment.
vi.mock("server-only", () => ({}));

const requireActiveManagerMock = vi.fn();
const operationalFetch = vi.fn();
const rawFetch = vi.fn();

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => requireActiveManagerMock(),
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => rawFetch(...a) },
}));

import { GET as rolesGET } from "@/app/api/admin/service-integrity/roles/route";
import { GET as setlistsGET } from "@/app/api/admin/service-integrity/setlists/route";
import { GET as proposalsGET } from "@/app/api/admin/service-integrity/proposals/route";

const routes: { name: string; GET: () => Promise<Response> }[] = [
  { name: "roles", GET: rolesGET },
  { name: "setlists", GET: setlistsGET },
  { name: "proposals", GET: proposalsGET },
];

beforeEach(() => {
  requireActiveManagerMock.mockReset();
  operationalFetch.mockReset();
  rawFetch.mockReset();
  operationalFetch.mockResolvedValue([]);
  rawFetch.mockResolvedValue([]);
});

describe.each(routes)("GET /api/admin/service-integrity/$name authorization", ({ GET }) => {
  it("denies an unauthenticated / inactive session (403)", async () => {
    requireActiveManagerMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("denies content-editor (403)", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "content-editor" } });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("allows admin (200)", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "admin" } });
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("allows super-admin (200)", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "super-admin" } });
    const res = await GET();
    expect(res.status).toBe(200);
  });
});

describe("service-integrity route behavior", () => {
  it("member role never reaches requireActiveManager gate as a manager (denied)", async () => {
    // requireActiveManager itself returns null for a plain member.
    requireActiveManagerMock.mockResolvedValue(null);
    const res = await rolesGET();
    expect(res.status).toBe(403);
    expect(operationalFetch).not.toHaveBeenCalled();
  });

  it("a Sanity read failure becomes a 500 domain error, never an empty clean result", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "admin" } });
    operationalFetch.mockRejectedValueOnce(new Error("network"));
    const res = await rolesGET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("roles route resolves members and returns a role target", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "admin" } });
    const role = {
      _id: "role-1",
      _rev: "r1",
      _type: "sunday_role",
      week: "2026-07-26",
      published: true,
      Lead: [{ _key: "k1", _type: "reference", _ref: "mem-1" }],
      BGVs: [],
      Chorus: [],
      instruments: [],
      foh_team: [],
    };
    // canonicalRoles, then members-by-ids on operationalClient; rawFetch = drafts.
    operationalFetch
      .mockResolvedValueOnce([role]) // canonicalRolesQuery
      .mockResolvedValueOnce([{ _id: "mem-1", _rev: "m1", member_name: "Ana" }]); // members
    rawFetch.mockResolvedValueOnce([]);
    const res = await rolesGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.targets).toHaveLength(1);
    expect(body.targets[0].targetKey).toBe("sunday_role:2026-07-26");
    expect(body.targets[0].records[0].members[0]._id).toBe("mem-1");
  });

  it("roles route exposes weekend lock state, owner and generation (A2 §1)", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "admin" } });
    const role = {
      _id: "role-1",
      _rev: "r1",
      _type: "sunday_role",
      week: "2026-07-26",
      published: true,
      Lead: [{ _key: "k1", _type: "reference", _ref: "mem-1" }],
      BGVs: [],
      Chorus: [],
      instruments: [],
      foh_team: [],
    };
    const lock = {
      _id: "roleTarget.sunday_role.2026-07-26",
      _rev: "lock-rev-1",
      _type: "roleTargetLock",
      targetKey: "sunday_role:2026-07-26",
      state: "claimed",
      roleId: "role-1",
      roleType: "sunday_role",
      date: "2026-07-26",
      claimNonce: "n1",
      generation: 2,
    };
    // canonicalRolesQuery, then members-by-ids, then the lock inventory — all on
    // the canonical operational client; rawFetch only serves draft inventory.
    operationalFetch
      .mockResolvedValueOnce([role])
      .mockResolvedValueOnce([{ _id: "mem-1", _rev: "m1", member_name: "Ana" }])
      .mockResolvedValueOnce([lock]);
    rawFetch.mockResolvedValueOnce([]);
    const res = await rolesGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.targets[0].expectsLock).toBe(true);
    expect(body.targets[0].lock).toEqual({
      id: "roleTarget.sunday_role.2026-07-26",
      rev: "lock-rev-1",
      state: "claimed",
      roleId: "role-1",
      generation: 2,
    });
    expect(body.targets[0].lockIssues).toEqual([]);
    expect(body.lockIssues).toEqual([]);
    // The lock inventory runs through the canonical client, never the raw one.
    const lockCall = operationalFetch.mock.calls.find((c) =>
      String(c[0]).includes("roleTargetLock"),
    );
    expect(lockCall).toBeTruthy();
    expect(rawFetch.mock.calls.some((c) => String(c[0]).includes("roleTargetLock"))).toBe(false);
  });

  it("roles route reports an orphan lock and a missing lock as explicit issues", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "super-admin" } });
    const role = {
      _id: "role-1",
      _rev: "r1",
      _type: "sunday_role",
      week: "2026-07-26",
      published: true,
      Lead: [],
      BGVs: [],
      Chorus: [],
      instruments: [],
      foh_team: [],
    };
    const orphan = {
      _id: "roleTarget.saturday_role.2026-07-25",
      _rev: "lock-rev-2",
      _type: "roleTargetLock",
      targetKey: "saturday_role:2026-07-25",
      state: "claimed",
      roleId: "role-gone",
      roleType: "saturday_role",
      date: "2026-07-25",
      claimNonce: "n2",
      generation: 0,
    };
    // No member refs on this role, so the next operational call is the locks read.
    operationalFetch.mockResolvedValueOnce([role]).mockResolvedValueOnce([orphan]);
    rawFetch.mockResolvedValueOnce([]);
    const res = await rolesGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.targets[0].lockIssues.map((i: { kind: string }) => i.kind)).toEqual([
      "missing_lock",
    ]);
    expect(body.lockIssues.map((i: { kind: string }) => i.kind).sort()).toEqual([
      "missing_lock",
      "orphan_lock",
    ]);
  });

  it("a lock read failure is a domain error, never a clean summary without lock state", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "admin" } });
    operationalFetch
      .mockResolvedValueOnce([]) // canonical roles
      .mockRejectedValueOnce(new Error("lock read failed"));
    rawFetch.mockResolvedValueOnce([]);
    const res = await rolesGET();
    expect(res.status).toBe(500);
  });

  it("setlists route returns a setlist target from canonical setlists", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "super-admin" } });
    const setlist = {
      _id: "sl-1",
      _rev: "s1",
      _type: "featuredSongs",
      week: "2026-07-26",
      songs: [{ _key: "e1", play_key: "G", song: { _type: "reference", _ref: "post-1" } }],
    };
    operationalFetch
      .mockResolvedValueOnce([setlist]) // canonicalSetlistsQuery
      .mockResolvedValueOnce([]); // canonicalRolesQuery (special roles)
    rawFetch.mockResolvedValueOnce([]);
    const res = await setlistsGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.targets[0].targetKey).toBe("featuredSongs:2026-07-26");
    expect(body.targets[0].contentState).toBe("ready");
  });

  it("proposals route resolves service_ref to a canonical role and validates", async () => {
    requireActiveManagerMock.mockResolvedValue({ user: { role: "admin" } });
    const role = {
      _id: "role-1",
      _rev: "r1",
      _type: "sunday_role",
      week: "2026-07-26",
      published: true,
      Lead: [{ _key: "k1", _type: "reference", _ref: "mem-1" }],
      BGVs: [],
      Chorus: [],
      instruments: [],
      foh_team: [],
    };
    const proposal = {
      _id: "prop-1",
      _rev: "p1",
      _createdAt: "2026-07-01T00:00:00Z",
      service_type: "sunday",
      service_ref: "role-1",
      service_date: "2026-07-26",
      status: "pending",
      songs: [],
    };
    operationalFetch
      .mockResolvedValueOnce([proposal]) // canonicalProposalsQuery
      .mockResolvedValueOnce([role]); // canonicalRolesQuery
    rawFetch.mockResolvedValueOnce([]);
    const res = await proposalsGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.records[0].valid).toBe(true);
    expect(body.records[0].referencedRole.id).toBe("role-1");
  });
});

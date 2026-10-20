// The admin panel's two reads — `GET /api/admin/roles` and `GET /api/admin/members` —
// run the GROQ of `adminRolesQuery()` / `adminMembersQuery()` (serviceReadQueries.ts),
// the builders the MCP month planner reads through too. Pinned by the exact text
// and params each route hands the client, so a later edit to one cannot skip the
// other: the connector would plan from rows `/admin` no longer reads.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The roles route module also carries the create writer and its delivery imports.
vi.mock("server-only", () => ({}));
vi.mock("@/app/utils/push", () => ({ sendPush: vi.fn() }));
vi.mock("@/app/utils/email", () => ({ sendEmail: vi.fn(), SEND_CONCURRENCY: 8, SEND_TIMEOUT_MS: 20_000 }));

const h = vi.hoisted(() => ({ requireActiveManager: vi.fn(), fetch: vi.fn() }));

vi.mock("@/app/utils/authGuards", () => ({
  requireActiveManager: () => h.requireActiveManager(),
}));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (q: string, p?: Record<string, unknown>) => h.fetch(q, p) },
}));

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: vi.fn() },
  writeClient: { create: vi.fn(), patch: vi.fn(), transaction: vi.fn() },
}));

import { GET as rolesGET } from "@/app/api/admin/roles/route";
import { GET as membersGET } from "@/app/api/admin/members/route";
import { adminMembersQuery, adminRolesQuery } from "@/app/utils/serviceReadQueries";

function signedInAs(role: string) {
  h.requireActiveManager.mockResolvedValue({ user: { sanityId: "boss", role } });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.fetch.mockResolvedValue([]);
});

describe("admin panel reads go through the shared builders", () => {
  it("the roles GET sends adminRolesQuery's exact text and params", async () => {
    signedInAs("admin");
    const res = await rolesGET();
    expect(res.status).toBe(200);
    const bound = adminRolesQuery();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch).toHaveBeenCalledWith(bound.query, bound.params);
  });

  it.each([
    ["admin", false],
    ["super-admin", true],
  ])("the members GET as %s sends adminMembersQuery(%s)", async (role, all) => {
    signedInAs(role);
    const res = await membersGET();
    expect(res.status).toBe(200);
    const bound = adminMembersQuery(all);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch).toHaveBeenCalledWith(bound.query, bound.params);
  });

  it("refuses a content-editor before any read, as before", async () => {
    signedInAs("content-editor");
    expect((await rolesGET()).status).toBe(403);
    expect((await membersGET()).status).toBe(403);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("keeps the roles rows' draft-visible shape the panel and the planner rely on", () => {
    const { query } = adminRolesQuery();
    expect(query).toContain(`"published": coalesce(published, true)`);
    expect(query).toContain(`"date": coalesce(week, date)`);
    expect(query).not.toMatch(/published\s*!=\s*false/);
  });
});

// The four availability-conflict routes (ADR-0080): the admin guard comes first on every one —
// no session, a content-editor, or a super-admin impersonating someone gets 403 before the writer
// is touched — and the bodies the writer receives are the validated ones.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  session: null as null | { user: { sanityId: string; role: string; isImpersonating?: boolean } },
  readConflictPanel: vi.fn(),
  applyAvailabilityFix: vi.fn(),
  setConflictKept: vi.fn(),
  sweepAvailabilityConflicts: vi.fn(),
}));

vi.mock("@/app/utils/authGuards", () => ({ requireActiveManager: async () => h.session }));
vi.mock("@/app/utils/availabilityFixCommit", () => ({
  SWEEP_WINDOW_MS: 50_000,
  sweepDisabled: () => false,
  readConflictPanel: (...a: unknown[]) => h.readConflictPanel(...a),
  applyAvailabilityFix: (...a: unknown[]) => h.applyAvailabilityFix(...a),
  setConflictKept: (...a: unknown[]) => h.setConflictKept(...a),
  sweepAvailabilityConflicts: (...a: unknown[]) => h.sweepAvailabilityConflicts(...a),
}));

import { GET } from "@/app/api/admin/availability-conflicts/route";
import { POST as applyPOST } from "@/app/api/admin/availability-conflicts/apply/route";
import { POST as keepPOST } from "@/app/api/admin/availability-conflicts/keep/route";
import { POST as sweepPOST } from "@/app/api/admin/availability-conflicts/sweep/route";

const req = (body?: unknown) => ({ headers: new Headers(), json: async () => body }) as unknown as NextRequest;

const APPLY = { roleId: "r1", rev: "rev1", memberId: "m1", replacements: [{ rowId: "coro", to: "m2" }] };
const KEEP = { roleId: "r1", memberId: "m1", date: "2026-11-29", serviceKind: "sunday_role", published: true, kept: true };

const calls = [
  ["GET", () => GET(req())],
  ["apply", () => applyPOST(req(APPLY))],
  ["keep", () => keepPOST(req(KEEP))],
  ["sweep", () => sweepPOST(req())],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  h.readConflictPanel.mockResolvedValue({ ok: true, blocked: null, open: [], applied: [], kept: [] });
  h.applyAvailabilityFix.mockResolvedValue({ ok: true, status: 200, body: { ok: true, recorded: true } });
  h.setConflictKept.mockResolvedValue({ ok: true, status: 200, body: { ok: true } });
  h.sweepAvailabilityConflicts.mockResolvedValue({ ok: true, mode: "dry", proposed: [], none: [], kept: [], gone: [], skipped: [], emailed: 0 });
});

describe("the availability-conflict routes' guard", () => {
  for (const [who, session] of [
    ["no session", null],
    ["a content-editor", { user: { sanityId: "ce", role: "content-editor" } }],
    ["an impersonating super-admin", { user: { sanityId: "sa", role: "super-admin", isImpersonating: true } }],
  ] as const) {
    it(`refuses ${who} on every route, before the writer`, async () => {
      h.session = session;
      for (const [, call] of calls) expect((await call()).status).toBe(403);
      expect(h.readConflictPanel).not.toHaveBeenCalled();
      expect(h.applyAvailabilityFix).not.toHaveBeenCalled();
      expect(h.setConflictKept).not.toHaveBeenCalled();
      expect(h.sweepAvailabilityConflicts).not.toHaveBeenCalled();
    });
  }

  it("lets an admin through, acting as themselves", async () => {
    h.session = { user: { sanityId: "m-frank", role: "admin" } };
    for (const [, call] of calls) expect((await call()).status).toBe(200);
    expect(h.applyAvailabilityFix).toHaveBeenCalledWith(expect.objectContaining({ actor: "m-frank", replacements: APPLY.replacements }));
    expect(h.setConflictKept).toHaveBeenCalledWith(expect.objectContaining({ actor: "m-frank", kept: true }));
  });

  it("sweeps dry outside production", async () => {
    h.session = { user: { sanityId: "m-frank", role: "admin" } };
    await sweepPOST(req());
    expect(h.sweepAvailabilityConflicts).toHaveBeenCalledWith(expect.objectContaining({ trigger: "manual", mode: "dry" }));
  });

  it("refuses a malformed body with 400", async () => {
    h.session = { user: { sanityId: "m-frank", role: "admin" } };
    expect((await applyPOST(req({ ...APPLY, replacements: [{ rowId: "coro" }] }))).status).toBe(400);
    expect((await keepPOST(req({ ...KEEP, date: "29/11/2026" }))).status).toBe(400);
    expect((await keepPOST(req({ ...KEEP, serviceKind: "kidsSchedule" }))).status).toBe(400);
    expect(h.applyAvailabilityFix).not.toHaveBeenCalled();
    expect(h.setConflictKept).not.toHaveBeenCalled();
  });
});

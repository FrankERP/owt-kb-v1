// MCP slice B §3.4b: every month tool reads members with the scope its caller's LIVE tier binds
// (`readsAllMembers`), exactly as the members GET binds it from the live role. A super-admin
// (`"full"`) reads every ministry; a worship admin, and any context without a known tier, reads
// worship only (fail closed). Each `deps.reads` call site is driven once per tier here, so a call
// site that forgot the principal's scope (or hard-coded `true`) fails.
// Fictitious people only (the repository is public).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

import { monthPrincipalOf, readsAllMembers, type MonthPrincipal } from "../../monthProposals/principal";
import { solveMonthResult } from "../solveMonth";
import { applyScheduleResult } from "../applySchedule";
import { checkServiceEditsResult, saveServiceEditsResult } from "../serviceEditor";
import { checkProposalEditsResult, reviseProposalResult, saveProposalEditsResult } from "../proposalEditor";
import { HANDLE, PRINCIPAL, applyWorld, solveDeps, storedFrom, textOf } from "./monthToolFixtures";
import { editorWorld } from "./editorToolFixtures";
import { MONTH, serviceWorld } from "./serviceEditorFixtures";

const FULL: MonthPrincipal = { ...PRINCIPAL, allMembers: true };
const ADMIN: MonthPrincipal = { ...PRINCIPAL, allMembers: false };
const TIERS = [
  ["a super-admin reads every ministry", FULL],
  ["a worship admin reads worship only", ADMIN],
] as const;

const ctxWith = (extra: Record<string, unknown> | undefined, resource: unknown = new URL("https://owt.example/api/mcp")) =>
  ({ http: { authInfo: { token: "t", clientId: "c", scopes: [], resource, extra } } }) as never;

/** Every scope a `reads` spy was called with. */
const scopesOf = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.map((c) => c[0]);

beforeEach(() => {
  for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("readsAllMembers / monthPrincipalOf", () => {
  it("only the live tier «full» reads every ministry; «admin», absent and unknown read worship only", () => {
    expect(readsAllMembers(ctxWith({ sub: "m-1", tier: "full" }))).toBe(true);
    expect(readsAllMembers(ctxWith({ sub: "m-1", tier: "admin" }))).toBe(false);
    expect(readsAllMembers(ctxWith({ sub: "m-1", tier: "read" }))).toBe(false);
    expect(readsAllMembers(ctxWith({ sub: "m-1", tier: "FULL" }))).toBe(false);
    expect(readsAllMembers(ctxWith({ sub: "m-1" }))).toBe(false);
    expect(readsAllMembers(ctxWith(undefined))).toBe(false);
    expect(readsAllMembers(undefined)).toBe(false);
    expect(readsAllMembers({} as never)).toBe(false);
  });

  it("monthPrincipalOf carries the principal plus its scope, and is null without a principal", () => {
    expect(monthPrincipalOf(ctxWith({ sub: "m-1", tier: "full" }))).toEqual({ sub: "m-1", origin: "https://owt.example", allMembers: true });
    expect(monthPrincipalOf(ctxWith({ sub: "m-1", tier: "admin" }))).toEqual({ sub: "m-1", origin: "https://owt.example", allMembers: false });
    expect(monthPrincipalOf(ctxWith({ tier: "full" }))).toBeNull();
    expect(monthPrincipalOf(ctxWith({ sub: "m-1", tier: "full" }, "https://owt.example"))).toBeNull();
    expect(monthPrincipalOf(undefined)).toBeNull();
  });
});

describe.each(TIERS)("every month tool's member read: %s", (_label, principal) => {
  const scope = { allMembers: principal.allMembers };

  it("solve_month", async () => {
    const d = solveDeps();
    const out = await solveMonthResult({ month: "2026-11" }, principal, d);
    expect(d.stored, textOf(out)).toHaveLength(1);
    expect(scopesOf(d.reads)).not.toHaveLength(0);
    for (const s of scopesOf(d.reads)) expect(s).toEqual(scope);
  });

  it("apply_schedule", async () => {
    const d = solveDeps();
    await solveMonthResult({ month: "2026-11" }, principal, d);
    const w = applyWorld(storedFrom(d.stored[0]));
    await applyScheduleResult({ proposal: HANDLE }, principal, w.deps);
    expect(scopesOf(w.deps.reads)).not.toHaveLength(0);
    for (const s of scopesOf(w.deps.reads)) expect(s).toEqual(scope);
  });

  it("the saved-month editor: check and save", async () => {
    const w = serviceWorld();
    const checked = await checkServiceEditsResult({ month: MONTH, edits: [{ op: "place", service: "2026-11-15", seat: "BGV", member: "Carla" }] }, principal, w.deps);
    expect(checked.isError, textOf(checked)).toBeFalsy();
    const changes = (checked.structuredContent as { changes: unknown[] }).changes;
    await saveServiceEditsResult({ month: MONTH, changes } as never, principal, w.deps);
    expect(scopesOf(w.deps.reads as never).length).toBeGreaterThanOrEqual(2);
    for (const s of scopesOf(w.deps.reads as never)) expect(s).toEqual(scope);
  });

  it("the proposal editor: check, save (its fresh read and its recheck) and revise", async () => {
    const w = await editorWorld();
    await checkProposalEditsResult({ proposal: HANDLE, edits: [] }, principal, w.deps);
    // Another writer moves the base's revision just before the commit: the save rechecks (a 3rd read).
    w.beforeCommit.current = () => {
      const cur = w.store.get(HANDLE)!;
      w.store.set(HANDLE, { ...cur, rev: `${cur.rev}-other` });
    };
    await saveProposalEditsResult({ proposal: HANDLE, edits: [], saveId: "save-0001" }, principal, w.deps);
    await reviseProposalResult({ proposal: HANDLE, edits: [] }, principal, w.deps);
    // check (1) + save's gate (1) + its fresh read (1) + the recheck (1) + revise (≥1).
    expect(scopesOf(w.deps.reads).length).toBeGreaterThanOrEqual(5);
    for (const s of scopesOf(w.deps.reads)) expect(s).toEqual(scope);
  });
});

describe("source guard (§3.4b, note 8)", () => {
  it("no code under app/** passes a literal `true` to adminMembersQuery, and only the availability sweep pins allMembers: true", () => {
    const root = join(__dirname, "../../../..");
    const hits: string[] = [];
    const pinned: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== "__tests__" && name !== "node_modules") walk(p);
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          // Code only: comments may name the pinned scope.
          const source = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
          if (/adminMembersQuery\(\s*true\s*\)/.test(source)) hits.push(relative(root, p));
          if (/allMembers:\s*true/.test(source)) pinned.push(relative(root, p));
        }
      }
    };
    walk(join(root, "app"));
    expect(hits).toEqual([]);
    expect(pinned).toEqual(["app/utils/availabilityFixCommit.ts"]);
  });
});

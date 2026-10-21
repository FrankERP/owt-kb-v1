// Admin parity phase 1, S3 (ADR-0064): `create_service` — one empty, unpublished service through the
// roles POST's writer (`roleCreateCommit.ts`), idempotent by a hash of the call.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

import type { CallToolResult } from "@modelcontextprotocol/server";
import { PRINCIPAL, textOf } from "./monthToolFixtures";
import { CREATE_MAX_GENERATIONS, createRequestId, createServiceResult, type CreateServiceArgs, type CreateServiceDeps } from "../createService";

const sc = (out: CallToolResult) => out.structuredContent as Record<string, unknown>;
type Body = Record<string, unknown> & { creationRequestId: string; _type: string; date: string; service_name?: string };

/** The create writer's receipt contract over a map: replay, retired key, occupied target, create. */
function world() {
  const receipts = new Map<string, { roleId: string; retired: boolean }>();
  const roles = new Map<string, Body>();
  let n = 0;
  const createRole = vi.fn(async (body: unknown) => {
    const b = body as Body;
    const receipt = receipts.get(b.creationRequestId);
    if (receipt?.retired) return { ok: false, status: 409, body: { error: "idempotency_key_retired" } };
    if (receipt) return { ok: true, status: 200, body: { _id: receipt.roleId, replay: true }, effects: { kind: "replay", roleId: receipt.roleId } };
    const taken = [...roles.values()].some((r) => r._type === b._type && r.date === b.date && r.service_name === b.service_name);
    if (taken) return { ok: false, status: 409, body: { error: "ambiguous_target" } };
    const roleId = `role-${++n}`;
    roles.set(roleId, b);
    receipts.set(b.creationRequestId, { roleId, retired: false });
    return { ok: true, status: 201, body: { _id: roleId }, effects: { kind: "created", roleId, push: {}, notice: null } };
  });
  const deps = { createRole, nowMs: () => 0, todayIso: () => "2026-10-21" } as unknown as CreateServiceDeps & { createRole: typeof createRole };
  /** `/admin` deletes a role: its receipt is retired for good. */
  const remove = (roleId: string) => {
    roles.delete(roleId);
    for (const r of receipts.values()) if (r.roleId === roleId) r.retired = true;
  };
  return { deps, roles, remove, bodies: () => createRole.mock.calls.map(([b]) => b as Body) };
}

const create = (w: ReturnType<typeof world>, args: CreateServiceArgs) => createServiceResult(args, PRINCIPAL, w.deps);

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("create_service", () => {
  it("creates an empty, unpublished Sunday with /admin's body, and a repeat replays («ya estaba»)", async () => {
    const w = world();
    const out = await create(w, { date: "2026-11-29", type: "sunday" });
    expect(out.isError).toBeFalsy();
    expect(sc(out)).toEqual({ ok: true, status: "created", service: "role-1" });
    expect(textOf(out)).toContain("domingo 29 nov");
    const [body] = w.bodies();
    expect(body).toEqual({
      creationRequestId: expect.stringMatching(/^mcp-create\.[0-9a-f]{32}$/),
      _type: "sunday_role",
      date: "2026-11-29",
      countsForFairness: true,
      leads: [],
      bgvs: [],
      chorus: [],
      instruments: [],
      foh: [],
      published: false,
    });
    const again = await create(w, { date: "2026-11-29", type: "sunday" });
    expect(sc(again)).toEqual({ ok: true, status: "already", service: "role-1" });
    expect(w.bodies()[1]!.creationRequestId).toBe(body!.creationRequestId);
    expect(w.roles.size).toBe(1);
  });

  it("a special, a «Noche de alabanza» and «Cuenta para equidad» go into the body as /admin sends them", async () => {
    const w = world();
    await create(w, { date: "2026-11-18", type: "special", name: "  Noche   de alabanza ", time: "19:30", worshipNight: true });
    await create(w, { date: "2026-11-19", type: "special", name: "Ensayo general", countsForFairness: true });
    const [night, counted] = w.bodies();
    expect(night).toMatchObject({ _type: "special_role", service_name: "Noche de alabanza", time: "19:30", format: "worship_night", countsForFairness: false });
    expect(counted).toMatchObject({ _type: "special_role", service_name: "Ensayo general", countsForFairness: true });
    expect(counted).not.toHaveProperty("time");
    expect(counted).not.toHaveProperty("format");
  });

  it("a past month takes the Tipo's default, whatever was asked (C1 §6.0)", async () => {
    const w = world();
    await create(w, { date: "2026-09-27", type: "sunday", countsForFairness: false });
    expect(w.bodies()[0]).toMatchObject({ countsForFairness: true });
  });

  it("refuses before any write: a bad date, the wrong weekday, a nameless special, a bad time, a weekend with a name", async () => {
    const w = world();
    const refused = [
      await create(w, { date: "2026-02-30", type: "special", name: "X" }),
      await create(w, { date: "2026-11-28", type: "sunday" }),
      await create(w, { date: "2026-11-29", type: "saturday" }),
      await create(w, { date: "2026-11-18", type: "special", name: "   " }),
      await create(w, { date: "2026-11-18", type: "special", name: "X", time: "7pm" }),
      await create(w, { date: "2026-11-29", type: "sunday", name: "X" }),
      await create(w, { date: "2026-11-28", type: "saturday", worshipNight: true }),
    ];
    expect(refused.map((r) => sc(r).detail)).toEqual(["date", "weekday", "weekday", "name", "time", "only_special", "only_special"]);
    expect(w.deps.createRole).not.toHaveBeenCalled();
  });

  it("a service deleted in /admin can be created again: the retired receipt moves to the next generation", async () => {
    const w = world();
    const first = await create(w, { date: "2026-11-29", type: "sunday" });
    w.remove(sc(first).service as string);
    const second = await create(w, { date: "2026-11-29", type: "sunday" });
    expect(sc(second)).toMatchObject({ ok: true, status: "created", service: "role-2" });
    const ids = w.bodies().map((b) => b.creationRequestId);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
    // And its repeat replays that generation.
    expect(sc(await create(w, { date: "2026-11-29", type: "sunday" }))).toMatchObject({ status: "already", service: "role-2" });
  });

  it("generations are bounded", async () => {
    const w = world();
    w.deps.createRole.mockResolvedValue({ ok: false, status: 409, body: { error: "idempotency_key_retired" } } as never);
    const out = await create(w, { date: "2026-11-29", type: "sunday" });
    expect(sc(out)).toMatchObject({ refused: true, code: "idempotency_key_retired" });
    expect(w.deps.createRole).toHaveBeenCalledTimes(CREATE_MAX_GENERATIONS);
  });

  it("a date that already has that service says so; a 5xx or a throw is «sin confirmar», to repeat", async () => {
    const w = world();
    await create(w, { date: "2026-11-29", type: "sunday" });
    const dup = await createServiceResult({ date: "2026-11-29", type: "sunday", countsForFairness: false }, PRINCIPAL, w.deps);
    expect(sc(dup)).toMatchObject({ refused: true, code: "ambiguous_target", detail: "exists" });
    expect(textOf(dup)).toContain("Ya existe domingo 29 nov");
    w.deps.createRole.mockResolvedValueOnce({ ok: false, status: 503, body: { error: "integrity_conflict" } } as never);
    expect(sc(await create(w, { date: "2026-11-22", type: "sunday" }))).toMatchObject({ status: "unknown", next: "repeat_same_call" });
    w.deps.createRole.mockRejectedValueOnce(new Error("2026-11-22 role-9"));
    expect(sc(await create(w, { date: "2026-11-22", type: "sunday" }))).toMatchObject({ status: "unknown", next: "repeat_same_call" });
    const logged = errors.mock.calls.flat().map(String).join("\n");
    for (const leak of ["2026-11-22", "role-9", "mcp-create."]) expect(logged).not.toContain(leak);
  });

  it("refuses without a principal", async () => {
    const w = world();
    const out = await createServiceResult({ date: "2026-11-29", type: "sunday" }, null, w.deps);
    expect(sc(out)).toMatchObject({ refused: true, code: "forbidden" });
    expect(w.deps.createRole).not.toHaveBeenCalled();
  });

  it("the request id is a pure function of the payload and the generation", () => {
    const p = { _type: "sunday_role", date: "2026-11-29", countsForFairness: true };
    expect(createRequestId(p, 0)).toBe(createRequestId({ countsForFairness: true, date: "2026-11-29", _type: "sunday_role" }, 0));
    expect(createRequestId(p, 0)).not.toBe(createRequestId(p, 1));
    expect(createRequestId(p, 0)).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  });
});

// The delete tools' deps over the saved-month fixture world (`serviceEditorFixtures.ts`), so the card's
// board and its delete read one store: `roleDeleteCommit`'s contract over the map (revision asserted,
// the row gone), the canonical shape `loadRolesForDelete` reads (raw `_ref`s, `week` or `date`).
import { vi } from "vitest";

import type { StoredRole } from "@/app/utils/roleWriteOps";
import type { ServiceDeleteDeps } from "../serviceDeletes";
import type { ServiceWorld, StoredRow } from "./serviceEditorFixtures";

type Outcome = { ok: boolean; status: number; body: unknown; effects?: unknown };

const refOf = (s: { _id: string; _key: string }) => ({ _key: s._key, _type: "reference", _ref: s._id });

export function canonicalOf(r: StoredRow): StoredRole {
  const special = r._type === "special_role";
  return {
    _id: r._id,
    _rev: r._rev,
    _type: r._type,
    ...(special ? { date: r.date, service_name: r.service_name, time: r.time } : { week: r.date }),
    published: r.published,
    Lead: r.leads.map(refOf),
    BGVs: r.bgvs.map(refOf),
    Chorus: r.chorus.map(refOf),
    instruments: r.instruments.map((i) => ({ _key: i._key, _type: "instrument_slot", instrument: i.instrument, person: { _type: "reference", _ref: i.person._id } })),
    foh_team: r.foh.map((f) => ({ _key: f._key, _type: "foh_slot", role: f.role, person: { _type: "reference", _ref: f.person._id } })),
  };
}

export interface DeleteWorld {
  deps: ServiceDeleteDeps & { deleteRole: ReturnType<typeof vi.fn> };
  /** Scripted outcomes of the next deletes, by service; past the script the fake writer runs. */
  scripted: Map<string, Array<() => Promise<Outcome>>>;
}

export function deleteWorld(w: ServiceWorld): DeleteWorld {
  const scripted = new Map<string, Array<() => Promise<Outcome>>>();
  const deleteRole = vi.fn(async (id: string, request: { rev: string }): Promise<Outcome> => {
    const queued = scripted.get(id)?.shift();
    if (queued) return queued();
    const row = w.store.get(id);
    if (!row) return { ok: false, status: 404, body: { error: "not_found" } };
    if (row._rev !== request.rev) return { ok: false, status: 409, body: { error: "stale_revision" } };
    w.store.delete(id);
    w.log.push(`delete:${id}`);
    return { ok: true, status: 200, body: { ok: true, id }, effects: { noticesQueued: true } };
  });
  const deps = {
    tokenKey: w.deps.tokenKey,
    nowMs: () => w.clock.now,
    todayIso: w.deps.todayIso,
    monthIds: async (month: string) => [...w.store.values()].filter((r) => r.date.startsWith(month)).map((r) => r._id),
    readRoles: async (ids: string[]) => ({ roles: [...w.store.values()].filter((r) => ids.includes(r._id)).map(canonicalOf), overlayIds: [] }),
    dependencies: async () => ({ code: "role_has_dependencies" as const, usable: true, issues: [], scopes: [], dependencies: [], hasDependencies: false }),
    memberNames: async (ids: string[]) => new Map(ids.map((id) => [id, id])),
    deleteRole,
    keepAlive: vi.fn(),
  } as unknown as DeleteWorld["deps"];
  return { deps, scripted };
}

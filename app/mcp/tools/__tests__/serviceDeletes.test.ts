// Admin parity phase 2: `check_service_deletes` and `delete_services` (its card twin runs the same
// function) over a fake of `/admin`'s DELETE writer (`roleDeleteCommit.ts`, whose own parity with the
// route is in `roleWriteRoutes.test.ts`). docs/superpowers/plans/2026-10-24-owt-mcp-admin-parity-f2-deletes.md.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/env", () => ({ apiVersion: "2024-07-23", dataset: "test", projectId: "test" }));

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { StoredRole } from "@/app/utils/roleWriteOps";
import type { RoleDependencyInventory } from "@/app/utils/roleDependencies";
import { PRINCIPAL, textOf } from "./monthToolFixtures";
import {
  SAVE_HARD_STOP_MS,
  SAVE_START_CUTOFF_MS,
} from "../serviceEditor";
import {
  DELETE_SERVICES_INPUT,
  checkServiceDeletesResult,
  deleteServicesResult,
  type DeleteServicesArgs,
  type ServiceDeleteDeps,
} from "../serviceDeletes";
import { DELETE_ARGS_PREFIX, V3_STORED_EDITOR_LINES } from "@/app/components/admin/v3Copy";

const sc = (out: CallToolResult) => out.structuredContent as Record<string, unknown>;
const ref = (id: string, key = id) => ({ _key: key, _type: "reference", _ref: id });

function sunday(id: string, week: string, over: Partial<StoredRole> = {}): StoredRole {
  return { _id: id, _rev: "rev-1", _type: "sunday_role", week, published: false, Lead: [ref("m-ana")], BGVs: [], Chorus: [], instruments: [], foh_team: [], ...over };
}
function saturday(id: string, week: string, over: Partial<StoredRole> = {}): StoredRole {
  return { ...sunday(id, week, over), _type: "saturday_role", ...over };
}
function special(id: string, date: string, name: string, over: Partial<StoredRole> = {}): StoredRole {
  return { _id: id, _rev: "rev-1", _type: "special_role", date, service_name: name, published: false, Lead: [], BGVs: [], Chorus: [], instruments: [], foh_team: [], ...over };
}

const clean = (): RoleDependencyInventory => ({ code: "role_has_dependencies", usable: true, issues: [], scopes: [], dependencies: [], hasDependencies: false });
const withDeps = (...kinds: string[]): RoleDependencyInventory => ({
  ...clean(),
  hasDependencies: true,
  dependencies: kinds.map((kind, i) => ({ id: `dep-${i}`, type: "x", kind, scope: "role" as const })),
});

const NAMES: Record<string, string> = { "m-ana": "Ana", "m-bruno": "Bruno", "m-carla": "Carla" };

interface Outcome { ok: boolean; status: number; body: unknown; effects?: unknown }

/** The DELETE writer's contract over a map: its revision check, a dependency refusal, inline notices. */
function world(initial: StoredRole[], over: { today?: string } = {}) {
  const roles = new Map(initial.map((r) => [r._id, r]));
  const overlays = new Set<string>();
  const inventories = new Map<string, RoleDependencyInventory | "throw">();
  const events: string[] = [];
  const noticeFails = new Set<string>();
  const scripted = new Map<string, Array<() => Promise<Outcome>>>();
  let readFails = false;
  let namesFail = false;
  let now = 0;
  let today = over.today ?? "2026-11-01";
  const deleteRole = vi.fn(async (id: string, request: { rev: string }, options?: { notices?: string }): Promise<Outcome> => {
    const queued = scripted.get(id)?.shift();
    if (queued) return queued();
    events.push(`delete:${id}`);
    const role = roles.get(id);
    if (!role) return { ok: false, status: 404, body: { error: "not_found" } };
    if (role._rev !== request.rev) return { ok: false, status: 409, body: { error: "stale_revision" } };
    const inv = inventories.get(id);
    if (inv && inv !== "throw" && inv.hasDependencies) return { ok: false, status: 409, body: { error: "role_has_dependencies" } };
    roles.delete(id);
    // Inline: the notice upsert is awaited before the commit returns.
    await Promise.resolve();
    const published = role.published !== false;
    if (published) events.push(`notice:${id}`);
    expect(options?.notices).toBe("inline");
    return { ok: true, status: 200, body: { ok: true, id }, effects: { noticesQueued: !noticeFails.has(id) } };
  });
  const keepAlive = vi.fn();
  const deps: ServiceDeleteDeps = {
    tokenKey: () => ({ ok: true, key: new Uint8Array(32).fill(7) }),
    nowMs: () => now,
    todayIso: () => today,
    monthIds: async (month) => {
      if (readFails) throw new Error("read");
      return [...roles.values()].filter((r) => (r.week ?? r.date ?? "").startsWith(month)).map((r) => r._id);
    },
    readRoles: async (ids) => {
      if (readFails) throw new Error("role read: not an array");
      return {
        roles: [...roles.values()].filter((r) => ids.includes(r._id)).map((r) => ({ ...r })),
        overlayIds: [...overlays].filter((o) => ids.includes(o.slice("drafts.".length))),
      };
    },
    dependencies: async (role) => {
      const inv = inventories.get(role._id);
      if (inv === "throw") throw new Error("deps");
      return inv ?? clean();
    },
    memberNames: async (ids) => {
      if (namesFail) throw new Error("names");
      return new Map(ids.filter((id) => NAMES[id]).map((id) => [id, NAMES[id]!]));
    },
    deleteRole: deleteRole as unknown as ServiceDeleteDeps["deleteRole"],
    keepAlive,
  };
  return {
    deps,
    roles,
    overlays,
    inventories,
    events,
    noticeFails,
    scripted,
    deleteRole,
    keepAlive,
    setNow: (ms: number) => { now = ms; },
    setToday: (iso: string) => { today = iso; },
    failReads: () => { readFails = true; },
    failNames: () => { namesFail = true; },
    edit: (id: string, patch: Partial<StoredRole>) => roles.set(id, { ...roles.get(id)!, _rev: `${roles.get(id)!._rev}+`, ...patch }),
  };
}

type World = ReturnType<typeof world>;
const check = (w: World, args: { month: string; include?: "drafts" | "all"; services?: string[] }) => checkServiceDeletesResult(args, PRINCIPAL, w.deps);
const del = (w: World, args: DeleteServicesArgs) => deleteServicesResult(args, PRINCIPAL, w.deps);
/** The arguments a check hands the model, read back from its TEXT (the model sees only the text). */
function argsFromText(out: CallToolResult): DeleteServicesArgs {
  const line = textOf(out).split("\n").find((l) => l.startsWith(DELETE_ARGS_PREFIX));
  if (!line) throw new Error("no args line");
  return JSON.parse(line.slice(DELETE_ARGS_PREFIX.length).trim()) as DeleteServicesArgs;
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

const NOV = () => [
  saturday("sat-7", "2026-11-07"),
  sunday("sun-8", "2026-11-08", { published: true, Lead: [ref("m-ana")], BGVs: [ref("m-bruno")], instruments: [{ _key: "i1", _type: "instrument_slot", instrument: "Bajo", person: { _type: "reference", _ref: "m-ana" } }] }),
  sunday("sun-15", "2026-11-15"),
  special("sp-18", "2026-11-18", "Noche de alabanza"),
];

describe("check_service_deletes", () => {
  it("lists drafts only by default, one line each, and counts the published ones it leaves out", async () => {
    const w = world(NOV());
    const out = await check(w, { month: "2026-11" });
    expect(out.isError).toBeFalsy();
    expect(sc(out).deletes).toEqual([
      { service: "sat-7", baseRev: "rev-1", line: "sábado 7 nov · borrador" },
      { service: "sun-15", baseRev: "rev-1", line: "domingo 15 nov · borrador" },
      { service: "sp-18", baseRev: "rev-1", line: "Noche de alabanza 18 nov · especial · borrador" },
    ]);
    expect(sc(out).publishedSkipped).toBe(1);
    expect(textOf(out)).toContain("1 servicio publicado no incluido");
    expect(textOf(out)).toContain("nunca «Siempre permitir»");
    expect(argsFromText(out)).toEqual({ month: "2026-11", deletes: sc(out).deletes, token: sc(out).token });
  });

  it("include all adds a published service with who it tells: distinct people, «hasta»; an empty team says so", async () => {
    const w = world([...NOV(), sunday("sun-22", "2026-11-22", { published: true, Lead: [] }), sunday("sun-29", "2026-11-29", { published: undefined, Lead: [ref("m-carla"), ref("m-carla", "k2")] })]);
    const out = await check(w, { month: "2026-11", include: "all" });
    const lines = (sc(out).deletes as Array<{ line: string }>).map((d) => d.line);
    expect(lines).toContain("domingo 8 nov · publicado: se avisa a hasta 2 personas");
    expect(lines).toContain("domingo 22 nov · publicado, sin equipo");
    // An ABSENT `published` is visible, never a draft; a person in two seats is one notice.
    expect(lines).toContain("domingo 29 nov · publicado: se avisa a hasta 1 persona");
    expect(sc(out).publishedSkipped).toBe(0);
  });

  it("keeps a past service, one with a setlist, a proposal, a special's songs, a referencing document, a Studio draft and an unreadable inventory, each with its reason", async () => {
    const w = world([
      sunday("sun-1", "2026-11-01"),
      saturday("sat-7", "2026-11-07"),
      sunday("sun-8", "2026-11-08"),
      special("sp-10", "2026-11-10", "Bautizos"),
      sunday("sun-15", "2026-11-15"),
      saturday("sat-21", "2026-11-21"),
      sunday("sun-22", "2026-11-22"),
      saturday("sat-28", "2026-11-28"),
    ], { today: "2026-11-02" });
    w.inventories.set("sat-7", withDeps("canonical_setlist"));
    w.inventories.set("sun-8", withDeps("proposal", "raw_proposal_draft"));
    w.inventories.set("sp-10", withDeps("special_songs"));
    w.inventories.set("sun-15", withDeps("unknown_reference"));
    w.overlays.add("drafts.sat-21");
    w.inventories.set("sun-22", "throw");
    const out = await check(w, { month: "2026-11" });
    expect(sc(out).deletes).toEqual([{ service: "sat-28", baseRev: "rev-1", line: "sábado 28 nov · borrador" }]);
    expect(sc(out).kept).toEqual([
      { label: "domingo 1 nov", reason: "ya pasó: bórralo en /admin" },
      { label: "sábado 7 nov", reason: "tiene setlist; un servicio con historial no se borra (tampoco en /admin)" },
      { label: "domingo 8 nov", reason: "tiene una propuesta; un servicio con historial no se borra (tampoco en /admin)" },
      { label: "Bautizos 10 nov", reason: "tiene canciones; un servicio con historial no se borra (tampoco en /admin)" },
      { label: "domingo 15 nov", reason: "tiene otro documento que lo menciona; un servicio con historial no se borra (tampoco en /admin)" },
      { label: "sábado 21 nov", reason: "tiene un borrador de Studio encima: descártalo o publícalo en Studio" },
      { label: "domingo 22 nov", reason: "no pude revisar de qué depende (revisa la cola de integridad)" },
    ]);
    // No inventory read for what was already kept.
    expect(textOf(out)).toContain("No se borran:");
  });

  it("services by id select a published one even without include all; an unknown id is kept", async () => {
    const w = world(NOV());
    const out = await check(w, { month: "2026-11", services: ["sun-8", "nope"] });
    expect(sc(out).deletes).toEqual([{ service: "sun-8", baseRev: "rev-1", line: "domingo 8 nov · publicado: se avisa a hasta 2 personas" }]);
    expect(sc(out).kept).toEqual([{ label: "un servicio que no encuentro", reason: "no existe (quizá ya se borró)" }]);
  });

  it("a malformed read refuses as «no pude leer el mes», never an empty list", async () => {
    const w = world(NOV());
    w.failReads();
    const out = await check(w, { month: "2026-11" });
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain("No pude leer el mes");
    expect(sc(out).deletes).toBeUndefined();
  });

  it("more than 31 deletable services: the first 31 in date order, and how many are left", async () => {
    const many = Array.from({ length: 33 }, (_, i) => special(`sp-${i}`, `2026-12-${String(1 + (i % 28)).padStart(2, "0")}`, `Especial ${String(i).padStart(2, "0")}`));
    const w = world(many, { today: "2026-11-01" });
    const out = await check(w, { month: "2026-12" });
    expect((sc(out).deletes as unknown[]).length).toBe(31);
    expect(sc(out).overflow).toBe(2);
    expect(textOf(out)).toContain("Quedan 2 más");
  });

  it("a special whose line would pass the save's 200-character cap is kept, so the rest stay deletable", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ref(`m-${i}`));
    const w = world([...NOV(), special("sp-long", "2026-11-20", "N".repeat(190), { published: true, Lead: many })]);
    const out = await check(w, { month: "2026-11", include: "all" });
    expect((sc(out).deletes as Array<{ service: string }>).map((d) => d.service)).not.toContain("sp-long");
    expect(textOf(out)).toContain(V3_STORED_EDITOR_LINES.delete.kept.too_long);
    const args = argsFromText(out);
    expect(DELETE_SERVICES_INPUT.safeParse(args).success).toBe(true);
    expect((await del(w, args)).isError).toBeFalsy();
  });

  it("nothing to delete: no token and no argument line", async () => {
    const w = world([sunday("sun-8", "2026-11-08", { published: true })]);
    const out = await check(w, { month: "2026-11" });
    expect(sc(out).deletes).toEqual([]);
    expect(sc(out).token).toBeUndefined();
    expect(textOf(out)).not.toContain(DELETE_ARGS_PREFIX);
  });
});

describe("delete_services", () => {
  it("deletes exactly the checked list in date order, each notice awaited before the next delete", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11", include: "all" }));
    const out = await del(w, args);
    expect(out.isError).toBeFalsy();
    expect(w.events).toEqual(["delete:sat-7", "delete:sun-8", "notice:sun-8", "delete:sun-15", "delete:sp-18"]);
    expect(sc(out)).toMatchObject({ ok: true, services: [
      { service: "sat-7", status: "deleted" },
      { service: "sun-8", status: "deleted" },
      { service: "sun-15", status: "deleted" },
      { service: "sp-18", status: "deleted" },
    ] });
    expect(textOf(out)).toContain("domingo 8 nov: borrado (avisos por correo en cola).");
    expect(textOf(out)).toContain("Un borrado no se deshace desde el chat");
    expect(w.roles.size).toBe(0);
  });

  it("a repeat after deleting 2 of 4 deletes only the other 2 and says «ya no existe» for the first", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11", include: "all" }));
    w.roles.delete("sat-7");
    w.roles.delete("sun-8");
    const out = await del(w, args);
    expect(w.deleteRole.mock.calls.map(([id]) => id)).toEqual(["sun-15", "sp-18"]);
    expect(textOf(out)).toContain("sábado 7 nov: ya no existe.");
    expect(sc(out).ok).toBe(true);
    // Everything gone: nothing to do.
    const again = await del(w, args);
    expect(textOf(again)).toContain("Ninguno de esos servicios existe ya");
    expect(w.deleteRole).toHaveBeenCalledTimes(2);
  });

  it.each<[string, (a: DeleteServicesArgs) => DeleteServicesArgs]>([
    ["a missing token", (a) => ({ ...a, token: "" })],
    ["a wrong token", (a) => ({ ...a, token: "A".repeat(43) })],
    ["a subset of the checked list", (a) => ({ ...a, deletes: a.deletes.slice(1) })],
    ["one more service", (a) => ({ ...a, deletes: [...a.deletes, { service: "sun-8", baseRev: "rev-1", line: "domingo 8 nov · publicado: se avisa a hasta 2 personas" }] })],
    ["another month on the same list", (a) => ({ ...a, month: "2026-12" })],
    ["a line edited by the caller", (a) => ({ ...a, deletes: a.deletes.map((d, i) => (i === 0 ? { ...d, line: "sábado 7 nov · borrador." } : d)) })],
  ])("%s refuses the whole call with zero deletes", async (_name, mutate) => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    const out = await del(w, mutate(args));
    expect(out.isError).toBe(true);
    expect(sc(out).refused).toBe(true);
    expect(w.deleteRole).not.toHaveBeenCalled();
  });

  it("a service that changed since the check refuses the whole call («cambió»), before any delete", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    w.edit("sun-15", { published: true });
    const out = await del(w, args);
    expect(textOf(out)).toContain("domingo 15 nov cambió desde que lo revisaste");
    expect(w.deleteRole).not.toHaveBeenCalled();
  });

  it("a line the server no longer renders the same refuses all, even with a valid token", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    // Same revision, but the stored role now reads differently (a rendering change, a re-labelled type).
    w.roles.set("sat-7", { ...w.roles.get("sat-7")!, _type: "sunday_role" });
    const out = await del(w, args);
    expect(textOf(out)).toContain("no es la que el servidor escribe ahora");
    expect(w.deleteRole).not.toHaveBeenCalled();
  });

  it("a service that is past by the time of the delete refuses all (D5)", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    w.setToday("2026-11-10");
    const out = await del(w, args);
    expect(textOf(out)).toContain("ya pasó");
    expect(w.deleteRole).not.toHaveBeenCalled();
  });

  it("a malformed read refuses as «no pude leer el mes», never «ya no existe», with zero deletes", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    w.failReads();
    const out = await del(w, args);
    expect(textOf(out)).toContain("No pude leer el mes");
    expect(textOf(out)).not.toContain("ya no existe");
    expect(w.deleteRole).not.toHaveBeenCalled();
  });

  it("a dependency added after the check answers «no se borró» and the run goes on", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    w.inventories.set("sat-7", withDeps("canonical_setlist"));
    const out = await del(w, args);
    expect(textOf(out)).toContain("sábado 7 nov: no se borró: ahora tiene setlist o propuesta.");
    expect(w.deleteRole.mock.calls.map(([id]) => id)).toEqual(["sat-7", "sun-15", "sp-18"]);
    expect(sc(out).next).toBeUndefined();
  });

  it("a lost race stops the run as «sin confirmar», keeps the write alive, and leaves the rest «pendiente»", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    w.scripted.set("sun-15", [() => { w.setNow(SAVE_HARD_STOP_MS + 1); return new Promise<Outcome>(() => {}); }]);
    const out = await del(w, args);
    expect(textOf(out)).toContain("domingo 15 nov: sin confirmar.");
    expect(textOf(out)).toContain("Noche de alabanza 18 nov: pendiente (no se empezó).");
    expect(sc(out).next).toBe("repeat_same_call");
    expect(w.keepAlive).toHaveBeenCalledTimes(2);
    expect(w.deleteRole.mock.calls.map(([id]) => id)).toEqual(["sat-7", "sun-15"]);
  });

  it("no delete starts after the cut-off: what did not start is «pendiente»", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    w.scripted.set("sat-7", [async () => { w.setNow(SAVE_START_CUTOFF_MS); w.roles.delete("sat-7"); return { ok: true, status: 200, body: { ok: true }, effects: { noticesQueued: true } }; }]);
    const out = await del(w, args);
    expect(w.deleteRole).toHaveBeenCalledTimes(1);
    expect(textOf(out)).toContain("domingo 15 nov: pendiente (no se empezó).");
    expect(sc(out).next).toBe("repeat_same_call");
  });

  it("a failed notice upsert names who was not told (read before the delete), and the run goes on; without names, how many", async () => {
    for (const namesFail of [false, true]) {
      const w = world(NOV());
      if (namesFail) w.failNames();
      const args = argsFromText(await check(w, { month: "2026-11", include: "all" }));
      w.noticeFails.add("sun-8");
      const out = await del(w, args);
      expect(textOf(out)).toContain(
        namesFail
          ? "domingo 8 nov: borrado, pero no se pudo avisar a 2 personas"
          : "domingo 8 nov: borrado, pero no se pudo avisar a Ana y Bruno",
      );
      expect(w.deleteRole).toHaveBeenCalledTimes(4);
    }
  });

  it("«su equipo recibirá «Ya no participas»» only when a published delete queued its notices", async () => {
    const team = V3_STORED_EDITOR_LINES.delete.undoTeam;
    const all = world(NOV());
    expect(textOf(await del(all, argsFromText(await check(all, { month: "2026-11", include: "all" }))))).toContain(team);
    const drafts = world(NOV());
    const draftsOut = await del(drafts, argsFromText(await check(drafts, { month: "2026-11" })));
    expect(textOf(draftsOut)).toContain("Un borrado no se deshace desde el chat");
    expect(textOf(draftsOut)).not.toContain(team);
    const failed = world(NOV());
    const failedArgs = argsFromText(await check(failed, { month: "2026-11", include: "all" }));
    failed.noticeFails.add("sun-8");
    expect(textOf(await del(failed, failedArgs))).not.toContain(team);
  });

  it("bootstrap_completed_reload → «revisa de nuevo», never «repite»", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    w.scripted.set("sat-7", [async () => { w.edit("sat-7", {}); return { ok: false, status: 409, body: { error: "bootstrap_completed_reload" } }; }]);
    const out = await del(w, args);
    expect(textOf(out)).toContain("sábado 7 nov: no se borró: su documento se acaba de reparar; revisa el mes de nuevo.");
    expect(sc(out).next).toBe("check_again");
    expect(textOf(out)).not.toContain("Repite exactamente");
  });

  it("stale_revision with the revision unchanged → «repite UNA vez»; changed → «revisa de nuevo», which wins", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    w.scripted.set("sat-7", [async () => ({ ok: false, status: 409, body: { error: "stale_revision" } })]);
    const out = await del(w, args);
    expect(textOf(out)).toContain("repite la misma llamada UNA vez");
    expect(sc(out).next).toBe("repeat_same_call");

    const v = world(NOV());
    const args2 = argsFromText(await check(v, { month: "2026-11" }));
    v.scripted.set("sat-7", [async () => ({ ok: false, status: 409, body: { error: "stale_revision" } })]);
    v.scripted.set("sun-15", [async () => { v.edit("sun-15", {}); return { ok: false, status: 409, body: { error: "stale_revision" } }; }]);
    const both = await del(v, args2);
    expect(sc(both).next).toBe("check_again");
    expect(textOf(both)).not.toContain("Repite exactamente");
  });

  it("not_found is «ya no existe» only when a strict re-read proves it; present → «sin confirmar», and the run stops", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    w.scripted.set("sat-7", [async () => { w.roles.delete("sat-7"); return { ok: false, status: 404, body: { error: "not_found" } }; }]);
    w.scripted.set("sun-15", [async () => ({ ok: false, status: 404, body: { error: "not_found" } })]);
    const out = await del(w, args);
    expect(textOf(out)).toContain("sábado 7 nov: ya no existe.");
    expect(textOf(out)).toContain("domingo 15 nov: sin confirmar.");
    expect(textOf(out)).toContain("Noche de alabanza 18 nov: pendiente");
  });

  it("a throw, a 5xx and bootstrap_outcome_unknown are «sin confirmar» and stop the run; a published one names who may not have been told", async () => {
    for (const fail of [
      async (): Promise<Outcome> => { throw new Error("boom"); },
      async (): Promise<Outcome> => ({ ok: false, status: 500, body: {} }),
      async (): Promise<Outcome> => ({ ok: false, status: 409, body: { error: "bootstrap_outcome_unknown" } }),
    ]) {
      const w = world(NOV());
      const args = argsFromText(await check(w, { month: "2026-11", include: "all" }));
      w.scripted.set("sun-8", [fail]);
      const out = await del(w, args);
      expect(textOf(out)).toContain("domingo 8 nov: sin confirmar (si se borró, quizá no se avisó a Ana y Bruno).");
      expect(w.deleteRole.mock.calls.map(([id]) => id)).toEqual(["sat-7", "sun-8"]);
    }
  });

  it("the card twin runs the same function", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    const out = await deleteServicesResult(args, PRINCIPAL, w.deps, "delete_services_app");
    expect(sc(out).ok).toBe(true);
    expect(w.deleteRole).toHaveBeenCalledTimes(3);
  });

  it("no principal: refused before any read", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11" }));
    const out = await deleteServicesResult(args, null, w.deps);
    expect(sc(out).refused).toBe(true);
    expect(w.deleteRole).not.toHaveBeenCalled();
  });

  it("logs fixed tags only: never an id, a name, a line or a token", async () => {
    const w = world(NOV());
    const args = argsFromText(await check(w, { month: "2026-11", include: "all" }));
    w.scripted.set("sat-7", [async () => { throw new Error("sat-7 m-ana Ana"); }]);
    await del(w, args);
    const logged = errors.mock.calls.flat().map(String).join("\n");
    for (const secret of ["sat-7", "sun-8", "m-ana", "Ana", "Bruno", args.token, "borrador"]) expect(logged).not.toContain(secret);
  });
});

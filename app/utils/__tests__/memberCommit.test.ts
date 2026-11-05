// The people writer (slice M): D5, D6, D12, D13 on /admin, /me and the chat; §3.1 on the chat only;
// the access switch. A small in-memory Content Lake answers the writer's own queries and applies its
// patches and transactions with real revision checks, so the tests assert stored state.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Doc = Record<string, unknown> & { _id: string; _rev: string };
  const docs = new Map<string, Doc>();
  let rev = 0;
  const nextRev = () => `rev-${++rev}`;
  const conflict = () =>
    Object.assign(new Error("409"), { statusCode: 409, details: { type: "mutationError", items: [{ error: { type: "documentRevisionIDDoesNotMatchError" } }] } });
  const hooks: { beforeCommit: (() => void) | null } = { beforeCommit: null };
  const writes: string[] = [];

  /** `a[_key=="k"].b` / `a.b` paths, as the writer sends them. */
  function segments(path: string): Array<string | { key: string }> {
    const out: Array<string | { key: string }> = [];
    for (const part of path.split(/\.(?![^[]*\])/)) {
      const m = /^([^[]+)\[_key=="([^"]+)"\]$/.exec(part);
      if (m) out.push(m[1], { key: m[2] });
      else out.push(part);
    }
    return out;
  }
  function setPath(doc: Record<string, unknown>, path: string, value: unknown, unset = false) {
    const segs = segments(path);
    let cur: unknown = doc;
    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i];
      if (typeof s === "string") {
        const o = cur as Record<string, unknown>;
        if (o[s] === undefined) o[s] = {};
        cur = o[s];
      } else {
        const arr = cur as Array<Record<string, unknown>>;
        cur = arr.find((x) => x._key === s.key);
        if (!cur) throw new Error(`no item ${s.key}`);
      }
    }
    const last = segs[segs.length - 1];
    if (typeof last === "string") {
      if (unset) delete (cur as Record<string, unknown>)[last];
      else (cur as Record<string, unknown>)[last] = structuredClone(value);
    } else {
      const arr = cur as Array<Record<string, unknown>>;
      const i = arr.findIndex((x) => x._key === last.key);
      if (unset && i >= 0) arr.splice(i, 1);
    }
  }

  type Op = { kind: "set" | "unset" | "setIfMissing"; value: unknown };
  function patchBuilder(id: string) {
    const ops: Op[] = [];
    let ifRev: string | undefined;
    const b = {
      ifRevisionId(r: string) { ifRev = r; return b; },
      set(v: Record<string, unknown>) { ops.push({ kind: "set", value: v }); return b; },
      unset(p: string[]) { ops.push({ kind: "unset", value: p }); return b; },
      setIfMissing(v: Record<string, unknown>) { ops.push({ kind: "setIfMissing", value: v }); return b; },
      check() {
        const doc = docs.get(id);
        if (!doc) throw Object.assign(new Error("missing"), { statusCode: 404 });
        if (ifRev && doc._rev !== ifRev) throw conflict();
      },
      apply() {
        const doc = structuredClone(docs.get(id)!);
        for (const op of ops) {
          if (op.kind === "set") for (const [k, v] of Object.entries(op.value as Record<string, unknown>)) setPath(doc, k, v);
          if (op.kind === "unset") for (const p of op.value as string[]) setPath(doc, p, undefined, true);
          if (op.kind === "setIfMissing") for (const [k, v] of Object.entries(op.value as Record<string, unknown>)) if (doc[k] === undefined) doc[k] = structuredClone(v);
        }
        doc._rev = nextRev();
        docs.set(id, doc);
        writes.push(id);
        return doc;
      },
      async commit() {
        hooks.beforeCommit?.();
        hooks.beforeCommit = null;
        b.check();
        return b.apply();
      },
    };
    return b;
  }

  const writeClient = {
    patch: (id: string) => patchBuilder(id),
    async create(doc: Record<string, unknown>) {
      const id = `rand-${++rev}`;
      const stored = { ...structuredClone(doc), _id: id, _rev: nextRev() } as Doc;
      docs.set(id, stored);
      writes.push(id);
      return stored;
    },
    transaction() {
      const steps: Array<{ check(): void; apply(): unknown }> = [];
      const tx = {
        patch(id: string, fn: (p: ReturnType<typeof patchBuilder>) => ReturnType<typeof patchBuilder>) {
          steps.push(fn(patchBuilder(id)));
          return tx;
        },
        createIfNotExists(doc: Doc) {
          steps.push({
            check() {},
            apply() {
              if (!docs.has(doc._id)) { docs.set(doc._id, { ...structuredClone(doc), _rev: nextRev() }); writes.push(doc._id); }
            },
          });
          return tx;
        },
        async commit() {
          hooks.beforeCommit?.();
          hooks.beforeCommit = null;
          for (const s of steps) s.check();
          for (const s of steps) s.apply();
          return { results: [] };
        },
      };
      return tx;
    },
  };

  const members = () => [...docs.values()].filter((d) => d._type === "teamMembers");
  async function fetch(q: string, p: Record<string, unknown> = {}): Promise<unknown> {
    if (q.startsWith("count(")) return docs.has(p.draft as string) ? 1 : 0;
    if (q.includes("lower(email) in $emails")) {
      const self = (p.self as string[]) ?? [];
      return members().filter((d) => (p.emails as string[]).includes(String(d.email ?? "").toLowerCase()) && !self.includes(d._id));
    }
    if (q.includes('!(_id in path("drafts.**"))')) return members().filter((d) => !d._id.startsWith("drafts.")).map((d) => ({ _id: d._id, member_name: d.member_name, alias: d.alias }));
    if (q.includes('role == "super-admin"')) return members().filter((d) => d.role === "super-admin" && d.disabled !== true && d._id !== p.id).map((d) => ({ _id: d._id, _rev: d._rev, disabled: d.disabled }));
    if (q.includes("._rev")) return docs.get(p.id as string)?._rev ?? null;
    const doc = docs.get(p.id as string);
    if (q.includes('_type == "teamMembers"') && doc?._type !== "teamMembers") return null;
    return doc ? structuredClone(doc) : null;
  }

  return { docs, writes, hooks, writeClient, fetch, reset() { docs.clear(); writes.length = 0; rev = 0; hooks.beforeCommit = null; } };
});

vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: h.fetch }, writeClient: h.writeClient }));
vi.mock("@/app/utils/revalidate", () => ({ revalidateServiceViews: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { MEMBER_ERROR, checkMemberEdits, createMember, createMembers, patchMember, patchOwnProfile, planNewMembers, saveMemberEdits, setMemberDisabled } from "../memberCommit";
import { CHAT_ACCESS } from "../memberEdits";

function put(doc: Record<string, unknown> & { _id: string }) {
  h.docs.set(doc._id, { _type: "teamMembers", _rev: `seed-${doc._id}`, ...doc } as never);
}

function seedRules() {
  h.docs.set("solverConfig", {
    _id: "solverConfig",
    _type: "solverConfig",
    _rev: "rules-1",
    sundayLeads: [],
    saturdayLeads: [],
    support: [],
    restrictions: [
      { _type: "solverRestriction", _key: "r1", id: "r1", person: "Vale", excludedPatterns: ["Sat.*"], fairness: "future-value", fairnessSlack: 1, weekExclusions: [], caps: [], sundayCadence: "weird", extra: 7 },
    ],
    conflicts: [{ _type: "solverConflict", _key: "c1", id: "c1", personA: "Pau", personB: "Vale", pattern: "Sun.*" }],
    presence: [{ _type: "solverPresence", _key: "p1", id: "p1", persons: ["Vale", "Tony"], pattern: "Sun.BGV" }],
    updatedAt: "2026-10-01T00:00:00Z",
  } as never);
}

const stored = (id: string) => h.docs.get(id) as Record<string, unknown>;

beforeEach(() => {
  h.reset();
  put({ _id: "vale", member_name: "Valentina Sosa", alias: "Vale", email: "vale@example.com", role: "member" });
  put({ _id: "pau", member_name: "Paula Ríos", alias: "Pau", email: "pau@example.com", role: "member" });
  put({ _id: "tony", member_name: "Antonio", alias: "Tony", email: "tony@example.com", role: "admin" });
  put({ _id: "frank", member_name: "Frank", email: "frank@example.com", role: "super-admin" });
  put({ _id: "boss2", member_name: "Otro", email: "boss2@example.com", role: "super-admin" });
  seedRules();
});

describe("D6 — a renamed person's rules move with them, in one transaction", () => {
  it("/admin: the alias change sets ONLY the renamed person paths and the stamp; unknown values survive", async () => {
    const before = structuredClone(stored("solverConfig"));
    const out = await patchMember("vale", { alias: "Valeria" }, "frank");
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ alias: "Valeria", renamedRules: 3 });
    const after = stored("solverConfig");
    const r = (after.restrictions as Array<Record<string, unknown>>)[0];
    expect(r).toEqual({ ...(before.restrictions as Array<Record<string, unknown>>)[0], person: "Valeria" });
    expect((after.conflicts as Array<Record<string, unknown>>)[0].personB).toBe("Valeria");
    expect((after.presence as Array<Record<string, unknown>>)[0].persons).toEqual(["Valeria", "Tony"]);
    expect(after.updatedBy).toBe("frank");
    const { restrictions: _a, conflicts: _b, presence: _c, _rev: _d, updatedAt: _e, updatedBy: _f, ...rest } = after;
    const { restrictions: _g, conflicts: _h, presence: _i, _rev: _j, updatedAt: _k, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
  });

  it("/me: a member's own alias change moves their rules too", async () => {
    const out = await patchOwnProfile("vale", { alias: "Valeria", email: "vale@example.com" });
    expect(out.status).toBe(200);
    expect((stored("solverConfig").restrictions as Array<Record<string, unknown>>)[0].person).toBe("Valeria");
  });

  it("a 409 on the rules writes neither document, and /admin says the rules moved", async () => {
    h.hooks.beforeCommit = () => { stored("solverConfig")._rev = "rules-2"; };
    const out = await patchMember("vale", { alias: "Valeria" }, "frank");
    expect(out).toMatchObject({ status: 409, body: { error: MEMBER_ERROR.rulesChanged } });
    expect(stored("vale").alias).toBe("Vale");
  });

  it("a 409 on the person writes neither document, and says the person moved", async () => {
    h.hooks.beforeCommit = () => { stored("vale")._rev = "moved"; };
    const out = await patchMember("vale", { alias: "Valeria" }, "frank");
    expect(out).toMatchObject({ status: 409, body: { error: MEMBER_ERROR.changed } });
    expect((stored("solverConfig").restrictions as Array<Record<string, unknown>>)[0].person).toBe("Vale");
  });

  it("no rules document → the person only", async () => {
    h.docs.delete("solverConfig");
    const out = await patchMember("vale", { alias: "Valeria" }, "frank");
    expect(out.status).toBe(200);
    expect(stored("vale").alias).toBe("Valeria");
  });
});

describe("D13 — a present field is not a changed field", () => {
  it("a form save that re-sends unchanged name, alias, email and role writes the person and nothing else", async () => {
    put({ _id: "twin", member_name: "Twin", alias: "Pau", email: "pau@example.com", role: "member" }); // a legacy collision
    const out = await patchMember("pau", { member_name: "Paula Ríos", alias: "Pau", email: "PAU@example.com", role: "member", memberType: ["voz"] }, "frank");
    expect(out.status).toBe(200);
    expect(h.writes).toEqual(["pau"]);
  });
});

describe("D5 — an email someone else has is refused", () => {
  it("case-insensitive, a disabled member, another person's draft; the person's own draft ignored", async () => {
    put({ _id: "gone", member_name: "Gone", email: "taken@example.com", disabled: true });
    expect((await patchMember("vale", { email: "TAKEN@example.com" }, "frank")).status).toBe(409);
    put({ _id: "drafts.pau", member_name: "Paula Ríos", email: "draft@example.com" });
    expect((await patchMember("vale", { email: "draft@example.com" }, "frank")).status).toBe(409);
    put({ _id: "drafts.vale", member_name: "Valentina Sosa", email: "mine@example.com" });
    expect((await patchMember("vale", { email: "mine@example.com" }, "frank")).status).toBe(200);
  });

  it("/me answers without naming the owner", async () => {
    const out = await patchOwnProfile("vale", { email: "pau@example.com" });
    expect(out).toMatchObject({ status: 409, body: { error: MEMBER_ERROR.meEmailTaken } });
  });

  it("a create refuses an email the roster has, or the batch repeats", async () => {
    expect((await createMember({ member_name: "Nueva", email: "Pau@Example.com" })).status).toBe(409);
    const twice = await planNewMembers(
      [
        { member_name: "Uno", email: "x@example.com", ministries: ["worship"] },
        { member_name: "Dos", email: "x@example.com", ministries: ["worship"] },
      ],
      "chat",
    );
    expect(twice).toMatchObject({ ok: false, status: 409 });
  });
});

describe("D12 — a name or alias another member has is refused", () => {
  it("on a rename (/admin names the other person; /me does not)", async () => {
    const admin = await patchMember("vale", { alias: "pau" }, "frank");
    expect(admin.status).toBe(409);
    expect(String(admin.body.error)).toContain("Pau");
    expect((await patchOwnProfile("vale", { alias: "Antonio" })).body).toEqual({ error: MEMBER_ERROR.meAliasTaken, code: "name_taken" });
  });

  it("on create, against the roster and within the batch", async () => {
    expect((await createMember({ member_name: "Tony", email: "t2@example.com" })).status).toBe(409);
    const batch = await planNewMembers(
      [
        { member_name: "Uno", alias: "Mismo", email: "a@example.com", ministries: ["worship"] },
        { member_name: "mismo", email: "b@example.com", ministries: ["worship"] },
      ],
      "chat",
    );
    expect(batch).toMatchObject({ ok: false, status: 409 });
  });

  it("a new name equal to an orphaned rule text is reported on /admin, refused at /me", async () => {
    const cfg = stored("solverConfig");
    (cfg.restrictions as unknown[]).push({ _type: "solverRestriction", _key: "r9", id: "r9", person: "Gaby", excludedPatterns: ["Sat.*"], fairness: "none", fairnessSlack: 1, weekExclusions: [], caps: [] });
    expect((await patchOwnProfile("vale", { alias: "Gaby" })).body).toMatchObject({ error: MEMBER_ERROR.meAliasUnavailable });
    const admin = await patchMember("pau", { alias: "Gaby" }, "frank");
    expect(admin.status).toBe(200);
    expect((admin.body as Record<string, unknown>).ruleNotes).toEqual(["Ojo: la regla «Gaby: Nunca en sábado» hoy no nombra a nadie y empezaría a aplicarle."]);
  });
});

describe("the chat (§3.1, D3)", () => {
  it("check renders the field lines and the renamed rules; save writes exactly that under the token's verify", async () => {
    const edits = [{ op: "set" as const, field: "alias" as const, value: "Valeria" }];
    const checked = await checkMemberEdits("vale", edits);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.lines[0]).toBe("Alias: «Vale» → «Valeria»");
    expect(checked.lines.filter((l) => l.startsWith("Regla: "))).toHaveLength(3);
    const seen: string[][] = [];
    const out = await saveMemberEdits("vale", edits, { actorId: "frank", verify: (lines) => (seen.push([...lines]), null) });
    expect(out.ok && out.effects.unchanged).toBe(false);
    expect(seen[0]).toEqual(checked.lines);
    expect(stored("vale").alias).toBe("Valeria");
    // A retry after the save landed: nothing to change, nothing written, verify not consulted.
    const again = await saveMemberEdits("vale", edits, { actorId: "frank", verify: () => "nope" });
    expect(again.ok && again.effects.unchanged).toBe(true);
  });

  it("a refusing verify writes nothing", async () => {
    const out = await saveMemberEdits("vale", [{ op: "add", field: "tipo", value: "voz" }], { actorId: "frank", verify: () => "cambió" });
    expect(out).toMatchObject({ ok: false, status: 409, body: { error: "cambió" } });
    expect(h.writes).toEqual([]);
  });

  it("refuses lowering an admin and changing a manager's email; the routes do not", async () => {
    const lower = await saveMemberEdits("tony", [{ op: "set", field: "role", value: "member" }], { actorId: "frank", verify: () => null });
    expect(lower).toMatchObject({ ok: false, status: 403, body: { error: CHAT_ACCESS.lowerAdmin } });
    const email = await checkMemberEdits("tony", [{ op: "set", field: "email", value: "t@example.com" }]);
    expect(email).toMatchObject({ ok: false, status: 403 });
    expect((await patchMember("tony", { role: "member" }, "frank")).status).toBe(200);
  });

  it("create: one transaction of createIfNotExists at the given ids; a super-admin is refused", async () => {
    const batch = [
      { member_name: "Nueva Uno", email: "n1@example.com", ministries: ["jovenes"], memberType: [] },
      { member_name: "Nueva Dos", email: "n2@example.com", ministries: ["jovenes"], memberType: [] },
    ];
    const out = await createMembers(batch, { ids: ["id-1", "id-2"], verify: () => null });
    expect(out.ok).toBe(true);
    expect(stored("id-1")).toMatchObject({ member_name: "Nueva Uno", email: "n1@example.com", ministries: ["jovenes"] });
    const boss = await planNewMembers([{ member_name: "Jefe", email: "j@example.com", role: "super-admin", ministries: ["worship"] }], "chat");
    expect(boss).toMatchObject({ ok: false, status: 403 });
  });
});

describe("setMemberDisabled", () => {
  it("the chat refuses disabling a manager and enabling a super-admin; allows a member", async () => {
    expect(await setMemberDisabled("tony", true, { operatorIds: new Set(["frank"]), chat: true })).toMatchObject({ ok: false, status: 403 });
    put({ _id: "off", member_name: "Off", email: "off@example.com", role: "super-admin", disabled: true });
    expect(await setMemberDisabled("off", false, { operatorIds: new Set(["frank"]), chat: true })).toMatchObject({ ok: false, status: 403 });
    const ok = await setMemberDisabled("pau", true, { operatorIds: new Set(["frank"]), chat: true });
    expect(ok.ok).toBe(true);
    expect(stored("pau").disabled).toBe(true);
  });

  it("the route keeps its own refusals: self, and the last enabled super-admin", async () => {
    expect(await setMemberDisabled("frank", true, { operatorIds: new Set(["frank"]) })).toMatchObject({ status: 409 });
    stored("boss2").disabled = true;
    expect(await setMemberDisabled("frank", true, { operatorIds: new Set(["boss2"]) })).toMatchObject({ status: 409 });
  });

  it("the chat's verdict is judged again on the retry after a 409", async () => {
    // The first commit loses to a write that makes the target an admin; the retry must refuse.
    h.hooks.beforeCommit = () => {
      const p = stored("pau");
      p.role = "admin";
      p._rev = "moved";
    };
    const out = await setMemberDisabled("pau", true, { operatorIds: new Set(["frank"]), chat: true });
    expect(out).toMatchObject({ ok: false, status: 403 });
    expect(stored("pau").disabled).toBeUndefined();
  });
});

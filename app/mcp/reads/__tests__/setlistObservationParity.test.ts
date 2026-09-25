// `get_service`'s setlist observation (spec I7) is the setlist WRITER's own
// decision, not a guess at it.
//
// The observation is what a later `edit_setlist` (P3) hands back to the admin
// setlist writer, which resolves its target with `loadWeekendSetlistTarget` /
// `loadSpecialSetlistTarget` (`app/utils/serviceWriteTargets.ts`). This file runs
// those REAL loaders — their own target-scoped queries, answered by the test's
// mock layer from the same fixture store — beside the presenter's observation
// over the one snapshot, and demands the same answer for every canonical role:
//
//   loader ok, server none           ↔ { state: "none" }
//   loader ok, server single         ↔ { state: "single", id, rev, rowKeys }  (row keys from the writer's own read)
//   ambiguous_target (duplicates)    ↔ { state: "ambiguous", ids }
//   integrity_conflict + rawDrafts   ↔ { state: "draft_overlay" }
//   integrity_conflict, malformed    ↔ { state: "invalid" }
//
// The loaders are not modified and not mocked; only the clients underneath are.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ operational: vi.fn(), raw: vi.fn() }));

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => h.operational(...a) },
  rawIntegrityClient: { fetch: (...a: unknown[]) => h.raw(...a) },
}));
// `serviceWriteTargets` → `roleWriteOps` imports the write client; nothing here writes.
vi.mock("@/sanity/lib/serverClient", () => ({ writeClient: { fetch: vi.fn() }, serverClient: { fetch: vi.fn() } }));

import { assembleService } from "@/app/utils/publishReadyBundle";
import { storedRoleDate } from "@/app/utils/roleWriteRequest";
import { loadSpecialSetlistTarget, loadWeekendSetlistTarget } from "@/app/utils/serviceWriteTargets";
import { setlistTypeForKind } from "@/app/utils/setlistWriteRequest";
import { loadServiceSnapshot, type ServiceSnapshot } from "../serviceSnapshot";
import { observeServiceSetlist, serviceKindOf, type SetlistObservation } from "../servicePresenter";
import { readToolStore, scopedResponder, type ScopedResponder } from "./readToolFixtures";

let responder: ScopedResponder;

beforeEach(() => {
  responder = scopedResponder(readToolStore());
  h.operational.mockReset().mockImplementation(responder.operational);
  h.raw.mockReset().mockImplementation(responder.raw);
});

type WriterLoad = Awaited<ReturnType<typeof loadWeekendSetlistTarget>> | Awaited<ReturnType<typeof loadSpecialSetlistTarget>>;

/** The writer's answer in the observation's own vocabulary. An answer outside it fails the test. */
function writerDecision(load: WriterLoad): SetlistObservation {
  if (load.ok) {
    const server = load.target.server;
    if (server.state === "none") return { state: "none" };
    const songs = load.target.record?.songs;
    return {
      state: "single",
      id: server.id,
      rev: server.rev,
      rowKeys: Array.isArray(songs) ? songs.map((row) => (row as { _key?: string })._key ?? null) : [],
    };
  }
  const { code, details } = load.failure;
  if (code === "ambiguous_target" && Array.isArray(details.conflictingIds)) {
    return { state: "ambiguous", ids: [...(details.conflictingIds as string[])].sort() };
  }
  if (code === "integrity_conflict" && Array.isArray(details.rawDrafts)) return { state: "draft_overlay" };
  if (code === "integrity_conflict") return { state: "invalid" };
  throw new Error(`writer answered ${code} ${JSON.stringify(details)} — outside the observation vocabulary`);
}

async function writerLoad(snapshot: ServiceSnapshot, id: string): Promise<WriterLoad> {
  const role = snapshot.roles.find((r) => r._id === id)!;
  const kind = serviceKindOf(role._type);
  const date = storedRoleDate(role);
  if (!kind || !date) throw new Error(`fixture: ${id} has no kind or date`);
  return kind === "special"
    ? loadSpecialSetlistTarget(id, date)
    : loadWeekendSetlistTarget(setlistTypeForKind(kind)!, date);
}

const CANONICAL_IDS = readToolStore().roles.map((r) => r._id as string);

describe("the setlist observation equals the setlist writer's own target decision", () => {
  it.each(CANONICAL_IDS)("%s", async (id) => {
    const snapshot = await loadServiceSnapshot();
    const role = snapshot.roles.find((r) => r._id === id)!;
    const observed = observeServiceSetlist(snapshot, role).observation;

    const scopedBefore = responder.scopedCalls.length;
    const decision = writerDecision(await writerLoad(snapshot, id));
    // The writer really read, through its own scoped queries.
    expect(responder.scopedCalls.length).toBeGreaterThan(scopedBefore);

    expect(observed).toEqual(decision);
  });

  it("covers every state, for weekend and special services", async () => {
    const snapshot = await loadServiceSnapshot();
    const seen = new Set<string>();
    for (const id of CANONICAL_IDS) {
      const role = snapshot.roles.find((r) => r._id === id)!;
      const kind = serviceKindOf(role._type) === "special" ? "special" : "weekend";
      seen.add(`${kind}:${writerDecision(await writerLoad(snapshot, id)).state}`);
    }
    expect([...seen].sort()).toEqual([
      "special:draft_overlay",
      "special:invalid",
      "special:none",
      "special:single",
      "weekend:ambiguous",
      "weekend:draft_overlay",
      "weekend:none",
      "weekend:single",
    ]);
  });

  it("documents why the readiness bundle is not the source: it misses a legacy-id week's overlay the writer refuses", async () => {
    const snapshot = await loadServiceSnapshot();
    const decision = writerDecision(await writerLoad(snapshot, "role-sun-1129"));
    expect(decision).toEqual({ state: "draft_overlay" });
    const bundle = assembleService(snapshot.readiness, "role-sun-1129")!.observation!;
    expect(bundle.setlist).toEqual({ state: "single", id: "legacy-set-1129", rev: "legacy-set-1129-rev" });
    expect(bundle.unsafe).not.toContain("setlist");
  });
});

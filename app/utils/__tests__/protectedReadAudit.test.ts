// Service Readiness A1 §1/§3 — protected-read audit.
//
// Two halves:
//  1. Fixture tests that pin the DETECTOR's behaviour (literal `_type` queries,
//     generic `_id` reads of protected fields, and the `_type`-only defensive
//     rejection guard) without writing throwaway files into the repo.
//  2. A real scan of every git-tracked runtime/script query site, asserting the
//     only remaining direct protected reads are the exact documented A2
//     mutation-local entries plus the single defensive type-rejection guard.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  A2_HANDOFF_ALLOWLIST,
  DEFENSIVE_TYPE_REJECTION_GUARDS,
  OPERATOR_TOOLING_ALLOWLIST,
  PROTECTED_RUNTIME_WRITERS,
  PROTECTED_TYPES,
  RETIRED_ONE_SHOT_WRITERS,
  auditViolations,
  describeSite,
  isAuditedQuerySiteFile,
  scanSource,
  stripComments,
  type ProtectedSite,
} from "../protectedReadAudit";
import { RETIRED_WRITERS } from "../../../scripts/lib/sr-retired-writer.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function gitTrackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

const TRACKED = gitTrackedFiles();
const TRACKED_SET = new Set(TRACKED);
const AUDITED_FILES = TRACKED.filter(isAuditedQuerySiteFile);

const REAL_SITES: ProtectedSite[] = AUDITED_FILES.flatMap((file) =>
  scanSource(file, readFileSync(path.join(REPO_ROOT, file), "utf8")),
);

const GUARD_FILE = "app/api/content/posts/[id]/route.ts";
const CLIENT_IMPORTS = `
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
`;

// ── Detector fixtures ───────────────────────────────────────────────────────

describe("protected-read detector", () => {
  it("flags a literal protected-type query run through a non-canonical client", () => {
    const sites = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
export async function GET() {
  return serverClient.fetch(\`*[_type == "sunday_role" && week == $week]{ _id, Lead }\`, { week });
}`,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      operation: "GET",
      kind: "protected-literal-read",
      client: "serverClient",
      compliant: false,
    });
    expect(auditViolations(sites)).toHaveLength(1);
  });

  it("treats the special identity coordinator as protected operational state", () => {
    const nonCanonical = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
export async function GET() {
  return serverClient.fetch(\`*[_type == "specialIdentityCoordinator"]{ _id, _rev, version }\`);
}`,
    );
    expect(nonCanonical).toHaveLength(1);
    expect(nonCanonical[0]).toMatchObject({
      kind: "protected-literal-read",
      client: "serverClient",
      compliant: false,
    });
    expect(auditViolations(nonCanonical)).toHaveLength(1);

    const canonical = scanSource(
      "app/utils/specialIdentityCoordinator.ts",
      `${CLIENT_IMPORTS}
export async function loadSpecialIdentityCoordinator() {
  return operationalClient.fetch(\`*[_type == "specialIdentityCoordinator"]{ _id, _rev, version }\`);
}`,
    );
    expect(canonical).toHaveLength(1);
    expect(canonical[0]).toMatchObject({
      kind: "protected-literal-read",
      client: "operationalClient",
      compliant: true,
    });
    expect(auditViolations(canonical)).toHaveLength(0);
  });

  it("detects a coordinator-backed mutation even when the route names no protected type", () => {
    const sites = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
import { loadSpecialIdentityCoordinator } from "@/app/utils/specialIdentityCoordinator";
export async function POST() {
  const loaded = await loadSpecialIdentityCoordinator();
  return writeClient.transaction().patch("coordinator", (p) => p.set({ version: 2 })).commit();
}`,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ operation: "POST", kind: "protected-write" });
    expect(sites[0].evidence).toContain("loadSpecialIdentityCoordinator");
  });

  it("flags a delete that names no type literal, resolved through a protected loader", () => {
    // The real blind spot this closes: `roles/[id]` DELETE resolves the document by
    // id through a loader and then deletes it. Nothing in the region spells a
    // protected type — the type comes from the stored document — so a literal-only
    // detector reported no site at all, and the repo's most destructive protected
    // write was the one operation the audit could not see.
    const sites = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
import { loadRoleForMutation } from "@/app/utils/roleWriteOps";
export async function DELETE() {
  const loaded = await loadRoleForMutation(id, rev);
  return writeClient.transaction().delete(loaded.target.role._id).commit();
}`,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ operation: "DELETE", kind: "protected-write", compliant: false });
    expect(sites[0].evidence).toContain("loadRoleForMutation");
    expect(auditViolations(sites)).toHaveLength(1);
  });

  it("flags a module-scope protected write reached through a canonical loader", () => {
    // Shared write helpers are not exported HTTP handlers, so they carry no
    // operation of their own. They still mutate protected documents and must be
    // registered rather than slip through as "not a route".
    const sites = scanSource(
      "app/utils/example.ts",
      `${CLIENT_IMPORTS}
import { loadCanonicalRole } from "@/app/utils/roleWriteOps";
const role = await loadCanonicalRole(roleId);
await writeClient.transaction().patch(roleId, (p) => p.set({ lock })).commit();`,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ operation: "module", kind: "protected-write", compliant: false });
    expect(auditViolations(sites)).toHaveLength(1);
  });

  it("leaves a mutation that resolves no protected document alone", () => {
    // The loader set is the whole signal — a write that never resolves a protected
    // document is out of scope, and widening the detector must not make every
    // unrelated mutation in the repo a violation.
    const sites = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
export async function DELETE() {
  return writeClient.delete(someUnrelatedId);
}`,
    );
    expect(sites).toHaveLength(0);
  });

  it("accepts the same query through the canonical operational client", () => {
    const sites = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
export async function GET() {
  return operationalClient.fetch(\`*[_type == "sunday_role" && week == $week]{ _id, Lead }\`, { week });
}`,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0].compliant).toBe(true);
    expect(auditViolations(sites)).toHaveLength(0);
  });

  it("detects a generic _id protected-role read that names no type literal", () => {
    const sites = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
export async function POST() {
  return serverClient.fetch(
    \`*[_id == $id][0]{ "leads": Lead[]._ref, "foh": foh_team[].person._ref }\`, { id },
  );
}`,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0].kind).toBe("generic-id-protected-read");
    expect(auditViolations(sites)).toHaveLength(1);
  });

  it("detects protected reads hidden behind a module-level query constant", () => {
    const sites = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
const FIELDS = \`_id, Lead[]._ref\`;
const SNEAKY = \`*[_type == "special_role"]{ \${FIELDS} }\`;
export async function GET() {
  return serverClient.fetch(SNEAKY);
}`,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0].kind).toBe("protected-literal-read");
  });

  it("rejects a canonical serviceReadQueries helper executed by a non-canonical client", () => {
    const sites = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
import { canonicalRolesQuery } from "@/app/utils/serviceReadQueries";
export async function GET() {
  const q = canonicalRolesQuery();
  return serverClient.fetch(q.query, q.params);
}`,
    );
    expect(auditViolations(sites)).toHaveLength(1);
    expect(sites[0].compliant).toBe(false);
  });

  it("flags a protected writer in a newly added, unlisted script", () => {
    const sites = scanSource(
      "scripts/brand-new-thing.mjs",
      `import { createClient } from "@sanity/client";
const client = createClient({ projectId: "x" });
const rows = await client.fetch(\`*[_type == "setlistProposal"]{ _id }\`);
for (const r of rows) await client.delete(r._id);`,
    );
    expect(sites.map((s) => s.kind).sort()).toEqual(["protected-literal-read", "protected-write"]);
    expect(auditViolations(sites)).toHaveLength(2);
  });

  it("ignores protected type names that appear only in prose or non-query code", () => {
    const commentOnly = scanSource(
      "app/api/example/route.ts",
      `${CLIENT_IMPORTS}
export async function PATCH() {
  // Do not let this overwrite a setlistProposal or sunday_role document.
  /* saturdarSongs is deliberately misspelled. */
  await writeClient.patch(id).set({ title: "x" }).commit();
}`,
    );
    expect(commentOnly).toEqual([]);

    const noClient = scanSource(
      "app/components/SongSheetLike.tsx",
      `const LABELS = { featuredSongs: "Domingo", saturdarSongs: "Sábado" };
export default function Sheet() { return LABELS.featuredSongs; }`,
    );
    expect(noClient).toEqual([]);
  });

  it("strips comments while preserving offsets and template-literal bodies", () => {
    const src = 'const q = `*[_type == "sunday_role"]`; // sets setlistProposal\n';
    const stripped = stripComments(src);
    expect(stripped).toHaveLength(src.length);
    expect(stripped).toContain('*[_type == "sunday_role"]');
    expect(stripped).not.toContain("setlistProposal");
  });
});

// ── Defensive type-rejection guard ──────────────────────────────────────────

describe("defensive type-rejection guard exclusion", () => {
  const guardSource = `${CLIENT_IMPORTS}
export async function PATCH() {
  const target = await writeClient.fetch(\`*[_id == $id][0]{ _type }\`, { id });
  if (target._type !== "post") return new Response(null, { status: 400 });
  await writeClient.patch(id).set({ title: "x" }).commit();
}`;

  it("recognizes the posts/[id] PATCH _type-only guard as its documented exclusion", () => {
    const sites = scanSource(GUARD_FILE, guardSource);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ operation: "PATCH", kind: "type-rejection-guard" });
    expect(auditViolations(sites)).toHaveLength(0);
  });

  it("still fails a protected-field generic _id read in the same file and method", () => {
    const sites = scanSource(
      GUARD_FILE,
      `${CLIENT_IMPORTS}
export async function PATCH() {
  const target = await writeClient.fetch(
    \`*[_id == $id][0]{ _type, "leads": Lead[]._ref, service_ref }\`, { id },
  );
  return Response.json(target);
}`,
    );
    expect(sites).toHaveLength(1);
    expect(sites[0].kind).toBe("generic-id-protected-read");
    expect(auditViolations(sites)).toHaveLength(1);
  });

  it("does not extend the guard exclusion to another file or another method", () => {
    expect(auditViolations(scanSource("app/api/other/route.ts", guardSource))).toHaveLength(1);
    const otherMethod = guardSource.replace("function PATCH", "function PUT");
    expect(auditViolations(scanSource(GUARD_FILE, otherMethod))).toHaveLength(1);
  });

  it("keeps the guard registry separate from, and disjoint with, the A2 allowlist", () => {
    // Two `_type`-only ownership guards: the song-content editor and the kids
    // pair editor, both of which patch a document id taken from the path.
    expect(DEFENSIVE_TYPE_REJECTION_GUARDS).toHaveLength(2);
    expect(DEFENSIVE_TYPE_REJECTION_GUARDS[0]).toMatchObject({
      file: GUARD_FILE,
      operation: "PATCH",
    });
    expect(DEFENSIVE_TYPE_REJECTION_GUARDS[1]).toMatchObject({
      file: "app/api/kids/pairs/[id]/route.ts",
      operation: "PATCH",
    });
    // A2 never removes it.
    expect(DEFENSIVE_TYPE_REJECTION_GUARDS[0].removalOwner).not.toBe("A2");
    for (const guard of DEFENSIVE_TYPE_REJECTION_GUARDS) {
      expect(
        A2_HANDOFF_ALLOWLIST.some((a) => a.file === guard.file && a.operation === guard.operation),
      ).toBe(false);
    }
    // The A2 allowlist does not cover a guard-kind site.
    const guardSite: ProtectedSite = {
      file: "app/api/admin/roles/route.ts",
      operation: "POST",
      kind: "type-rejection-guard",
      client: "serverClient",
      compliant: false,
      evidence: "",
    };
    expect(auditViolations([guardSite])).toHaveLength(1);
  });
});

// ── Allowlist shape ─────────────────────────────────────────────────────────

describe("A2 handoff allowlist", () => {
  const ALL_ENTRIES = [
    ...A2_HANDOFF_ALLOWLIST,
    ...PROTECTED_RUNTIME_WRITERS,
    ...RETIRED_ONE_SHOT_WRITERS,
    ...OPERATOR_TOOLING_ALLOWLIST,
    ...DEFENSIVE_TYPE_REJECTION_GUARDS,
  ];
  const VALID_OPERATIONS = new Set(["module", "GET", "POST", "PUT", "PATCH", "DELETE"]);

  it("names an exact file and operation, never a directory or glob", () => {
    for (const entry of ALL_ENTRIES) {
      expect(entry.file, entry.file).not.toMatch(/[*?]|\/$/);
      expect(VALID_OPERATIONS.has(entry.operation), `${entry.file} [${entry.operation}]`).toBe(true);
      expect(entry.reason.length, entry.file).toBeGreaterThan(20);
      expect(entry.removalOwner.length, entry.file).toBeGreaterThan(0);
    }
    // A blanket `scripts/**` style exemption must not sneak in.
    expect(ALL_ENTRIES.some((e) => e.file.includes("**"))).toBe(false);
  });

  it("references only git-tracked files, so gitignored local tooling is never listed", () => {
    for (const entry of ALL_ENTRIES) {
      expect(TRACKED_SET.has(entry.file), `${entry.file} is not git-tracked`).toBe(true);
    }
    // Gitignored UX-review helpers (e.g. scripts/sa-roster.mjs) are outside the
    // committed-code contract: never an entry, and never asserted to exist.
    expect(ALL_ENTRIES.some((e) => /sa-roster/.test(e.file))).toBe(false);
    for (const file of AUDITED_FILES) expect(TRACKED_SET.has(file)).toBe(true);
  });

  it("has no duplicate file+operation entries", () => {
    const keys = ALL_ENTRIES.map((e) => `${e.file}#${e.operation}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is EMPTY — plan item 12: every A1 mutation-local read is migrated", () => {
    // A2's completion gate: "the A1 writer-read allowlist is empty". Not a rename —
    // the reads themselves are gone. The permanent writes that remain are a
    // different claim and live in their own registries below.
    expect(A2_HANDOFF_ALLOWLIST).toEqual([]);
  });

  it("licenses the fourteen permanent runtime writers for WRITES ONLY, never reads", () => {
    expect(PROTECTED_RUNTIME_WRITERS.map((e) => `${e.file}#${e.operation}`).sort()).toEqual(
      [
        "app/utils/outboxSweep.ts#module",
        "app/utils/serviceMutationSideEffects.ts#module",
        "app/api/admin/proposals/[id]/route.ts#PATCH",
        "app/api/admin/roles/[id]/route.ts#DELETE",
        "app/api/admin/roles/[id]/route.ts#PATCH",
        "app/api/admin/roles/copy-instruments/route.ts#POST",
        "app/api/admin/roles/publish/route.ts#POST",
        "app/api/admin/roles/publish-ready/route.ts#POST",
        "app/api/admin/roles/route.ts#POST",
        "app/api/admin/roles/swap/route.ts#POST",
        "app/api/admin/roles/unpublish/route.ts#POST",
        "app/utils/roleWriteOps.ts#module",
        "app/api/admin/setlists/route.ts#PUT",
        "app/api/me/proposals/route.ts#POST",
      ].sort(),
    );
    // Nothing removes a writer: item 12 must never be "satisfied" by moving reads here.
    for (const entry of PROTECTED_RUNTIME_WRITERS) {
      expect(entry.removalOwner, entry.file).not.toBe("A2");
      expect(
        A2_HANDOFF_ALLOWLIST.some((a) => a.file === entry.file && a.operation === entry.operation),
        entry.file,
      ).toBe(false);
    }

    // The narrowing is real: the same file+operation still fails for every READ kind.
    for (const entry of PROTECTED_RUNTIME_WRITERS) {
      const write: ProtectedSite = {
        file: entry.file,
        operation: entry.operation,
        kind: "protected-write",
        client: "sanity-client",
        compliant: false,
        evidence: "",
      };
      expect(auditViolations([write]), `${entry.file} write`).toHaveLength(0);
      for (const kind of ["protected-literal-read", "generic-id-protected-read", "type-rejection-guard"] as const) {
        expect(auditViolations([{ ...write, kind }]), `${entry.file} ${kind}`).toHaveLength(1);
      }
    }
  });

  it("lists exactly the six retired one-shot writers, each proven fail-closed", () => {
    expect(RETIRED_ONE_SHOT_WRITERS.map((e) => `${e.file}#${e.operation}`).sort()).toEqual(
      [
        "scripts/cleanup-superseded-proposals.mjs#module",
        "scripts/import-schedule.ts#module",
        "scripts/import-setlist-history.mjs#module",
        "scripts/migrate-shared-proposals.mjs#module",
        "scripts/normalize-instrument-names.mjs#module",
        "scripts/unpublish-july-2026.mjs#module",
      ].sort(),
    );
    // Same set as the runtime retirement gate — one source of truth, not two lists
    // that can drift apart.
    expect(RETIRED_ONE_SHOT_WRITERS.map((e) => e.file).sort()).toEqual(
      Object.values(RETIRED_WRITERS)
        .map((entry) => entry.file)
        .sort(),
    );
    // The exemption is only honest while the file actually fails closed. The gate
    // must be present AND precede every write marker — that ordering is proven in
    // scripts/lib/__tests__/sr-retired-writer.test.mjs; here we pin the call itself
    // so an entry cannot outlive its guard.
    for (const entry of RETIRED_ONE_SHOT_WRITERS) {
      const src = readFileSync(path.join(REPO_ROOT, entry.file), "utf8");
      expect(src, entry.file).toContain('from "./lib/sr-retired-writer.mjs"');
      expect(src, entry.file).toMatch(/assertRetiredWriter\(\s*"/);
      expect(entry.removalOwner, entry.file).not.toBe("A2");
    }
  });

  it("keeps the four writer/read registries pairwise disjoint", () => {
    const registries = {
      A2_HANDOFF_ALLOWLIST,
      PROTECTED_RUNTIME_WRITERS,
      RETIRED_ONE_SHOT_WRITERS,
      OPERATOR_TOOLING_ALLOWLIST,
      DEFENSIVE_TYPE_REJECTION_GUARDS,
    };
    const names = Object.keys(registries) as Array<keyof typeof registries>;
    for (const a of names) {
      for (const b of names) {
        if (a === b) continue;
        for (const entry of registries[a]) {
          expect(
            registries[b].some((o) => o.file === entry.file && o.operation === entry.operation),
            `${entry.file} [${entry.operation}] is in both ${a} and ${b}`,
          ).toBe(false);
        }
      }
    }
  });

  it("keeps guarded operator tooling in its own registry, never owned by A2", () => {
    expect(OPERATOR_TOOLING_ALLOWLIST.map((e) => `${e.file}#${e.operation}`).sort()).toEqual(
      [
        "e2e/service-readiness/lib/dataset.ts#module",
        "scripts/backfill-legacy-seat-arrays.mjs#module",
        "scripts/bootstrap-weekend-locks.mjs#module",
        // Reads role documents to re-queue notices a lossy flush spent; writes
        // only notificationOutbox, and is dry-run until --apply.
        "scripts/requeue-role-notices.mjs#module",
        "scripts/requeue-setlist-notice.mjs#module",
        "scripts/service-readiness-cleanup.mjs#module",
        "scripts/service-readiness-feasibility.mjs#module",
      ].sort(),
    );
    for (const entry of OPERATOR_TOOLING_ALLOWLIST) {
      // A2 adds these writers; item 12 ("empty the A2 allowlist") never removes them.
      expect(entry.removalOwner, entry.file).not.toBe("A2");
      expect(
        A2_HANDOFF_ALLOWLIST.some((a) => a.file === entry.file && a.operation === entry.operation),
        entry.file,
      ).toBe(false);
    }
  });

  it("sees a client obtained from the guarded factory, not only from createClient", () => {
    const sites = scanSource(
      "scripts/example-tool.mjs",
      `const { makeVerificationClient } = await import("./lib/sr-verification-runtime.mjs");
const client = makeVerificationClient(guards, token);
const rows = await client.fetch(\`*[_type == "sunday_role"]{ _id }\`);
await client.transaction().delete(rows[0]._id).commit();`,
    );
    expect(sites.map((s) => s.kind).sort()).toEqual(["protected-literal-read", "protected-write"]);
    // Unlisted guarded tooling is still a violation: the registry is exact.
    expect(auditViolations(sites)).toHaveLength(2);
  });

  it("carries no dead entries — every exemption is exercised by a real site", () => {
    for (const entry of ALL_ENTRIES) {
      const used = REAL_SITES.some(
        (s) => !s.compliant && s.file === entry.file && s.operation === entry.operation,
      );
      expect(used, `unused exemption: ${entry.file} [${entry.operation}]`).toBe(true);
    }
  });
});

// ── Real repository scan ────────────────────────────────────────────────────

describe("git-tracked protected read inventory", () => {
  it("scans a meaningful set of git-tracked query sites", () => {
    expect(AUDITED_FILES.length).toBeGreaterThan(50);
    expect(REAL_SITES.length).toBeGreaterThan(20);
    expect(REAL_SITES.some((s) => s.compliant)).toBe(true);
  });

  it("has no unlisted direct protected read or writer today", () => {
    const violations = auditViolations(REAL_SITES);
    expect(violations.map(describeSite)).toEqual([]);
  });

  it("routes every migrated member-facing and notification read through the canonical client", () => {
    const migrated = [
      "app/(client)/page.tsx",
      "app/(client)/schedule/page.tsx",
      "app/(client)/me/page.tsx",
      "app/(client)/me/propose/[roleId]/page.tsx",
      "app/api/song/[id]/route.ts",
      "app/api/me/songs/route.ts",
      "app/api/notifications/count/route.ts",
      "app/api/admin/roles/route.ts",
      "app/api/admin/proposals/route.ts",
      "app/api/me/proposals/route.ts",
    ];
    for (const file of migrated) {
      const reads = REAL_SITES.filter((s) => s.file === file && s.kind !== "protected-write");
      const nonCompliantReadOps = new Set(reads.filter((s) => !s.compliant).map((s) => s.operation));
      for (const op of nonCompliantReadOps) {
        expect(
          A2_HANDOFF_ALLOWLIST.some((e) => e.file === file && e.operation === op),
          `${file} [${op}] reads a protected type off the canonical client`,
        ).toBe(true);
      }
      expect(reads.some((s) => s.compliant), `${file} has no canonical protected read`).toBe(true);
    }
  });

  it("does not flag files that merely mention protected type names", () => {
    const mentionOnly = [
      "app/components/SongSheet.tsx",
      "app/context/PlayerContext.tsx",
      "app/utils/computeParticipation.ts",
      "app/utils/draftToDayCardProps.ts",
      "app/utils/assignmentEmail.ts",
      "app/utils/notifyTargets.ts",
    ];
    for (const file of mentionOnly) {
      expect(TRACKED_SET.has(file), `${file} moved or was renamed`).toBe(true);
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      expect(scanSource(file, source), file).toEqual([]);
      expect(A2_HANDOFF_ALLOWLIST.some((e) => e.file === file)).toBe(false);
    }
  });

  it("keeps the protected type list, including the deliberate saturdarSongs typo", () => {
    expect([...PROTECTED_TYPES]).toEqual([
      "sunday_role",
      "saturday_role",
      "special_role",
      "featuredSongs",
      "saturdarSongs",
      "setlistProposal",
      "specialIdentityCoordinator",
    ]);
  });
});

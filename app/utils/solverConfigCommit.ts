// app/utils/solverConfigCommit.ts
//
// THE writer of the shared planner rules (`solverConfig`) — admin parity phase 4, slice R (ADR-0084).
//
// Two callers, one write:
//   · `saveSolverConfig` is `POST /api/admin/solver-config`'s body, moved here verbatim after auth (R1):
//     the whole rule set as the panel holds it, version-checked, parsed, revision-checked, then ONE
//     six-field `set` under `ifRevisionId`.
//   · `checkRuleEdits` / `saveRuleEdits` are the chat's (`check_rule_edits` / `save_rule_edits`): edits BY
//     PARTS (`ruleEdits.ts`) applied to a fresh read, judged the way the v3 solver will judge them, and
//     written through the SAME parser and serializer, with the server's own `SOLVER_CONFIG_VERSION` (R3).
//     The route's header explains the three things the write deliberately cannot do; all three hold here.
//
// Why the chat does not send a whole `SolverConfig`, as the panel does (R2): a whole-document body is how a
// rule the model forgot would disappear for everyone.
//
// The lossless gate (R4): before any chat edit, the stored rules must survive the panel's own round trip
// unchanged. The lenient reader coerces values it does not know; the panel shows the coerced rule on screen
// before its save, but the chat shows only the edited lines, so a silent coercion of an UNTOUCHED rule would
// be invisible. A document that fails is refused with a remedy, never written.
//
// No notification and no revalidation (R10): the route has none and needs none (its header says why).
//
// Rule people (ADR-0092): both writers judge the NAMES view (`rulePeopleToNames`) and write through the
// one core (`solverConfigWrite.ts`), which turns names back into what is stored: names, or member ids
// once the document carries `personTokens: "id"`. No id reaches a message, a line or a response body.

import { writeClient } from "@/sanity/lib/serverClient";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { rulePersonRefusalMessage } from "@/app/components/admin/solverConfigSource";
import { addMonths } from "@/app/components/admin/monthPills";
import { cdmxCurrentMonth } from "@/app/components/admin/v3Horizon";
import { sanityConflictKind } from "@/app/utils/roleWriteRequest";
import { serviceError } from "@/app/utils/serviceMutation";
import { adminMembersQuery } from "@/app/utils/serviceReadQueries";
import { loadRulePeopleRoster, loadSolverConfigWithRoster, loadStoredSolverConfig } from "@/app/utils/solverConfigRead";
import {
  SOLVER_CONFIG_DOC_ID,
  SOLVER_CONFIG_VERSION,
  parseSolverConfigWrite,
  rulePeopleToNames,
  rulePersonIssue,
  type RulePeopleRosterMember,
  type RulePersonRefusal,
} from "@/app/utils/solverConfigWriteRequest";
import { commitSolverConfigFields, losslessRules, prepareSolverConfigWrite } from "@/app/utils/solverConfigWrite";
import { applyRuleEdits, judgeRuleEdits, type NewRuleId, type RuleEdit, type RuleRosterMember } from "@/app/utils/ruleEdits";

// ── The route's write (R1, verbatim) ─────────────────────────────────────────

export type RouteOutcome = { status: number; body: unknown };

/**
 * Replace the rule set. Body: `{ rev, config, configVersion }`, already JSON-parsed and an object.
 * Answers what the route sends. A non-409 commit failure THROWS, as the route always did.
 */
export async function saveSolverConfig(body: Record<string, unknown>, actorId: string): Promise<RouteOutcome> {
  // The version guard (C3 §6.2) — after auth and the JSON parse, before `rev`,
  // the parser and the read: an outdated body is refused with nothing read.
  const configVersion = body.configVersion;
  if (configVersion !== SOLVER_CONFIG_VERSION) {
    return serviceError("invalid_request", {
      message: "Esta pestaña tiene una versión anterior de las reglas. Recarga la página; no se guardó nada.",
      details: {
        issues: ["configVersion"],
        expected: SOLVER_CONFIG_VERSION,
        received: configVersion === undefined ? null : configVersion,
      },
    });
  }

  const rev = body.rev;
  if (typeof rev !== "string" || !rev.length) {
    return serviceError("invalid_request", { details: { issues: ["rev"] } });
  }

  const parsed = parseSolverConfigWrite(body.config);
  if (!parsed.ok) {
    return serviceError("invalid_request", { details: { issues: parsed.issues } });
  }

  const { doc: stored, roster } = await loadSolverConfigWithRoster();
  if (!stored) {
    // See the route's header: only the seed script may mint this document.
    return serviceError("not_found", {
      message:
        "Las reglas compartidas aún no existen. Solo el script de siembra puede crearlas; esta ruta únicamente actualiza.",
      details: { id: SOLVER_CONFIG_DOC_ID, detail: "create_not_allowed_here" },
    });
  }
  if (stored._rev !== rev) {
    return serviceError("stale_revision", {
      details: { id: SOLVER_CONFIG_DOC_ID, observed: rev, current: stored._rev ?? null },
    });
  }

  // ADR-0092: the names this tab sent become what is stored, on the FRESH read's labels. A name that
  // names nobody any more (renamed while the tab was open) refuses as a stale revision, never detaches.
  const prepared = prepareSolverConfigWrite({ config: parsed.value.config, stored, roster });
  if (!prepared.ok) {
    if (prepared.kind === "invalid") return serviceError("invalid_request", { details: { issues: prepared.issues } });
    return rulePersonRouteRefusal(prepared.refusal, rev);
  }

  try {
    await commitSolverConfigFields(writeClient, rev, prepared.fields, {
      updatedAt: new Date().toISOString(),
      updatedBy: actorId,
    });
  } catch (err) {
    // ONLY a genuine Content Lake 409 is a lost race. Everything else — an
    // expired or missing `SANITY_WRITE_TOKEN`, a network fault, a validation
    // complaint — must surface as itself.
    //
    // Reporting all of them as `stale_revision` is not a harmless
    // approximation: the message is "Alguien más lo cambió primero. Recarga y
    // reintenta.", so the admin reloads, gets the SAME `_rev` back (nothing
    // changed — nothing was written), retries, and fails identically, forever,
    // with the real cause swallowed by a `catch` that did not even log it. Same
    // classifier, same reason, as `app/api/admin/roles/[id]/route.ts:283`.
    if (!sanityConflictKind(err)) throw err;
    return serviceError("stale_revision", {
      details: { id: SOLVER_CONFIG_DOC_ID, observed: rev, detail: "commit_conflict" },
    });
  }

  const after = await loadStoredSolverConfig();
  return {
    status: 200,
    body: {
      present: true,
      rev: after && typeof after._rev === "string" ? after._rev : null,
      // What was written, read back as names (ADR-0092): the panel adopts this as its new state, so it
      // shows the same labels a reload would. In names mode this is the parsed config itself.
      config: rulePeopleToNames({ ...prepared.fields, personTokens: stored.personTokens }, roster).config,
      configVersion: SOLVER_CONFIG_VERSION,
    },
  };
}

/** A rule person the write could not store, as the route answers it (ADR-0092). */
function rulePersonRouteRefusal(refusal: RulePersonRefusal, rev: string): RouteOutcome {
  const message = rulePersonRefusalMessage(refusal.reason, refusal.person);
  if (refusal.reason === "person_changed") {
    // A 409 the panel answers with «Recargar reglas»; `detail` picks its own words (`saveFailure`).
    return serviceError("stale_revision", { message, details: { id: SOLVER_CONFIG_DOC_ID, observed: rev, detail: "person_changed" } });
  }
  return serviceError("invalid_request", { message, details: { issues: [rulePersonIssue(refusal)], person: refusal.person } });
}

// ── The chat's edits ─────────────────────────────────────────────────────────

// R4's gate lives in the neutral write core (ADR-0092), so the migration script runs the same one.
export { losslessRules } from "@/app/utils/solverConfigWrite";

export const RULES_MESSAGE = {
  absent: "No hay reglas guardadas; créalas una vez en /admin → Generar mes → Reglas.",
  lossy:
    "Las reglas guardadas tienen algo que esta versión leería distinto; ábrelas en /admin → Generar mes → Reglas y guárdalas una vez.",
  changed: "Las reglas cambiaron desde la revisión: vuelve a revisar con check_rule_edits.",
} as const;

export interface RuleEditsDeps {
  /** The raw stored document (`loadStoredSolverConfig`): `null` = absent; a failed read throws. */
  loadRaw: () => Promise<Record<string, unknown> | null>;
  /** The planner's roster (`adminMembersQuery`, worship members, disabled included). */
  roster: () => Promise<RuleRosterMember[]>;
  /** The rule-person roster (`rulePeopleRosterQuery`, ADR-0092): every member, any ministry. */
  peopleRoster: () => Promise<RulePeopleRosterMember[]>;
  /** The one write: the six fields + stamp under `ifRevisionId(rev)`. Throws on failure. */
  write: (rev: string, fields: Record<string, unknown>, actorId: string) => Promise<void>;
  /** `YYYY-MM` — the month R11 judges; the next CDMX month. */
  month: () => string;
}

export function defaultRuleEditsDeps(): RuleEditsDeps {
  return {
    loadRaw: loadStoredSolverConfig,
    roster: async () => {
      // `false`: `true` adds only `ministryRoles`, which no rule reads (and no caller passes a literal `true`).
      const q = adminMembersQuery(false);
      const rows: unknown = await operationalClient.fetch(q.query, q.params);
      if (!Array.isArray(rows)) throw new Error("members");
      return rows as RuleRosterMember[];
    },
    peopleRoster: loadRulePeopleRoster,
    write: async (rev, fields, actorId) => {
      await commitSolverConfigFields(writeClient, rev, fields, { updatedAt: new Date().toISOString(), updatedBy: actorId });
    },
    month: () => addMonths(cdmxCurrentMonth(new Date()), 1),
  };
}

export type RuleEditsRefusal = { ok: false; status: 404 | 409 | 422; code: "absent" | "lossy" | "edit" | "changed" | "not_the_checked"; message: string };

export type RuleEditsPlan =
  | {
      ok: true;
      rev: string;
      /** What Frank reads; empty = nothing would change. */
      lines: string[];
      noops: string[];
      notes: string[];
      /** Problems the stored rules already have (R9, R11): shown, never blocking. */
      existing: string[];
      fields: Record<string, unknown>;
    }
  | RuleEditsRefusal;

/** Read, gate, apply, judge — the check's whole work, repeated by the save on its own fresh read. */
async function plan(edits: readonly RuleEdit[], newIdFor: (rev: string) => NewRuleId, deps: RuleEditsDeps): Promise<RuleEditsPlan> {
  const [raw, roster, people] = await Promise.all([deps.loadRaw(), deps.roster(), deps.peopleRoster()]);
  if (!raw || typeof raw._rev !== "string") return { ok: false, status: 404, code: "absent", message: RULES_MESSAGE.absent };
  const rev = raw._rev;
  const stored = losslessRules(raw, people);
  if (!stored) return { ok: false, status: 422, code: "lossy", message: RULES_MESSAGE.lossy };
  const applied = applyRuleEdits(stored, edits, roster, newIdFor(rev));
  if (!applied.ok) return { ok: false, status: 422, code: "edit", message: applied.message };
  const verdict = judgeRuleEdits(stored, applied.config, roster, deps.month());
  if (!verdict.ok) return { ok: false, status: 422, code: "edit", message: verdict.message };
  // The one write core (ADR-0092): the same fields `saveSolverConfig` would write for this config.
  const prepared = prepareSolverConfigWrite({ config: applied.config, stored: raw, roster: people });
  if (!prepared.ok && prepared.kind === "person") {
    const message = rulePersonRefusalMessage(prepared.refusal.reason, prepared.refusal.person);
    if (prepared.refusal.reason === "person_changed") return { ok: false, status: 409, code: "changed", message };
    return { ok: false, status: 422, code: "edit", message };
  }
  // `judgeRuleEdits` already refused a config the parser refuses; this keeps the types honest.
  if (!prepared.ok) return { ok: false, status: 422, code: "edit", message: "Con estos cambios las reglas no serían válidas." };
  return { ok: true, rev, lines: applied.lines, noops: applied.noops, notes: applied.notes, existing: verdict.existing, fields: prepared.fields };
}

/** `check_rule_edits`: everything the save will do, nothing written. */
export async function checkRuleEdits(edits: readonly RuleEdit[], newIdFor: (rev: string) => NewRuleId, deps: RuleEditsDeps = defaultRuleEditsDeps()): Promise<RuleEditsPlan> {
  return plan(edits, newIdFor, deps);
}

export type SaveRuleEditsOutcome =
  | { ok: true; unchanged: boolean; lines: string[] }
  | RuleEditsRefusal;

/**
 * `save_rule_edits`: re-read, re-apply, re-judge, and write ONLY when `verify` accepts the fresh
 * `rev` and lines (R7: the token binds what the check showed). `verify` answers a refusal text or `null`.
 */
export async function saveRuleEdits(
  edits: readonly RuleEdit[],
  newIdFor: (rev: string) => NewRuleId,
  opts: { actorId: string; verify: (rev: string, lines: readonly string[]) => string | null },
  deps: RuleEditsDeps = defaultRuleEditsDeps(),
): Promise<SaveRuleEditsOutcome> {
  const p = await plan(edits, newIdFor, deps);
  if (!p.ok) return p;
  if (!p.lines.length) return { ok: true, unchanged: true, lines: [] };
  const refusal = opts.verify(p.rev, p.lines);
  if (refusal) return { ok: false, status: 409, code: "not_the_checked", message: refusal };
  try {
    await deps.write(p.rev, p.fields, opts.actorId);
  } catch (err) {
    if (!sanityConflictKind(err)) throw err;
    return { ok: false, status: 409, code: "changed", message: RULES_MESSAGE.changed };
  }
  return { ok: true, unchanged: false, lines: p.lines };
}

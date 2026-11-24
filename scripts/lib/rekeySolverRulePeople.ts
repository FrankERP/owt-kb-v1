// scripts/lib/rekeySolverRulePeople.ts
//
// The core of `scripts/rekey-solver-rule-people.ts` (ADR-0092, C1 §4.2): turn the four person fields of
// the shared rules from names into member ids and set `personTokens: "id"` — or, with `--to-names`, the
// reverse, for a rollback. A PRODUCTION write, run only after Frank's explicit «sí» to the dry run.
//
// Not a test file and no module-level client: the CLI hands `runRekey` its own client (the write token
// lives on the Mac), the tests a fake. The write itself is the app's one writer core
// (`app/utils/solverConfigWrite.ts`), so the migration cannot write anything a save would not.
//
// The dry run prints NAMES only (never an id): Frank must recognise the people to consent. It refuses,
// before any write, unless four checks pass:
//   1. only person paths (and the marker) change;
//   2. every changed path holds the same person (id direction: the written id is the member the stored
//      text resolves to);
//   3. the same view: the written document, read back as names, names the same member at every path;
//   4. the target form: id direction, every token is a roster `_id`; names direction, none is; the
//      presence lists keep their length; and the written document passes the lossless gate.

import { createHash } from "node:crypto";

import type { SanityClient } from "@sanity/client";

import { rulePeopleRosterQuery } from "../../app/utils/serviceReadQueries";
import { resolveRulePersonId } from "../../app/utils/sundayCadence";
import { rulePersonNamesMember } from "../../app/utils/memberRuleNames";
import { normalizeMinistries } from "../../app/ministries";
import {
  PERSON_TOKENS_ID,
  SOLVER_CONFIG_DOC_ID,
  rulePeopleOf,
  rulePeopleToNames,
  solverConfigFromDocument,
  storesPersonIds,
  type RulePeopleRosterMember,
} from "../../app/utils/solverConfigWriteRequest";
import {
  RULE_FIELDS,
  losslessRules,
  prepareSolverConfigWrite,
  sortedJson,
  writeSolverConfig,
  type SolverConfigMarker,
} from "../../app/utils/solverConfigWrite";

export type RekeyDirection = "id" | "names";

export type RekeyPlan =
  | { kind: "nothing"; lines: string[] }
  | { kind: "refused"; lines: string[] }
  | { kind: "ready"; lines: string[]; fingerprint: string; view: unknown; marker: SolverConfigMarker };

const asMember = (m: RulePeopleRosterMember) => ({
  _id: m._id,
  member_name: typeof m.member_name === "string" ? m.member_name : "",
  ...(typeof m.alias === "string" ? { alias: m.alias } : {}),
  ministries: m.ministries,
});

/** How a member is shown to Frank: name and alias, never the id. */
function personText(m: RulePeopleRosterMember | undefined): string {
  if (!m) return "(nadie)";
  const name = typeof m.member_name === "string" ? m.member_name : "";
  const alias = typeof m.alias === "string" && m.alias.trim() ? ` (${m.alias.trim()})` : "";
  return `${name || "(sin nombre)"}${alias}`;
}

/** Every person path of a document as its names view, with the member each label resolves to (or null). */
function membersAt(doc: Record<string, unknown>, roster: readonly RulePeopleRosterMember[]): Array<{ path: string; label: string; member: string | null }> {
  const view = rulePeopleToNames(doc, roster).config;
  const rows = roster.map(asMember);
  const out: Array<{ path: string; label: string; member: string | null }> = [];
  const at = (path: string, label: string) => {
    const r = resolveRulePersonId(label, rows);
    out.push({ path, label, member: r.ok ? r.id : null });
  };
  view.restrictions.forEach((r, i) => at(`restrictions[${i}].person`, r.person));
  view.conflicts.forEach((c, i) => {
    at(`conflicts[${i}].personA`, c.personA);
    at(`conflicts[${i}].personB`, c.personB);
  });
  view.presence.forEach((p, i) => p.persons.forEach((t, j) => at(`presence[${i}].persons[${j}]`, t)));
  return out;
}

/** The six rule fields and the marker: what the fingerprint and the diff cover (§9.8). */
function ruleState(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of RULE_FIELDS) out[f] = doc[f];
  if (doc.personTokens !== undefined) out.personTokens = doc.personTokens;
  return out;
}

/** Leaf paths where two JSON values differ (`restrictions[0].person`, `personTokens`). */
function diffPaths(a: unknown, b: unknown, path = ""): string[] {
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: string[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(...diffPaths(a[i], b[i], `${path}[${i}]`));
    return out;
  }
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => diffPaths(a[k], b[k], path ? `${path}.${k}` : k));
  }
  return sortedJson(a) === sortedJson(b) ? [] : [path];
}

const PERSON_PATH = /^(restrictions\[\d+\]\.person|conflicts\[\d+\]\.person[AB]|presence\[\d+\]\.persons\[\d+\]|personTokens)$/;

/**
 * The dry run: what the migration would write, its four checks and the lines to print. Pure.
 * `stored` is the raw document as read; `roster` is `rulePeopleRosterQuery()`'s rows.
 */
export function planRekey(stored: Record<string, unknown>, roster: readonly RulePeopleRosterMember[], direction: RekeyDirection): RekeyPlan {
  const lines: string[] = [];
  const isIds = storesPersonIds(stored);
  if (direction === "id" && isIds) return { kind: "nothing", lines: ["Las reglas ya guardan a las personas por id: 0 por convertir."] };
  if (direction === "names" && !isIds) return { kind: "nothing", lines: ["Las reglas ya guardan a las personas por nombre: 0 por convertir."] };

  const rows = roster.map(asMember);
  const byId = new Map(roster.map((m) => [m._id, m]));
  const view = rulePeopleToNames(stored, roster).config;

  // The people, by name only. The id direction refuses while a text names nobody or several.
  let blocked = false;
  const seen = new Set<string>();
  for (const token of rulePeopleOf(solverConfigFromDocument(stored))) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (direction === "id") {
      const r = resolveRulePersonId(token, rows);
      if (r.ok) lines.push(`«${token}» → ${personText(byId.get(r.id))}`);
      else {
        blocked = true;
        lines.push(`${r.reason === "unresolved" ? "UNRESOLVED" : "AMBIGUOUS"}: «${token}»${r.reason === "ambiguous" ? ` (coincide con ${r.matches.length} personas)` : ""}`);
      }
    }
  }
  if (direction === "names") {
    const labels = [...new Set(rulePeopleOf(view))];
    for (const label of labels) lines.push(`«${label}»`);
  }
  if (blocked) {
    lines.push("No se puede convertir: corrige o quita esas reglas en /admin → Generar mes → Reglas y vuelve a correr la prueba.");
    return { kind: "refused", lines };
  }

  const marker: SolverConfigMarker = direction === "id" ? PERSON_TOKENS_ID : null;
  const prepared = prepareSolverConfigWrite({ config: view, stored, roster, setMarker: marker });
  if (!prepared.ok) {
    lines.push(
      prepared.kind === "invalid"
        ? `REFUSED: las reglas no pasan el validador (${prepared.issues.join(", ")}).`
        : `REFUSED: «${prepared.refusal.person}» (${prepared.refusal.reason}).`,
    );
    return { kind: "refused", lines };
  }
  const written: Record<string, unknown> = { ...ruleState(stored), ...prepared.fields };
  if (marker === null) delete written.personTokens;

  const failures: string[] = [];
  // 1. Only person paths change.
  const changed = diffPaths(ruleState(stored), ruleState(written));
  const foreign = changed.filter((p) => !PERSON_PATH.test(p));
  if (foreign.length) failures.push(`1: cambiaría algo que no es una persona (${foreign.join(", ")})`);
  // 4a. Presence lists keep their length (two spellings of one member would collapse into one id).
  const storedPresence = solverConfigFromDocument(stored).presence;
  if (prepared.written.presence.some((p, i) => p.persons.length !== storedPresence[i]?.persons.length)) {
    failures.push("4: una regla de presencia perdería a una persona (dos nombres de la misma persona)");
  }
  // 2 + 3. The same person at every path, in the stored view and in the written one read back.
  const before = membersAt(stored, roster);
  const after = membersAt(written, roster);
  if (before.length !== after.length) failures.push("3: el número de personas en las reglas cambiaría");
  else {
    before.forEach((b, i) => {
      if (b.member !== after[i].member || b.path !== after[i].path) failures.push(`3: ${b.path} nombraría a otra persona`);
    });
  }
  if (direction === "id") {
    const tokens = rulePeopleOf(prepared.written);
    const at = membersAt(stored, roster);
    tokens.forEach((t, i) => {
      if (at[i] && at[i].member !== t) failures.push(`2: ${at[i].path} no quedaría con la misma persona`);
    });
  }
  // 4b. The target form, and the lossless gate on the written document.
  const writtenTokens = rulePeopleOf(solverConfigFromDocument(written));
  if (direction === "id" && writtenTokens.some((t) => !byId.has(t))) failures.push("4: quedaría un nombre donde debe ir un id");
  if (direction === "names" && writtenTokens.some((t) => byId.has(t))) failures.push("4: quedaría un id donde debe ir un nombre");
  if (!losslessRules(written, roster)) failures.push("4: las reglas escritas no se leerían igual al guardarlas");

  // §9.8: respellings and labels a non-worship member also answers to, so Frank sees them before «sí».
  const afterView = membersAt(written, roster);
  const storedTexts = membersAt(stored, roster);
  const notes = new Set<string>();
  afterView.forEach((a, i) => {
    if (storedTexts[i] && storedTexts[i].label !== a.label) notes.add(`Se leerá distinto: «${storedTexts[i].label}» → «${a.label}» (misma persona).`);
    if (rows.some((m) => !normalizeMinistries(m.ministries).includes("worship") && rulePersonNamesMember(a.label, m))) {
      notes.add(`Ojo: «${a.label}» también es el nombre de alguien fuera de Alabanza.`);
    }
  });
  lines.push(...notes);

  if (failures.length) {
    lines.push(...failures.map((f) => `CHECK FAILED ${f}`));
    return { kind: "refused", lines };
  }
  const fingerprint = createHash("sha256").update(sortedJson(ruleState(written))).digest("hex");
  lines.push(`${changed.filter((p) => p !== "personTokens").length} lugares cambian; las 4 comprobaciones pasan.`, `fingerprint: ${fingerprint}`);
  return { kind: "ready", lines, fingerprint, view, marker };
}

// ── The CLI's run ────────────────────────────────────────────────────────────

export const USAGE =
  "Uso: npx tsx --env-file=.env.local scripts/rekey-solver-rule-people.ts [--to-names] [--apply --fingerprint <hex>]";

export interface RekeyArgs {
  direction: RekeyDirection;
  apply: boolean;
  fingerprint: string | null;
}

export function parseRekeyArgs(argv: readonly string[]): RekeyArgs | null {
  let direction: RekeyDirection = "id";
  let apply = false;
  let fingerprint: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--to-names") direction = "names";
    else if (a === "--apply") apply = true;
    else if (a === "--fingerprint") {
      const v = argv[++i];
      if (!v || !/^[0-9a-f]{64}$/.test(v)) return null;
      fingerprint = v;
    } else return null;
  }
  if (apply && !fingerprint) return null;
  if (!apply && fingerprint) return null;
  return { direction, apply, fingerprint };
}

export interface RekeyDeps {
  client: Pick<SanityClient, "fetch" | "patch">;
  target: string;
  now: () => Date;
  /** Writes the pre-apply snapshot; answers where. Throws on failure, before any write. */
  backup: (name: string, text: string) => string;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** One run. Answers the exit code: 0 done (or nothing to do), 1 refused or failed, 2 usage. */
export async function runRekey(argv: readonly string[], deps: RekeyDeps): Promise<number> {
  const args = parseRekeyArgs(argv);
  if (!args) {
    deps.err(USAGE);
    return 2;
  }
  deps.out(`${deps.target} · ${args.direction === "id" ? "nombres → ids" : "ids → nombres"} · ${args.apply ? "APPLY" : "prueba (no escribe)"}`);

  const q = rulePeopleRosterQuery();
  const [stored, roster] = await Promise.all([
    deps.client.fetch<Record<string, unknown> | null>(`*[_id == $id][0]`, { id: SOLVER_CONFIG_DOC_ID }),
    deps.client.fetch<RulePeopleRosterMember[]>(q.query, q.params),
  ]);
  if (!stored || typeof stored._rev !== "string") {
    deps.err("No existe el documento de reglas; nada que convertir.");
    return 1;
  }
  if (!Array.isArray(roster)) {
    deps.err("No se pudo leer la lista de personas; no se hizo nada.");
    return 1;
  }

  const plan = planRekey(stored, roster, args.direction);
  for (const line of plan.lines) deps.out(line);
  if (plan.kind === "nothing") return 0;
  if (plan.kind === "refused") return 1;
  if (!args.apply) return 0;

  if (plan.fingerprint !== args.fingerprint) {
    deps.err("El fingerprint no coincide: las reglas o las personas cambiaron desde la prueba. Vuelve a correr la prueba; no se hizo nada.");
    return 1;
  }
  const stamp = deps.now().toISOString();
  const where = deps.backup(`solverConfig-${stamp.replace(/[:.]/g, "-")}.json`, `${JSON.stringify(stored, null, 2)}\n`);
  deps.out(`Respaldo: ${where}`);
  const result = await writeSolverConfig(deps.client, {
    config: plan.view,
    stored,
    roster,
    setMarker: plan.marker,
    rev: stored._rev,
    stamp: { updatedAt: stamp },
  });
  if (!result.ok) {
    deps.err("La escritura se negó; no se escribió nada.");
    return 1;
  }
  deps.out("Escrito. Vuelve a correr la prueba: debe decir 0 por convertir.");
  return 0;
}

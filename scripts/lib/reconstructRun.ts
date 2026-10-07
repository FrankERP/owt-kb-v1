// scripts/lib/reconstructRun.ts
//
// The reconstruction's working half (solver v3 C4): arguments, the private-path
// refusal, the token check, the reads, the dry run — and, from C4's Tasks 8 and 9,
// the apply and the rollback. `scripts/reconstruct-fairness-months.mjs` is only its
// entry point, and the ONE caller of C2's write executor, which reaches this module as
// the injected `execute` (R20 a: no `scripts/lib` file calls the executor).
//
// Clients are built through the injected `createClient` only AFTER the token check
// (R19), with the read token, the `published` perspective and no CDN — the three C2's
// executor asserts (IF2-22), and the reason an untokened read cannot pass for «sin
// registro» (A2). Every read goes through C2's builders (IF2-24 … IF2-28): this module
// writes no GROQ of its own and calls no mutation method (R2, R3).
//
// Stdout and stderr carry no member name, no member `_id`, no rule key and no hash of
// one (R12): a rule is named by its ordinal, a refusal by its reason code; names, ids
// and keys go only to the private files under `--out`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SanityClient } from "@sanity/client";

import { countsForFairness } from "../../app/utils/countsForFairness";
import { resolveMonthEligibility } from "../../app/utils/fairnessEligibility";
import type { LedgerService } from "../../app/utils/fairnessLedger";
import type { FairnessDeleteEntry, FairnessExecution, FairnessStamps } from "../../app/utils/fairnessMonthWriteRequest";
import {
  ROLE_KEYS,
  TAB_KEYS,
  compareCodepoint,
  shiftMonth,
  type FairnessMonthBody,
  type FairnessMonthWrite,
  type LogicalRecord,
  type RecordEnvironment,
  type RoleKey,
  type TabKey,
} from "../../app/utils/fairnessVocabulary";
import { displayMemberName } from "../../app/utils/memberRuleNames";
import {
  fairnessMonthsThroughQuery,
  serviceCountsInMonths,
  solverConfigQuery,
  voiceRolesInRangeQuery,
  worshipRosterQuery,
  type BoundQuery,
} from "../../app/utils/serviceReadQueries";
import { solverConfigFromDocument } from "../../app/utils/solverConfigWriteRequest";
import { fairnessRecordEnvironment } from "../../app/utils/solverDeployment";
import { joinAnomalies, lostBlocks, monthAnomalies, poolAnomalies, sortAnomalies } from "./reconstructAnomalies";
import { USAGE, defaultPreviewRun, notPastMonths, parseReconstructArgs, privatePathRefusals, type ReconstructArgs, type RunMode } from "./reconstructArgs";
import { decideWrite, hashOfBody, parseRecord, summarizeStored, validateReconstructionBody, type StoredSummary } from "./reconstructDecide";
import {
  dedupeRefusals,
  hypotheticalConfig,
  resolverRefusals,
  seatJoinMonths,
  toLedgerServices,
  transformMonth,
  validatorRefusal,
  type TransformResult,
} from "./reconstructInference";
import { outOfRunEntries, parseOverrides, type Overrides } from "./reconstructOverrides";
import { backupText, fingerprintOf, hashText, memberInputDigest, serializePlan, serviceInputDigest, type WriteMonthPlan, type WritePlanContent } from "./reconstructPlanFile";
import { ledgerMembers, monthLedger, plannedLogicalRecord, previewFigures, previewWindow, seatsPerLine } from "./reconstructPreview";
import {
  ACTION_LABEL,
  SERVICE_TYPE_LABEL,
  anomalyText,
  refusalLine,
  renderRefusalReport,
  renderTable,
  replaceChanges,
  targetLine,
  type TableCell,
  type TableModel,
  type TableMonth,
  type TableRow,
} from "./reconstructReport";
import { ReadFailure, type Anomaly, type Correction, type Line, type MonthAction, type ReconstructionBody, type RosterRow, type RunRefusal } from "./reconstructTypes";
import type { GitFs } from "./solverHistoryDiffRun";

/** `sanity/env.ts`'s default, when NEXT_PUBLIC_SANITY_API_VERSION is unset. */
const DEFAULT_API_VERSION = "2024-07-23";
/** R5: the join window has no lower bound — every stored service before its end. */
const JOIN_WINDOW_FLOOR = "0001-01-01";

export interface ClientConfig {
  projectId: string;
  dataset: string;
  apiVersion: string;
  token: string;
  perspective: "published";
  useCdn: false;
}

/** C2's write executor (IF2-22), as the CLI hands it in. Actor `reconstruction` only. */
export type ExecuteFn = (input: {
  clients: { read: SanityClient; write: SanityClient };
  actor: "reconstruction";
  op: "write" | "delete";
  months: Array<Omit<FairnessMonthWrite, "source"> | FairnessDeleteEntry>;
  stamps: FairnessStamps;
}) => Promise<FairnessExecution[]>;

export interface RunDeps {
  env: Readonly<Record<string, string | undefined>>;
  repoRoot: string;
  platform: string;
  now: () => Date;
  createClient: (config: ClientConfig) => SanityClient;
  execute: ExecuteFn;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Tests only: a fake repository layout for R11's refusal. */
  gitFs?: GitFs;
}

/** A refusal before any write (exit 2). Its lines are name-free by construction. */
class Refusal extends Error {
  constructor(readonly lines: string[]) {
    super("refused");
    this.name = "Refusal";
  }
}

/**
 * R12: an error is printed as its class (and an HTTP status) — never its message, which may carry a request body or a name.
 * It mirrors C2's `fairnessErrorClass` (`app/utils/fairnessLedgerRead.ts`, a `server-only` module this script cannot
 * import): C2's executor rethrows every non-409 client error raw, and a `@sanity/client` error carries member ids in its
 * message and in `response.url`. Used for the reads, for every executor call, and for any error that escapes the run.
 */
export function errorClass(e: unknown): string {
  if (e instanceof ReadFailure) return `ReadFailure (${e.step}${e.causeClass ? `: ${e.causeClass}` : ""})`;
  if (e instanceof Error) {
    const status = (e as { statusCode?: unknown }).statusCode;
    return typeof status === "number" ? `${e.name} ${status}` : e.name;
  }
  return typeof e;
}

/** Exit code: 0 done · 2 refused before any write · 1 failed or partial. */
export async function runReconstruction(argv: readonly string[], deps: RunDeps): Promise<number> {
  try {
    return await run(argv, deps);
  } catch (e) {
    if (e instanceof Refusal) {
      for (const line of e.lines) deps.err(`reconstruct-fairness-months: ${line}`);
      return 2;
    }
    deps.err(
      `reconstruct-fairness-months: falló: ${errorClass(e)}. Si fue una lectura, nada se escribió; si no, corre el dry run otra vez antes de cualquier reparación.`,
    );
    return 1;
  }
}

interface Ctx {
  args: ReconstructArgs;
  deps: RunDeps;
  read: SanityClient;
  write: SanityClient | null;
  months: string[];
  currentMonth: string;
  environment: RecordEnvironment;
  projectId: string;
  dataset: string;
  overridesText: string | null;
  runDir: string;
}

async function run(argv: readonly string[], deps: RunDeps): Promise<number> {
  const args = parseReconstructArgs(argv);
  if ("error" in args) throw new Refusal([args.error, USAGE]);
  const projectId = deps.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? "";
  const dataset = deps.env.NEXT_PUBLIC_SANITY_DATASET ?? "";
  deps.out(targetLine(args.mode, projectId || "(sin proyecto)", dataset || "(sin dataset)"));

  // R11 — nothing that holds names may sit in the repository; checked before any read.
  const files = [
    { flag: "--out", file: args.out },
    ...(args.overrides ? [{ flag: "--overrides", file: args.overrides }] : []),
    ...(args.plan ? [{ flag: "--plan", file: args.plan }] : []),
  ];
  const paths = privatePathRefusals(files, deps.repoRoot, deps.platform, deps.gitFs);
  if (paths.problem) throw new Refusal([`${paths.problem}; se rechaza en vez de vigilar solo parte del repositorio`]);
  if (paths.refusals.length > 0) throw new Refusal(paths.refusals);

  // R1, R17 — the clock enters here: the CDMX day, its month.
  const today = deps.now().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  const currentMonth = today.slice(0, 7);

  const months = args.months ?? [];

  const notPast = notPastMonths(months, currentMonth);
  if (notPast.length > 0) {
    throw new Refusal([
      `--months ${notPast.join(", ")}: solo se reconstruyen meses anteriores al mes actual de CDMX (${currentMonth}) — R1, A21. Nada se leyó.`,
    ]);
  }
  const overridesText = args.overrides ? readLocal(args.overrides, "--overrides") : null;

  // R19 — the tokens are checked BEFORE any client is constructed.
  const applying = args.mode === "apply" || args.mode === "rollback-apply";
  const readToken = deps.env.SANITY_API_READ_TOKEN ?? "";
  const writeToken = deps.env.SANITY_WRITE_TOKEN ?? "";
  if (!projectId || !dataset) throw new Refusal(["faltan NEXT_PUBLIC_SANITY_PROJECT_ID o NEXT_PUBLIC_SANITY_DATASET; no se construyó ningún cliente"]);
  if (!readToken) {
    throw new Refusal(["falta SANITY_API_READ_TOKEN: sin él un registro (id privado) se leería como «sin registro» (A2). No se construyó ningún cliente."]);
  }
  if (applying && !writeToken) throw new Refusal(["--apply necesita SANITY_WRITE_TOKEN además del de lectura. No se construyó ningún cliente."]);
  const base = {
    projectId,
    dataset,
    apiVersion: deps.env.NEXT_PUBLIC_SANITY_API_VERSION || DEFAULT_API_VERSION,
    perspective: "published" as const,
    useCdn: false as const,
  };
  const read = deps.createClient({ ...base, token: readToken });
  const write = applying ? deps.createClient({ ...base, token: writeToken }) : null;

  const ctx: Ctx = {
    args,
    deps,
    read,
    write,
    months,
    currentMonth,
    environment: fairnessRecordEnvironment(deps.env),
    projectId,
    dataset,
    overridesText,
    runDir: runDirFor(args.out, deps.now(), args.mode),
  };
  // ── Modes (C4 Tasks 8 and 9 wire the apply and the rollback here).
  if (args.mode !== "dry-run") throw new Refusal([`${args.mode}: modo no disponible todavía en esta versión`]);
  return dryRun(ctx);
}

function readLocal(file: string, flag: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Refusal([`no se pudo leer ${flag}`]);
  }
}

/** A fresh folder per run (never an existing one): nothing reviewed is ever overwritten. */
function runDirFor(out: string, now: Date, mode: RunMode): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  let dir = path.join(out, `${stamp}-${mode}`);
  for (let n = 2; existsSync(dir); n += 1) dir = path.join(out, `${stamp}-${mode}-${n}`);
  return dir;
}

/** Every private file goes into the run's own folder, created on the first write; `wx` never overwrites. */
function writeRunFile(ctx: Ctx, name: string, text: string): string {
  mkdirSync(ctx.runDir, { recursive: true });
  const file = path.join(ctx.runDir, name);
  writeFileSync(file, text, { flag: "wx" });
  return file;
}

// ─── Reads (R3) ─────────────────────────────────────────────────────────────────

interface WorldReads {
  config: Record<string, unknown>;
  roster: RosterRow[];
  records: Array<Record<string, unknown>>;
  /** IF2-24's freezing services per requested month: weekend + counted specials. */
  freezing: Map<string, number>;
  services: LedgerService[];
}

async function fetchStep(read: SanityClient, step: string, bound: BoundQuery): Promise<unknown> {
  try {
    return await read.fetch(bound.query, bound.params);
  } catch (e) {
    throw new ReadFailure(step, errorClass(e));
  }
}

function asRows(value: unknown, step: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.some((r) => !r || typeof r !== "object" || Array.isArray(r))) throw new ReadFailure(step);
  return value as Array<Record<string, unknown>>;
}

const maxMonth = (a: string, b: string) => (a >= b ? a : b);
const monthOfRecord = (doc: Record<string, unknown>) =>
  typeof doc.month === "string" ? doc.month : String(doc._id ?? "").replace(/^fairnessMonth\./, "");

/** Every read through C2's builders, on the one token-carrying client; null = no `solverConfig` document. */
async function readWorld(read: SanityClient, months: string[], previewRun: string): Promise<WorldReads | null> {
  const config = await fetchStep(read, "solverConfig", solverConfigQuery());
  if (config === null || config === undefined) return null;
  if (typeof config !== "object" || Array.isArray(config)) throw new ReadFailure("solverConfig");
  const roster = asRows(await fetchStep(read, "roster", worshipRosterQuery()), "roster");
  if (roster.some((m) => typeof m._id !== "string")) throw new ReadFailure("roster");
  const last = months[months.length - 1];
  const records = asRows(await fetchStep(read, "records", fairnessMonthsThroughQuery(maxMonth(last, shiftMonth(previewRun, -1)))), "records");
  const freezing = new Map<string, number>();
  for (const row of asRows(await fetchStep(read, "counts", serviceCountsInMonths(months)), "counts")) {
    if (typeof row.month !== "string" || typeof row.weekend !== "number" || typeof row.countedSpecials !== "number") throw new ReadFailure("counts");
    freezing.set(row.month, row.weekend + row.countedSpecials);
  }
  if (months.some((m) => !freezing.has(m))) throw new ReadFailure("counts");
  const readEnd = `${maxMonth(shiftMonth(last, 1), previewRun)}-01`;
  const services = toLedgerServices(await fetchStep(read, "services", voiceRolesInRangeQuery(JOIN_WINDOW_FLOOR, readEnd)));
  return { config: config as Record<string, unknown>, roster: roster as unknown as RosterRow[], records, freezing, services };
}

// ─── Derivation (R1, R4–R18) — shared by the dry run and the apply ──────────────

interface Derived {
  content: WritePlanContent;
  table: Omit<TableModel, "generatedAt" | "projectId" | "dataset">;
  backups: Array<{ file: string; text: string }>;
  summaries: string[];
  cadence: { config: number; overrides: number };
  goneCount: number;
}

type DeriveOutcome =
  | { kind: "ok"; derived: Derived }
  | { kind: "absent_config" }
  | { kind: "refused"; refusals: RunRefusal[]; nameOf: (id: string) => string };

function actionOf(decision: ReturnType<typeof decideWrite>): MonthAction {
  if (decision === "create" || decision === "replace" || decision === "unchanged") return decision;
  if (typeof decision === "object" && (decision.refused === "not_reconstruction_owned" || decision.refused === "record_edited")) {
    return decision.refused;
  }
  // R1 refused every month that is not past, and a planned revision is the one read: nothing else can come back.
  throw new Error("unexpected planning decision");
}

function derive(input: {
  reads: WorldReads | null;
  months: string[];
  previewRun: string;
  overridesText: string | null;
  currentMonth: string;
  environment: RecordEnvironment;
}): DeriveOutcome {
  const { reads, months, previewRun, currentMonth, environment } = input;
  if (reads === null) return { kind: "absent_config" };
  const config = solverConfigFromDocument(reads.config);
  const roster = reads.roster;
  const rosterIds = new Set(roster.map((m) => m._id));
  const names = new Map(roster.map((m) => [m._id, displayMemberName({ member_name: m.member_name ?? undefined, alias: m.alias ?? undefined })]));
  const nameOf = (id: string) => names.get(id) ?? "";
  const previewMonths = previewWindow(previewRun);
  const needed = new Set([...months, ...previewMonths]);

  // The stored records the run uses — each through IF2-20 first (R3: a malformed one aborts the run).
  const stored = new Map<string, { doc: Record<string, unknown>; record: LogicalRecord; summary: StoredSummary }>();
  for (const doc of reads.records) {
    const month = monthOfRecord(doc);
    if (!needed.has(month)) continue;
    const parsed = parseRecord(doc);
    if (!parsed.ok) throw new ReadFailure("records", "malformed_record");
    stored.set(month, { doc, record: parsed.record, summary: summarizeStored(doc) });
  }

  // R8 — the corrections file, validated in full before any record is built.
  let overrides: Overrides | null = null;
  if (input.overridesText !== null) {
    const parsed = parseOverrides(input.overridesText, rosterIds);
    if (!parsed.ok) return { kind: "refused", refusals: parsed.refusals, nameOf };
    overrides = parsed.overrides;
  }
  const corrections = overrides?.members ?? [];

  const joinEnd = `${shiftMonth(months[months.length - 1], 1)}-01`;
  const joinWindow = reads.services.filter((s) => s.date < joinEnd);
  const servicesIn = (month: string) => reads.services.filter((s) => s.date.slice(0, 7) === month);
  const seatJoins = seatJoinMonths(joinWindow);
  const hypothetical = hypotheticalConfig(config, roster);

  // R1's skip; then IF2-15 per month — R4's call, and a second over today's REAL pools for R13's pool anomalies only.
  const built = new Map<string, { base: FairnessMonthBody; actual: FairnessMonthBody }>();
  const refusals: RunRefusal[] = [];
  for (const month of months) {
    if (!stored.has(month) && (reads.freezing.get(month) ?? 0) === 0) continue;
    const base = resolveMonthEligibility({ month, config: hypothetical, members: roster });
    if (!base.ok) {
      refusals.push(...resolverRefusals(base, config, roster, month));
      continue;
    }
    const actual = resolveMonthEligibility({ month, config, members: roster });
    if (!actual.ok) {
      refusals.push(...resolverRefusals(actual, config, roster, month));
      continue;
    }
    built.set(month, { base: base.body, actual: actual.body });
  }
  if (refusals.length > 0) return { kind: "refused", refusals: dedupeRefusals(refusals), nameOf };

  // R5–R8, then IF2-18 on every transformed body, with the revision it would assert.
  const planned = new Map<string, { body: ReconstructionBody; transform: TransformResult }>();
  for (const [month, b] of built) {
    const transform = transformMonth({ month, body: b.base, roster, seatJoins, overrides: corrections });
    if (transform.refusals.length > 0) {
      refusals.push(...transform.refusals);
      continue;
    }
    const body: ReconstructionBody = { ...transform.body, expectedRev: stored.get(month)?.summary.rev ?? null };
    const checked = validateReconstructionBody(body, currentMonth);
    if (!checked.ok) {
      refusals.push(validatorRefusal(month, body, checked.issues, corrections));
      continue;
    }
    planned.set(month, { body, transform });
  }
  if (refusals.length > 0) return { kind: "refused", refusals, nameOf };

  // IF2-21 — the executor's own decision, per month (R14).
  const actions = new Map<string, MonthAction>();
  const hashes = new Map<string, string>();
  for (const month of months) {
    const p = planned.get(month);
    if (!p) {
      actions.set(month, "skip");
      continue;
    }
    const bodyHash = hashOfBody(p.body);
    hashes.set(month, bodyHash);
    const decision = decideWrite({ month, currentMonth, bodyHash, stored: stored.get(month)?.summary ?? null, freezing: reads.freezing.get(month) ?? 0 });
    actions.set(month, actionOf(decision));
  }

  // The record each month holds once this plan is applied (R11's preview rule, R13's ledger anomalies).
  const afterApply = (month: string): LogicalRecord | null => {
    const action = actions.get(month);
    if (action === "create" || action === "replace") return plannedLogicalRecord(planned.get(month)!.body, hashes.get(month)!, environment, names);
    if (action === "skip") return null;
    return stored.get(month)?.record ?? null; // «sin cambios», the two «no se toca» rows, and window months outside --months
  };

  // R18 — a backup of every record a replace would overwrite.
  const backups: Array<{ file: string; text: string }> = [];
  const backupOf = new Map<string, { file: string; hash: string }>();
  for (const month of months) {
    if (actions.get(month) !== "replace") continue;
    const text = backupText(stored.get(month)!.doc);
    const file = `backup-${month}.json`;
    backups.push({ file, text });
    backupOf.set(month, { file, hash: hashText(text) });
  }

  // R7, R13 — per month, against the after-apply record and the ledger run on that month alone.
  const members = ledgerMembers(roster);
  const presenceOrdinal = (ruleKey: string) => {
    const i = config.presence.findIndex((r) => r.id === ruleKey);
    return i >= 0 ? `presencia ${i + 1} de ${config.presence.length}` : undefined;
  };
  const anomalies: Anomaly[] = [];
  const seats = new Map<string, Map<string, Partial<Record<Line, number>>>>();
  for (const month of months) {
    const p = planned.get(month);
    if (!p) continue;
    const record = afterApply(month)!;
    const ledger = monthLedger(month, record, servicesIn(month), members);
    seats.set(month, seatsPerLine(ledger, month));
    anomalies.push(...monthAnomalies({ month, record, services: servicesIn(month), ledger, rosterIds, presenceOrdinal }));
    anomalies.push(...p.transform.anomalies);
    if (actions.get(month) === "replace") anomalies.push(...lostBlocks(month, stored.get(month)!.record, p.body));
  }
  const cadenceIds = new Set([...planned.values()].flatMap((p) => p.body.people.filter((x) => x.sundayCadence === "alternate").map((x) => x.memberId)));
  const bodies = (pick: "base" | "actual") => new Map([...built].map(([m, b]) => [m, b[pick]] as const));
  anomalies.push(...poolAnomalies({ months, hypothetical: bodies("base"), actual: bodies("actual"), seatJoins, overrides: corrections, cadenceIds }));
  anomalies.push(
    ...joinAnomalies({
      months,
      seatJoins,
      joinWindow,
      resolverIds: new Map([...built].map(([m, b]) => [m, new Set(b.base.people.map((x) => x.memberId))] as const)),
      overrides: corrections,
      cadenceIds,
    }),
  );
  const sorted = sortAnomalies(anomalies);

  // R11 — the balance preview, over the record each window month will hold.
  const sources = previewMonths.map((month) => {
    const record = afterApply(month);
    const action = actions.get(month);
    const from: "planned" | "stored" | "none" = record === null ? "none" : action === "create" || action === "replace" ? "planned" : "stored";
    return { month, from, record };
  });
  const preview = previewFigures({
    run: previewRun,
    records: sources.flatMap((s) => (s.record ? [s.record] : [])),
    services: reads.services.filter((s) => previewMonths.includes(s.date.slice(0, 7))),
    members,
  });

  // R15 — what the consent attaches to.
  const content: WritePlanContent = {
    mode: "write",
    inputs: { months, previewRun, overridesHash: overrides?.hash ?? "none" },
    months: months.map((month): WriteMonthPlan => {
      const p = planned.get(month);
      if (!p) return { month, action: "skip", body: null, bodyHash: null, corrections: [], existing: null, backup: null };
      const s = stored.get(month)?.summary ?? null;
      return {
        month,
        action: actions.get(month)!,
        body: p.body,
        bodyHash: hashes.get(month)!,
        corrections: p.transform.corrections,
        existing: s ? { id: s.id, rev: s.rev, source: s.source, contentHash: s.contentHash } : null,
        backup: backupOf.get(month) ?? null,
      };
    }),
    anomalies: sorted,
    preview: { run: previewRun, sources: sources.map(({ month, from }) => ({ month, from })), figures: preview.figures },
    serviceDigest: serviceInputDigest(reads.services.filter((s) => s.date < joinEnd || previewMonths.includes(s.date.slice(0, 7)))),
    memberDigest: memberInputDigest(roster, [...needed].sort(compareCodepoint)),
  };

  // R11 — the private table's model.
  const table: TableMonth[] = months.map((month) => {
    const services = servicesIn(month).map((s) => ({ date: s.date, type: SERVICE_TYPE_LABEL[s._type], counted: countsForFairness(s) }));
    const p = planned.get(month);
    if (!p) return { month, action: "skip", services, rows: [], presence: [] };
    const marked = (id: string, field: Correction["field"]) => p.transform.corrections.some((c) => c.memberId === id && c.field === field);
    const monthSeats = seats.get(month) ?? new Map<string, Partial<Record<Line, number>>>();
    const rows: TableRow[] = p.body.people.map((person) => {
      const cells = p.transform.cells.get(person.memberId);
      const cellOf = (k: RoleKey): TableCell => ({
        status: person.roles[k],
        count: person.exactRules.find((r) => r.roles.includes(k))?.count ?? null,
        reason: cells?.[k].reason ?? "tipo",
        corrected: cells?.[k].corrected ?? false,
      });
      return {
        memberId: person.memberId,
        name: nameOf(person.memberId),
        cells: Object.fromEntries(ROLE_KEYS.map((k) => [k, cellOf(k)])) as Record<RoleKey, TableCell>,
        joins: p.transform.joins.get(person.memberId) ?? {},
        seats: monthSeats.get(person.memberId) ?? {},
        blocked: person.blocks.map((b) => (b.unavailable ? b.date : `${b.date} (${b.excludedRoles.join(", ")})`)),
        exempt: person.exempt,
        exemptCorrected: marked(person.memberId, "exempt"),
        cadence: person.sundayCadence === "alternate",
        cadenceCorrected: marked(person.memberId, "sundayCadence"),
        blocksCorrected: marked(person.memberId, "blocks"),
        added: marked(person.memberId, "added"),
      };
    });
    const presence = p.body.presence.map((r) => ({
      ordinal: presenceOrdinal(r.ruleKey) ?? "presencia",
      ruleKey: r.ruleKey,
      roles: r.roles,
      members: r.members.map((id) => nameOf(id) || id),
      exclusive: r.exclusive,
    }));
    // «Decision per month»: a replace shows, person by person, what it changes in the stored record.
    const changes = actions.get(month) === "replace" ? replaceChanges(stored.get(month)!.record, p.body, nameOf) : undefined;
    return { month, action: actions.get(month)!, services, rows, presence, changes };
  });
  const previewRows = preview.result.people.map((person) => {
    const tabs: Partial<Record<TabKey, number>> = {};
    for (const tab of TAB_KEYS) {
      const f = person.tabs.window[tab];
      if (f) tabs[tab] = f.tenths.balance;
    }
    return { memberId: person.memberId, name: person.name, tabs };
  });

  // R12 — the name-free per-month line.
  const summaries = months.map((month) => {
    const p = planned.get(month);
    if (!p) return `${month} · ${ACTION_LABEL.skip}`;
    const statuses = p.body.people.flatMap((x) => ROLE_KEYS.map((k) => x.roles[k]));
    const count = (s: string) => statuses.filter((x) => x === s).length;
    return [
      month,
      ACTION_LABEL[actions.get(month)!],
      `personas ${p.body.people.length}`,
      `elegibles ${count("in")}`,
      `fuera ${count("out")}`,
      `fijas ${count("exact")}`,
      `correcciones ${p.transform.corrections.length}`,
      `anomalías ${sorted.filter((a) => a.month === month).length}`,
    ].join(" · ");
  });
  const cadence = {
    config: config.restrictions.filter((r) => r.sundayCadence === "alternate").length,
    overrides: corrections.filter((o) => o.sundayCadence === "alternate").length,
  };

  return {
    kind: "ok",
    derived: {
      content,
      table: {
        months,
        previewRun,
        overridesHash: overrides?.hash ?? "none",
        cadenceSettings: cadence,
        table,
        preview: { window: previewMonths, sources: content.preview.sources, rows: previewRows },
        anomalies: sorted.map((anomaly) => ({ anomaly, text: anomalyText(anomaly, nameOf) })),
        notes: corrections.flatMap((o) => (o.note !== null ? [{ ordinal: o.ordinal, memberId: o.memberId, name: nameOf(o.memberId), note: o.note }] : [])),
        notApplicable: overrides ? outOfRunEntries(overrides, months) : [],
      },
      backups,
      summaries,
      cadence,
      goneCount: sorted.filter((a) => a.code === "member_gone").length,
    },
  };
}

// ─── The dry run ────────────────────────────────────────────────────────────────

async function dryRun(ctx: Ctx): Promise<number> {
  const previewRun = ctx.args.previewRun ?? defaultPreviewRun(ctx.months);
  const reads = await readWorld(ctx.read, ctx.months, previewRun);
  const outcome = derive({ reads, months: ctx.months, previewRun, overridesText: ctx.overridesText, currentMonth: ctx.currentMonth, environment: ctx.environment });
  if (outcome.kind === "absent_config") {
    throw new Refusal([
      "no hay reglas guardadas (no existe solverConfig): las reglas por defecto no son las de hoy y perderían cada exclusión y regla fija (R3). No se escribió ningún archivo.",
    ]);
  }
  if (outcome.kind === "refused") return reportRefusals(ctx, outcome.refusals, outcome.nameOf);
  const d = outcome.derived;
  for (const b of d.backups) writeRunFile(ctx, b.file, b.text); // R18: every backup before the plan
  const generatedAt = ctx.deps.now().toISOString();
  const tablePath = writeRunFile(ctx, "tabla.md", renderTable({ ...d.table, generatedAt, projectId: ctx.projectId, dataset: ctx.dataset }));
  const planPath = writeRunFile(ctx, "plan.json", serializePlan(d.content, generatedAt));
  for (const line of d.summaries) ctx.deps.out(line);
  ctx.deps.out(`«Mes por medio» encontrados: ${d.cadence.config} en las reglas · ${d.cadence.overrides} en correcciones`);
  if (d.cadence.config + d.cadence.overrides === 0) {
    ctx.deps.out("⚠ AVISO: ningún «Mes por medio»: los miembros de cadencia se leerán como líderes normales (C4 A2). Ponlo en las reglas o en correcciones y vuelve a correr.");
  }
  ctx.deps.out(`miembros eliminados o fuera de alabanza con lugares: ${d.goneCount}`);
  ctx.deps.out(`huella del plan: ${fingerprintOf(d.content)}`);
  ctx.deps.out(`tabla: ${tablePath}`);
  ctx.deps.out(`plan: ${planPath}`);
  ctx.deps.out("Nada se escribió en Sanity. --apply solo después del consentimiento explícito de Frank a esta huella (R19).");
  return 0;
}

/** R13: one name-free line per refusal on stderr, and the private report beside them (exit 2). */
function reportRefusals(ctx: Ctx, refusals: readonly RunRefusal[], nameOf: (id: string) => string): number {
  const file = writeRunFile(ctx, "rechazo.md", renderRefusalReport({ generatedAt: ctx.deps.now().toISOString(), refusals, nameOf }));
  refusals.forEach((r, i) => ctx.deps.err(refusalLine(r, i + 1, refusals.length, file)));
  ctx.deps.err("Nada se escribió en Sanity, ni tabla ni plan.");
  return 2;
}

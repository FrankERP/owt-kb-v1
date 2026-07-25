// Static audit of protected-type query sites (Service Readiness A1 §1/§3, A2 §8/item 12).
//
// The six protected stored types must be read through the canonical operational
// clients (`sanity/lib/operationalClient`). This module statically detects every
// git-tracked query site that reads or writes a protected type through any other
// Sanity client, so a new direct read cannot land unnoticed.
//
// Detection deliberately covers three shapes, because a helper must not be able
// to evade the audit merely by omitting a type literal:
//   1. literal `_type` queries (`_type == "sunday_role"`, `_type in [...]`)
//   2. generic `_id`/reference queries whose projection consumes protected fields
//   3. mutation regions whose payload/branching names a protected type
// A generic `_id` read that projects ONLY `_type` is a defensive type-rejection
// guard: it is detected as its own kind and satisfied only by the separate,
// non-A2-owned guard exclusion registry.
//
// This module performs no I/O; the test supplies git-tracked paths and sources.

export const PROTECTED_TYPES = [
  "sunday_role",
  "saturday_role",
  "special_role",
  "featuredSongs",
  // Deliberate stored typo (Saturday setlist). Never rename — it would orphan data.
  "saturdarSongs",
  "setlistProposal",
] as const;

export type ProtectedType = (typeof PROTECTED_TYPES)[number];

/**
 * Fields that only exist on the protected role/setlist/proposal documents. Used
 * to decide whether a generic `_id`/`references()` query is really a protected
 * read. Intentionally excludes ambiguous fields shared with `post`/`teamMembers`
 * (`published`, `date`, `title`), so the signal stays specific.
 */
const PROTECTED_FIELDS = [
  "Lead",
  "BGVs",
  "Chorus",
  "instruments",
  "foh_team",
  "service_ref",
  "service_type",
  "service_date",
  "contributors",
  "play_key",
  "medley_tag",
  "team_notes",
] as const;

const MUTATION_METHODS = [
  "create",
  "createIfNotExists",
  "createOrReplace",
  "createOrUpdate",
  "patch",
  "delete",
  "transaction",
  "commit",
] as const;

const CLIENT_METHODS = ["fetch", ...MUTATION_METHODS] as const;

const HTTP_METHOD_NAMES = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/** Module specifiers that hand out a Sanity client instance. */
const SANITY_CLIENT_MODULE = /(^|\/)sanity\/lib\/[\w[\]./-]+$|^next-sanity$|^@sanity\/client$/;
/** The one module whose clients satisfy the canonical read contract. */
const OPERATIONAL_CLIENT_MODULE = /(^|\/)sanity\/lib\/operationalClient$/;
/** Bound-query helper module: `X.query`/`X.params` sourced from here is canonical. */
const QUERY_HELPER_MODULE = /(^|\/)app\/utils\/serviceReadQueries$|(^|\/)serviceReadQueries$/;

/** Names exported by a Sanity client module that are not client instances. */
const NON_CLIENT_EXPORTS = new Set(["createClient", "groq", "defineQuery", "defineLive"]);

/**
 * Guard-gated client FACTORIES used by the operator/verification tooling. A
 * `const client = makeVerificationClient(...)` hands out a real Sanity client
 * just like `createClient(...)` does, so the receiver must be audited — otherwise
 * a script could reach the Content Lake through a helper and stay invisible here.
 */
const GUARDED_CLIENT_FACTORIES = ["makeVerificationClient"];

export type ProtectedSiteKind =
  | "protected-literal-read"
  | "generic-id-protected-read"
  | "type-rejection-guard"
  | "protected-write";

export interface ProtectedSite {
  /** Repo-relative, git-tracked path. */
  file: string;
  /** Exported HTTP method for route handlers, otherwise `"module"`. */
  operation: string;
  kind: ProtectedSiteKind;
  /** Receiver identifier of the Sanity call (or `"http"` for raw Sanity HTTP). */
  client: string;
  /** Reads through the canonical operational clients. Writes are never compliant. */
  compliant: boolean;
  evidence: string;
}

export interface AuditExemption {
  file: string;
  operation: string;
  reason: string;
  removalOwner: string;
}

// ── Registries ──────────────────────────────────────────────────────────────
//
// Four disjoint registries, each exact `file + operation`. They are separate on
// purpose: "a temporary read we have not migrated yet" and "a writer that must
// write" are different claims with different owners and different lifetimes, and
// collapsing them would let a regression in the first hide behind the second.
//
//   A2_HANDOFF_ALLOWLIST      temporary unmigrated READS — empty (plan item 12)
//   PROTECTED_RUNTIME_WRITERS permanent guarded WRITES — satisfies writes only
//   RETIRED_ONE_SHOT_WRITERS  fail-closed historical scripts — reads and writes
//   OPERATOR_TOOLING_ALLOWLIST guarded operator/verification tooling A2 added
//
// plus DEFENSIVE_TYPE_REJECTION_GUARDS for the `_type`-only rejection guard kind.

/**
 * TEMPORARY A1→A2 READ HANDOFF — **empty**, and it must stay empty.
 *
 * A1 used this registry for mutation-local *reads* of the protected types that it
 * could not migrate without also rewriting the writer. A2 §2/§4/§5/§6 migrated
 * every one of those reads onto `operationalClient` / `rawIntegrityClient` via the
 * shared write helpers, so plan item 12 ("remove all A1 mutation-read audit
 * allowlist entries") is satisfied by an empty list rather than by a rename.
 *
 * The export is deliberately kept: `auditViolations` still consults it for every
 * non-guard kind, so the "is the handoff empty?" question stays machine-checkable,
 * and a future slice that needs a *temporary* read exemption has an owned place to
 * put it instead of widening a permanent registry.
 *
 * A legitimate, permanent protected **write** is a different category and lives in
 * `PROTECTED_RUNTIME_WRITERS`; a fail-closed historical writer lives in
 * `RETIRED_ONE_SHOT_WRITERS`; guarded operator tooling lives in
 * `OPERATOR_TOOLING_ALLOWLIST`. None of those are read exemptions.
 */
export const A2_HANDOFF_ALLOWLIST: readonly AuditExemption[] = [];

/**
 * PERMANENT protected WRITERS — the guarded runtime mutation routes. A writer must
 * write: these entries exist because the route commits a revision-asserted
 * transaction over a protected type, not because a read is unmigrated. Nothing
 * removes them; the app would have no mutation surface without them.
 *
 * Scope is deliberately narrower than the old handoff allowlist: this registry
 * satisfies ONLY `protected-write` sites. A non-canonical **read** appearing in one
 * of these files/operations is still a violation, so migrating the reads cannot be
 * silently undone later. Every entry is exact `file + operation`; no globs.
 */
export const PROTECTED_RUNTIME_WRITERS: readonly AuditExemption[] = [
  {
    file: "app/api/admin/roles/route.ts",
    operation: "POST",
    reason:
      "guarded role create: one transaction creates the deterministic roleCreationReceipt, the role, and the claimed/reclaimed weekend roleTargetLock (A2 §2)",
    removalOwner: "permanent runtime writer (never removed — the create surface itself)",
  },
  {
    file: "app/api/admin/roles/[id]/route.ts",
    operation: "PATCH",
    reason:
      "guarded role edit: revision-asserted assignment/date patch that also vacates the old and claims the new weekend roleTargetLock on a permitted date move (A2 §2)",
    removalOwner: "permanent runtime writer (never removed — the edit surface itself)",
  },
  // NOTE: `app/api/admin/roles/[id]/route.ts` DELETE is deliberately NOT listed.
  // It mutates through `writeClient.transaction()`, but its region names no
  // protected type literal (the type comes from the stored document, never from the
  // request), so the detector produces no site for it and an entry here would be a
  // dead exemption. If a protected literal ever appears in that region the audit
  // will fail and the entry must be added then — that is the audit working.
  {
    file: "app/api/admin/roles/publish/route.ts",
    operation: "POST",
    reason:
      "guarded batch publish/unpublish: one transaction patches every requested role's publication state under its client-observed revision and heartbeats each coordination token (A2 §2)",
    removalOwner: "permanent runtime writer (never removed — the publish surface itself)",
  },
  {
    file: "app/api/admin/roles/swap/route.ts",
    operation: "POST",
    reason:
      "guarded atomic swap: one transaction exchanges stored seat/team assignments across both roles under both observed revisions (A2 §4)",
    removalOwner: "permanent runtime writer (never removed — the swap surface itself)",
  },
  {
    file: "app/api/admin/roles/copy-instruments/route.ts",
    operation: "POST",
    reason:
      "guarded copy-instruments: one transaction patches only the target role's instruments, read from the stored source under both observed revisions (A2 §4)",
    removalOwner: "permanent runtime writer (never removed — the copy surface itself)",
  },
  {
    file: "app/api/admin/setlists/route.ts",
    operation: "PUT",
    reason:
      "guarded live setlist writer: one transaction creates/patches featuredSongs/saturdarSongs at the deterministic id, or patches special_role songs, under the client-observed target state (A2 §5)",
    removalOwner: "permanent runtime writer (never removed — the setlist save surface itself)",
  },
  {
    file: "app/api/me/proposals/route.ts",
    operation: "POST",
    reason:
      "guarded shared proposal writer: one transaction creates the deterministic setlistProposal or patches the observed one, heartbeating the weekend lock or special-role revision (A2 §6)",
    removalOwner: "permanent runtime writer (never removed — the proposal save surface itself)",
  },
  {
    file: "app/api/admin/proposals/[id]/route.ts",
    operation: "PATCH",
    reason:
      "guarded proposal transitions and atomic approval: one transaction asserts the reviewed proposal revision, writes the live featuredSongs/saturdarSongs/special_role target, and records the approval receipt (A2 §6)",
    removalOwner: "permanent runtime writer (never removed — the review/approval surface itself)",
  },
];

/**
 * RETIRED one-shot executable writers — kept as the historical record of what was
 * applied to production, and unreachable in code. Each of these five files calls
 * `assertRetiredWriter()` (`scripts/lib/sr-retired-writer.mjs`) as its first
 * statement, before any client is constructed and before any mutation is
 * assembled, and that gate is an unconditional non-zero exit (A2 §8).
 *
 * They are still listed because this audit is a STATIC scan: the historical GROQ
 * and mutation text remains in the files, so removing the entries would fail the
 * audit rather than prove anything. They are NOT read exemptions in any live path —
 * no code path reaches them — and they are not A2's to remove: deleting the files
 * would erase the record, and `scripts/lib/__tests__/sr-retired-writer.test.mjs`
 * proves the gate precedes every write marker in each one.
 */
export const RETIRED_ONE_SHOT_WRITERS: readonly AuditExemption[] = [
  {
    file: "scripts/cleanup-superseded-proposals.mjs",
    operation: "module",
    reason:
      "retired one-shot: queried setlistProposal and deleted stale non-approved proposals; now fails closed at assertRetiredWriter() before any client is constructed. Replacement: scripts/service-readiness-cleanup.mjs --action resolve-proposal",
    removalOwner: "retired historical writer (never A2 — the file is the record, the gate is the guard)",
  },
  {
    file: "scripts/import-schedule.ts",
    operation: "module",
    reason:
      "retired one-shot: create-if-missing and patched sunday_role/saturday_role assignment arrays over raw Sanity HTTP; now fails closed at assertRetiredWriter(). Replacement: POST /api/admin/roles and PATCH /api/admin/roles/[id]",
    removalOwner: "retired historical writer (never A2 — the file is the record, the gate is the guard)",
  },
  {
    file: "scripts/import-setlist-history.mjs",
    operation: "module",
    reason:
      "retired one-shot: queried featuredSongs/saturdarSongs and created missing history documents; now fails closed at assertRetiredWriter(). Replacement: PUT /api/admin/setlists",
    removalOwner: "retired historical writer (never A2 — the file is the record, the gate is the guard)",
  },
  {
    file: "scripts/migrate-shared-proposals.mjs",
    operation: "module",
    reason:
      "retired one-shot: queried setlistProposal, patched the retained shared proposal, and deleted losers; now fails closed at assertRetiredWriter(). Already applied in production on 2026-07-03",
    removalOwner: "retired historical writer (never A2 — the file is the record, the gate is the guard)",
  },
  {
    file: "scripts/unpublish-july-2026.mjs",
    operation: "module",
    reason:
      "retired one-shot: queried July 2026 role documents and patched published: false; now fails closed at assertRetiredWriter(). Replacement: POST /api/admin/roles/publish",
    removalOwner: "retired historical writer (never A2 — the file is the record, the gate is the guard)",
  },
];

/**
 * Guarded OPERATOR TOOLING — kept SEPARATE from the A2 writer allowlist and NOT
 * owned by A2, because A2 does not remove these writers: they exist precisely to
 * be run by hand against the isolated verification dataset, and their guards
 * (`scripts/lib/sr-verification.mjs`) hard-refuse the production project and
 * dataset on either axis, in dry-run too. They are listed here, by exact
 * file + operation, so they are visible to the audit rather than invisible to it.
 */
export const OPERATOR_TOOLING_ALLOWLIST: readonly AuditExemption[] = [
  {
    file: "scripts/service-readiness-cleanup.mjs",
    operation: "module",
    reason:
      "guarded operator cleanup: gathers its own dependency/orphan proof over the protected types and commits one revision-asserted transaction; hard-refuses the production project/dataset and is dry-run by default",
    removalOwner: "operator cleanup tooling (never A2 — A2 adds it, nothing removes it)",
  },
  {
    file: "scripts/service-readiness-feasibility.mjs",
    operation: "module",
    reason:
      "A3 isolated-dataset feasibility harness: creates and conflicts protected role/setlist/proposal documents inside the verification dataset only; hard-refuses the production project/dataset",
    removalOwner: "A3 verification tooling (never A2)",
  },
];

/**
 * Defensive type-rejection guards — kept SEPARATE from the A2 writer allowlist
 * and NOT owned by A2. A write-path handler outside the Service Readiness writer
 * set may fetch only a target's `_type`, never projecting or consuming protected
 * content, solely to reject a protected document. A generic `_id` read that
 * projects or consumes protected fields is not covered by this narrow exclusion
 * and still fails the audit.
 */
export const DEFENSIVE_TYPE_REJECTION_GUARDS: readonly AuditExemption[] = [
  {
    file: "app/api/content/posts/[id]/route.ts",
    operation: "PATCH",
    reason:
      "`*[_id == $id][0]{ _type }` ownership guard on the song-content editor, so a manager cannot overwrite a role/proposal/teamMembers document by id; projects only _type",
    removalOwner: "song-content editor refactor (never A2)",
  },
];

// ── Source scanning ─────────────────────────────────────────────────────────

/**
 * Blank out `//` and block comments while preserving byte offsets, so a protected
 * type named in prose (e.g. the posts/[id] guard comment) is never evidence.
 * String and template-literal bodies (including `${}` interpolations) are kept.
 */
export function stripComments(src: string): string {
  const out = src.split("");
  const stack: Array<{ kind: "tpl" } | { kind: "expr"; depth: number }> = [];
  const n = src.length;
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (src[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const top = stack[stack.length - 1];
    if (top && top.kind === "tpl") {
      const c = src[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { stack.pop(); i++; continue; }
      if (c === "$" && src[i + 1] === "{") { stack.push({ kind: "expr", depth: 0 }); i += 2; continue; }
      i++;
      continue;
    }
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      const end = Math.min(j + 2, n);
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j++;
        else if (src[j] === "\n") break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "`") { stack.push({ kind: "tpl" }); i++; continue; }
    if (top && top.kind === "expr") {
      if (c === "{") top.depth++;
      else if (c === "}") {
        if (top.depth === 0) { stack.pop(); i++; continue; }
        top.depth--;
      }
    }
    i++;
  }
  return out.join("");
}

interface Region { operation: string; start: number; end: number }

/** Split a source into operations: exported route methods, else `"module"`. */
export function operationRegions(code: string): Region[] {
  const re = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+(${HTTP_METHOD_NAMES.join("|")})\\s*\\(`,
    "g",
  );
  const marks: Array<{ operation: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) marks.push({ operation: m[1], start: m.index });
  const regions: Region[] = [
    { operation: "module", start: 0, end: marks.length ? marks[0].start : code.length },
  ];
  for (let k = 0; k < marks.length; k++) {
    regions.push({
      operation: marks[k].operation,
      start: marks[k].start,
      end: k + 1 < marks.length ? marks[k + 1].start : code.length,
    });
  }
  return regions;
}

function operationAt(regions: Region[], index: number): string {
  for (const r of regions) if (index >= r.start && index < r.end) return r.operation;
  return "module";
}

interface ClientInfo {
  clients: Set<string>;
  operational: Set<string>;
  helperFns: Set<string>;
  rawSanityHttp: boolean;
}

/** Identify which local identifiers are Sanity clients, and which are canonical. */
export function sanityClientIdentifiers(code: string): ClientInfo {
  const clients = new Set<string>();
  const operational = new Set<string>();
  const helperFns = new Set<string>();
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(code))) {
    const spec = m[2].replace(/^@\//, "");
    const names = m[1]
      .split(",")
      .map((raw) => raw.trim().replace(/^type\s+/, ""))
      .map((raw) => (raw.includes(" as ") ? raw.split(" as ")[1].trim() : raw))
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name) && !NON_CLIENT_EXPORTS.has(name));
    if (SANITY_CLIENT_MODULE.test(spec)) for (const name of names) clients.add(name);
    if (OPERATIONAL_CLIENT_MODULE.test(spec)) for (const name of names) operational.add(name);
    if (QUERY_HELPER_MODULE.test(spec)) for (const name of names) helperFns.add(name);
  }
  const createRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*createClient\s*\(/g;
  while ((m = createRe.exec(code))) clients.add(m[1]);
  const factoryRe = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?(?:${GUARDED_CLIENT_FACTORIES.join("|")})\\s*\\(`,
    "g",
  );
  while ((m = factoryRe.exec(code))) clients.add(m[1]);
  // A transaction handle inherits its client's write capability.
  const txRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*transaction\s*\(/g;
  while ((m = txRe.exec(code))) if (clients.has(m[2])) clients.add(m[1]);
  return { clients, operational, helperFns, rawSanityHttp: /api\.sanity\.io/.test(code) };
}

/** Index just past the matching `)` for the `(` at `open`. */
function matchParen(code: string, open: number): number {
  let depth = 0;
  let i = open;
  const n = code.length;
  const stack: Array<{ kind: "tpl" } | { kind: "expr"; depth: number }> = [];
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = code[i];
    if (top && top.kind === "tpl") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { stack.pop(); i++; continue; }
      if (c === "$" && code[i + 1] === "{") { stack.push({ kind: "expr", depth: 0 }); i += 2; continue; }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && code[j] !== c) {
        if (code[j] === "\\") j++;
        else if (code[j] === "\n") break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "`") { stack.push({ kind: "tpl" }); i++; continue; }
    if (top && top.kind === "expr") {
      if (c === "{") top.depth++;
      else if (c === "}") {
        if (top.depth === 0) { stack.pop(); i++; continue; }
        top.depth--;
      }
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return n;
}

/** Skip a generic argument list, returning the index of the call's `(`. */
function callParenIndex(code: string, afterName: number): number {
  let i = afterName;
  while (i < code.length && /\s/.test(code[i])) i++;
  if (code[i] === "<") {
    let depth = 0;
    while (i < code.length) {
      if (code[i] === "<") depth++;
      else if (code[i] === ">") {
        depth--;
        if (depth === 0) { i++; break; }
      }
      i++;
    }
    while (i < code.length && /\s/.test(code[i])) i++;
  }
  return code[i] === "(" ? i : -1;
}

/** First top-level argument expression inside `(...)`. */
function firstArgument(argsText: string): string {
  const inner = argsText.slice(1, -1);
  let depth = 0;
  const stack: Array<{ kind: "tpl" } | { kind: "expr"; depth: number }> = [];
  for (let i = 0; i < inner.length; i++) {
    const top = stack[stack.length - 1];
    const c = inner[i];
    if (top && top.kind === "tpl") {
      if (c === "\\") { i++; continue; }
      if (c === "`") stack.pop();
      else if (c === "$" && inner[i + 1] === "{") { stack.push({ kind: "expr", depth: 0 }); i++; }
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < inner.length && inner[i] !== c) {
        if (inner[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (c === "`") { stack.push({ kind: "tpl" }); continue; }
    if (top && top.kind === "expr") {
      if (c === "{") top.depth++;
      else if (c === "}") { if (top.depth === 0) { stack.pop(); continue; } top.depth--; }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) return inner.slice(0, i);
  }
  return inner;
}

/** Concatenated bodies of every string/template literal in an expression. */
function literalBodies(expr: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      let body = "";
      while (j < expr.length && expr[j] !== c) {
        if (expr[j] === "\\") { body += expr[j + 1] ?? ""; j += 2; continue; }
        body += expr[j];
        j++;
      }
      parts.push(body);
      i = j + 1;
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      let body = "";
      let exprDepth = -1;
      while (j < expr.length) {
        if (expr[j] === "\\") { body += expr[j + 1] ?? ""; j += 2; continue; }
        if (exprDepth < 0 && expr[j] === "`") break;
        if (exprDepth < 0 && expr[j] === "$" && expr[j + 1] === "{") { exprDepth = 0; body += "${"; j += 2; continue; }
        if (exprDepth >= 0) {
          if (expr[j] === "{") exprDepth++;
          else if (expr[j] === "}") { if (exprDepth === 0) { exprDepth = -1; body += "}"; j++; continue; } exprDepth--; }
        }
        body += expr[j];
        j++;
      }
      parts.push(body);
      i = j + 1;
      continue;
    }
    i++;
  }
  return parts.join("\n");
}

/** Initializer text for `const NAME = …`: a literal, or the leading identifier. */
function constInitializer(code: string, name: string): string | null {
  const re = new RegExp(
    `(?:const|let|var)\\s+${name.replace(/[$]/g, "\\$")}\\s*(?::[^=;]*)?=\\s*`,
    "g",
  );
  const m = re.exec(code);
  if (!m) return null;
  let i = m.index + m[0].length;
  if (code[i] === "`" || code[i] === '"' || code[i] === "'") {
    const q = code[i];
    let j = i + 1;
    if (q === "`") {
      const stack: Array<"tpl" | number> = [];
      while (j < code.length) {
        if (code[j] === "\\") { j += 2; continue; }
        if (code[j] === "`" && stack.length === 0) break;
        j++;
      }
    } else {
      while (j < code.length && code[j] !== q) { if (code[j] === "\\") j++; j++; }
    }
    return code.slice(i, j + 1);
  }
  const ident = /^[A-Za-z_$][\w$]*/.exec(code.slice(i));
  return ident ? ident[0] : null;
}

interface ResolvedQuery { text: string | null; helperSourced: boolean }

/** Resolve a `.fetch()` query expression to GROQ text, following local consts. */
export function resolveQueryExpression(
  expr: string,
  code: string,
  info: ClientInfo,
  depth = 0,
): ResolvedQuery {
  const trimmed = expr.trim();
  if (depth > 4 || !trimmed) return { text: null, helperSourced: false };

  const literals = literalBodies(trimmed);
  if (literals) {
    // Inline `${IDENT}` fragments so a query split across consts is still seen.
    const expanded = literals.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (whole, name: string) => {
      const init = constInitializer(code, name);
      if (!init) return whole;
      return resolveQueryExpression(init, code, info, depth + 1).text ?? whole;
    });
    return { text: expanded, helperSourced: false };
  }

  const member = /^([A-Za-z_$][\w$]*)\s*\.\s*(query|params)$/.exec(trimmed);
  if (member) {
    const init = constInitializer(code, member[1]);
    if (init && info.helperFns.has(init)) return { text: null, helperSourced: true };
    return { text: null, helperSourced: false };
  }

  if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    if (info.helperFns.has(trimmed)) return { text: null, helperSourced: true };
    const init = constInitializer(code, trimmed);
    if (init && init !== trimmed) return resolveQueryExpression(init, code, info, depth + 1);
  }
  return { text: null, helperSourced: false };
}

const PROTECTED_LITERAL_RE = new RegExp(`["'](${PROTECTED_TYPES.join("|")})["']`);
const GENERIC_ID_RE = /(^|[^\w.])_id\s*(==|in)\s*\$|references\s*\(\s*\$/;
const TYPE_ONLY_PROJECTION_RE = /\{\s*_type\s*\}/;
const PROTECTED_FIELD_RE = new RegExp(`(^|[^\\w.])(${PROTECTED_FIELDS.join("|")})\\b`);

/** Classify one resolved GROQ query. Returns null when it touches nothing protected. */
export function classifyQuery(groq: string): ProtectedSiteKind | null {
  if (PROTECTED_LITERAL_RE.test(groq)) return "protected-literal-read";
  if (!GENERIC_ID_RE.test(groq)) return null;
  if (PROTECTED_FIELD_RE.test(groq)) return "generic-id-protected-read";
  if (TYPE_ONLY_PROJECTION_RE.test(groq)) return "type-rejection-guard";
  return null;
}

function condense(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Every protected query site in one source file. */
export function scanSource(file: string, source: string): ProtectedSite[] {
  const code = stripComments(source);
  const info = sanityClientIdentifiers(code);
  if (!info.clients.size && !info.rawSanityHttp) return [];
  const regions = operationRegions(code);
  const sites: ProtectedSite[] = [];
  const mutatingOperations = new Set<string>();

  const callRe = new RegExp(
    `\\b([A-Za-z_$][\\w$]*)\\s*\\.\\s*(${CLIENT_METHODS.join("|")})\\s*(?=[<(])`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(code))) {
    const [receiver, method] = [m[1], m[2]];
    if (!info.clients.has(receiver)) continue;
    const operation = operationAt(regions, m.index);
    if (method !== "fetch") {
      mutatingOperations.add(operation);
      continue;
    }
    const open = callParenIndex(code, m.index + m[0].length);
    if (open < 0) continue;
    const args = code.slice(open, matchParen(code, open));
    const resolved = resolveQueryExpression(firstArgument(args), code, info);
    const compliant = info.operational.has(receiver);
    // A bound query from `serviceReadQueries` is canonical only when it is also
    // executed by a canonical client; running one through `serverClient` (raw
    // perspective) is exactly the draft-leaking bypass this audit exists to catch.
    if (resolved.helperSourced) {
      if (compliant) continue;
      sites.push({
        file,
        operation,
        kind: "protected-literal-read",
        client: receiver,
        compliant,
        evidence: "canonical serviceReadQueries helper executed by a non-canonical client",
      });
      continue;
    }
    let kind: ProtectedSiteKind | null = null;
    let evidence = "";
    if (resolved.text != null) {
      kind = classifyQuery(resolved.text);
      evidence = condense(resolved.text);
    } else if (!compliant) {
      // Fail closed: an unresolvable query on a non-canonical client is treated
      // as protected whenever its operation names a protected type at all.
      const regionText = code.slice(
        regions.find((r) => r.operation === operation)?.start ?? 0,
        regions.find((r) => r.operation === operation)?.end ?? code.length,
      );
      if (PROTECTED_LITERAL_RE.test(regionText)) {
        kind = "protected-literal-read";
        evidence = `unresolved query in protected operation: ${condense(firstArgument(args))}`;
      }
    }
    if (kind) sites.push({ file, operation, kind, client: receiver, compliant, evidence });
  }

  if (info.rawSanityHttp) {
    const httpRe = /(^|[^.\w$])fetch\s*\(/g;
    while ((m = httpRe.exec(code))) mutatingOperations.add(operationAt(regions, m.index));
  }

  for (const region of regions) {
    if (!mutatingOperations.has(region.operation)) continue;
    const text = code.slice(region.start, region.end);
    const hit = PROTECTED_LITERAL_RE.exec(text);
    if (!hit) continue;
    sites.push({
      file,
      operation: region.operation,
      kind: "protected-write",
      client: info.rawSanityHttp && !info.clients.size ? "http" : "sanity-client",
      compliant: false,
      evidence: `mutation operation names protected type ${hit[1]}`,
    });
  }

  return sites;
}

// ── Audit ───────────────────────────────────────────────────────────────────

/** Files the audit treats as runtime/script query sites (per plan §1). */
export function isAuditedQuerySiteFile(path: string): boolean {
  if (!/\.(ts|tsx|mjs|cjs|js)$/.test(path)) return false;
  // Tests are fixtures, not query sites.
  if (/(^|\/)__tests__\//.test(path) || /\.test\.[^/]+$/.test(path)) return false;
  return true;
}

function matches(entry: AuditExemption, site: ProtectedSite): boolean {
  return entry.file === site.file && entry.operation === site.operation;
}

/**
 * Protected sites that neither read through the canonical operational clients nor
 * carry an exact documented exemption. Each kind is satisfied by its own registries
 * only — the narrower the kind, the narrower the registry set:
 *
 * - `type-rejection-guard` → `DEFENSIVE_TYPE_REJECTION_GUARDS` only.
 * - `protected-write` → the permanent runtime writers, the retired one-shots, the
 *   guarded operator tooling, or (in principle) the empty A2 read handoff.
 * - any protected READ → everything EXCEPT `PROTECTED_RUNTIME_WRITERS`. A guarded
 *   runtime route is licensed to write, never to read off a non-canonical client.
 *
 * Every registry stays exact `file + operation`; there are no globs anywhere.
 */
export function auditViolations(sites: readonly ProtectedSite[]): ProtectedSite[] {
  return sites.filter((site) => {
    if (site.compliant) return false;
    let registries: ReadonlyArray<readonly AuditExemption[]>;
    if (site.kind === "type-rejection-guard") {
      registries = [DEFENSIVE_TYPE_REJECTION_GUARDS];
    } else if (site.kind === "protected-write") {
      registries = [
        A2_HANDOFF_ALLOWLIST,
        PROTECTED_RUNTIME_WRITERS,
        RETIRED_ONE_SHOT_WRITERS,
        OPERATOR_TOOLING_ALLOWLIST,
      ];
    } else {
      registries = [A2_HANDOFF_ALLOWLIST, RETIRED_ONE_SHOT_WRITERS, OPERATOR_TOOLING_ALLOWLIST];
    }
    return !registries.some((registry) => registry.some((entry) => matches(entry, site)));
  });
}

export function describeSite(site: ProtectedSite): string {
  return `${site.file} [${site.operation}] ${site.kind} via ${site.client} — ${site.evidence}`;
}

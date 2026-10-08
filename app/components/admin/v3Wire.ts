// app/components/admin/v3Wire.ts
//
// The `contract: 3` wire as C6 builds and reads it (C5 §5 request, §8 response — C5's spec is the
// source; these are C6's typed view of it). NEUTRAL: types, two constants and the contract marker
// `isV3Body`, imported by the client modules, the request builder, the solve route and the
// server-only transport alike.
//
// Key hygiene (C6 KH-1, parent A41): a request's rule ids are MINTED by C6 (`v3RuleIds.ts`), never
// a config key; `P:<id>` keys in `carried` and `fairness.lines` carry minted ids too.

import type { LineKey, RoleKey, TabKey } from "@/app/utils/fairnessVocabulary";

export type V3Role = "Lead" | "BGV" | "Choir";
export const V3_ROLES: readonly V3Role[] = ["Lead", "BGV", "Choir"];

export type V3ServiceKind = "sunday" | "saturday" | "special";

/** C5 §5.2. `seats` only when not fixed; a non-fixed `saturday` sends no `Choir`. */
export interface V3Service {
  id: string;
  date: string;
  month: string;
  kind: V3ServiceKind;
  time?: string;
  fixed: boolean;
  counts: boolean;
  seats?: { Lead: number; BGV: number; Choir?: number };
}

/** C5 §5.3. `dl_since` and `prev_dl_leads` are always sent (C5's parser requires both). */
export interface V3Person {
  id: string;
  name: string;
  exempt: boolean;
  eligibility: Record<string, V3Role[]>;
  carried: Partial<Record<LineKey, number>>;
  cadence?: Record<string, "on" | "off" | "out">;
  dl_since: string | null;
  prev_dl_leads: number;
}

/** C5 §5.4. C6 never emits `consecutive` (today's UI has none — spec RQ-5). */
export type V3Rule =
  | { kind: "count"; id: string; person: string; roles: RoleKey[]; op: "==" | "<=" | ">="; month: string; value: number }
  | { kind: "pair"; id: string; persons: [string, string]; roles: RoleKey[]; month?: string }
  | { kind: "presence"; id: string; persons: string[]; roles: RoleKey[]; exclusive: boolean; month?: string };

/** C5 §5.5. */
export interface V3Pin {
  service: string;
  date: string;
  role: V3Role;
  person: string;
}

/** C5 §5.6 — built from the roles read, never from the ledger (spec RQ-7). */
export interface V3Prior {
  month: string;
  has_services: boolean;
  services: Array<{
    date: string;
    kind: V3ServiceKind;
    counts: boolean;
    seats: { Lead: string[]; BGV: string[]; Choir: string[] };
  }>;
}

/** C5 §5.1. No `budget` in production (spec RQ-8); no v2 field ever. */
export interface V3SolveRequest {
  contract: 3;
  seed: number;
  request_id: string;
  months: string[];
  services: V3Service[];
  people: V3Person[];
  rules: V3Rule[];
  pins: V3Pin[];
  prior: V3Prior;
}

export interface V3Stage {
  id: string;
  status: "proven" | "unproven" | "not_run";
  reason?: "budget" | "no_solution_in_limit" | "stopped_earlier";
  value: number;
  bound: number;
  limit: string;
  ms: number;
  det_milli: number;
}

/** One display tab of a person (C5 §8.2 `tabs`): hundredths, plus the integer seat counts (A39) and tenths. */
export interface V3TabFigures {
  carried: number;
  share: number;
  received: number;
  pinned: number;
  seats: number;
  pinned_seats: number;
  after: number;
  tenths: { share: number; after: number };
}

export interface V3FairnessPerson {
  person: string;
  floor: Array<{ month: string; planned: boolean; realised: boolean; seat: { service: string; role: V3Role } | null }>;
  lines: Partial<Record<LineKey, V3TabFigures & { planned: number; set_aside: number; in_stage: boolean; clamped: boolean }>>;
  tabs: Partial<Record<TabKey, V3TabFigures>>;
}

/** C5 §8.1. */
export interface V3Success {
  ok: true;
  contract: 3;
  engine: "v3";
  solver_version: string;
  build: string;
  request_id: string | null;
  seed: number;
  months: string[];
  reproducible: boolean;
  assignments: Record<string, Partial<Record<V3Role, string[]>>>;
  unfilled: Array<{ service: string; role: V3Role; count: number; reason: string }>;
  pins: { requested: number; honored: number };
  violations: Array<{
    code: string; rule: string; cause: string; person?: string; persons?: string[]; month?: string;
    service?: string; weekends?: string[]; observed?: number; limit?: number;
  }>;
  violation_ceiling: { value: number; proven: boolean };
  stages: V3Stage[];
  total_ms: number;
  fairness: { scale: number; tolerance: number; lines: string[]; people: V3FairnessPerson[] };
  cadence: Array<{ person: string; month: string; state: string; sundays: number; saturdays: number; met: boolean; compensation: string }>;
  missed: Array<{ code: string; person: string; month?: string; month1?: string; month2?: string; dates?: string[]; count?: number; cause: string }>;
  notices: Array<{ code: string; params: Record<string, unknown> }>;
}

/** C5 §8.3, as the route forwards it (always 422, spec RT-5). */
export interface V3Failure {
  ok: false;
  contract: 3;
  engine: "v3";
  code: string;
  params: Record<string, unknown>;
}

/** The route's own failures (spec RT-5): never a 500, never a solver code. */
export type V3TransportReason = "timeout" | "unreachable" | "http_status" | "not_json" | "not_configured" | "contract_echo";

export interface V3TransportError {
  ok: false;
  transport_error: true;
  transport: V3TransportReason;
}

/** spec RT-1 — the server's engine decided against the body's contract. */
export interface V3VersionMismatch {
  ok: false;
  error: "solver_version_mismatch";
  engine: "v2" | "v3";
}

/**
 * The v3 contract marker (C5 §5.1). It classifies; the SERVER's engine decides (RT-1). Lives here,
 * not in the server-only transport, so the solve route can classify every body without loading
 * that module on the v2 path.
 */
export function isV3Body(body: unknown): boolean {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    && (body as { contract?: unknown }).contract === 3;
}

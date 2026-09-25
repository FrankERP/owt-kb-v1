// What `get_member_availability` reports (P1 step 6): a pure reading of the
// worship-audience directory `memberDirectory.ts` loads. No I/O here.
//
// SELECTION (spec D8): `memberId` and `name` are mutually exclusive; either
// selects exactly one member, an unmatched or ambiguous one is refused (never
// an arbitrary pick), and no selector at all answers the whole directory. A
// `name` match is EXACT after `normalizeText`, against `member_name` OR
// `alias` — never fuzzy, so a later write is never fed a guess (A15's lesson,
// same discipline as `resolveService`).
//
// A kids-only member never reaches this module at all: `memberDirectory.ts`'s
// query already applies `WORSHIP_AUDIENCE_GROQ_FILTER` (spec I5, no `$all`
// bypass). Resolving an id that names one therefore fails the same way an
// unknown id does — the SAME message, so the refusal never leaks which case it
// was (spec D8's "never leak" sibling for members).

import { MEMBER_TYPE_LABEL } from "@/app/utils/memberTypes";
import { normalizeText } from "@/app/utils/normalizeText";
import { isCanonicalDocumentId } from "@/app/utils/roleWriteRequest";
import type { WorshipMemberRow } from "./memberDirectory";

// ── Selector (mutually exclusive, spec D8) ──────────────────────────────────

export type MemberSelector = { by: "all" } | { by: "id"; memberId: string } | { by: "name"; name: string };

export type SelectorParse = { ok: true; selector: MemberSelector } | { ok: false; message: string };

const refuse = (message: string): SelectorParse => ({ ok: false, message });

/** Validates the selector's shape; a Spanish refusal when both or a malformed field are given. */
export function parseMemberAvailabilitySelector(input: { memberId?: unknown; name?: unknown }): SelectorParse {
  const { memberId, name } = input;
  const given = (v: unknown) => v !== undefined;

  if (given(memberId) && given(name)) {
    return refuse("memberId no se combina con name. Usa uno solo, o ninguno para todo el equipo.");
  }
  if (given(memberId)) {
    if (!isCanonicalDocumentId(memberId)) return refuse("memberId no es un id de documento válido.");
    return { ok: true, selector: { by: "id", memberId } };
  }
  if (given(name)) {
    if (typeof name !== "string" || name.trim() === "") return refuse("name debe ser texto no vacío.");
    return { ok: true, selector: { by: "name", name } };
  }
  return { ok: true, selector: { by: "all" } };
}

// ── Resolution ───────────────────────────────────────────────────────────────

export type MemberCandidate = { memberId: string; name: string | null; alias: string | null };

export type MemberResolution =
  | { ok: true; members: WorshipMemberRow[] }
  | { ok: false; message: string; candidates: MemberCandidate[] };

/** Never distinguishes "no such id" from "that id is kids-only": both read as unknown (spec I5). */
export const UNKNOWN_MEMBER_MESSAGE = "No existe un miembro del equipo de alabanza con ese id o nombre.";

function candidateOf(row: WorshipMemberRow): MemberCandidate {
  return { memberId: row._id, name: row.member_name ?? null, alias: row.alias ?? null };
}

/** `memberId (name «alias»)` — how a refusal's TEXT names a candidate, as `get_service`'s `refusal()` does. */
function candidateLabel(c: MemberCandidate): string {
  const who = [c.name, c.alias ? `«${c.alias}»` : null].filter(Boolean).join(" ");
  return `${c.memberId} (${who || "sin nombre"})`;
}

/** The one member a selector names, the whole directory, or a refusal listing candidates (D8). */
export function resolveMembers(directory: readonly WorshipMemberRow[], selector: MemberSelector): MemberResolution {
  if (selector.by === "all") return { ok: true, members: [...directory] };

  if (selector.by === "id") {
    const found = directory.find((m) => m._id === selector.memberId);
    return found ? { ok: true, members: [found] } : { ok: false, message: UNKNOWN_MEMBER_MESSAGE, candidates: [] };
  }

  const wanted = normalizeText(selector.name);
  const matches = directory.filter(
    (m) => normalizeText(m.member_name ?? "") === wanted || normalizeText(m.alias ?? "") === wanted,
  );
  if (matches.length === 0) return { ok: false, message: UNKNOWN_MEMBER_MESSAGE, candidates: [] };
  if (matches.length > 1) {
    // The candidates go in the TEXT as well as in `structuredContent`: the SDK
    // adds no text fallback for an object payload, and a client that reads
    // only `content` would otherwise have no memberId to retry with.
    const candidates = matches.map(candidateOf);
    return {
      ok: false,
      message:
        `Hay ${matches.length} miembros que coinciden con ese nombre; elige uno por memberId. ` +
        `Candidatos: ${candidates.map(candidateLabel).join("; ")}.`,
      candidates,
    };
  }
  return { ok: true, members: [matches[0]!] };
}

// ── Presentation ─────────────────────────────────────────────────────────────

export type MemberAvailabilityEntry = {
  memberId: string;
  name: string | null;
  alias: string | null;
  /** `MEMBER_TYPE_LABEL`'s Spanish labels for `memberType`, an unknown code kept as-is. */
  tipo: string[];
  /** Reported, never hidden: `disabled` removes app access, not schedulability (spec D7, CLAUDE.md). */
  disabled: boolean;
  unavailable: { date: string; note?: string }[];
};

export type GetMemberAvailabilityPayload = { month: string; members: MemberAvailabilityEntry[] };

function unavailableInMonth(row: WorshipMemberRow, month: string): { date: string; note?: string }[] {
  const prefix = `${month}-`;
  const dates = new Set(
    (row.unavailableDates ?? []).filter((d): d is string => typeof d === "string" && d.startsWith(prefix)),
  );
  const notesByDate = new Map<string, string>();
  for (const entry of row.unavailabilityNotes ?? []) {
    if (entry && typeof entry.date === "string" && typeof entry.note === "string" && entry.note.trim()) {
      notesByDate.set(entry.date, entry.note);
    }
  }
  return [...dates].sort().map((date) => {
    const note = notesByDate.get(date);
    return note ? { date, note } : { date };
  });
}

export function presentMemberAvailability(row: WorshipMemberRow, month: string): MemberAvailabilityEntry {
  return {
    memberId: row._id,
    name: row.member_name ?? null,
    alias: row.alias ?? null,
    tipo: (row.memberType ?? []).map((t) => MEMBER_TYPE_LABEL[t] ?? t),
    disabled: row.disabled === true,
    unavailable: unavailableInMonth(row, month),
  };
}

/** Every resolved member's availability for `month`, ordered by name (D8's "never an arbitrary pick" extends to display order). */
export function presentMemberAvailabilityList(
  rows: readonly WorshipMemberRow[],
  month: string,
): GetMemberAvailabilityPayload {
  const members = rows.map((row) => presentMemberAvailability(row, month));
  members.sort((a, b) => (a.name ?? a.alias ?? "").localeCompare(b.name ?? b.alias ?? "", "es"));
  return { month, members };
}

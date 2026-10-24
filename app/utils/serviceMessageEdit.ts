// Request parsing for the three EDIT writers of a service's messages (ADR-0065,
// amended 2026-10-24): the pastor's message, the setlist's «Mensaje para el
// equipo» and an admin's own message in the service thread.
//
// Pure: no client, no I/O. Each parser answers the same shape the proposal
// message parser does — `{ ok: true, value }` or `{ ok: false, issues }` — so the
// routes refuse with `invalid_request` and the issue list, never a coerced value.
//
// An EMPTY text is legal on the two field writers and means "remove it": that is
// how an admin clears a pastor's message or a team note. It is not legal on a
// chat message (deleting one is its own DELETE), exactly as posting one refuses it.

import { PROPOSAL_NOTES_MAX } from "./proposalNotesLimit";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: string[] };

function record(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/** Trimmed text, `""` allowed; null when not a string or over the shared cap. */
function fieldText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > PROPOSAL_NOTES_MAX ? null : text;
}

function optionalStamp(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value === "string" && value) return { ok: true, value };
  return { ok: false };
}

/**
 * `PUT …/pastor-message` — `{ body, observed }`. `observed` is the stamp of the
 * pastor's message the admin was looking at (`edited_at ?? at`), or `null` when
 * there was none: the route refuses with 409 when the stored one differs, so two
 * admins editing at once never silently overwrite each other.
 */
export function parsePastorMessageEdit(
  raw: unknown,
): ParseResult<{ body: string; observed: string | null }> {
  const r = record(raw);
  if (!r) return { ok: false, issues: ["body"] };
  const issues: string[] = [];
  const body = fieldText(r.body);
  if (body === null) issues.push("body");
  const observed = optionalStamp(r.observed);
  if (!observed.ok) issues.push("observed");
  if (issues.length || body === null || !observed.ok) return { ok: false, issues };
  return { ok: true, value: { body, observed: observed.value } };
}

/**
 * `PUT …/team-notes` — `{ teamNotes, observed: { id, rev } }`. `observed` is the
 * setlist target the admin loaded (the weekend setlist document, or a special's
 * role): its `_rev` is asserted by the write, the same rule every setlist writer
 * follows.
 */
export function parseTeamNotesEdit(
  raw: unknown,
): ParseResult<{ teamNotes: string; observed: { id: string; rev: string } }> {
  const r = record(raw);
  if (!r) return { ok: false, issues: ["teamNotes"] };
  const issues: string[] = [];
  const teamNotes = fieldText(r.teamNotes);
  if (teamNotes === null) issues.push("teamNotes");
  const o = record(r.observed);
  const id = typeof o?.id === "string" && o.id ? o.id : null;
  const rev = typeof o?.rev === "string" && o.rev ? o.rev : null;
  if (!id || !rev) issues.push("observed");
  if (issues.length || teamNotes === null || !id || !rev) return { ok: false, issues };
  return { ok: true, value: { teamNotes, observed: { id, rev } } };
}

/** `PATCH …/messages/[key]` — `{ body }`, non-empty, like a new message. */
export function parseMessageEdit(raw: unknown): ParseResult<{ body: string }> {
  const body = fieldText(record(raw)?.body);
  if (!body) return { ok: false, issues: ["body"] };
  return { ok: true, value: { body } };
}

/** A message `_key` as minted by `nextKey()`: short, no path syntax. */
export function isMessageKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/** The stamp a client observes for a pastor's message: last edit, else first set. */
export function pastorMessageStamp(
  m: { at?: string | null; edited_at?: string | null } | null | undefined,
): string | null {
  return m?.edited_at || m?.at || null;
}

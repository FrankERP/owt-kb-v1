// Pure read model for the private lead ↔ admin thread on a `setlistProposal`
// (Release 2 §8): rendering order, and the one predicate that decides whether
// the conversation still accepts posts.
//
// Pure like `proposalMessageWrite`: no Sanity client, no React, no framework
// types. Both the UI and the write routes call the same predicate — a hidden
// composer is not a guard.

import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import { isValidServiceDate } from "@/app/utils/serviceReadModel";

/** The minimum a stored message must look like to be ordered. */
export interface ThreadMessage {
  at?: string | null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

/**
 * Messages oldest-first.
 *
 * The array is strictly append-only with a server-minted `at`, so stored order
 * IS chronological and this is normally the identity. It exists to be honest
 * about the two cases where it is not: the migration writes its (at most two)
 * messages ordered by a RESOLVED timestamp that may predate a later append, and
 * two concurrent unconditioned appends land in a server-decided order rather
 * than a clock order.
 *
 * `at` is compared as an INSTANT (`Date.parse`), not as a string: it is a full
 * ISO datetime that may carry an offset, so a lexicographic compare would order
 * `…T10:00:00-06:00` against `…T11:00:00Z` wrongly. This is not the calendar-day
 * rule CLAUDE.md pins to local noon — that one is `isThreadOpen` below, and it
 * never parses a datetime.
 *
 * A message with an unparseable or missing `at` is PINNED at its stored index
 * and the datable ones are sorted into the slots that remain. This is done by
 * partition rather than by one comparator, because a comparator that returns
 * stored order whenever either side is NaN is not a valid ordering: with
 * `A(t=10,i=0)`, `B(NaN,i=1)`, `C(t=5,i=2)` it says A<B and B<C but A>C, and V8
 * then scrambles the DATABLE entries too — a 40-message thread with a few
 * broken timestamps came back newest-first with the broken ones flung to the
 * tail, which is the exact opposite of what this function promises. Partition
 * is a total order and makes the paragraph above literally true.
 *
 * Non-object entries ARE dropped: there is nothing to render.
 */
export function orderedMessages<T extends ThreadMessage>(
  messages: readonly T[] | null | undefined,
): T[] {
  if (!Array.isArray(messages)) return [];
  const entries = messages
    .filter((m): m is T => isObj(m))
    .map((message, index) => ({ message, index, at: Date.parse(message.at ?? "") }));

  const datable = entries.filter((e) => !Number.isNaN(e.at));
  // The positions the datable messages occupy: they get reshuffled among these
  // and nowhere else, so an undatable neighbour never moves.
  const slots = datable.map((e) => e.index);
  datable.sort((a, b) => a.at - b.at || a.index - b.index);

  const out = entries.slice();
  datable.forEach((entry, i) => {
    out[slots[i]] = entry;
  });
  return out.map((entry) => entry.message);
}

/**
 * Is the conversation still open for posts?
 *
 * The gate is the SERVICE DATE, not the review status: the thread stays open
 * while the set has not yet happened, whatever its status. Gating on `approved`
 * would ship a chat that is read-only on almost every real proposal — an admin
 * could not ask about a published setlist without reopening it, which is not a
 * conversation.
 *
 * The comparison is a CALENDAR-DAY string compare in America/Mexico_City
 * (`serviceTodayIso()` for "today"), never `new Date(iso)` and never elapsed
 * hours — CLAUDE.md's timezone invariant. For the `YYYY-MM-DD` service dates
 * this field actually holds it is deliberately the negation of
 * `outboxClassify.ts`'s `isPast(serviceDate, today) => serviceDate < today`,
 * (this one additionally fails CLOSED on an unusable date, where `isPast`
 * returns false and would read as open — that branch, not datetime handling, is
 * where the two differ, and the difference favours refusing the write),
 * so the UI, the write routes and the notification layer all agree on what
 * "past" means instead of each deciding for itself.
 *
 * Fails CLOSED on an unusable service date. A date we cannot read is an
 * integrity problem, and this predicate authorizes a write — refusing the post
 * is recoverable, accepting it against an unknown date is not.
 */
export function isThreadOpen(input: {
  serviceDate: unknown;
  /** "Today" in America/Mexico_City; defaults to the server/browser clock. */
  today?: string;
}): boolean {
  const day = typeof input.serviceDate === "string" ? input.serviceDate.slice(0, 10) : "";
  if (!isValidServiceDate(day)) return false;
  const today = input.today ?? serviceTodayIso();
  if (!isValidServiceDate(today)) return false;
  return day >= today;
}

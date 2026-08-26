// The thread as the SURFACES read it: messages with their author's name already
// resolved (Child A §5, §6).
//
// `PROPOSAL_PROJECTION` deliberately keeps `"author": author._ref` — it backs the
// write paths, which compare and store references, not names. The surfaces need
// something else: a bubble is attributed to a person, and re-rendering a whole
// thread as unattributed the moment someone posts would undo the one thing this
// feature is for. So the read sites and the two message routes' responses share
// THIS projection instead.
//
// A leaf on purpose: no client, no React. `outboxSweep`'s sibling
// (`proposalNotifyQueries.ts`) exists for the same reason and the same lesson —
// a query string that lives inside a `server-only` module cannot be executed by
// a test, so it gets guarded by a hand-written fixture that nothing compares
// against it.

/**
 * One message, with the author's display name joined at read time.
 *
 * `author_role` is NOT joined — it is the snapshot taken when the message was
 * posted (§3), and joining the person's current role instead would re-render an
 * ex-admin's change request as a lead note.
 *
 * `author_name` is null when the message carries no `author` reference. Two
 * production `admin_notes` have nobody to attribute them to, so this is a real
 * state and not a defect; §7 renders it from the ROLE, never from the missing
 * name.
 */
export const THREAD_MESSAGES = `messages[]{
    _key, _type, author_role, kind, body, at,
    "author": author._ref,
    "author_name": coalesce(author->alias, author->member_name)
  }`;

/** The shape `THREAD_MESSAGES` projects. Every field optional: this is read from
 *  stored data that predates the field, and one message legitimately has no author. */
export interface ThreadMessageRow {
  _key?: string;
  _type?: string;
  author?: string | null;
  author_name?: string | null;
  author_role?: string;
  kind?: string;
  body?: string;
  at?: string;
}

/**
 * Read one proposal's thread back after an append, for the route's response.
 *
 * The routes return the FULL array rather than just the appended message: the
 * lead surface has no other path to its own message (§5 forbids an optimistic
 * append, and `setRev` + `router.refresh()` was rejected), so the response is
 * what the surface re-renders from.
 *
 * `messages` is absent on a document nothing has ever appended to, and GROQ
 * returns `null` rather than `[]` for that — coerced here so no caller has to
 * remember.
 */
export const THREAD_AFTER_APPEND_QUERY = `*[_type == "setlistProposal" && _id == $id][0]{
  _id, _rev,
  "messages": ${THREAD_MESSAGES}
}`;

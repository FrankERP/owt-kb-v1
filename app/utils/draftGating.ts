/**
 * Draft-gating for weekend setlists.
 *
 * The draft/publish `published` flag lives on the ROLE doc (sunday_role /
 * saturday_role / special_role), NOT on the setlist doc (featuredSongs /
 * saturdarSongs). Member-facing role queries already filter `published != false`,
 * so a null role here means "no published role for this service". A setlist must
 * only be surfaced to members when its role is published — otherwise a draft
 * service leaks its song list (titles/keys/authors) before an admin publishes it.
 *
 * Pass the (already `published != false`-filtered) role and the raw setlist;
 * returns the setlist only when the role is present, else null.
 */
export function publishedSetlist<T>(role: unknown | null | undefined, setlist: T | null | undefined): T | null {
  return role ? (setlist ?? null) : null;
}

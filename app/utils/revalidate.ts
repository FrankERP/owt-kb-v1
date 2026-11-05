import { revalidatePath } from "next/cache";

// The home, schedule and song pages are statically rendered (ISR), so admin
// mutations must explicitly invalidate them or edits won't show until the cache
// expires. Call these from mutation route handlers after a successful write.

// Setlist / team / service changes → home DayCards, schedule, song play-history.
export function revalidateServiceViews() {
  revalidatePath("/");
  revalidatePath("/schedule");
  revalidatePath("/posts/[slug]", "page");
}

// Kids pair / schedule / availability changes → the member view, the planner,
// `/me` (which carries the member's own upcoming kids assignments) and the
// Calendario (which shows Kids Sundays to a member of both ministries).
export function revalidateKidsViews() {
  revalidatePath("/kids");
  revalidatePath("/kids/admin");
  revalidatePath("/me");
  revalidatePath("/schedule");
}

// A ministry's meetings changed (ADR-0081 W7) → its pages and the Calendario. Those pages read
// the session and are dynamic today; the call keeps a later static page from going stale silently.
// Only Jóvenes has meetings; another leveled ministry's pages follow the same `/<id>` shape.
export function revalidateMinistryViews(ministry: string) {
  revalidatePath(`/${ministry}`);
  revalidatePath(`/${ministry}/admin`);
  revalidatePath("/schedule");
}

// Song content changes → home song list, song pages, the library index.
// R1 turns `/tag*` and `/author*` into redirects into `/biblioteca`; a redirect
// holds no cache of its own to invalidate.
export function revalidateSongViews() {
  revalidatePath("/");
  revalidatePath("/posts/[slug]", "page");
  revalidatePath("/biblioteca");
}

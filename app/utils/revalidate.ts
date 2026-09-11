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
// and `/me` (which carries the member's own upcoming kids assignments).
export function revalidateKidsViews() {
  revalidatePath("/kids");
  revalidatePath("/kids/admin");
  revalidatePath("/me");
}

// Song content changes → home song list, song pages, the library index.
// R1 turns `/tag*` and `/author*` into redirects into `/biblioteca`; a redirect
// holds no cache of its own to invalidate.
export function revalidateSongViews() {
  revalidatePath("/");
  revalidatePath("/posts/[slug]", "page");
  revalidatePath("/biblioteca");
}

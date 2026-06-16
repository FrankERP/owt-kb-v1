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

// Song content changes → home song list, song pages, tag listings.
export function revalidateSongViews() {
  revalidatePath("/");
  revalidatePath("/posts/[slug]", "page");
  revalidatePath("/tag");
  revalidatePath("/tag/[slug]", "page");
}

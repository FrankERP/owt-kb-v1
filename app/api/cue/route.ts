import { NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";
import { operationalClient } from "@/sanity/lib/operationalClient";
import { pickCue, type Cue } from "@/app/utils/cue";

// The navbar cue strip's one read: the member's next service, whichever ministry
// it belongs to. Fetched client-side by `CueStrip` after paint, exactly like the
// notification badge, so `Navbar` stays a plain synchronous component and every
// page that renders it can still be statically/ISR rendered.

/**
 * The next worship service, as the min of the three role types.
 *
 * One round trip, three ordered `[0]`s — GROQ has no cross-type min, and the
 * three types keep their date under different field names (`week` vs `date`).
 * `published != false` is the worship draft-gating rule: these types predate the
 * field, so an ABSENT `published` must read as visible.
 */
const WORSHIP_NEXT_QUERY = `{
    "sunday":   *[_type == "sunday_role"   && week >= $today && published != false] | order(week asc)[0].week,
    "saturday": *[_type == "saturday_role" && week >= $today && published != false] | order(week asc)[0].week,
    "special":  *[_type == "special_role"  && date >= $today && published != false] | order(date asc)[0].date
  }`;

/**
 * The next Oasis Kids Sunday. The STRICTER spelling, and the difference from the
 * query above is deliberate rather than a typo: a `kidsSchedule` is minted with
 * `published` by its own writer, so a field-less document is a bug and
 * `!= false` would wave exactly that bug onto every kids volunteer's navbar.
 */
const KIDS_NEXT_QUERY = `*[_type == "kidsSchedule" && published == true && date >= $today] | order(date asc)[0].date`;

type WorshipNext = { sunday?: string | null; saturday?: string | null; special?: string | null };

export async function GET() {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Ministry membership decides which halves are QUERIED at all, the way `/me`
  // resolves them — a kids-only volunteer must not even ask about worship, and a
  // worship member must not learn that a kids Sunday exists.
  const { ministries } = await getMemberAccess(session.user.sanityId);
  const inWorship = ministries.includes("worship");
  const inKids = ministries.includes("kids");

  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });

  const [worship, kidsNext] = await Promise.all([
    inWorship ? operationalClient.fetch<WorshipNext | null>(WORSHIP_NEXT_QUERY, { today }) : null,
    inKids ? operationalClient.fetch<string | null>(KIDS_NEXT_QUERY, { today }) : null,
  ]);

  const worshipNext =
    [worship?.sunday, worship?.saturday, worship?.special]
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;

  const cue: Cue | null = pickCue(worshipNext, kidsNext ?? null);

  // Private and short: it is one member's own next service, and it changes at
  // most once a day — the strip's own sessionStorage cache uses the same 60 s.
  return NextResponse.json({ cue }, { headers: { "Cache-Control": "private, max-age=60" } });
}

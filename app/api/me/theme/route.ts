import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";
import { isThemePref, VALID_THEMES, type ThemePref } from "@/app/utils/themePref";

/**
 * A member writes their own theme preference.
 *
 * Shaped after `app/api/me/notif-prefs/route.ts` — the repo's only other
 * member-writes-own-preference route — for its 401 / 400 / self-id-from-session
 * structure. (D7's named precedent is a different thing: the TextSizeControl /
 * textZoom / TextScaleBootstrap *plumbing*, followed elsewhere in Child E.)
 *
 * No `revalidate*` call, and that is deliberate. CLAUDE.md's cache invariant
 * covers routes that mutate CONTENT; `themePref` is per-member chrome that no ISR
 * page renders — `/me` carries `revalidate = 60` but the control initialises from
 * ThemeBootstrap's client-side fetch, not from the server-rendered page. Calling
 * revalidateServiceViews() here would invalidate the whole schedule for a colour.
 * Stated rather than omitted, because "a mutating route with no revalidate" is
 * exactly the shape that invariant exists to catch.
 */
export async function PATCH(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // DELIBERATELY STRICTER THAN `PATCH /api/me`, which happily writes alias and
  // email to the impersonated member's record. This is not an inconsistency to
  // harmonise: impersonation rewrites `session.user.sanityId` to the target
  // (auth.ts:182), so without this a super-admin toggling the theme while
  // impersonating would persist it to SOMEONE ELSE's document from a UI action
  // that looks entirely local. A name correction is plausibly something an admin
  // makes on a member's behalf; their theme is not.
  if (session.user.isImpersonating) {
    return NextResponse.json(
      { error: "No theme writes while impersonating" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null) as { theme?: unknown } | null;
  const theme: unknown = body?.theme;

  // The literal set is the ONLY validation — `themePref` is a bare string in the
  // schema. "system" joined that set at Child F, together with the `enableSystem`
  // flip that makes it resolvable; before F it would have left a class-less
  // document. The message is DERIVED from the set rather than written out, so a
  // future change cannot leave the 400 body describing a different contract.
  if (!isThemePref(theme)) {
    return NextResponse.json(
      { error: `theme must be one of: ${VALID_THEMES.join(", ")}` },
      { status: 400 },
    );
  }

  // Self-write only: the id comes from the session, never from the body, so no
  // member can address another member's record by crafting a request.
  await writeClient
    .patch(session.user.sanityId)
    .set({ themePref: theme satisfies ThemePref })
    .commit();

  return NextResponse.json({ themePref: theme });
}

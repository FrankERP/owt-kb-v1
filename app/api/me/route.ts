import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";
import { patchOwnProfile } from "@/app/utils/memberCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

export async function GET() {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await serverClient.fetch(
    `*[_type == "teamMembers" && _id == $id][0] {
      _id, member_name, alias, email, role, memberType,
      "photoUrl": coalesce(profilePhoto.asset->url, googlePhotoUrl),
      "hasPassword": defined(passwordHash) && passwordHash != "",
      // ADDITIVE. Do not narrow this projection to just themePref for the sake of
      // ThemeBootstrap's per-load cost: nothing in app/ GETs this route today, so
      // no test and no gate would catch the eight fields above going missing.
      // If the cost ever matters, add a separate narrow reader.
      themePref
    }`,
    { id: session.user.sanityId }
  );

  return NextResponse.json(member);
}

export const PATCH = withVerificationRunContext(patchHandler);

/**
 * A member's own alias and email. Everything after the session check is `patchOwnProfile`
 * (`app/utils/memberCommit.ts`): the same checks as /admin's edit (D5 a repeated email, D12 a repeated
 * alias, D6 the member's solver rules follow a new alias), with refusals that never name anyone else.
 */
async function patchHandler(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const outcome = await patchOwnProfile(session.user.sanityId, await req.json());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

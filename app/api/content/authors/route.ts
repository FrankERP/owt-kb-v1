import { NextRequest, NextResponse } from "next/server";
import { requireActiveManager } from "@/app/utils/authGuards";
import { serverClient } from "@/sanity/lib/serverClient";
import { ensureAuthors } from "@/app/utils/songSaveCommit";
import { withVerificationRunContext } from "@/app/utils/srVerificationRunContext";

export async function GET() {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authors = await serverClient.fetch(
    `*[_type == "author"] | order(name asc) { _id, name, slug }`
  );
  return NextResponse.json(authors);
}

// Wrapped because the module it calls is a `*Commit` (`srVerificationRunContext.test.ts` scans by
// import); creating an author sends nothing, and an unmarked request behaves as before.
export const POST = withVerificationRunContext(postHandler);

/** Create an author, or return the one with the same slug: `ensureAuthors` (`songSaveCommit.ts`). */
async function postHandler(req: NextRequest) {
  if (!await requireActiveManager()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const outcome = await ensureAuthors(await req.json());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

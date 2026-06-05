import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient } from "@/sanity/lib/serverClient";

// Notification badge count for the current user. Fetched client-side by NavMenu
// after paint so it never blocks page rendering / static caching.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.sanityId) {
    return NextResponse.json({ count: 0 });
  }

  const role = session.user.role as string | undefined;
  const isAdmin = role === "super-admin" || role === "admin";
  const isLead = role === "member" || role === "content-editor" || isAdmin;

  let count = 0;
  if (isAdmin) {
    count = await serverClient.fetch<number>(
      `count(*[_type == "setlistProposal" && status == "pending"])`,
      {}
    );
  } else if (isLead) {
    count = await serverClient.fetch<number>(
      `count(*[_type == "setlistProposal" && lead._ref == $id && status == "changes_requested"])`,
      { id: session.user.sanityId }
    );
  }

  return NextResponse.json({ count });
}

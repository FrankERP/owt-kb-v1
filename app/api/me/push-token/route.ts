import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/app/utils/authGuards";
import { writeClient } from "@/sanity/lib/serverClient";

// FCM/APNs device tokens are opaque strings of alphanumerics plus a few
// separators. Reject anything else so user input can never break out of the
// interpolated GROQ filter path below (query-injection guard).
const TOKEN_RE = /^[A-Za-z0-9_:.-]{1,4096}$/;

export async function POST(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { token, platform } = (await req.json()) as { token?: string; platform?: string };
  if (!token || !TOKEN_RE.test(token)) return NextResponse.json({ error: "token required" }, { status: 400 });

  const id = session.user.sanityId;
  // Remove any existing copy, then append fresh (dedupe + refresh updatedAt).
  await writeClient.patch(id).unset([`deviceTokens[token == "${token}"]`]).commit().catch(() => {});
  await writeClient
    .patch(id)
    .setIfMissing({ deviceTokens: [] })
    .append("deviceTokens", [{ token, platform: platform ?? "ios", updatedAt: new Date().toISOString() }])
    .commit();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await requireActiveSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { token } = (await req.json()) as { token?: string };
  if (!token || !TOKEN_RE.test(token)) return NextResponse.json({ error: "token required" }, { status: 400 });
  await writeClient.patch(session.user.sanityId).unset([`deviceTokens[token == "${token}"]`]).commit().catch(() => {});
  return NextResponse.json({ ok: true });
}

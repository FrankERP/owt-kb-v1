import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient } from "@/sanity/lib/serverClient";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const role = session?.user.role;
  if (role !== "super-admin" && role !== "admin") return null;
  return session;
}

export async function GET() {
  if (!await requireAdmin()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [members, events] = await Promise.all([
    serverClient.fetch<Array<{ _id: string; member_name: string; alias?: string; lastSeen?: string }>>(
      `*[_type == "teamMembers"] | order(member_name asc) { _id, member_name, alias, lastSeen }`
    ),
    serverClient.fetch<Array<{ _id: string; memberId: string; email: string; provider: string; timestamp: string }>>(
      `*[_type == "loginEvent"] | order(timestamp desc) {
        _id,
        "memberId": member._ref,
        email,
        provider,
        timestamp
      }`
    ),
  ]);

  const byMember = new Map<string, typeof events>();
  for (const e of events) {
    if (!byMember.has(e.memberId)) byMember.set(e.memberId, []);
    byMember.get(e.memberId)!.push(e);
  }

  const result = members
    .map((m) => {
      const memberEvents = byMember.get(m._id) ?? [];
      const lastLogin    = memberEvents[0]?.timestamp ?? null;
      // lastActive is whichever is more recent: a page visit (lastSeen) or an explicit login
      const lastActive   = [m.lastSeen ?? null, lastLogin]
        .filter(Boolean)
        .sort()
        .pop() ?? null;
      const providers    = [...new Set(memberEvents.map((e) => e.provider))];
      return {
        _id:         m._id,
        member_name: m.member_name,
        alias:       m.alias,
        lastSeen:    m.lastSeen ?? null,
        lastLogin,
        lastActive,
        loginCount:  memberEvents.length,
        providers,
        events:      memberEvents.slice(0, 20),
      };
    })
    .sort((a, b) => {
      if (!a.lastActive && !b.lastActive) return 0;
      if (!a.lastActive) return 1;
      if (!b.lastActive) return -1;
      return new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime();
    });

  return NextResponse.json(result);
}

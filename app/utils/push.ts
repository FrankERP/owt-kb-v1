import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { getMessaging } from "./firebaseAdmin";

export type NotifCategory = "assignments" | "setlist" | "proposals" | "reminders";
export type PushPayload = { title: string; body: string; path: string };

type MemberRow = {
  _id: string;
  deviceTokens?: { token: string }[];
  notifPrefs?: Record<string, unknown>;
};

const PRUNE_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-argument",
]);

function optedIn(prefs: Record<string, unknown> | undefined, category: NotifCategory): boolean {
  const p = prefs ?? {};
  if (category === "setlist") return (p.setlist ?? "all") !== "off"; // scope resolved by caller
  return (p[category] ?? true) !== false;
}

/**
 * Send a push to the given members for a category. Filters by preference, sends via
 * FCM, and self-heals: removes any token FCM reports as dead. Never throws.
 */
export async function sendPush(
  memberIds: string[],
  category: NotifCategory,
  payload: PushPayload
): Promise<{ sent: number; pruned: number }> {
  try {
    if (memberIds.length === 0) return { sent: 0, pruned: 0 };
    const members = await serverClient.fetch<MemberRow[]>(
      `*[_type == "teamMembers" && _id in $ids]{ _id, deviceTokens, notifPrefs }`,
      { ids: memberIds }
    );

    const tokenOwner = new Map<string, string>();
    const tokens: string[] = [];
    for (const m of members) {
      if (!optedIn(m.notifPrefs, category)) continue;
      for (const dt of m.deviceTokens ?? []) {
        if (dt.token) {
          tokens.push(dt.token);
          tokenOwner.set(dt.token, m._id);
        }
      }
    }
    if (tokens.length === 0) return { sent: 0, pruned: 0 };

    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: { path: payload.path },
    });

    let sent = 0;
    const dead: { token: string; member: string }[] = [];
    res.responses.forEach((r, i) => {
      if (r.success) {
        sent++;
        return;
      }
      const code = (r.error as { code?: string } | undefined)?.code;
      if (code && PRUNE_CODES.has(code)) {
        dead.push({ token: tokens[i], member: tokenOwner.get(tokens[i])! });
      }
    });

    for (const d of dead) {
      try {
        await writeClient
          .patch(d.member)
          .unset([`deviceTokens[token == "${d.token}"]`])
          .commit();
      } catch {
        // Best-effort prune; ignore individual commit failures
      }
    }
    return { sent, pruned: dead.length };
  } catch (err) {
    console.error("[push] sendPush failed:", err);
    return { sent: 0, pruned: 0 };
  }
}

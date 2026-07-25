import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import { getMessaging } from "./firebaseAdmin";
import { blockDelivery, recordDeliveryAttempt } from "./deliveryFirewall";

export type NotifCategory = "assignments" | "setlist" | "proposals" | "reminders";
export type PushPayload = { title: string; body: string; path: string };

type MemberRow = {
  _id: string;
  deviceTokens?: { token: string }[];
  notifPrefs?: Record<string, unknown>;
};

// NOTE: `invalid-argument` can also indicate a malformed *payload* (not just a bad
// token); since we send a fixed, tested payload shape, in practice it only fires for
// bad tokens. If payload structure changes, re-evaluate to avoid over-pruning.
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
    // A3 §3 outbound-delivery firewall. Gated on the MEMBER count, before the
    // token read, so evidence is emitted even when the fixtures happen to carry no
    // device tokens — "no tokens in the dataset" is exactly the fixture-absence
    // non-proof the plan rejects. The count is non-PII; no id is ever emitted.
    if (blockDelivery({ channel: "fcm", recipientCount: memberIds.length })) {
      return { sent: 0, pruned: 0 };
    }
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

    recordDeliveryAttempt({ channel: "fcm", recipientCount: tokens.length });
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

    // Dead-token pruning is its own gated channel (A3 §3 names it explicitly).
    // Unreachable while the firewall is closed — the `fcm` gate above already
    // returned — but gated on its own axis so a future caller that reaches the
    // prune without passing that gate still cannot write.
    if (dead.length && blockDelivery({ channel: "prune", recipientCount: dead.length })) {
      return { sent, pruned: 0 };
    }
    for (const d of dead) {
      try {
        // FCM tokens are opaque URL-safe strings (no quotes), so interpolating into the
        // GROQ filter here is safe; they originate only from our own token API.
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

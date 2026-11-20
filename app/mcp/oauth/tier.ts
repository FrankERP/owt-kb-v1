// MCP OAuth core — who may connect an agent, and what their connection reaches
// (ADR-0083). Pure: it reads a `MemberAccess` snapshot and nothing else.
//
// The tier is NEVER stored — not in a grant, a code or a token. Every gate
// (the consent page, the code-minting POST, both token grants and `/api/mcp`)
// derives it from the member's LIVE access (`getMemberAccess`, 30 s cache), so
// a promotion or demotion bites within 30 s and old grants keep working.
//
//   "full"  — a super-admin: every tool (the app-only card tools only on a
//             claude.ai grant, `toolList.ts`)
//   "admin" — an admin of worship: `ADMIN_TIER_TOOLS`, everything an admin does
//             in `/admin` except people and Oasis Kids (ADR-0083 addendum);
//             `READ_TIER_TOOLS` only on a grant approved before
//             `ADMIN_WRITES_CUTOFF` (`grantDocument.ts`)
//   null    — everyone else (content-editor, member, an admin outside worship,
//            a disabled or missing member): refused

import type { MemberAccess } from "@/app/utils/memberAccess";

export type McpTier = "full" | "admin";

/** Only the fields the tier reads, so a caller can pass any snapshot that has them. */
export type TierAccess = Pick<MemberAccess, "active" | "role" | "ministries">;

/**
 * The connection tier of a member, from their live access. The "admin" audience
 * is the same as the in-app assistant's (`canUseAdminChat`, ADR-0060) for an
 * active member; a test pins the two together. They stay separate functions
 * because they gate different features.
 */
export function mcpTierOf(access: TierAccess): McpTier | null {
  if (!access.active) return null;
  if (access.role === "super-admin") return "full";
  if (access.role === "admin" && access.ministries.includes("worship")) return "admin";
  return null;
}

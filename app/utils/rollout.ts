// THE rollout registry: how far a feature that is built but not yet for everyone has reached
// (ADR-0081; plan `docs/superpowers/plans/2026-10-30-jovenes-events-access.md` §7, G6). One entry
// per feature, keyed by a FEATURE name (never a Sanity type name, so this file stays outside the
// type's coverage guard). Moving a stage is a one-line PR through the release order, like any code.
//
// The stages widen in order:
//   hidden     — nobody; the pages answer 404, the routes refuse, the nav shows nothing.
//   superAdmin — the super-admin only.
//   admins     — plus the ministry's admins (in Jóvenes, the `admin` level).
//   all        — everyone the page's own guard lets in.
//
// `rolloutAllows` is the SERVER decision every page and route of the feature calls, on the same
// access snapshot as its guard. `navRolloutAllows` is the nav's COSMETIC copy over the session,
// which carries no ministry level: at `admins` the nav shows the feature to the super-admin only,
// and a ministry admin opens it by its address. Neutral module (no "use client", no server-only):
// the nav imports it.

import type { MinistryId } from "@/app/ministries";
import type { MemberAccess } from "./memberAccess";
import { isMinistryManager } from "./ministryAccess";

export const ROLLOUT_STAGES = ["hidden", "superAdmin", "admins", "all"] as const;
export type RolloutStage = (typeof ROLLOUT_STAGES)[number];

type Feature = { ministry: MinistryId; stage: RolloutStage };

// Typed as the wide stage on purpose: a literal type would make each later stage's code
// unreachable to the compiler, and moving a stage would then turn into a type error.
export const ROLLOUT: Record<"jovenesEvents", Feature> = {
  // Jóvenes' meetings: `/jovenes`, Planear Jóvenes and its write routes. Open to every pastor since
  // 2026-11-12 (Frank's call, once the accounts, per-group leadership and the card design were in
  // production). Each page's and route's own guard still decides who gets in.
  jovenesEvents: { ministry: "jovenes", stage: "all" },
};

export type RolloutFeature = keyof typeof ROLLOUT;

type Access = Pick<MemberAccess, "active" | "role" | "ministries" | "managesMinistries" | "ministryRoles">;

/** One stage judged for one person. Pure; exported so the test walks every stage. */
export function stageAllows(stage: RolloutStage, ministry: MinistryId, access: Access): boolean {
  if (stage === "hidden" || !access.active) return false;
  if (access.role === "super-admin") return true;
  if (stage === "superAdmin") return false;
  if (stage === "admins") return isMinistryManager(access, ministry);
  return true;
}

/** The server gate, on the same access snapshot as the page's or route's own guard. */
export function rolloutAllows(feature: RolloutFeature, access: Access): boolean {
  const { stage, ministry } = ROLLOUT[feature];
  return stageAllows(stage, ministry, access);
}

/** The nav's cosmetic copy: no level in the session, so `admins` reads as the super-admin only. */
export function navRolloutAllows(feature: RolloutFeature, isSuper: boolean): boolean {
  const { stage } = ROLLOUT[feature];
  if (stage === "hidden") return false;
  if (stage === "all") return true;
  return isSuper;
}

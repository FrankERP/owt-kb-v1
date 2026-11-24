// Native-app sign-in — the `needs` lattice (ADR-0091, spec D8). Every
// `/api/app/v1/*` handler declares one level; there is NO default (a
// ministry-agnostic default would break two-way ministry isolation). Each level
// is the SAME pure predicate the cookie side uses, on the LIVE access snapshot.
// A level is an ENTRY gate only: what the person may then do is decided by the
// same reads and `*Commit.ts` writers the web uses.

import type { MemberAccess } from "@/app/utils/memberAccess";
import { isMinistryManager, isMinistryMember, plansInMinistry } from "@/app/utils/ministryAccess";
import type { MinistryId } from "@/app/ministries";
import { MANAGER_ROLES } from "@/app/utils/managerRoles";


export type AppNeeds =
  /** Active; the handler reads or writes ONLY the caller's own record. */
  | "self"
  | { ministry: MinistryId; as: "member" }
  /** Jóvenes: a manager OR a leader of at least one group; the handler narrows non-managers to `ledGroupsIn`. */
  | { ministry: "jovenes"; as: "planner" }
  | { ministry: MinistryId; as: "manager" }
  /** role ∈ {super-admin, admin, content-editor}, read from LIVE access. */
  | "manager"
  | "super-admin";

type Access = Pick<MemberAccess, "active" | "role" | "ministries" | "managesMinistries" | "ministryRoles">;

/** Whether a live, ACTIVE access snapshot meets `needs`. Inactive never passes. */
export function meetsNeeds(access: Access, needs: AppNeeds): boolean {
  if (!access.active) return false;
  if (needs === "self") return true;
  if (needs === "manager") return access.role !== null && MANAGER_ROLES.includes(access.role);
  if (needs === "super-admin") return access.role === "super-admin";
  switch (needs.as) {
    case "member":
      return isMinistryMember(access, needs.ministry);
    case "planner":
      return plansInMinistry(access, needs.ministry);
    case "manager":
      return isMinistryManager(access, needs.ministry);
  }
}

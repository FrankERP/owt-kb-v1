import { defineType } from "sanity";

/**
 * Internal weekend target lock (Service Readiness A2 §1).
 *
 * One document per weekend service target, at a deterministic id
 * (`roleTarget.<sunday_role|saturday_role>.<YYYY-MM-DD>`), so every writer that
 * touches that target serializes on the same document inside its business
 * transaction. Special services are their own target and are serialized by their
 * own role revision — they never get a lock.
 *
 * NOT editable content: no operator ever authors this by hand. It is hidden and
 * read-only in the Studio; `__experimental_actions` is deliberately absent
 * (removed in Sanity v5, inert dead config). Full Studio protection — removing
 * create/mutate affordances even by direct URL — lands with plan §8.
 *
 * `roleId` is a PLAIN STRING, never a strong reference: deleting a role must not
 * cascade into the lock, and a lock must never keep a deleted role alive.
 *
 * Derivation, invariants, and patch shapes live in `app/utils/roleTargetLock.ts`.
 */
export const roleTargetLock = defineType({
  name: "roleTargetLock",
  title: "Role Target Lock (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description:
    "Interno: coordina escrituras sobre un servicio de fin de semana. No editar a mano.",
  fields: [
    {
      name: "targetKey",
      title: "Target key",
      type: "string",
      description: "sunday_role:<YYYY-MM-DD> | saturday_role:<YYYY-MM-DD>",
    },
    {
      name: "state",
      title: "State",
      type: "string",
      options: {
        list: [
          { title: "Claimed", value: "claimed" },
          { title: "Vacant", value: "vacant" },
        ],
      },
    },
    {
      name: "roleId",
      title: "Owning role id",
      type: "string",
      description:
        "Plain string, never a reference — deletion vacates the lock instead of cascading. Absent while vacant.",
    },
    {
      name: "roleType",
      title: "Role type",
      type: "string",
      options: {
        list: [
          { title: "Sunday", value: "sunday_role" },
          { title: "Saturday", value: "saturday_role" },
        ],
      },
    },
    { name: "date", title: "Service date", type: "date" },
    {
      name: "claimNonce",
      title: "Claim nonce",
      type: "string",
      description: "Identifies the individual claim. Absent while vacant.",
    },
    {
      name: "generation",
      title: "Generation",
      type: "number",
      description: "Advances on every vacate, so a stale claimant is never mistaken for the next one.",
    },
    { name: "createdAt", title: "Created", type: "datetime" },
    { name: "updatedAt", title: "Updated", type: "datetime" },
  ],
  preview: {
    select: { targetKey: "targetKey", state: "state", roleId: "roleId", generation: "generation" },
    prepare(sel: { targetKey?: string; state?: string; roleId?: string; generation?: number }) {
      return {
        title: sel.targetKey ?? "(sin target)",
        subtitle: `${sel.state ?? "?"} · gen ${sel.generation ?? "?"} · ${sel.roleId ?? "—"}`,
      };
    },
  },
});

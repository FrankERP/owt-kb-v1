import { defineType } from "sanity";

/**
 * Internal role-creation receipt (Service Readiness A2 §2).
 *
 * The global create-request mutex for `sunday_role`, `saturday_role`, and
 * `special_role`. Its `_id` is derived from a collision-resistant digest of the
 * exact `creationRequestId` (`roleCreate.<sha256>`), so a replayed request maps
 * to the same document and only one `create()` can win — across every target and
 * role type. The weekend target lock (§1) independently serializes DIFFERENT
 * request ids competing for one weekend target.
 *
 * `requestId` stores the EXACT request id, because a digest alone must never be
 * trusted for equality. `requestId`, `fingerprint`, `roleId`, `roleType`, and
 * `targetIdentity` are immutable after commit; only `state`/`updatedAt` change
 * (to `role_deleted`, in the same transaction that deletes the role). A
 * committed or retired receipt is a durable idempotency tombstone — normal
 * cleanup never deletes one.
 *
 * NOT editable content: hidden and read-only in the Studio.
 * `__experimental_actions` is deliberately absent (removed in Sanity v5, inert
 * dead config). Full Studio protection lands with plan §8.
 *
 * `roleId` is a PLAIN STRING, never a strong reference: the receipt must outlive
 * the role it retired.
 *
 * Canonicalization, fingerprinting, and id derivation live in
 * `app/utils/roleCreationReceipt.ts`.
 */
export const roleCreationReceipt = defineType({
  name: "roleCreationReceipt",
  title: "Role Creation Receipt (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description:
    "Interno: llave de idempotencia para la creación de servicios. No editar ni borrar a mano.",
  fields: [
    {
      name: "requestId",
      title: "Creation request id",
      type: "string",
      description: "The exact client request id. The document _id is a digest of this value.",
    },
    {
      name: "fingerprint",
      title: "Payload fingerprint",
      type: "string",
      description:
        "Digest of the canonicalized create payload. Same id + different fingerprint = idempotency_mismatch.",
    },
    {
      name: "roleId",
      title: "Created role id",
      type: "string",
      description: "Pre-generated role id, created in the same transaction. Plain string, never a reference.",
    },
    {
      name: "roleType",
      title: "Role type",
      type: "string",
      options: {
        list: [
          { title: "Sunday", value: "sunday_role" },
          { title: "Saturday", value: "saturday_role" },
          { title: "Special", value: "special_role" },
        ],
      },
    },
    {
      name: "targetIdentity",
      title: "Initial target identity",
      type: "string",
      description: "sunday_role:<date> | saturday_role:<date> | special_role:<date>:<service name>",
    },
    {
      name: "state",
      title: "State",
      type: "string",
      options: {
        list: [
          { title: "Committed", value: "committed" },
          { title: "Role deleted", value: "role_deleted" },
        ],
      },
    },
    { name: "createdAt", title: "Created", type: "datetime" },
    { name: "updatedAt", title: "Updated", type: "datetime" },
  ],
  preview: {
    select: { targetIdentity: "targetIdentity", state: "state", roleId: "roleId" },
    prepare(sel: { targetIdentity?: string; state?: string; roleId?: string }) {
      return {
        title: sel.targetIdentity ?? "(sin target)",
        subtitle: `${sel.state ?? "?"} · ${sel.roleId ?? "—"}`,
      };
    },
  },
});

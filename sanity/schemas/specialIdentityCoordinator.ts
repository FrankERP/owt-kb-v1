import { defineType } from "sanity";

/**
 * Internal global mutex for special-service date/name identity changes.
 *
 * Runtime writers lazily create the deterministic document and then advance its
 * version/nonce under `_rev` in the same transaction as a special create or
 * identity-changing PATCH. It is never authored or repaired by hand.
 */
export const specialIdentityCoordinator = defineType({
  name: "specialIdentityCoordinator",
  title: "Special Identity Coordinator (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description:
    "Interno: serializa cambios de fecha/nombre de servicios especiales. No editar a mano.",
  fields: [
    {
      name: "version",
      title: "Version",
      type: "number",
      description: "Monotonic claim version; advances on every identity claim.",
    },
    {
      name: "claimNonce",
      title: "Claim nonce",
      type: "string",
      description: "Fresh nonce for the latest identity claim.",
    },
    {
      name: "updatedAt",
      title: "Updated",
      type: "datetime",
    },
  ],
  preview: {
    select: { version: "version", updatedAt: "updatedAt" },
    prepare(sel: { version?: number; updatedAt?: string }) {
      return {
        title: "Coordinador global de servicios especiales",
        subtitle: `v${sel.version ?? "?"} · ${sel.updatedAt ?? "sin fecha"}`,
      };
    },
  },
});

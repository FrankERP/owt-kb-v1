import { defineType } from "sanity";

import { APP_AUTH_GRANT_TYPE, APP_GRANT_FIELD } from "../../app/appAuth/documentTypes";

/**
 * Internal native-app sign-in grant (ADR-0091). One document per signed-in
 * phone/tablet/computer: the member id (`sub`), the public client id
 * (`backstage-ios`/`backstage-android`), the platform, the issuing origin,
 * timestamps, the current refresh `jti` and the revocation flag. No token, no
 * code, no device name, no IP. Every field is treated as public (the dataset
 * answers unauthenticated published reads; the dotted id keeps it out of the
 * public reader).
 *
 * Written only by `app/appAuth/grantStore.ts`. Hidden and read-only in the
 * Studio. Names come from the import-free `app/appAuth/documentTypes.ts`, so a
 * schema file never drags `jose`/`node:crypto` into the Studio bundle.
 */
export const appAuthGrant = defineType({
  name: APP_AUTH_GRANT_TYPE,
  title: "App sign-in grant (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description: "Interno: sesión de la app nativa. No editar ni borrar a mano.",
  fields: [
    { name: APP_GRANT_FIELD.sub, title: "Miembro (sub)", type: "string" },
    { name: APP_GRANT_FIELD.clientId, title: "Cliente", type: "string", description: "backstage-ios o backstage-android." },
    { name: APP_GRANT_FIELD.platform, title: "Plataforma", type: "string" },
    { name: APP_GRANT_FIELD.origin, title: "Origin", type: "string" },
    { name: APP_GRANT_FIELD.createdAt, title: "Creado", type: "datetime" },
    { name: APP_GRANT_FIELD.lastRefreshAt, title: "Último uso", type: "datetime" },
    { name: APP_GRANT_FIELD.currentRefreshJti, title: "Refresh jti actual", type: "string" },
    { name: APP_GRANT_FIELD.revoked, title: "Revocado", type: "boolean" },
    { name: APP_GRANT_FIELD.revokedAt, title: "Revocado el", type: "datetime" },
    { name: APP_GRANT_FIELD.revokedReason, title: "Motivo", type: "string" },
  ],
  preview: {
    select: { platform: "platform", createdAt: "createdAt", revoked: "revoked" },
    prepare(sel: { platform?: string; createdAt?: string; revoked?: boolean }) {
      return {
        title: `App ${sel.platform ?? "?"}${sel.revoked ? " (revocada)" : ""}`,
        subtitle: sel.createdAt ?? "sin fecha",
      };
    },
  },
});

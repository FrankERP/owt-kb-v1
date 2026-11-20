import { defineType } from "sanity";

import { APP_AUTH_CODE_REDEMPTION_TYPE, APP_CODE_REDEMPTION_FIELD } from "../../app/appAuth/documentTypes";

/**
 * Internal record that a native-app authorization code was used (ADR-0091). The
 * `_id` is `appAuthCode.<sha256 of the code's jti>`, and `create()` on it is what
 * refuses a second use. Written only by `app/appAuth/grantStore.ts`; hidden and
 * read-only in the Studio.
 */
export const appAuthCodeRedemption = defineType({
  name: APP_AUTH_CODE_REDEMPTION_TYPE,
  title: "App sign-in code redemption (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description: "Interno: registro de canje de código de la app. No editar ni borrar a mano.",
  fields: [{ name: APP_CODE_REDEMPTION_FIELD.redeemedAt, title: "Canjeado el", type: "datetime" }],
  preview: {
    select: { redeemedAt: "redeemedAt" },
    prepare(sel: { redeemedAt?: string }) {
      return { title: "Código de la app canjeado", subtitle: sel.redeemedAt ?? "sin fecha" };
    },
  },
});

// The consent screen's tier lines (ADR-0083) — what the person is about to
// let an agent do with their account. One module, so the page and its tests
// read the same words. Pure, no imports beyond the tier type.

import type { McpTier } from "./tier";

/** «Podrá»: what a connection of this tier reaches. */
export const TIER_CONSENT_TEXT: Readonly<Record<McpTier, string>> = {
  full: "Todo lo que puedes hacer como super-admin, incluido cambiar servicios, setlists y canciones.",
  read: "Solo leer: servicios, canciones, disponibilidad, participación, equidad, reglas, propuestas e integridad. No podrá cambiar nada.",
};

/** The warning above the buttons. */
export const CONSENT_WARNING = "Aprueba solo si tú acabas de pedir esta conexión desde tu agente de IA.";

// The consent screen's tier lines (ADR-0083 and its addendum) — what the person is about to
// let an agent do with their account. One module, so the page and its tests
// read the same words. Pure, no imports beyond the tier type.

import type { McpTier } from "./tier";

/** «Podrá»: what a connection of this tier reaches. */
export const TIER_CONSENT_TEXT: Readonly<Record<McpTier, string>> = {
  full: "Todo lo que puedes hacer como super-admin, incluido cambiar servicios, setlists y canciones.",
  admin:
    "Lo mismo que puedes hacer como admin de Alabanza en la página: ver y cambiar servicios, equipos, setlists, " +
    "propuestas, mensajes y canciones; publicar, borrar servicios y generar el mes. Esos cambios avisan al equipo " +
    "como en la página. Verá los nombres, la disponibilidad y las notas del equipo, como en la página. " +
    "No podrá administrar personas (altas, correos, accesos) ni Oasis Kids.",
};

/** The warning above the buttons. */
export const CONSENT_WARNING = "Aprueba solo si tú acabas de pedir esta conexión desde tu agente de IA.";

import { defineType } from "sanity";

/**
 * Internal: one member's calendar-feed generation counter (ADR-0057;
 * docs/superpowers/specs/2026-10-15-member-calendar-feed-design.md D2).
 *
 * `_id` is `calendarFeed.<memberId>` — dotted, so an untokened read never serves it. It holds
 * NOTHING secret: the feed URL is an HMAC under `CALENDAR_FEED_SECRET` (Vercel only) over the
 * member id and this counter. «Generar un enlace nuevo» (`POST /api/me/calendar-feed`) increments
 * it, which revokes every earlier URL of that member. Absent document = generation 0.
 *
 * NOT editable content: hidden and read-only in the Studio, never authored by hand.
 */
export const calendarFeed = defineType({
  name: "calendarFeed",
  title: "Calendar feed (internal)",
  type: "document",
  hidden: true,
  readOnly: true,
  description: "Interno: contador del enlace de calendario de un miembro. No editar ni borrar a mano.",
  fields: [
    {
      name: "member",
      title: "Miembro",
      type: "reference",
      to: [{ type: "teamMembers" }],
      weak: true,
    },
    {
      name: "generation",
      title: "Generación",
      type: "number",
      description: "Cada «Generar un enlace nuevo» la sube en 1; los enlaces anteriores dejan de funcionar.",
    },
    { name: "rotatedAt", title: "Último cambio de enlace", type: "datetime" },
  ],
  preview: {
    select: { name: "member.member_name", generation: "generation" },
    prepare(sel: { name?: string; generation?: number }) {
      return { title: sel.name ?? "(sin miembro)", subtitle: `generación ${sel.generation ?? 0}` };
    },
  },
});

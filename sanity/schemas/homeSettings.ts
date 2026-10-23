import { defineField, defineType } from "sanity";

/**
 * What Inicio shows above the greeting: the team photo (ADR-0070, the «Inicio
 * de millones» reference mock Frank approved 2026-10-23).
 *
 * ONE document with the fixed id `homeSettings` (a singleton pane in
 * `sanity/structure.ts`; the global «Create» menu does not offer the type),
 * read by `app/(client)/page.tsx` as `*[_id == "homeSettings"][0]` through the
 * PUBLISHED perspective — a photo saved but not published shows nothing.
 * Without the document, or without a photo, Inicio paints the greeting on the
 * plain page, so the photo is never a blocker: the page launched before anyone
 * uploaded one.
 *
 * The hotspot is honoured: the band is wide and short on a desktop and tall on
 * a phone, so the Studio's crop tool is how the faces stay in frame on both.
 */
export const homeSettings = defineType({
  name: "homeSettings",
  title: "Inicio (foto del equipo)",
  type: "document",
  fields: [
    defineField({
      name: "heroPhoto",
      title: "Foto del equipo",
      description:
        "La foto grande de Inicio, detrás del saludo. Ancha en escritorio y alta en el teléfono: usa el punto de enfoque y el recorte para que las caras queden en cuadro en los dos. Se ve en la app cuando este documento está publicado.",
      type: "image",
      options: { hotspot: true },
    }),
    defineField({
      name: "heroAlt",
      title: "Descripción de la foto",
      description: "Para lectores de pantalla, por ejemplo «El equipo en el escenario, agosto 2026».",
      type: "string",
    }),
  ],
  preview: {
    select: { media: "heroPhoto", subtitle: "heroAlt" },
    prepare: ({ media, subtitle }) => ({ title: "Inicio (foto del equipo)", subtitle, media }),
  },
});

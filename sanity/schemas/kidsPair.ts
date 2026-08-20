import { defineType } from "sanity";

/**
 * Oasis Kids scheduling unit: a fixed PAIR of people bound to one age room.
 * Written by the app (/api/kids/pairs), not authored in Studio — same posture
 * as the worship coordination types. Rooms and rules: spec
 * docs/superpowers/specs/2026-08-19-kids-ministry-scheduling-design.md §1, §4.2.
 */
export const kidsPair = defineType({
  name: "kidsPair",
  title: "Kids — Pareja",
  type: "document",
  fields: [
    { name: "name", title: "Nombre", type: "string", validation: (r: any) => r.required() },
    {
      name: "members",
      title: "Integrantes",
      type: "array",
      of: [{ type: "reference", to: [{ type: "teamMembers" }] }],
      validation: (r: any) => r.required().length(2),
    },
    {
      name: "room",
      title: "Sala",
      type: "string",
      options: {
        list: [
          { title: "Reunión General Chiquitos", value: "chiquitos" },
          { title: "Reunión General Medianos", value: "medianos" },
          { title: "Reunión General Grandes", value: "grandes" },
        ],
        layout: "radio",
      },
      validation: (r: any) => r.required(),
    },
    {
      name: "active",
      title: "Activa",
      type: "boolean",
      initialValue: true,
      description: "Las parejas retiradas conservan su historial pero salen de todas las rotaciones.",
    },
  ],
  preview: { select: { title: "name", subtitle: "room" } },
});

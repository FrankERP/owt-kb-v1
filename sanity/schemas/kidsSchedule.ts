import { defineType } from "sanity";

const pairRef = (name: string, title: string) => ({
  name,
  title,
  type: "reference" as const,
  to: [{ type: "kidsPair" as const }],
});

/**
 * One document per Sunday, at the DETERMINISTIC id `kidsSchedule-<YYYY-MM-DD>`
 * (minted by /api/kids/schedules): a regenerate updates in place and two
 * concurrent saves cannot fork the same Sunday. Draft until published —
 * member-facing reads filter `published != false` (repo convention).
 * A seat may be empty: unfillable weeks stay honest (spec §7.6).
 */
export const kidsSchedule = defineType({
  name: "kidsSchedule",
  title: "Kids — Rol del domingo",
  type: "document",
  fields: [
    { name: "date", title: "Domingo", type: "date", validation: (r: any) => r.required() },
    pairRef("ensenanza", "Enseñanza"),
    pairRef("chiquitos", "RG Chiquitos"),
    pairRef("medianos", "RG Medianos"),
    pairRef("grandes", "RG Grandes"),
    { name: "published", title: "Publicado", type: "boolean", initialValue: false },
  ],
  preview: { select: { title: "date" } },
});

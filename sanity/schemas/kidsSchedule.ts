import { defineType, type Rule } from "sanity";

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
 * member-facing reads filter `published == true`, NOT the worship types'
 * `published != false`. The worship convention exists because those documents
 * predate the field, so an absent `published` must mean "visible"; a
 * `kidsSchedule` carries the field from birth (`initialValue: false`), so the
 * strict test is the safe one — `null == true` is false, which excludes a
 * field-less document instead of publishing it by accident. Any new kids type or
 * new member-facing kids read copies THIS rule, not the worship one.
 * A seat may be empty: unfillable weeks stay honest (spec §7.6).
 */
export const kidsSchedule = defineType({
  name: "kidsSchedule",
  title: "Kids — Rol del domingo",
  type: "document",
  // Studio protection (PROTECTED_STUDIO_TYPES in app/utils/studioProtection.ts):
  // read-only in the embedded Studio. The create affordance is what matters most
  // here — it mints a RANDOM `_id`, and a second document for a Sunday that
  // already has `kidsSchedule-<date>` would show that Sunday twice in /kids.
  // `document.actions` in `sanity.config.ts` also removes every mutating action
  // (even by direct URL). `__experimental_actions` is NOT used — inert in v5.
  readOnly: true,
  fields: [
    { name: "date", title: "Domingo", type: "date", validation: (r: Rule) => r.required() },
    pairRef("ensenanza", "Enseñanza"),
    pairRef("chiquitos", "RG Chiquitos"),
    pairRef("medianos", "RG Medianos"),
    pairRef("grandes", "RG Grandes"),
    { name: "published", title: "Publicado", type: "boolean", initialValue: false },
  ],
  preview: { select: { title: "date" } },
});

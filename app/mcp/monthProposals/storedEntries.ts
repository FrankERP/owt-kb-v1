// A saved month's frozen eligibility as the month check's entry, from its fairness record (T2.3).
// Shared by the MCP saved-month editor (`serviceEditor.ts`) and the availability proposals
// (`availabilityConflicts.ts`, ADR-0079), so both judge a month against the same entry.
//
// Neutral and pure: no I/O, nothing from a `"use client"` module (ADR-0028).

import type { LogicalRecord } from "@/app/utils/fairnessVocabulary";
import type { V3ConfirmEntry } from "@/app/components/admin/v3Confirm";

/** The month's frozen eligibility, from its fairness record; none = «sin revisar» where it is needed (E7). */
export function entryFromRecord(record: LogicalRecord): V3ConfirmEntry {
  return {
    month: record.month,
    state: "bound",
    write: {
      month: record.month,
      source: record.source === "auto" ? "auto" : "manual",
      expectedRev: record.rev,
      people: record.people.map(({ name: _name, ...p }) => p),
      presence: record.presence,
    },
    expects: ["unchanged"],
  };
}

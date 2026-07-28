// app/utils/setlistDiff.ts
// The standings table behind every setlist email (spec §6). One shape covers
// add, remove, re-key, reorder and regrouping — there is no diff mode.

import type { OutboxSongRow } from "./outboxNotice";

export interface TableRow {
  position: number | null;
  ref: string;
  key: string;
  previousKey: string | null;
  group: number | null;
  groupIsNew: boolean;
  /** null for a first setlist: there is no previous position to compare to. */
  movement: { dir: "up" | "down" | "same"; n: number } | null;
  status: "present" | "new" | "gone";
}

/** The set of adjacent refs forming each group, so "new" survives reindexing. */
function groupSignatures(rows: OutboxSongRow[]): Set<string> {
  const byGroup = new Map<number, string[]>();
  rows.forEach((r) => {
    if (r.group === null) return;
    byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r.ref]);
  });
  return new Set([...byGroup.values()].map((refs) => JSON.stringify(refs)));
}

/**
 * Assumes each `ref` appears at most once per list. Both `SetlistEditor.tsx`
 * and `ProposalEditor.tsx` block adding a song already in the list, so a
 * duplicate can only arrive via a Studio direct-edit or legacy/migrated data.
 * If it does: `beforeIndex`/`beforeKey` collapse repeats to the *last*
 * occurrence, so an earlier occurrence's movement and `previousKey` end up
 * computed against the later one instead of its own match.
 */
export function buildSetlistTable(before: OutboxSongRow[], after: OutboxSongRow[]): TableRow[] {
  const isFirst = before.length === 0;
  const beforeIndex = new Map(before.map((r, i) => [r.ref, i]));
  const beforeKey = new Map(before.map((r) => [r.ref, r.key]));
  const beforeGroups = groupSignatures(before);

  const afterGroupRefs = new Map<number, string[]>();
  after.forEach((r) => {
    if (r.group === null) return;
    afterGroupRefs.set(r.group, [...(afterGroupRefs.get(r.group) ?? []), r.ref]);
  });

  const rows: TableRow[] = after.map((r, i) => {
    const prev = beforeIndex.get(r.ref);
    const prevKey = beforeKey.get(r.ref);
    const sig = r.group === null ? null : JSON.stringify(afterGroupRefs.get(r.group) ?? []);
    return {
      position: i + 1,
      ref: r.ref,
      key: r.key,
      previousKey: prevKey !== undefined && prevKey !== r.key ? prevKey : null,
      group: r.group,
      groupIsNew: sig !== null && !beforeGroups.has(sig),
      movement: isFirst || prev === undefined
        ? null
        : prev === i
          ? { dir: "same", n: 0 }
          : prev > i
            ? { dir: "up", n: prev - i }
            : { dir: "down", n: i - prev },
      status: prev === undefined && !isFirst ? "new" : "present",
    };
  });

  // Departed songs stay IN the table, below the rest: "don't rehearse this one"
  // is among the most actionable lines the email carries.
  const afterRefs = new Set(after.map((r) => r.ref));
  for (const r of before) {
    if (afterRefs.has(r.ref)) continue;
    rows.push({
      position: null, ref: r.ref, key: r.key, previousKey: null,
      group: null, groupIsNew: false, movement: null, status: "gone",
    });
  }
  return rows;
}

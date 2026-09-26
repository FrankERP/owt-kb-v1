// scripts/__tests__/__fixtures__/solverHistoryDiffFixtures.ts
//
// Builders for R11's diff tests: window documents, out-of-window receipts, the
// builder's evidence result and export entries. Every name is fake — the
// repository is public, and real exports never enter it.

import { historyWindow, type SolverHistoryEntry, type SolverHistoryTarget } from "@/app/utils/solverHistory";
import type {
  SolverHistoryDocumentEvidence,
  SolverHistoryOutOfWindowReceipt,
  SolverHistoryReceiptLink,
  SolverHistoryResult,
  SolverHistoryRoleCounts,
} from "@/app/utils/solverHistoryTypes";

export const ANA = "Ana Prueba";
export const BETO = "Beto Ensayo";
export const CARO = "Caro Demo";
export const DANI = "Dani Ficticio";

export const MEMBERS = [
  { id: "m-ana", name: ANA },
  { id: "m-beto", name: BETO },
  { id: "m-caro", name: CARO },
  { id: "m-dani", name: DANI },
  { id: "m-sin", name: null },
];

/** November 2026 → the window is August, September, October. */
export const NOV: SolverHistoryTarget = { year: 2026, month: 11 };

export function found(
  roleId: string,
  targetDay: string,
  createdAt: string | null = "2026-09-25T10:00:00.000Z",
  state: "committed" | "role_deleted" | null = "committed",
): SolverHistoryReceiptLink {
  return { status: "found", receiptId: `rc-${roleId}`, state, targetDay, createdAt };
}

export interface DocInput {
  roleId: string;
  day: string | null;
  type?: "sunday_role" | "saturday_role";
  contributes?: SolverHistoryRoleCounts;
  receipt?: SolverHistoryReceiptLink;
  createdAt?: string | null;
  unchangedAs?: "published" | "draft" | null;
  emptySeatCreate?: boolean;
  excluded?: "duplicate_target" | "invalid_date" | null;
}

/** A window document; by default stamped, found, created on its own day, and unchanged. */
export function doc(input: DocInput): SolverHistoryDocumentEvidence {
  return {
    roleId: input.roleId,
    type: input.type ?? "sunday_role",
    day: input.day,
    publishedRaw: true,
    receipt: input.receipt ?? found(input.roleId, input.day ?? "2026-10-04", input.createdAt ?? "2026-09-25T10:00:00.000Z"),
    unchangedAs: input.unchangedAs === undefined ? "published" : input.unchangedAs,
    emptySeatCreate: input.emptySeatCreate ?? false,
    excluded: input.excluded ?? null,
    contributes: input.contributes ?? {},
  };
}

export function oow(
  input: Partial<SolverHistoryOutOfWindowReceipt> & { receiptId: string; targetDay: string },
): SolverHistoryOutOfWindowReceipt {
  return {
    state: "committed",
    type: "sunday_role",
    createdAt: "2026-09-25T10:00:00.000Z",
    roleId: `role-of-${input.receiptId}`,
    roleFound: false,
    roleCurrentDay: null,
    ...input,
  };
}

function monthIdxOf(day: string): number {
  return Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;
}

/**
 * The builder's result for `target`, with its entries summed from the documents'
 * `contributes` — task 3's invariant — so a fixture can never disagree with itself.
 */
export function derivedFor(
  target: SolverHistoryTarget,
  documents: SolverHistoryDocumentEvidence[],
  outOfWindowReceipts: SolverHistoryOutOfWindowReceipt[] = [],
  duplicateTargets: { type: "sunday_role" | "saturday_role"; day: string; roleIds: string[] }[] = [],
): SolverHistoryResult {
  const window = historyWindow(target);
  const entries = window.map((w) => {
    const counts = new Map<string, Map<string, number>>();
    let services = 0;
    for (const d of documents) {
      if (d.excluded || !d.day || monthIdxOf(d.day) !== w.year * 12 + w.month - 1) continue;
      services += 1;
      for (const [name, byRole] of Object.entries(d.contributes)) {
        const row = counts.get(name) ?? new Map<string, number>();
        for (const [roleKey, n] of Object.entries(byRole)) row.set(roleKey, (row.get(roleKey) ?? 0) + n);
        counts.set(name, row);
      }
    }
    const role_counts = Object.fromEntries([...counts].map(([name, row]) => [name, Object.fromEntries(row)]));
    const total_counts = Object.fromEntries(
      [...counts].map(([name, row]) => [name, [...row.values()].reduce((a, b) => a + b, 0)]),
    );
    return { entry: { key: w.key, year: w.year, month: w.month, total_counts, role_counts }, services };
  });
  const withReceipt = documents.filter((d) => d.receipt.status === "found");
  return {
    target,
    entries: entries.map((e) => e.entry),
    months: window.map((w, i) => ({ ...w, services: entries[i].services })),
    diagnostics: { duplicateTargets, danglingSeats: [], unnamedMembers: [], duplicateNames: [] },
    evidence: {
      documents,
      outOfWindowReceipts,
      members: MEMBERS,
      control: { withReceipt: withReceipt.length, unchanged: withReceipt.filter((d) => d.unchangedAs !== null).length },
    },
  };
}

/** An export entry; `total_counts` is the per-name sum unless given. */
export function entry(
  year: number,
  month: number,
  role_counts: SolverHistoryRoleCounts,
  total_counts?: Record<string, number>,
): SolverHistoryEntry {
  return {
    key: `${year}-${month}`,
    year,
    month,
    role_counts,
    total_counts:
      total_counts ??
      Object.fromEntries(Object.entries(role_counts).map(([n, r]) => [n, Object.values(r).reduce((a, b) => a + b, 0)])),
  };
}

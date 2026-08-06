// T2 of the grid drag-and-drop plan
// (docs/superpowers/plans/2026-08-06-grid-drag-and-drop.md) — the single move
// primitive every drag must go through: pointer drag (T4), keyboard/touch
// pick-then-place (T5), and any future entry point. It is exported and
// UNCALLED in production here; T3 gates a proposed move before anything calls
// this, T4/T5 wire it in.
//
// Composes `withUpdatedCell` (`PlannerGrid.tsx`) TWICE over one array — source
// minus the member, target plus the member — and returns ONE array for ONE
// `onCellsChange` (DD1). Never add-then-remove, never two updates against
// stale state: the second `withUpdatedCell` call runs against the FIRST
// call's output, so a same-cell move and override pruning both see a
// consistent, already-updated cell rather than the pre-move snapshot.
import { withUpdatedCell } from "./PlannerGrid";
import type { GridCell } from "./plannerModel";

export interface MoveOccupantEndpoint {
  rowId: string;
  columnId: string;
}

export interface MoveOccupantSource extends MoveOccupantEndpoint {
  memberId: string;
}

/**
 * Forwarded verbatim to the TARGET's `withUpdatedCell` call only — never the
 * source's. A forced move records the waived rule where the member lands,
 * not where they left.
 */
type OverrideDirective = NonNullable<Parameters<typeof withUpdatedCell>[4]>;

function findCell(cells: GridCell[], rowId: string, columnId: string): GridCell | undefined {
  return cells.find((c) => c.rowId === rowId && c.columnId === columnId);
}

/**
 * Drops exactly ONE occurrence of `memberId` from `occupants` — DD10: a
 * duplicate occupant in one cell (deliberately supported by
 * `reconcileOccupants`, `plannerModel.ts:60-63`, and reachable via the swap
 * route, `app/api/admin/roles/swap/route.ts:190-201`) loses one assignment
 * per drag, never every assignment of that member.
 *
 * This only has to get the COUNT right: it returns a plain member-id array,
 * and `withUpdatedCell` → `reconcileOccupants` (`plannerModel.ts:65-75`) is
 * what decides which PHYSICAL occupant (and its `itemKey`) survives, purely
 * by re-matching against the cell's original occupants in order. Which of
 * the two duplicate occupants this function's own filter drops first is not
 * observable — `reconcileOccupants` always keeps the first prior occupant
 * for the ids that remain, regardless of which one was targeted here. Uses
 * `indexOf`/slice (not a blanket `!==` filter) to keep that "one, not all"
 * semantics obvious at the call site.
 */
function dropOneOccurrence(occupants: GridCell["occupants"], memberId: string): string[] {
  const memberIds = occupants.map((o) => o.memberId);
  const index = memberIds.indexOf(memberId);
  if (index === -1) return memberIds;
  return [...memberIds.slice(0, index), ...memberIds.slice(index + 1)];
}

/**
 * Moves one occupant from `source` to `target` within `cells`, in a single
 * returned array.
 *
 * C1 (target already holds this member) is refused upstream by the T3 gate,
 * but this primitive still needs a defined behaviour if it is ever called
 * anyway: it returns `cells` UNCHANGED (same reference, nothing touched), and
 * never throws — so a gate bug degrades to a no-op instead of a duplicate
 * occupant or a crash. This is also what makes a same-cell drop safe without
 * a special case: source === target means the member is trivially already
 * seated at the target, so the same C1 branch applies.
 *
 * If `source` names a cell not present in `cells`, OR `source.memberId` is
 * not actually seated in that cell (stale drag state, a T3 gate bug, a wrong
 * id), there is nothing to remove — `cells` is returned unchanged rather
 * than dropping nothing at the source while still appending the member to
 * the target, which would silently create a second occupant with no
 * corresponding removal anywhere (the same "degrade to a no-op, not
 * corruption" requirement C1 states above, applied to the source side).
 */
export function moveOccupant(
  cells: GridCell[],
  source: MoveOccupantSource,
  target: MoveOccupantEndpoint,
  addOverride?: OverrideDirective,
): GridCell[] {
  const targetCell = findCell(cells, target.rowId, target.columnId);
  const alreadyAtTarget = targetCell?.occupants.some((o) => o.memberId === source.memberId) ?? false;
  if (alreadyAtTarget) return cells;

  const sourceCell = findCell(cells, source.rowId, source.columnId);
  const memberAtSource = sourceCell?.occupants.some((o) => o.memberId === source.memberId) ?? false;
  if (!sourceCell || !memberAtSource) return cells;

  const sourceMemberIds = dropOneOccurrence(sourceCell.occupants, source.memberId);
  const afterSource = withUpdatedCell(cells, source.rowId, source.columnId, sourceMemberIds);

  const targetAfterSource = findCell(afterSource, target.rowId, target.columnId);
  const targetMemberIds = [
    ...(targetAfterSource?.occupants.map((o) => o.memberId) ?? []),
    source.memberId,
  ];
  return withUpdatedCell(afterSource, target.rowId, target.columnId, targetMemberIds, addOverride);
}

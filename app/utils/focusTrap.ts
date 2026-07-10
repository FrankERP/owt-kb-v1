// Pure tab-cycle logic for a focus trap, extracted so it can be unit-tested
// without a DOM. Given the number of focusable items in a dialog, the index of
// the currently-focused one, and whether Shift is held, returns the index to
// move focus to — or null to let the browser handle the move normally.
//
// Rule: Tab past the last item wraps to the first; Shift+Tab before the first
// wraps to the last. Anything in between is left to native tab order.
export function trapTabTarget(
  count: number,
  activeIndex: number,
  shiftKey: boolean,
): number | null {
  if (count <= 0) return null;
  if (count === 1) return 0; // only one stop — keep focus on it
  if (shiftKey && activeIndex <= 0) return count - 1;
  if (!shiftKey && activeIndex >= count - 1) return 0;
  return null;
}

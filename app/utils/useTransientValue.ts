"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A value that shows, then reverts to `idle` after `ms` — a toast, a "Guardado ✓"
 * flash, a transient banner.
 *
 * WHY THIS EXISTS. Eight sites across the app had hand-rolled the same two lines:
 *
 *     const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };
 *
 * and all eight had the same bug, because the timer was never held onto. A second
 * toast inside the window does not restart the clock — it inherits the first
 * one's. Save at t=0 and again at t=2900 and the second message shows for 100ms
 * before the FIRST timer fires and clears it.
 *
 * That is not only cosmetic. The pairs that matter are success-then-error:
 * "Borrador guardado" followed by "Error al guardar" a moment later, where the
 * error is the one that vanishes in a blink and the member walks away believing
 * the save landed. The toast is often the only signal a mutation failed.
 *
 * So the timer is stored, cleared before each new value, and cleared on unmount.
 *
 * Returns `[value, show, reset]`. `reset` returns to idle NOW and cancels the
 * pending timer — for the case where something other than time invalidates the
 * value, such as the availability calendar's "Guardado ✓" the moment the member
 * edits a date again. Without it a caller would have to fake a reset by showing
 * the idle value, which quietly arms another timer.
 *
 * The fourth return, `hold`, shows a value that must PERSIST until something
 * replaces it, cancelling any pending timer. It exists because a surface can need
 * both channels through one slot: `MonthGenerator`'s swap toast holds all but
 * three of its messages, because some of them report a write that landed in Sanity
 * but could not be verified — and the recovery button lives inside the toast, so
 * auto-dismissing those would delete the only record that a real roster swap is
 * unresolved. The held set is not only those; it includes refusals too, because
 * holding is the safe default there and only three messages were ever transient
 * (two refusals and a local confirmation). Mixing the channels is safe because ONE
 * owner holds the timer: a pending `show` can never fire into a value a later
 * `hold` put there.
 *
 * `show` and `reset` are stable as long as `idle` and `ms` are (every caller
 * passes literals — `null`, `false`, `3000`). Pass an object literal as `idle`
 * and they are re-created each render, which is harmless but not memo-friendly.
 * They are `useCallback`s, not `useState` setters, so ESLint cannot assume
 * stability — name them in an effect's dependency array.
 */
export function useTransientValue<T>(
  idle: T,
  ms: number,
): [T, (next: T) => void, () => void, (next: T) => void] {
  const [value, setValue] = useState<T>(idle);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Unmount only: a pending timer must not fire into a gone component.
  useEffect(() => clear, [clear]);

  const show = useCallback(
    (next: T) => {
      clear();
      setValue(next);
      timer.current = setTimeout(() => {
        timer.current = null;
        setValue(idle);
      }, ms);
    },
    [clear, idle, ms],
  );

  const reset = useCallback(() => {
    clear();
    setValue(idle);
  }, [clear, idle]);

  const hold = useCallback(
    (next: T) => {
      clear();
      setValue(next);
    },
    [clear],
  );

  return [value, show, reset, hold];
}

"use client";

// One transposition seat per song page (R4, ruling 2). The hero owns the key
// PICKER; `ChordChart` only steps the same value by half tones. Both read this
// context, so the chart can never disagree with the key shown above it.
//
// `ChordChart` uses `useTransposeOptional`, not a required hook: the component is
// also rendered without a provider (the practice sheet, the admin preview), and
// there it keeps its own local state.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { transposeKey } from "@/app/utils/transpose";

export interface TransposeState {
  /** The song's own key as written on the document (`post.key`), or null. */
  nativeKey: string | null;
  semitones: number;
  setSemitones: (n: number) => void;
  /** nativeKey shifted by `semitones`; null when nativeKey is null. */
  soundingKey: string | null;
}

export const TransposeContext = createContext<TransposeState | null>(null);

export function TransposeProvider({
  nativeKey,
  children,
}: {
  nativeKey: string | null;
  children: React.ReactNode;
}) {
  const [semitones, setRaw] = useState(0);

  // Every writer goes through the wrap, so a caller may hand in -1 or 13 and the
  // stored value is still the 0..11 the readouts are built for.
  const setSemitones = useCallback((n: number) => setRaw(((n % 12) + 12) % 12), []);

  const value = useMemo<TransposeState>(
    () => ({
      nativeKey,
      semitones,
      setSemitones,
      soundingKey: nativeKey ? transposeKey(nativeKey, semitones) : null,
    }),
    [nativeKey, semitones, setSemitones],
  );

  return <TransposeContext.Provider value={value}>{children}</TransposeContext.Provider>;
}

/** null when rendered outside a provider — `ChordChart` uses this to fall back to local state. */
export function useTransposeOptional(): TransposeState | null {
  return useContext(TransposeContext);
}

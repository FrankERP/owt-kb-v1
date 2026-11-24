"use client";

import { useEffect, useState } from "react";
import { PRESETS, TextScaleMode, applyScale, getStoredMode, setStoredMode } from "@/app/utils/textZoom";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import { SHEET_TITLE } from "@/app/utils/homeHero";

/**
 * Segmented text-size control. Persists the choice device-locally and applies it
 * immediately. "Automático" follows the device accessibility setting on native.
 *
 * A section in the page's own type (the «millones» pass, 2026-10-26): small-caps
 * title, a 15 px hint, the house bar filled and full width, and a 17 px sample
 * line in the body face — the bordered card it used to draw (and the `bare` prop
 * that removed it for `SettingsCard`) are gone with the card they matched.
 */
export default function TextSizeControl() {
  const [mode, setMode] = useState<TextScaleMode>("auto");

  // Initialise from storage after mount (localStorage is client-only).
  useEffect(() => { setMode(getStoredMode()); }, []);

  function choose(next: TextScaleMode) {
    setMode(next);
    setStoredMode(next);
    applyScale(next);
  }

  return (
    <section className="space-y-4">
      <h2 className={SHEET_TITLE}>Tamaño de texto</h2>
      <p className="font-body text-[15px] leading-snug text-ink-muted">
        «Automático» sigue el ajuste de tu teléfono. Solo en este dispositivo.
      </p>
      <SegmentedControl
        label="Tamaño de texto"
        value={mode}
        onChange={choose}
        options={PRESETS.map((p) => ({ value: p.mode, label: p.label }))}
        tone="filled"
        className="w-full [&>button]:flex-1"
      />
      <p className="font-body text-[17px] leading-snug text-ink-dim">
        Así se lee el setlist del domingo.
      </p>
    </section>
  );
}

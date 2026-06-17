import { isNativeApp } from "./native";

export type TextScaleMode = "auto" | "1.0" | "1.2" | "1.4" | "1.6";

export const PRESETS: { mode: TextScaleMode; value?: number; label: string }[] = [
  { mode: "auto", label: "Automático" },
  { mode: "1.0", value: 1.0, label: "Normal" },
  { mode: "1.2", value: 1.2, label: "Grande" },
  { mode: "1.4", value: 1.4, label: "Más grande" },
  { mode: "1.6", value: 1.6, label: "Máximo" },
];

const STORAGE_KEY = "owt-text-scale";
const VALID = new Set<TextScaleMode>(["auto", "1.0", "1.2", "1.4", "1.6"]);

/** Stored device-local mode; "auto" when unset or invalid. */
export function getStoredMode(): TextScaleMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && VALID.has(v as TextScaleMode) ? (v as TextScaleMode) : "auto";
  } catch {
    return "auto";
  }
}

export function setStoredMode(mode: TextScaleMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* non-fatal */
  }
}

/** Fixed presets resolve to their value; "auto" resolves to 1.0 (web fallback baseline). */
export function resolveValue(mode: TextScaleMode): number {
  return PRESETS.find((p) => p.mode === mode)?.value ?? 1.0;
}

/** Snap a raw zoom (e.g. from getPreferred) to the nearest fixed preset mode. */
export function nearestPreset(value: number): TextScaleMode {
  const fixed = PRESETS.filter(
    (p): p is { mode: TextScaleMode; value: number; label: string } => p.value !== undefined
  );
  let best = fixed[0];
  for (const p of fixed) {
    if (Math.abs(p.value - value) < Math.abs(best.value - value)) best = p;
  }
  return best.mode;
}

/**
 * Apply a text scale. Native: @capacitor/text-zoom (getPreferred for auto, set for
 * fixed). Web: best-effort -webkit-text-size-adjust. Never throws.
 */
export async function applyScale(mode: TextScaleMode): Promise<void> {
  try {
    if (isNativeApp()) {
      const { TextZoom } = await import("@capacitor/text-zoom");
      if (mode === "auto") {
        const { value } = await TextZoom.getPreferred();
        await TextZoom.set({ value });
      } else {
        await TextZoom.set({ value: resolveValue(mode) });
      }
    } else {
      document.documentElement.style.setProperty(
        "-webkit-text-size-adjust",
        `${resolveValue(mode) * 100}%`
      );
    }
  } catch (err) {
    console.error("[textZoom] applyScale failed:", err);
  }
}

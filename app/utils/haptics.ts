// Haptic feedback (spec decision D). Native only: on the web and under jsdom
// `isNativeApp()` is false and the plugin module is never imported, so the web
// bundle carries none of it. Best effort — a handler that asks for a tap must
// never wait on it or fail because of it. Call as `void haptic("light")`.
import { isNativeApp } from "./native";

export type HapticKind = "light" | "medium" | "selection";

let pluginPromise: Promise<typeof import("@capacitor/haptics")> | null = null;

export async function haptic(kind: HapticKind = "light"): Promise<void> {
  if (!isNativeApp()) return;
  try {
    pluginPromise ??= import("@capacitor/haptics");
    const { Haptics, ImpactStyle } = await pluginPromise;
    if (kind === "selection") await Haptics.selectionChanged();
    else await Haptics.impact({ style: kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light });
  } catch {
    // A device without an engine, or the plugin missing from a stale native
    // build — either way the interaction already happened. Nothing to do.
  }
}

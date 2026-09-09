import { beforeEach, describe, expect, it, vi } from "vitest";

const impact = vi.fn(async () => {});
const selectionChanged = vi.fn(async () => {});
vi.mock("@capacitor/haptics", () => ({
  Haptics: { impact, selectionChanged },
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM" },
}));
const isNativeApp = vi.fn(() => false);
vi.mock("../native", () => ({ isNativeApp: () => isNativeApp() }));

describe("haptic()", () => {
  beforeEach(() => { impact.mockClear(); selectionChanged.mockClear(); isNativeApp.mockReturnValue(false); });

  it("is a no-op on the web — the plugin module is never touched", async () => {
    const { haptic } = await import("../haptics");
    await haptic("light");
    expect(impact).not.toHaveBeenCalled();
  });

  it("fires a light impact on native by default", async () => {
    isNativeApp.mockReturnValue(true);
    const { haptic } = await import("../haptics");
    await haptic();
    expect(impact).toHaveBeenCalledWith({ style: "LIGHT" });
  });

  it("maps selection to selectionChanged and medium to a medium impact", async () => {
    isNativeApp.mockReturnValue(true);
    const { haptic } = await import("../haptics");
    await haptic("selection");
    await haptic("medium");
    expect(selectionChanged).toHaveBeenCalledTimes(1);
    expect(impact).toHaveBeenCalledWith({ style: "MEDIUM" });
  });

  it("swallows a plugin failure — a haptic never breaks the handler that asked for it", async () => {
    isNativeApp.mockReturnValue(true);
    impact.mockRejectedValueOnce(new Error("no engine"));
    const { haptic } = await import("../haptics");
    await expect(haptic("light")).resolves.toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const setMock = vi.fn();
const getPreferredMock = vi.fn();
vi.mock("@capacitor/text-zoom", () => ({
  TextZoom: { set: (...a: unknown[]) => setMock(...a), getPreferred: () => getPreferredMock() },
}));

const isNativeMock = vi.fn();
vi.mock("../native", () => ({ isNativeApp: () => isNativeMock() }));

import {
  getStoredMode, setStoredMode, resolveValue, nearestPreset, applyScale, PRESETS,
} from "../textZoom";

const store: Record<string, string> = {};
beforeEach(() => {
  setMock.mockReset(); getPreferredMock.mockReset(); isNativeMock.mockReset();
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  });
  vi.stubGlobal("document", { documentElement: { style: { setProperty: vi.fn() } } });
});

describe("storage", () => {
  it("defaults to auto when unset", () => { expect(getStoredMode()).toBe("auto"); });
  it("round-trips a valid mode", () => { setStoredMode("1.4"); expect(getStoredMode()).toBe("1.4"); });
  it("resets an invalid stored value to auto", () => { store["owt-text-scale"] = "bogus"; expect(getStoredMode()).toBe("auto"); });
});

describe("resolveValue", () => {
  it("maps a fixed preset to its value", () => { expect(resolveValue("1.2")).toBe(1.2); });
  it("maps auto to 1.0 (web fallback)", () => { expect(resolveValue("auto")).toBe(1.0); });
});

describe("nearestPreset", () => {
  it("snaps to the closest fixed preset", () => {
    expect(nearestPreset(1.25)).toBe("1.2");
    expect(nearestPreset(1.55)).toBe("1.6");
    expect(nearestPreset(0.9)).toBe("1.0");
  });
});

describe("applyScale", () => {
  it("native auto: reads getPreferred and applies it", async () => {
    isNativeMock.mockReturnValue(true);
    getPreferredMock.mockResolvedValueOnce({ value: 1.3 });
    await applyScale("auto");
    expect(getPreferredMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledWith({ value: 1.3 });
  });
  it("native fixed: applies the preset value, no getPreferred", async () => {
    isNativeMock.mockReturnValue(true);
    await applyScale("1.6");
    expect(getPreferredMock).not.toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith({ value: 1.6 });
  });
  it("web: sets -webkit-text-size-adjust and never calls the plugin", async () => {
    isNativeMock.mockReturnValue(false);
    await applyScale("1.4");
    expect(setMock).not.toHaveBeenCalled();
    expect((document.documentElement.style.setProperty as any)).toHaveBeenCalledWith("-webkit-text-size-adjust", "140%");
  });
  it("never throws when the plugin fails", async () => {
    isNativeMock.mockReturnValue(true);
    setMock.mockRejectedValueOnce(new Error("boom"));
    await expect(applyScale("1.2")).resolves.toBeUndefined();
  });
});

describe("PRESETS", () => {
  it("has auto + four fixed presets in order", () => {
    expect(PRESETS.map(p => p.mode)).toEqual(["auto", "1.0", "1.2", "1.4", "1.6"]);
  });
});

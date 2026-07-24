import { describe, expect, it } from "vitest";
import {
  canonicalGroupState,
  setlistContentState,
} from "@/app/utils/serviceReadModel";

function entry(over: Record<string, unknown> = {}) {
  return {
    _key: `k${Math.random().toString(36).slice(2, 7)}`,
    play_key: "G",
    song: { _type: "reference", _ref: "song-1" },
    ...over,
  };
}

describe("canonicalGroupState", () => {
  it.each([
    [0, "none"],
    [1, "single"],
    [2, "duplicate"],
    [5, "duplicate"],
  ])("%i canonical docs -> %s", (count, expected) => {
    expect(canonicalGroupState(count as number)).toBe(expected);
  });
});

describe("setlistContentState", () => {
  it("no entries is empty", () => {
    expect(setlistContentState([])).toBe("empty");
  });

  it("all structurally safe entries with play keys is ready", () => {
    expect(setlistContentState([entry(), entry({ song: { _type: "reference", _ref: "song-2" } })])).toBe("ready");
  });

  it("a safe entry with a blank play key is incomplete", () => {
    expect(setlistContentState([entry(), entry({ play_key: "" })])).toBe("incomplete");
  });

  it("a missing play key is incomplete", () => {
    const e = entry();
    delete (e as Record<string, unknown>).play_key;
    expect(setlistContentState([e])).toBe("incomplete");
  });

  it("a non-array songs value is invalid", () => {
    expect(setlistContentState(null)).toBe("invalid");
    expect(setlistContentState({} as unknown)).toBe("invalid");
  });

  it("a non-object entry is invalid", () => {
    expect(setlistContentState(["nope"])).toBe("invalid");
  });

  it("a missing _key is invalid", () => {
    const e = entry();
    delete (e as Record<string, unknown>)._key;
    expect(setlistContentState([e])).toBe("invalid");
  });

  it("duplicate _keys are invalid", () => {
    expect(setlistContentState([entry({ _key: "dup" }), entry({ _key: "dup" })])).toBe("invalid");
  });

  it("a missing song reference is invalid", () => {
    expect(setlistContentState([entry({ song: null })])).toBe("invalid");
    expect(setlistContentState([entry({ song: { _type: "reference", _ref: "" } })])).toBe("invalid");
  });

  it("a dangling song reference (unresolvable) is invalid, not incomplete", () => {
    const resolves = (id: string) => id === "song-1";
    expect(setlistContentState([entry({ song: { _type: "reference", _ref: "ghost" } })], resolves)).toBe("invalid");
    expect(setlistContentState([entry()], resolves)).toBe("ready");
  });
});

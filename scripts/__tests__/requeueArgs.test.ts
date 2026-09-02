import { describe, expect, it } from "vitest";
import { membersToQueue, parseRequeueArgs } from "../lib/requeueArgs.mjs";

describe("parseRequeueArgs", () => {
  it("leaves argv untouched when neither flag is given", () => {
    const { before, only, rest } = parseRequeueArgs(["role-1", "--apply", "--now"]);
    expect(before.size).toBe(0);
    expect(only).toBeNull();
    expect(rest).toEqual(["role-1", "--apply", "--now"]);
  });

  it("parses --before in the two-token and the = forms, stripping both from rest", () => {
    const { before, rest } = parseRequeueArgs([
      "role-1", "--before", "m1=Líder", "--before=m2=BGV,Coro", "--apply",
    ]);
    expect([...before.entries()]).toEqual([
      ["m1", ["Líder"]],
      ["m2", ["BGV", "Coro"]],
    ]);
    expect(rest).toEqual(["role-1", "--apply"]);
  });

  it("trims labels and merges a repeated --before member without duplicates", () => {
    const { before } = parseRequeueArgs(["--before", "m1= Líder , BGV", "--before", "m1=BGV,Keys"]);
    expect(before.get("m1")).toEqual(["Líder", "BGV", "Keys"]);
  });

  it("parses --only as a set, in either form, repeatable", () => {
    const { only, rest } = parseRequeueArgs(["role-1", "--only", "m1,m2", "--only=m2,m3"]);
    expect([...(only ?? [])].sort()).toEqual(["m1", "m2", "m3"]);
    expect(rest).toEqual(["role-1"]);
  });

  it("rejects malformed flags rather than guessing", () => {
    expect(() => parseRequeueArgs(["--before", "m1="])).toThrow(/no labels/);
    expect(() => parseRequeueArgs(["--before", "m1=,"])).toThrow(/no labels/);
    expect(() => parseRequeueArgs(["--before", "=Líder"])).toThrow(/expected/);
    expect(() => parseRequeueArgs(["--before", "Líder"])).toThrow(/expected/);
    expect(() => parseRequeueArgs(["--before"])).toThrow(/needs a value/);
    // A flag swallowing the next flag as its value is the classic silent typo.
    expect(() => parseRequeueArgs(["--before", "--apply"])).toThrow(/needs a value/);
    expect(() => parseRequeueArgs(["--only", ","])).toThrow(/no member ids/);
    expect(() => parseRequeueArgs(["--only"])).toThrow(/needs a value/);
  });
});

describe("membersToQueue", () => {
  it("queues every stored member when nothing narrows it", () => {
    expect(membersToQueue(["a", "b"], null, new Map())).toEqual(["a", "b"]);
  });

  it("adds a removed member (in --before only) after the stored ones", () => {
    expect(membersToQueue(["a", "b"], null, new Map([["gone", ["Líder"]]]))).toEqual(["a", "b", "gone"]);
  });

  it("narrows to --only, always keeping --before members, without duplicates", () => {
    const before = new Map([["b", ["Líder"]], ["gone", ["BGV"]]]);
    expect(membersToQueue(["a", "b", "c"], new Set(["b", "d"]), before)).toEqual(["b", "d", "gone"]);
  });
});

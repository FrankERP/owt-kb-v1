// The people tools' tokens (slice M, D3/D7): what each half binds, label separation, age, malformed
// input, and the create ids' shape and stability.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PEOPLE_TOKEN_TTL_S,
  checkMemberCreateCall,
  checkMemberEditsCall,
  memberCreateIds,
  memberCreateToken,
  memberEditsToken,
  sameMemberCreateResult,
  sameMemberEditsResult,
} from "../peopleTokens";

const KEY = new TextEncoder().encode("k".repeat(48));
const OTHER = new TextEncoder().encode("o".repeat(48));
const NOW = 1_800_000_000;
const call = { memberId: "vale", edits: [{ op: "set", field: "alias", value: "Valeria" }] };
const lines = ["Alias: «Vale» → «Valeria»"];

describe("edit tokens", () => {
  const token = memberEditsToken(KEY, { ...call, lines }, NOW);

  it("the call half binds the person and the edits; the result half also the lines", () => {
    expect(checkMemberEditsCall(KEY, token, call, NOW)).toEqual({ ok: true, iat: NOW, expired: false });
    expect(checkMemberEditsCall(KEY, token, { ...call, memberId: "pau" }, NOW).ok).toBe(false);
    expect(checkMemberEditsCall(KEY, token, { ...call, edits: [] }, NOW).ok).toBe(false);
    expect(sameMemberEditsResult(KEY, token, { ...call, lines })).toBe(true);
    expect(sameMemberEditsResult(KEY, token, { ...call, lines: [...lines, "Regla: …"] })).toBe(false);
  });

  it("another key, or a create token, never passes", () => {
    expect(checkMemberEditsCall(OTHER, token, call, NOW).ok).toBe(false);
    const create = memberCreateToken(KEY, { batch: call, lines }, NOW);
    expect(checkMemberEditsCall(KEY, create, call, NOW).ok).toBe(false);
  });

  it("ages out after the TTL, still verified", () => {
    expect(checkMemberEditsCall(KEY, token, call, NOW + PEOPLE_TOKEN_TTL_S + 1)).toEqual({ ok: true, iat: NOW, expired: true });
  });

  it("malformed tokens are refused", () => {
    for (const bad of ["", "x", `${NOW}.a`, `${NOW}.a.b.c`, `abc.${token.split(".")[1]}.${token.split(".")[2]}`]) {
      expect(checkMemberEditsCall(KEY, bad, call, NOW).ok, bad).toBe(false);
    }
  });
});

describe("create tokens and ids", () => {
  const batch = [{ name: "Ana", email: "ana@example.com", ministries: ["Jóvenes"] }];
  const token = memberCreateToken(KEY, { batch, lines }, NOW);

  it("binds the batch, and the lines in the result half", () => {
    expect(checkMemberCreateCall(KEY, token, batch, NOW).ok).toBe(true);
    expect(checkMemberCreateCall(KEY, token, [{ ...batch[0], email: "b@example.com" }], NOW).ok).toBe(false);
    expect(sameMemberCreateResult(KEY, token, { batch, lines })).toBe(true);
    expect(sameMemberCreateResult(KEY, token, { batch, lines: [] })).toBe(false);
  });

  it("ids are UUID-shaped, stable per token and different per person and per token", () => {
    const ids = memberCreateIds(KEY, token, 3);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(3);
    expect(memberCreateIds(KEY, token, 3)).toEqual(ids);
    expect(memberCreateIds(KEY, memberCreateToken(KEY, { batch, lines }, NOW + 1), 1)[0]).not.toBe(ids[0]);
  });
});

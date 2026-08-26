// Pure request parsing and message construction for the private lead ↔ admin
// thread on a `setlistProposal` (Release 2 §4).
//
// The stored shape is pinned field-by-field, `_type` included, and cross-checked
// against the OTHER writer of the same array: the one-shot migration re-derives
// it in `scripts/lib/proposalMessages.mjs`, nothing makes the two agree at
// compile time, and a migrated item carrying a field a runtime item lacks would
// leave `messages[]` permanently heterogeneous — half of it written irreversibly.

import { describe, expect, it } from "vitest";
import {
  PROPOSAL_AUTHOR_ROLES,
  PROPOSAL_MESSAGES_MAX,
  PROPOSAL_MESSAGE_KINDS,
  PROPOSAL_MESSAGE_TYPE,
  buildProposalMessage,
  parseProposalMessageRequest,
} from "@/app/utils/proposalMessageWrite";
// Imported from the LEAF on purpose: this is the one place a future author
// copies from, and routing it through `proposalWriteRequest` would quietly make
// the `node:crypto` re-export the canonical source again.
import { PROPOSAL_NOTES_MAX } from "@/app/utils/proposalNotesLimit";

describe("thread enums and bounds", () => {
  it("reserves pastor and system from day one, so routing them later needs no migration", () => {
    expect(PROPOSAL_MESSAGE_KINDS).toEqual([
      "lead_note",
      "admin_change_request",
      "pastor_note",
      "system",
    ]);
    expect(PROPOSAL_AUTHOR_ROLES).toEqual(["lead", "admin", "pastor", "system"]);
  });

  it("bounds a thread at 200 messages", () => {
    expect(PROPOSAL_MESSAGES_MAX).toBe(200);
  });
});

describe("parseProposalMessageRequest", () => {
  it("accepts a body and trims only the outer whitespace", () => {
    expect(parseProposalMessageRequest({ body: "  Cambia la última\n\ny avisa  " })).toEqual({
      ok: true,
      value: { body: "Cambia la última\n\ny avisa" },
    });
  });

  it("accepts a body exactly at the shared notes limit", () => {
    const body = "x".repeat(PROPOSAL_NOTES_MAX);
    expect(parseProposalMessageRequest({ body })).toEqual({ ok: true, value: { body } });
  });

  it("reports an oversized body with the SAME issue code the other note fields use", () => {
    expect(parseProposalMessageRequest({ body: "x".repeat(PROPOSAL_NOTES_MAX + 1) })).toEqual({
      ok: false,
      issues: ["notes_length"],
    });
  });

  it.each([
    ["a non-object payload", "hola"],
    ["a missing body", {}],
    ["a non-string body", { body: 3 }],
    ["an empty body", { body: "" }],
    ["a whitespace-only body", { body: "   \n\t " }],
  ])("rejects %s — a blank bubble is noise in a thread", (_label, body) => {
    expect(parseProposalMessageRequest(body).ok).toBe(false);
  });
});

describe("buildProposalMessage", () => {
  const base = {
    authorId: "member-1",
    authorRole: "lead" as const,
    kind: "lead_note" as const,
    body: "  Propongo esta lista  ",
    now: "2026-08-24T18:00:00.000Z",
    key: "abc123def456",
  };

  it("builds the stored shape, with its own _key, its _type and a reference author", () => {
    expect(buildProposalMessage(base)).toEqual({
      _key: "abc123def456",
      _type: "proposal_message",
      author: { _ref: "member-1", _type: "reference" },
      author_role: "lead",
      kind: "lead_note",
      body: "Propongo esta lista",
      at: "2026-08-24T18:00:00.000Z",
    });
  });

  it("carries _type, and its value is the shared constant", () => {
    // NOT the divergence guard — that lives in
    // `scripts/__tests__/migrateProposalMessages.test.ts`, which imports this
    // function and compares the two key sets directly. A hardcoded list here and
    // another there is what let `_type` ship on one side only, with both suites
    // green. This test pins the local shape; the cross-check is over there.
    expect(Object.keys(buildProposalMessage(base) ?? {}).sort()).toEqual(
      ["_key", "_type", "at", "author", "author_role", "body", "kind"].sort(),
    );
    expect(PROPOSAL_MESSAGE_TYPE).toBe("proposal_message");
    expect(buildProposalMessage(base)?._type).toBe(PROPOSAL_MESSAGE_TYPE);
  });

  it("omits `author` entirely when there is nobody to attribute it to", () => {
    // The migrated `admin_notes` case: an absent author renders as "Admin". A
    // fabricated attribution in an audit-adjacent history is worse.
    const message = buildProposalMessage({
      ...base,
      authorId: null,
      authorRole: "admin",
      kind: "admin_change_request",
    });
    expect(message).not.toHaveProperty("author");
    expect(message).toMatchObject({ author_role: "admin", kind: "admin_change_request" });
    expect(buildProposalMessage({ ...base, authorId: "" })).not.toHaveProperty("author");
    expect(buildProposalMessage({ ...base, authorId: undefined })).not.toHaveProperty("author");
  });

  it("mints every reserved kind and role without a schema change", () => {
    for (const kind of PROPOSAL_MESSAGE_KINDS) {
      for (const authorRole of PROPOSAL_AUTHOR_ROLES) {
        expect(buildProposalMessage({ ...base, kind, authorRole })).toMatchObject({
          kind,
          author_role: authorRole,
        });
      }
    }
  });

  it.each([
    ["no _key (the CLAUDE.md array invariant)", { key: "" }],
    ["no timestamp", { now: "" }],
    ["an unknown kind", { kind: "gossip" as never }],
    ["an unknown author role", { authorRole: "pastor_emeritus" as never }],
    ["an empty body", { body: "" }],
    ["a whitespace-only body", { body: "  \n " }],
    ["an oversized body", { body: "x".repeat(PROPOSAL_NOTES_MAX + 1) }],
  ])("refuses to build a half-formed message with %s", (_label, patch) => {
    expect(buildProposalMessage({ ...base, ...patch })).toBeNull();
  });
});

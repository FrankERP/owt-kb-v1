// Pure request parsing and message construction for the private lead ↔ admin
// thread on a `setlistProposal` (Release 2 §4).

import { describe, expect, it } from "vitest";
import {
  PROPOSAL_AUTHOR_ROLES,
  PROPOSAL_MESSAGES_MAX,
  PROPOSAL_MESSAGE_KINDS,
  buildProposalMessage,
  parseProposalMessageRequest,
} from "@/app/utils/proposalMessageWrite";
import { PROPOSAL_NOTES_MAX } from "@/app/utils/proposalWriteRequest";

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

  it("builds the stored shape, with its own _key and a reference author", () => {
    expect(buildProposalMessage(base)).toEqual({
      _key: "abc123def456",
      author: { _ref: "member-1", _type: "reference" },
      author_role: "lead",
      kind: "lead_note",
      body: "Propongo esta lista",
      at: "2026-08-24T18:00:00.000Z",
    });
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

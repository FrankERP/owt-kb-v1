import { describe, expect, it } from "vitest";
import { notificationOutbox } from "@/sanity/schemas/notificationOutbox";
import { schema } from "@/sanity/schema";

const fields = (notificationOutbox.fields as { name: string; type: string }[]);
const byName = (n: string) => fields.find((f) => f.name === n);

describe("notificationOutbox schema", () => {
  it("is hidden from authoring — it is written only by the server token", () => {
    expect(notificationOutbox.hidden).toBe(true);
  });

  it("carries the identity snapshot used when the subject is gone", () => {
    expect(byName("serviceDate")?.type).toBe("string");
    expect(byName("roleType")?.type).toBe("string");
  });

  it("carries the lifecycle fields the sweep depends on", () => {
    for (const n of ["firstQueuedAt", "notifyAfter", "deadline", "claimedAt"]) {
      expect(byName(n)?.type).toBe("datetime");
    }
    expect(byName("status")?.type).toBe("string");
  });

  it("carries the subject/kind identity fields", () => {
    expect(byName("kind")?.type).toBe("string");
    expect(byName("subjectKey")?.type).toBe("string");
  });

  it("stores memberId/roleId/proposalId rather than re-parsing subjectKey", () => {
    // Stored rather than re-parsed out of subjectKey — see the schema comment.
    expect(byName("memberId")?.type).toBe("string");
    expect(byName("roleId")?.type).toBe("string");
    expect(byName("proposalId")?.type).toBe("string");
  });

  it("records which recipients were already known when the notice was queued", () => {
    const knownRecipients = byName("knownRecipients") as unknown as { type: string; of: { type: string }[] };
    expect(knownRecipients.type).toBe("array");
    expect(knownRecipients.of?.[0]?.type).toBe("string");
  });

  it("stores before-snapshots as three typed fields, not a JSON blob", () => {
    const before = byName("before") as unknown as {
      fields: { name: string; type: string; of?: { type: string; fields?: { name: string }[] }[] }[];
    };
    expect(before.fields.map((f) => f.name).sort())
      .toEqual(["beforeNotes", "beforeRoles", "beforeSongs"]);

    const beforeRoles = before.fields.find((f) => f.name === "beforeRoles");
    expect(beforeRoles?.type).toBe("array");

    const beforeSongs = before.fields.find((f) => f.name === "beforeSongs");
    expect(beforeSongs?.type).toBe("array");

    // The `group`-not-`medley_tag` decision is load-bearing: a regression back
    // to a raw medley_tag field must fail here.
    const songRow = beforeSongs?.of?.[0];
    expect(songRow?.fields?.map((f) => f.name).sort()).toEqual(["group", "key", "ref"]);
  });

  it("is registered in the studio schema", () => {
    expect(schema.types.map((t) => (t as { name: string }).name)).toContain("notificationOutbox");
  });
});

describe("notifPrefs", () => {
  it("gains the five per-type email fields, all defaulting to true", () => {
    const teamMembers = schema.types.find((t) => (t as { name: string }).name === "teamMembers") as
      unknown as { fields: { name: string; fields?: { name: string; type?: string; initialValue?: unknown }[] }[] };
    const prefs = teamMembers.fields.find((f) => f.name === "notifPrefs");
    const names = prefs?.fields?.map((f) => f.name) ?? [];
    for (const n of ["emailAssigned", "emailRemoved", "emailRoleChanged", "emailSetlist", "emailProposals"]) {
      expect(names).toContain(n);
      const field = prefs?.fields?.find((f) => f.name === n);
      expect(field?.type).toBe("boolean");
      expect(field?.initialValue).toBe(true);
    }
    // The legacy field stays: it is the fallback for members who opted out.
    expect(names).toContain("email");
  });
});

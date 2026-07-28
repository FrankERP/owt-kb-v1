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

  it("stores before-snapshots as three typed fields, not a JSON blob", () => {
    const before = byName("before") as unknown as { fields: { name: string }[] };
    expect(before.fields.map((f) => f.name).sort())
      .toEqual(["beforeNotes", "beforeRoles", "beforeSongs"]);
  });

  it("is registered in the studio schema", () => {
    expect(schema.types.map((t) => (t as { name: string }).name)).toContain("notificationOutbox");
  });
});

describe("notifPrefs", () => {
  it("gains the five per-type email fields, all defaulting to true", () => {
    const teamMembers = schema.types.find((t) => (t as { name: string }).name === "teamMembers") as
      unknown as { fields: { name: string; fields?: { name: string; initialValue?: unknown }[] }[] };
    const prefs = teamMembers.fields.find((f) => f.name === "notifPrefs");
    const names = prefs?.fields?.map((f) => f.name) ?? [];
    for (const n of ["emailAssigned", "emailRemoved", "emailRoleChanged", "emailSetlist", "emailProposals"]) {
      expect(names).toContain(n);
      expect(prefs?.fields?.find((f) => f.name === n)?.initialValue).toBe(true);
    }
    // The legacy field stays: it is the fallback for members who opted out.
    expect(names).toContain("email");
  });
});

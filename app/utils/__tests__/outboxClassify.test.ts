// app/utils/__tests__/outboxClassify.test.ts
import { describe, expect, it } from "vitest";
import {
  classifyLeadNotes,
  classifyProposalMessages,
  classifyRole,
  classifySetlist,
  LINE_PREF,
} from "../outboxClassify";

const TODAY = "2026-08-01";
const FUTURE = "2026-08-09";
const row = (ref: string, key: string, group: number | null = null) =>
  ({ _key: `k${ref}`, ref, key, group });

describe("classifyRole", () => {
  const base = { serviceDate: FUTURE, roleType: "sunday_role" as const, today: TODAY, roleExists: true, published: true };

  it("empty -> non-empty is a new assignment", () => {
    expect(classifyRole({ ...base, before: [], after: ["Líder"] })?.kind).toBe("assigned");
  });

  it("non-empty -> empty is a removal", () => {
    expect(classifyRole({ ...base, before: ["BGV"], after: [] })?.kind).toBe("removed");
  });

  it("different non-empty sets are a role change", () => {
    const line = classifyRole({ ...base, before: ["BGV"], after: ["Líder"] });
    expect(line?.kind).toBe("roleChanged");
    expect(line?.before).toEqual(["BGV"]);
    expect(line?.after).toEqual(["Líder"]);
  });

  it("an unchanged set says nothing", () => {
    // Remove-then-re-add inside the window collapses to silence.
    expect(classifyRole({ ...base, before: ["BGV"], after: ["BGV"] })).toBeNull();
  });

  it("drops silently when the service is now unpublished", () => {
    expect(classifyRole({ ...base, published: false, before: ["BGV"], after: [] })).toBeNull();
  });

  it("a deleted role tells the people who knew about it", () => {
    expect(classifyRole({ ...base, roleExists: false, before: ["BGV"], after: [] })?.kind).toBe("removed");
  });

  it("a deleted role says NOTHING to people who were never introduced", () => {
    // Create a published service at 10:00, delete it at 10:05: every assignee
    // has before=[] and would otherwise be told they no longer participate in a
    // service they were never told existed.
    expect(classifyRole({ ...base, roleExists: false, before: [], after: [] })).toBeNull();
  });

  it("a deleted role still tells former assignees regardless of what `published` carries", () => {
    // Pins the roleExists gate on the unpublish guard: once the role is gone
    // there's no real `published` field to read, so the guard must not run —
    // the deleted-role branch decides on its own, for either published value.
    expect(classifyRole({ ...base, roleExists: false, published: true, before: ["BGV"], after: [] })?.kind).toBe("removed");
    expect(classifyRole({ ...base, roleExists: false, published: false, before: ["BGV"], after: [] })?.kind).toBe("removed");
  });

  it("a deleted role with no before-snapshot stays silent regardless of what `published` carries", () => {
    // Complementary case: the "never introduced" silence gate also must not
    // depend on the meaningless `published` value for a vanished role.
    expect(classifyRole({ ...base, roleExists: false, published: true, before: [], after: [] })).toBeNull();
    expect(classifyRole({ ...base, roleExists: false, published: false, before: [], after: [] })).toBeNull();
  });

  it("drops a service whose date has passed", () => {
    expect(classifyRole({ ...base, serviceDate: "2026-07-31", before: [], after: ["Líder"] })).toBeNull();
  });

  it("keeps a service happening today", () => {
    expect(classifyRole({ ...base, serviceDate: TODAY, before: [], after: ["Líder"] })?.kind).toBe("assigned");
  });
});

describe("classifySetlist", () => {
  const base = { serviceDate: FUTURE, roleType: "sunday_role" as const, today: TODAY, roleExists: true, published: true, dateMatches: true };

  it("empty -> songs introduces the setlist", () => {
    expect(classifySetlist({ ...base, before: [], after: [row("a", "G")] })?.kind).toBe("setlistReady");
  });

  it("a changed key is a change", () => {
    expect(classifySetlist({ ...base, before: [row("a", "E")], after: [row("a", "G")] })?.kind).toBe("setlistChanged");
  });

  it("a reorder is a change", () => {
    expect(classifySetlist({ ...base, before: [row("a", "G"), row("b", "D")], after: [row("b", "D"), row("a", "G")] })?.kind).toBe("setlistChanged");
  });

  it("a regrouping is a change even with identical songs and keys", () => {
    expect(classifySetlist({
      ...base,
      before: [row("a", "G"), row("b", "D")],
      after: [row("a", "G", 0), row("b", "D", 0)],
    })?.kind).toBe("setlistChanged");
  });

  it("an identical list says nothing", () => {
    expect(classifySetlist({ ...base, before: [row("a", "G")], after: [row("a", "G")] })).toBeNull();
  });

  it("an emptied setlist is work in progress, not news", () => {
    expect(classifySetlist({ ...base, before: [row("a", "G")], after: [] })).toBeNull();
  });

  it("drops when unpublished, when the role is gone, or when the date moved", () => {
    const after = [row("a", "G")];
    expect(classifySetlist({ ...base, published: false, before: [], after })).toBeNull();
    expect(classifySetlist({ ...base, roleExists: false, before: [], after })).toBeNull();
    expect(classifySetlist({ ...base, dateMatches: false, before: [], after })).toBeNull();
  });

  it("drops a service whose date has passed", () => {
    // Pins isPast for classifySetlist, exercised so far only via classifyRole.
    expect(classifySetlist({ ...base, serviceDate: "2026-07-31", before: [], after: [row("a", "G")] })).toBeNull();
  });
});

describe("classifyLeadNotes", () => {
  const base = { serviceDate: FUTURE, today: TODAY, reviewable: true };

  it("reports a real change", () => {
    expect(classifyLeadNotes({ ...base, before: "", after: "Bajé la tonalidad" })?.kind).toBe("leadNotes");
  });

  it("ignores whitespace-only differences", () => {
    expect(classifyLeadNotes({ ...base, before: "hola", after: "  hola  " })).toBeNull();
  });

  it("drops when the proposal is no longer reviewable", () => {
    expect(classifyLeadNotes({ ...base, reviewable: false, before: "", after: "x" })).toBeNull();
  });

  it("drops a service whose date has passed", () => {
    // Pins isPast for classifyLeadNotes, exercised so far only via classifyRole.
    expect(classifyLeadNotes({ ...base, serviceDate: "2026-07-31", before: "", after: "x" })).toBeNull();
  });
});

describe("LINE_PREF", () => {
  it("maps every line kind to the toggle that gates it", () => {
    expect(LINE_PREF).toEqual({
      assigned: "assigned",
      removed: "removed",
      roleChanged: "roleChanged",
      setlistReady: "setlist",
      setlistChanged: "setlist",
      leadNotes: "proposals",
    });
  });
});

describe("classifyProposalMessages", () => {
  const base = { serviceDate: FUTURE, today: TODAY, reviewable: true };
  const note = (body: string) => ({ kind: "lead_note", body });

  it("joins every message appended since the notice was queued", () => {
    const line = classifyProposalMessages({
      ...base,
      beforeCount: 1,
      leadMessages: [note("vieja"), note("uno"), note("dos")],
    });
    // The whole burst, not just the newest: the debounce collapses a
    // conversation into one email and dropping its middle is worse than length.
    expect(line?.notes).toBe("uno\n\ndos");
    expect(line?.kind).toBe("leadNotes");
  });

  it("says nothing when the count already covers every message", () => {
    expect(
      classifyProposalMessages({ ...base, beforeCount: 2, leadMessages: [note("a"), note("b")] }),
    ).toBeNull();
  });

  it("treats beforeCount 0 as the legitimate first-message case", () => {
    const line = classifyProposalMessages({ ...base, beforeCount: 0, leadMessages: [note("hola")] });
    expect(line?.notes).toBe("hola");
  });

  it("does NOT re-filter — the array arrives already filtered", () => {
    // If this function filtered on `kind` and a caller narrowed the projection
    // to `{body}`, nothing would match and the email would die silently. It
    // takes what it is given.
    const line = classifyProposalMessages({
      ...base,
      beforeCount: 0,
      leadMessages: [{ body: "sin kind" }],
    });
    expect(line?.notes).toBe("sin kind");
  });

  it("coerces the null GROQ returns for a document with no messages", () => {
    expect(classifyProposalMessages({ ...base, beforeCount: 0, leadMessages: null })).toBeNull();
    expect(classifyProposalMessages({ ...base, beforeCount: 0, leadMessages: undefined })).toBeNull();
  });

  it("drops a past service and a non-reviewable status, like its predecessor", () => {
    expect(
      classifyProposalMessages({ ...base, serviceDate: "2026-07-01", beforeCount: 0, leadMessages: [note("x")] }),
    ).toBeNull();
    expect(
      classifyProposalMessages({ ...base, reviewable: false, beforeCount: 0, leadMessages: [note("x")] }),
    ).toBeNull();
  });

  it("clamps a negative count instead of slicing from the END", () => {
    // `slice(-2)` would silently send the last TWO — a plausible-looking batch
    // whose size depends on the corrupt value. Clamping sends all three, which
    // is more wrong and therefore visible.
    const line = classifyProposalMessages({
      ...base,
      beforeCount: -2,
      leadMessages: [note("a"), note("b"), note("c")],
    });
    expect(line?.notes).toBe("a\n\nb\n\nc");
  });

  it("treats NaN as 0, since a `typeof number` guard would not stop one", () => {
    const line = classifyProposalMessages({
      ...base,
      beforeCount: Number.NaN,
      leadMessages: [note("a")],
    });
    expect(line?.notes).toBe("a");
  });

  it("says nothing rather than mailing a blank section", () => {
    // Not writable through `buildProposalMessage`; reachable by hand-editing.
    expect(
      classifyProposalMessages({
        ...base,
        beforeCount: 0,
        leadMessages: [{ kind: "lead_note", body: "   " }, { kind: "lead_note", body: 42 }],
      }),
    ).toBeNull();
  });

  it("carries the same preference key as the string classifier it replaces", () => {
    const line = classifyProposalMessages({ ...base, beforeCount: 0, leadMessages: [note("x")] });
    expect(LINE_PREF[line!.kind]).toBe("proposals");
  });
});

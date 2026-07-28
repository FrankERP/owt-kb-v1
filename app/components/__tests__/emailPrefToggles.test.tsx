/** @vitest-environment jsdom */
// The defect this file exists to prevent: five switches drawn ON for a member
// who receives nothing.
//
// There is no data migration. A member who opted out of the legacy
// `notifPrefs.email` has all five per-type fields unset, which resolves to "no
// mail" — but an unset boolean renders as its `true` default, and §5 takes the
// legacy toggle out of the panels. So the panels must render the RESOLVED value,
// through the same `wantsNotification` the senders use.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmailPrefToggles, {
  EMAIL_PREF_ROWS,
  resolveEmailPrefs,
  visibleEmailPrefRows,
} from "../ui/EmailPrefToggles";
import { CueDialogProvider } from "../ui/CueDialogProvider";
import ProfilePanel from "../ProfilePanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const FIELDS = ["emailAssigned", "emailRemoved", "emailRoleChanged", "emailSetlist", "emailProposals"];

describe("resolveEmailPrefs", () => {
  it("covers exactly the five per-type fields", () => {
    expect(EMAIL_PREF_ROWS.map((r) => r.field)).toEqual(FIELDS);
  });

  it("resolves a legacy opt-out to all five OFF", () => {
    expect(resolveEmailPrefs({ email: false })).toEqual({
      emailAssigned: false, emailRemoved: false, emailRoleChanged: false,
      emailSetlist: false, emailProposals: false,
    });
  });

  it("resolves an unset bag to all five ON", () => {
    expect(resolveEmailPrefs({})).toEqual({
      emailAssigned: true, emailRemoved: true, emailRoleChanged: true,
      emailSetlist: true, emailProposals: true,
    });
    expect(resolveEmailPrefs(undefined)).toEqual(resolveEmailPrefs({}));
  });

  it("lets an explicit per-type field beat the legacy fallback, both ways", () => {
    expect(resolveEmailPrefs({ email: false, emailSetlist: true })).toMatchObject({
      emailSetlist: true, emailAssigned: false,
    });
    expect(resolveEmailPrefs({ email: true, emailSetlist: false })).toMatchObject({
      emailSetlist: false, emailAssigned: true,
    });
  });
});

describe("visibleEmailPrefRows", () => {
  // Both emails "Propuestas" gates go to `role in ["super-admin","admin"]`
  // (proposalNotify.ts and outboxSweep's ADMIN_RECIPIENTS_QUERY), so showing that
  // switch to a plain member offered control over nothing they could receive.
  it("shows all five to an admin and a super-admin", () => {
    for (const role of ["admin", "super-admin"]) {
      expect(visibleEmailPrefRows(role).map((r) => r.field), role).toEqual(FIELDS);
    }
  });

  it("hides the admin-only row from everyone else", () => {
    for (const role of ["member", "content-editor", "", undefined]) {
      expect(visibleEmailPrefRows(role).map((r) => r.field), String(role)).toEqual(
        FIELDS.filter((f) => f !== "emailProposals"),
      );
    }
  });

  it("keeps EMAIL_PREF_ROWS itself complete — only the RENDERED rows are filtered", () => {
    // The field is still stored, still resolved and still honoured by the
    // senders for every member; this is a UI-visibility rule, not a policy one.
    expect(EMAIL_PREF_ROWS.map((r) => r.field)).toEqual(FIELDS);
    expect(Object.keys(resolveEmailPrefs({})).sort()).toEqual([...FIELDS].sort());
  });
});

describe("EmailPrefToggles", () => {
  it("draws one switch per visible type, checked from the resolved values", () => {
    const { getAllByRole } = render(
      <EmailPrefToggles
        values={resolveEmailPrefs({ email: false })}
        onToggle={() => {}}
        memberRole="admin"
      />,
    );
    const switches = getAllByRole("switch");
    expect(switches).toHaveLength(5);
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(
      ["false", "false", "false", "false", "false"],
    );
  });

  it("draws four switches for a plain member, without the admin-only row", () => {
    const { getAllByRole, queryByRole } = render(
      <EmailPrefToggles
        values={resolveEmailPrefs({ email: false })}
        onToggle={() => {}}
        memberRole="member"
      />,
    );
    const switches = getAllByRole("switch");
    expect(switches).toHaveLength(4);
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(
      ["false", "false", "false", "false"],
    );
    expect(queryByRole("switch", { name: "Propuestas" })).toBeNull();
  });

  it("reports the field and the NEXT value on toggle", () => {
    const onToggle = vi.fn();
    const { getByRole } = render(
      <EmailPrefToggles values={resolveEmailPrefs({})} onToggle={onToggle} memberRole="member" />,
    );
    fireEvent.click(getByRole("switch", { name: "Setlist" }));
    expect(onToggle).toHaveBeenCalledWith("emailSetlist", false);
  });
});

// ── The panel, end to end ───────────────────────────────────────────────────

const baseMember = {
  _id: "m1",
  member_name: "Ana Torres",
  email: "ana@example.com",
  role: "member",
  hasPassword: true,
};

function openProfile(notifPrefs: Record<string, unknown> | undefined, role = baseMember.role) {
  const utils = render(
    <CueDialogProvider>
      <ProfilePanel initialMember={{ ...baseMember, role, notifPrefs }} />
    </CueDialogProvider>,
  );
  act(() => { fireEvent.click(utils.getByRole("button", { name: /Editar perfil/i })); });
  return utils;
}

describe("ProfilePanel notification section", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  it("shows every switch OFF for a member who opted out before per-type toggles existed", () => {
    const { getAllByRole, queryByRole } = openProfile({ email: false });
    const switches = getAllByRole("switch");
    // Four, not five: "Propuestas" gates two admin-only emails (see above).
    expect(switches).toHaveLength(4);
    for (const s of switches) expect(s.getAttribute("aria-checked")).toBe("false");
    expect(queryByRole("switch", { name: "Propuestas" })).toBeNull();
  });

  it("shows every switch ON for a member who never touched a preference", () => {
    const { getAllByRole } = openProfile({});
    const switches = getAllByRole("switch");
    expect(switches).toHaveLength(4);
    for (const s of switches) expect(s.getAttribute("aria-checked")).toBe("true");
  });

  it("shows the admin-only row to an admin, resolved like the rest", () => {
    const { getAllByRole, getByRole } = openProfile({ email: false }, "admin");
    expect(getAllByRole("switch")).toHaveLength(5);
    expect(getByRole("switch", { name: "Propuestas" }).getAttribute("aria-checked")).toBe("false");
  });

  it("honours an explicit per-type field over the legacy fallback", () => {
    const { getByRole } = openProfile({ email: false, emailProposals: true }, "admin");
    expect(getByRole("switch", { name: "Propuestas" }).getAttribute("aria-checked")).toBe("true");
    expect(getByRole("switch", { name: "Setlist" }).getAttribute("aria-checked")).toBe("false");
  });

  it("PATCHes only the toggled field", async () => {
    const { getByRole } = openProfile({});
    await act(async () => {
      fireEvent.click(getByRole("switch", { name: "Cambios de rol" }));
    });
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/me/notif-prefs");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ emailRoleChanged: false });
  });

  it("reverts the switch and re-enables it when the save fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const { getByRole } = openProfile({});
    const target = getByRole("switch", { name: "Avisos de baja" });
    await act(async () => { fireEvent.click(target); });
    expect(target.getAttribute("aria-checked")).toBe("true");   // reverted
    expect(target.hasAttribute("disabled")).toBe(false);        // loading flag reset
  });

  it("reverts and re-enables when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { getByRole } = openProfile({});
    const target = getByRole("switch", { name: "Setlist" });
    await act(async () => { fireEvent.click(target); });
    expect(target.getAttribute("aria-checked")).toBe("true");
    expect(target.hasAttribute("disabled")).toBe(false);
  });
});

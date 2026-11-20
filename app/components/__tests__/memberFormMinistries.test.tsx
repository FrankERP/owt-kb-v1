/** @vitest-environment jsdom */
// The privilege-wipe class this form exists to avoid, from both directions.
//
// `ministries` is ABSENT on every member predating Oasis Kids (no migration),
// which makes two natural gestures dangerous:
//   - seeding the checkboxes from the raw value draws a full worship member as
//     belonging to nothing, so ticking "Oasis Kids" would submit `["kids"]` and
//     revoke the worship app;
//   - submitting the arrays unconditionally would let an unrelated typo fix
//     PATCH `ministries: []` / `managesMinistries: []` over whatever is stored.
// Both are silent — the save succeeds and the panel says "Miembro actualizado."

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberForm, MinistryScopeBar, ministryScopeIds, resolveMinistryScope } from "../admin/MembersPanel";

afterEach(cleanup);

const BASE = {
  _id: "m1",
  member_name: "Ana",
  alias: "Ani",
  email: "ana@example.com",
  role: "member" as const,
  memberType: ["voz"],
  hasPassword: true,
};

function renderForm(initial?: Parameters<typeof MemberForm>[0]["initial"]) {
  const onSubmit = vi.fn();
  const { container } = render(
    <MemberForm initial={initial} onSubmit={onSubmit} onClose={() => {}} loading={false} />,
  );
  const submit = () => fireEvent.submit(container.querySelector("form")!);
  return { onSubmit, submit };
}

/** The ministry row's button (the "Administra" row repeats "Oasis Kids"). */
function toggle(label: string, row: "member" | "manage" = "member") {
  const all = screen.getAllByRole("button", { name: label });
  // Document order: Ministerios first, Administra ministerios second.
  return all[row === "member" ? 0 : all.length - 1] as HTMLButtonElement;
}

describe("MemberForm — ministry seeding", () => {
  it("shows a LEGACY member (no stored ministries) as Alabanza, not as nothing", () => {
    renderForm(BASE);
    expect(toggle("Alabanza").getAttribute("aria-pressed")).toBe("true");
    expect(toggle("Oasis Kids").getAttribute("aria-pressed")).toBe("false");
  });

  it("adds kids to the existing worship membership — never replaces it", () => {
    const { onSubmit, submit } = renderForm(BASE);
    fireEvent.click(toggle("Oasis Kids"));
    submit();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].ministries).toEqual(["worship", "kids"]);
  });

  it("seeds a kids-only member from storage", () => {
    renderForm({ ...BASE, ministries: ["kids"], managesMinistries: ["kids"] });
    expect(toggle("Alabanza").getAttribute("aria-pressed")).toBe("false");
    expect(toggle("Oasis Kids").getAttribute("aria-pressed")).toBe("true");
    expect(toggle("Oasis Kids", "manage").getAttribute("aria-pressed")).toBe("true");
  });

  it("defaults a NEW member to Alabanza", () => {
    const { onSubmit, submit } = renderForm(undefined);
    expect(toggle("Alabanza").getAttribute("aria-pressed")).toBe("true");
    submit();
    expect(onSubmit.mock.calls[0][0].ministries).toEqual(["worship"]);
  });
});

describe("MemberForm — touched-field-only submission", () => {
  it("REGRESSION: an edit that touches no ministry row submits NEITHER key", () => {
    const { onSubmit, submit } = renderForm({ ...BASE, ministries: ["kids"], managesMinistries: ["kids"] });
    fireEvent.change(screen.getByPlaceholderText("Nombre corto o apodo (opcional)"), {
      target: { value: "Anita" },
    });
    submit();
    const data = onSubmit.mock.calls[0][0];
    expect(data.alias).toBe("Anita");
    expect(data).not.toHaveProperty("ministries");
    expect(data).not.toHaveProperty("managesMinistries");
  });

  it("sends only the row that was touched", () => {
    const { onSubmit, submit } = renderForm({ ...BASE, ministries: ["kids"] });
    fireEvent.click(toggle("Oasis Kids", "manage"));
    submit();
    const data = onSubmit.mock.calls[0][0];
    expect(data.managesMinistries).toEqual(["kids"]);
    expect(data).not.toHaveProperty("ministries");
  });

  it("sends both on create, so a Kids volunteer is never worship-then-fixed", () => {
    const { onSubmit, submit } = renderForm(undefined);
    fireEvent.click(toggle("Alabanza"));
    fireEvent.click(toggle("Oasis Kids"));
    submit();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ ministries: ["kids"], managesMinistries: [] });
  });
});

describe("MemberForm — at least one ministry", () => {
  it("blocks an EDIT that unticks the last ministry", () => {
    const { onSubmit, submit } = renderForm({ ...BASE, ministries: ["kids"] });
    fireEvent.click(toggle("Oasis Kids"));
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Elige al menos un ministerio.")).toBeTruthy();
  });

  it("blocks a CREATE with every box unticked", () => {
    const { onSubmit, submit } = renderForm(undefined);
    fireEvent.click(toggle("Alabanza"));
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Elige al menos un ministerio.")).toBeTruthy();
  });

  it("clears the message once a ministry is ticked again", () => {
    const { onSubmit, submit } = renderForm(undefined);
    fireEvent.click(toggle("Alabanza"));
    submit();
    fireEvent.click(toggle("Oasis Kids"));
    expect(screen.queryByText("Elige al menos un ministerio.")).toBeNull();
    submit();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

// ADR-0075, access plan §3.4 and §8: Jóvenes is assignable, with a level and
// groups. The level travels WITH `ministries` (the route judges it against them),
// seeded through the read's normalizer and sent without `_key`/`_type`.
describe("MemberForm — the Jóvenes block", () => {
  const STORED_ADMIN = {
    ...BASE,
    ministries: ["worship", "jovenes"],
    ministryRoles: [{ _key: "jovenes", _type: "ministryRole", ministry: "jovenes", level: "admin", groups: ["emprendedores"] }],
  };
  const radio = (name: string) => screen.getByRole("radio", { name });
  const groupsRow = () => screen.getByRole("group", { name: "Grupos en Jóvenes" });
  const leadsRow = () => screen.queryByRole("group", { name: "Lidera en Jóvenes" });
  const pressed = (row: HTMLElement) =>
    within(row).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);

  it("labels the role as worship's own", () => {
    renderForm(BASE);
    expect(screen.getByLabelText("Rol en Alabanza")).toBeTruthy();
  });

  it("shows no block until Jóvenes is ticked; ticking it sends a plain member level", () => {
    const { onSubmit, submit } = renderForm(BASE);
    expect(screen.queryByRole("radiogroup", { name: "Nivel en Jóvenes" })).toBeNull();
    fireEvent.click(toggle("Jóvenes"));
    expect(screen.getByRole("radiogroup", { name: "Nivel en Jóvenes" })).toBeTruthy();
    submit();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      ministries: ["worship", "jovenes"],
      ministryRoles: [{ ministry: "jovenes", level: "member", groups: [], leaderOf: [] }],
    });
  });

  it("seeds level and groups from storage and sends them back WITHOUT _key/_type", () => {
    const { onSubmit, submit } = renderForm(STORED_ADMIN);
    expect(radio("Admin").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Emprendedores").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle("Otro Nivel"));
    submit();
    expect(onSubmit.mock.calls[0][0].ministryRoles).toEqual([
      { ministry: "jovenes", level: "admin", groups: ["emprendedores", "otro-nivel"], leaderOf: [] },
    ]);
  });

  it("touching only the level still sends ministries with it", () => {
    const { onSubmit, submit } = renderForm(STORED_ADMIN);
    fireEvent.click(radio("Miembro"));
    submit();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      ministries: ["worship", "jovenes"],
      ministryRoles: [{ ministry: "jovenes", level: "member", groups: ["emprendedores"], leaderOf: [] }],
    });
  });

  it("touching another ministry re-sends the stored level intact", () => {
    const { onSubmit, submit } = renderForm(STORED_ADMIN);
    fireEvent.click(toggle("Oasis Kids"));
    submit();
    expect(onSubmit.mock.calls[0][0].ministryRoles).toEqual([{ ministry: "jovenes", level: "admin", groups: ["emprendedores"], leaderOf: [] }]);
  });

  it("unticking Jóvenes drops its item, so the person can leave it", () => {
    const { onSubmit, submit } = renderForm(STORED_ADMIN);
    fireEvent.click(toggle("Jóvenes"));
    submit();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ ministries: ["worship"], ministryRoles: [] });
  });

  it("an edit that touches no ministry sends neither ministries nor ministryRoles", () => {
    const { onSubmit, submit } = renderForm(STORED_ADMIN);
    fireEvent.change(screen.getByPlaceholderText("Nombre corto o apodo (opcional)"), { target: { value: "Noe" } });
    submit();
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("ministries");
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("ministryRoles");
  });

  it("a leader who leads no group is stopped in the form", () => {
    const { onSubmit, submit } = renderForm(BASE);
    fireEvent.click(toggle("Jóvenes"));
    fireEvent.click(radio("Líder"));
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Un líder necesita liderar al menos un grupo.")).toBeTruthy();
    // In a group but leading none: still stopped (choosing «Líder» pre-ticks nothing).
    fireEvent.click(within(groupsRow()).getByRole("button", { name: "Otro Nivel" }));
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a level stored without membership is not shown (the read ignores it)", () => {
    renderForm({ ...STORED_ADMIN, ministries: ["worship"] });
    fireEvent.click(toggle("Jóvenes"));
    expect(radio("Miembro").getAttribute("aria-checked")).toBe("true");
  });

  // Per-group leadership (plan 2026-11-11 T8, ADR-0085).
  const JACOB = {
    ...BASE,
    ministries: ["worship", "jovenes"],
    ministryRoles: [{
      _key: "jovenes", _type: "ministryRole", ministry: "jovenes", level: "leader",
      groups: ["otro-nivel", "invencibles", "adrenalin"], leaderOf: ["otro-nivel", "adrenalin"],
    }],
  };

  it("seeds «Lidera» from the stored leaderOf, offering only the ticked groups", () => {
    renderForm(JACOB);
    expect(pressed(groupsRow())).toEqual(["Otro Nivel", "Invencibles", "Adrenalin"]);
    const row = leadsRow()!;
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["Otro Nivel", "Invencibles", "Adrenalin"]);
    expect(pressed(row)).toEqual(["Otro Nivel", "Adrenalin"]);
  });

  it("a legacy leader (no stored leaderOf) seeds leading nothing (L2)", () => {
    const { onSubmit, submit } = renderForm({ ...JACOB, ministryRoles: [{ ...JACOB.ministryRoles[0], leaderOf: undefined }] });
    expect(pressed(leadsRow()!)).toEqual([]);
    submit();
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("ministryRoles");
  });

  it("shows «Lidera» only while «Líder» is selected; leaving «Líder» clears it and the body sends leaderOf []", () => {
    const { onSubmit, submit } = renderForm(JACOB);
    fireEvent.click(radio("Miembro"));
    expect(leadsRow()).toBeNull();
    fireEvent.click(radio("Líder"));
    expect(pressed(leadsRow()!)).toEqual([]);
    fireEvent.click(radio("Admin"));
    submit();
    expect(onSubmit.mock.calls[0][0].ministryRoles).toEqual([
      { ministry: "jovenes", level: "admin", groups: ["otro-nivel", "invencibles", "adrenalin"], leaderOf: [] },
    ]);
  });

  it("the «Lidera» pills follow the groups: a new group is offered unticked, an unticked group leaves leaderOf", () => {
    const { onSubmit, submit } = renderForm(JACOB);
    fireEvent.click(within(groupsRow()).getByRole("button", { name: "Guerreras" }));
    expect(within(leadsRow()!).getAllByRole("button").map((b) => b.textContent)).toContain("Guerreras");
    expect(pressed(leadsRow()!)).toEqual(["Otro Nivel", "Adrenalin"]);
    fireEvent.click(within(groupsRow()).getByRole("button", { name: "Adrenalin" }));
    expect(within(leadsRow()!).queryByRole("button", { name: "Adrenalin" })).toBeNull();
    fireEvent.click(within(leadsRow()!).getByRole("button", { name: "Invencibles" }));
    submit();
    expect(onSubmit.mock.calls[0][0].ministryRoles).toEqual([
      { ministry: "jovenes", level: "leader", groups: ["otro-nivel", "invencibles", "guerreras"], leaderOf: ["otro-nivel", "invencibles"] },
    ]);
  });

  it("a new leader: pick the groups, then which of them they lead", () => {
    const { onSubmit, submit } = renderForm(undefined);
    fireEvent.click(toggle("Jóvenes"));
    fireEvent.click(radio("Líder"));
    fireEvent.click(within(groupsRow()).getByRole("button", { name: "Invencibles" }));
    fireEvent.click(within(groupsRow()).getByRole("button", { name: "Otro Nivel" }));
    fireEvent.click(within(leadsRow()!).getByRole("button", { name: "Invencibles" }));
    submit();
    expect(onSubmit.mock.calls[0][0].ministryRoles).toEqual([
      { ministry: "jovenes", level: "leader", groups: ["invencibles", "otro-nivel"], leaderOf: ["invencibles"] },
    ]);
  });

  it("an untouched leader sends neither ministries nor ministryRoles", () => {
    const { onSubmit, submit } = renderForm(JACOB);
    fireEvent.change(screen.getByPlaceholderText("Nombre corto o apodo (opcional)"), { target: { value: "Jake" } });
    submit();
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("ministries");
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("ministryRoles");
  });

  it("the hint says a leader plans only the groups they lead", () => {
    renderForm(JACOB);
    expect(
      screen.getByText("Admin administra todo Jóvenes. Un líder planea solo los grupos que lidera; en los demás es miembro. No da acceso a Alabanza."),
    ).toBeTruthy();
  });

  it("a new member sends ministryRoles too (empty when Jóvenes is not ticked)", () => {
    const { onSubmit, submit } = renderForm(undefined);
    submit();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ ministries: ["worship"], ministryRoles: [] });
  });
});

describe("the scope bar offers Jóvenes to the super-admin only (access plan §8.5)", () => {
  const members = [
    { ministries: ["worship"] },
    { ministries: ["kids"] },
    { ministries: ["worship", "jovenes"] },
  ];

  it("a worship admin's bar has no Jóvenes tab, even with a member who holds it", () => {
    const { counts, visible } = resolveMinistryScope(members, "all", ministryScopeIds(false));
    expect(visible).toBe(true);
    render(<MinistryScopeBar counts={counts} total={members.length} visible={visible} value="all" onChange={() => {}} />);
    expect(screen.queryByText("Jóvenes")).toBeNull();
    expect(screen.getByText("Oasis Kids")).toBeTruthy();
  });

  it("a Jóvenes member alone does not make a worship admin's bar appear", () => {
    expect(resolveMinistryScope([{ ministries: ["worship"] }, { ministries: ["jovenes"] }], "all").visible).toBe(false);
  });

  it("the super-admin's bar has a Jóvenes tab, and it scopes the list", () => {
    const ids = ministryScopeIds(true);
    const { counts, visible, scoped } = resolveMinistryScope(members, "jovenes", ids);
    expect(visible).toBe(true);
    expect(scoped).toEqual([{ ministries: ["worship", "jovenes"] }]);
    render(<MinistryScopeBar counts={counts} total={members.length} visible={visible} value="jovenes" onChange={() => {}} scopeIds={ids} />);
    expect(screen.getByText("Jóvenes")).toBeTruthy();
  });
});

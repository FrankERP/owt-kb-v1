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

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      ministryRoles: [{ ministry: "jovenes", level: "member", groups: [] }],
    });
  });

  it("seeds level and groups from storage and sends them back WITHOUT _key/_type", () => {
    const { onSubmit, submit } = renderForm(STORED_ADMIN);
    expect(radio("Admin").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Emprendedores").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle("Otro Nivel"));
    submit();
    expect(onSubmit.mock.calls[0][0].ministryRoles).toEqual([
      { ministry: "jovenes", level: "admin", groups: ["emprendedores", "otro-nivel"] },
    ]);
  });

  it("touching only the level still sends ministries with it", () => {
    const { onSubmit, submit } = renderForm(STORED_ADMIN);
    fireEvent.click(radio("Miembro"));
    submit();
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      ministries: ["worship", "jovenes"],
      ministryRoles: [{ ministry: "jovenes", level: "member", groups: ["emprendedores"] }],
    });
  });

  it("touching another ministry re-sends the stored level intact", () => {
    const { onSubmit, submit } = renderForm(STORED_ADMIN);
    fireEvent.click(toggle("Oasis Kids"));
    submit();
    expect(onSubmit.mock.calls[0][0].ministryRoles).toEqual([{ ministry: "jovenes", level: "admin", groups: ["emprendedores"] }]);
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

  it("a leader with no group is stopped in the form", () => {
    const { onSubmit, submit } = renderForm(BASE);
    fireEvent.click(toggle("Jóvenes"));
    fireEvent.click(radio("Líder"));
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Un líder necesita al menos un grupo.")).toBeTruthy();
  });

  it("a level stored without membership is not shown (the read ignores it)", () => {
    renderForm({ ...STORED_ADMIN, ministries: ["worship"] });
    fireEvent.click(toggle("Jóvenes"));
    expect(radio("Miembro").getAttribute("aria-checked")).toBe("true");
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

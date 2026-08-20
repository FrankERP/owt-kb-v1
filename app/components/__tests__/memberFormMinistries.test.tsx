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
import { MemberForm } from "../admin/AdminPanel";

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

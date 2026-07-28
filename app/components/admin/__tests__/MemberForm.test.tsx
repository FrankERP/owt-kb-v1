/** @vitest-environment jsdom */
// The defect this file exists to prevent: an admin editing only a member's
// name (or any other identity field) silently restores email preferences the
// member has since turned off in their own profile. The admin's member list
// can be stale relative to that change, so the form must submit ONLY the
// preference fields actually toggled during this editing session — never the
// full resolved snapshot it started from.

import { fireEvent, render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberForm } from "../AdminPanel";

afterEach(() => cleanup());

const baseMember = {
  _id: "m1",
  member_name: "Ana Torres",
  alias: "",
  email: "ana@example.com",
  role: "member" as const,
  memberType: [],
  hasPassword: true,
  // Unset: resolves to all five ON, same as a member who never touched a
  // preference.
  notifPrefs: {},
};

describe("MemberForm — edit mode preference submission", () => {
  it("sends no preference fields when only the name changes", () => {
    const onSubmit = vi.fn();
    const { getByPlaceholderText, getByRole } = render(
      <MemberForm initial={baseMember} onSubmit={onSubmit} onClose={() => {}} loading={false} />,
    );

    fireEvent.change(getByPlaceholderText("Nombre completo"), { target: { value: "Ana T. Torres" } });
    fireEvent.click(getByRole("button", { name: "Guardar" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.member_name).toBe("Ana T. Torres");
    expect(submitted.emailPrefs).toBeUndefined();
    expect("emailPrefs" in submitted).toBe(false);
  });

  it("sends only the toggled field when one switch is flipped", () => {
    const onSubmit = vi.fn();
    const { getByRole } = render(
      <MemberForm initial={baseMember} onSubmit={onSubmit} onClose={() => {}} loading={false} />,
    );

    fireEvent.click(getByRole("switch", { name: "Setlist" }));
    fireEvent.click(getByRole("button", { name: "Guardar" }));

    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.emailPrefs).toEqual({ emailSetlist: false });
  });

  it("does not widen to the other four fields when the name also changes", () => {
    const onSubmit = vi.fn();
    const { getByPlaceholderText, getByRole } = render(
      <MemberForm initial={baseMember} onSubmit={onSubmit} onClose={() => {}} loading={false} />,
    );

    fireEvent.change(getByPlaceholderText("Nombre completo"), { target: { value: "Ana T. Torres" } });
    fireEvent.click(getByRole("switch", { name: "Propuestas" }));
    fireEvent.click(getByRole("button", { name: "Guardar" }));

    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.member_name).toBe("Ana T. Torres");
    expect(submitted.emailPrefs).toEqual({ emailProposals: false });
  });

  it("a brand-new member (no `initial`) never carries a preferences key", () => {
    const onSubmit = vi.fn();
    const { getByPlaceholderText, getByRole } = render(
      <MemberForm onSubmit={onSubmit} onClose={() => {}} loading={false} />,
    );

    fireEvent.change(getByPlaceholderText("Nombre completo"), { target: { value: "Nuevo Miembro" } });
    fireEvent.change(getByPlaceholderText("correo@ejemplo.com"), { target: { value: "nuevo@example.com" } });
    fireEvent.click(getByRole("button", { name: "Guardar" }));

    const submitted = onSubmit.mock.calls[0][0];
    expect("emailPrefs" in submitted).toBe(false);
  });
});

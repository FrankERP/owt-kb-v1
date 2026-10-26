/** @vitest-environment jsdom */
// Task 4 (motion R3, Mi semana): the Ajustes sections live under ONE `#ajustes`
// — Tema, Tamaño de texto and (when a profile read landed) Perfil, Contraseña,
// Correos. This file pins that contract: both anchors a page-level link depends
// on (`#ajustes`, `#tema`) survive, the headings render, the profile sections
// are the ones conditional on `member`, and the email switches render INLINE
// (the «millones» pass, 2026-10-26: no «Editar perfil» sheet to open first).

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({
  // ThemeControl reads `isImpersonating` off the session; a plain member session
  // renders the control normally.
  useSession: vi.fn(() => ({ data: { user: { name: "Ana" } }, status: "authenticated" })),
}));

import SettingsCard from "../SettingsCard";
import { useSession } from "next-auth/react";
import { CueDialogProvider } from "../ui/CueDialogProvider";
import { ToastProvider } from "../ui/Toast";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseMember = {
  _id: "m1",
  member_name: "Ana Torres",
  email: "ana@example.com",
  role: "member",
  hasPassword: true,
};

function renderCard(member: typeof baseMember | null) {
  return render(
    <ToastProvider>
      <CueDialogProvider>
        <SettingsCard member={member} />
      </CueDialogProvider>
    </ToastProvider>,
  );
}

describe("SettingsCard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  });

  it("renders one #ajustes holding #tema, with every section heading when a profile is present", () => {
    const { container } = renderCard(baseMember);
    const ajustes = container.querySelector("#ajustes");
    expect(ajustes).not.toBeNull();
    expect(ajustes?.querySelector("#tema")).not.toBeNull();
    for (const name of ["Tema", "Tamaño de texto", "Perfil", "Contraseña", "Correos"]) {
      expect(screen.queryByRole("heading", { name }), name).not.toBeNull();
    }
  });

  it("drops the profile sections (and the password row) when there is no member", () => {
    const { container } = renderCard(null);
    expect(container.querySelector("#ajustes")).not.toBeNull();
    expect(container.querySelector("#tema")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Tema" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Tamaño de texto" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Perfil" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Correos" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cambiar contraseña/i })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("renders EmailPrefToggles' Switch rows inline, with no editor to open first", () => {
    renderCard(baseMember);
    expect(screen.queryByRole("button", { name: /Editar perfil/i })).toBeNull();
    const switches = screen.getAllByRole("switch");
    // Four, not five — the member role hides the admin-only "Propuestas" row
    // (see emailPrefToggles.test.tsx for the full resolution contract).
    expect(switches).toHaveLength(4);
  });

  it("keeps the password form behind its row: the fields mount only once the row opens the sheet", () => {
    renderCard(baseMember);
    expect(screen.queryByLabelText("Nueva contraseña")).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Cambiar contraseña/i }));
    });
    expect(screen.getByLabelText("Nueva contraseña")).toBeTruthy();
    // `hasPassword: true` → the current password is asked for too.
    expect(screen.getByLabelText("Contraseña actual")).toBeTruthy();
  });

  it("drops #tema entirely while impersonating (ThemeControl returns null) with no empty box", () => {
    (useSession as any).mockImplementation(() => ({
      data: { user: { name: "Super", isImpersonating: true } },
      status: "authenticated",
    }));
    try {
      const { container } = renderCard(null);
      // #tema should be null since ThemeControl returns null when impersonating
      expect(container.querySelector("#tema")).toBeNull();
      // The column starts on Tamaño de texto, with no empty slot where Tema was.
      const column = container.querySelector("#ajustes")?.firstElementChild;
      expect(column?.firstElementChild?.textContent).toContain("Tamaño de texto");
    } finally {
      (useSession as any).mockReset();
    }
  });
});

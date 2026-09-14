/** @vitest-environment jsdom */
// Task 4 (motion R3, Mi semana): the three Ajustes subsections live in ONE card
// now — Tema, Tamaño de texto and (when a profile read landed) Perfil. This file
// pins the card's own contract: both anchors a page-level link depends on
// (`#ajustes`, `#tema`) survive the merge, all three headings render, the Perfil
// subsection is the one that's conditional on `member`, and the profile editor
// nested inside it still works end to end (EmailPrefToggles' `Switch` rows).

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

  it("renders one #ajustes card holding #tema as a direct child, with all three headings when a profile is present", () => {
    const { container } = renderCard(baseMember);
    const ajustes = container.querySelector("#ajustes");
    expect(ajustes).not.toBeNull();
    // #tema is a direct child of #ajustes, not wrapped in a div
    expect(ajustes?.querySelector(":scope > #tema")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Tema" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Tamaño de texto" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Perfil" })).not.toBeNull();
  });

  it("drops the Perfil subsection (and its editor) when there is no member", () => {
    const { container } = renderCard(null);
    expect(container.querySelector("#ajustes")).not.toBeNull();
    expect(container.querySelector("#tema")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Tema" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Tamaño de texto" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Perfil" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Editar perfil/i })).toBeNull();
  });

  it("still renders EmailPrefToggles' Switch rows once the nested profile editor opens", () => {
    renderCard(baseMember);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Editar perfil/i }));
    });
    const switches = screen.getAllByRole("switch");
    // Four, not five — the member role hides the admin-only "Propuestas" row
    // (see emailPrefToggles.test.tsx for the full resolution contract).
    expect(switches).toHaveLength(4);
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
      // The first element child of #ajustes should be Tamaño de texto, not an empty div
      const ajustes = container.querySelector("#ajustes");
      expect(ajustes?.firstElementChild?.textContent).toContain("Tamaño de texto");
    } finally {
      (useSession as any).mockReset();
    }
  });
});

/** @vitest-environment jsdom */
// The member row's ONE menu, and the confirm in front of the kill switch
// (R5 ruling 6, decision O).
//
// What this file exists to prevent, in order of how much it would cost:
//
// 1. The kill switch firing on a single click. It was a `Checkbox` sitting in
//    the row body: one stray tap next to a name signed a member out of the app
//    with no confirmation and nothing on screen that said what had happened.
//    Confirming must PATCH exactly once; CANCELLING must PATCH nothing at all —
//    an "are you sure" that writes anyway is worse than no dialog.
// 2. Actions that only exist on hover. The four icon buttons were
//    `sm:opacity-0 sm:group-hover:opacity-100`: on a phone they were either
//    always visible (cramped) or unreachable, and nothing about a row said it
//    had actions. The menu is one 44px target that works the same on both.
// 3. A role reading the destructive items. Miembros is super-admin-only by tab,
//    so this is defence in depth rather than the only gate — which is exactly
//    why it needs a test rather than a reader's confidence.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({ useSession: () => ({ update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import MembersPanel from "../MembersPanel";
import { ToastProvider } from "../../ui/Toast";
import { CueDialogProvider } from "../../ui/CueDialogProvider";

const ANA  = { _id: "m1", member_name: "Ana Torres", alias: "Ana", email: "ana@x.mx", role: "member", memberType: ["voz"], hasPassword: true };
const BETO = { _id: "m2", member_name: "Beto Ruiz", email: "beto@x.mx", role: "member", memberType: ["voz"], hasPassword: true, disabled: true };

type Role = "super-admin" | "admin" | "content-editor" | "member";

/** Every call the panel made, so a cancelled confirm can be proven silent. */
const calls = () => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
const disableCalls = () => calls().filter((c) => String(c[0]).includes("/disable"));

async function mount(members: unknown[], role: Role = "super-admin") {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => members })));
  const view = render(
    <ToastProvider><CueDialogProvider><MembersPanel role={role} /></CueDialogProvider></ToastProvider>,
  );
  await waitFor(() => expect(screen.queryByText(/miembros?$/)).not.toBeNull());
  return view;
}

/** Opens a row's menu and returns queries scoped to the panel. */
function openMenu(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `Acciones de ${name}` }));
  return within(screen.getByRole("menu", { name: `Acciones de ${name}` }));
}

const menuLabels = (name: string) =>
  openMenu(name).getAllByRole("menuitem").map((i) => i.textContent?.trim());

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe("Miembros — the row menu", () => {
  it("gives a super-admin every action behind one trigger", async () => {
    await mount([ANA]);
    expect(menuLabels("Ana")).toEqual([
      "Editar",
      "Contraseña",
      "Ver como este miembro",
      "Deshabilitar acceso",
      "Eliminar",
    ]);
  });

  it("offers a lesser role only the two non-destructive actions", async () => {
    await mount([ANA], "admin");
    expect(menuLabels("Ana")).toEqual(["Editar", "Contraseña"]);
  });

  it("offers «Habilitar acceso» for a member who already lost it", async () => {
    await mount([BETO]);
    // ONE read: a second `openMenu` would click the trigger again and close it.
    const labels = menuLabels("Beto Ruiz");
    expect(labels).toContain("Habilitar acceso");
    expect(labels).not.toContain("Deshabilitar acceso");
    // The chip is the row's own statement about access and stays beside the name.
    expect(screen.queryByText("Sin acceso")).not.toBeNull();
  });

  it("opens the edit dialog from the menu", async () => {
    await mount([ANA]);
    openMenu("Ana").getByRole("menuitem", { name: "Editar" }).click();
    await waitFor(() => expect(screen.queryByText("Editar miembro")).not.toBeNull());
  });

  it("keeps no hover-only action strip and no kill-switch checkbox on the row", async () => {
    const { container } = await mount([ANA]);
    const row = container.querySelector(".brand-member-row") as HTMLElement;
    expect(row.innerHTML).not.toContain("sm:opacity-0");
    expect(screen.queryByLabelText(/kill switch/i)).toBeNull();
    expect(screen.queryByText(/kill switch/i)).toBeNull();
    expect(row.querySelector('input[type="checkbox"]')).toBeNull();
  });
});

describe("Miembros — the kill switch asks first (decision O)", () => {
  it("asks before it disables, and says what it does and does not change", async () => {
    await mount([ANA]);
    openMenu("Ana").getByRole("menuitem", { name: "Deshabilitar acceso" }).click();

    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/¿Deshabilitar el acceso de/)).toBeTruthy();
    expect(dialog.getByText(/No podrá iniciar sesión/)).toBeTruthy();
    // Nothing is written by OPENING the confirm.
    expect(disableCalls()).toEqual([]);
  });

  it("PATCHes once, with { disabled: true }, when the admin confirms", async () => {
    await mount([ANA]);
    openMenu("Ana").getByRole("menuitem", { name: "Deshabilitar acceso" }).click();
    const dialog = within(await screen.findByRole("dialog"));

    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: "Deshabilitar" }));
    });

    await waitFor(() => expect(disableCalls()).toHaveLength(1));
    const [url, init] = disableCalls()[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/members/m1/disable");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ disabled: true });
  });

  it("writes NOTHING when the admin cancels", async () => {
    await mount([ANA]);
    openMenu("Ana").getByRole("menuitem", { name: "Deshabilitar acceso" }).click();
    const dialog = within(await screen.findByRole("dialog"));

    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: "Cancelar" }));
    });

    expect(disableCalls()).toEqual([]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("HOLDS the dialog open and says so when the PATCH fails", async () => {
    // The failure this case exists for: the confirm used to close on every
    // outcome, because `handleDisableAccess` swallowed the error into a toast
    // and returned nothing. A sheet that closes on a refused write reads as
    // success — the row is unchanged, so the admin concludes the LIST is stale
    // and walks away leaving the member signed in.
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("/disable")
        ? { ok: false, json: async () => ({ error: "No permitido." }) }
        : { ok: true, json: async () => [ANA] },
    ));
    render(
      <ToastProvider><CueDialogProvider><MembersPanel role="super-admin" /></CueDialogProvider></ToastProvider>,
    );
    await waitFor(() => expect(screen.queryByText(/miembros?$/)).not.toBeNull());
    const listReads = () => calls().filter((c) => String(c[0]) === "/api/admin/members").length;
    const before = listReads();

    openMenu("Ana").getByRole("menuitem", { name: "Deshabilitar acceso" }).click();
    const dialog = within(await screen.findByRole("dialog"));
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: "Deshabilitar" }));
    });

    await waitFor(() => expect(disableCalls()).toHaveLength(1));
    // Still on screen, and it says why.
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(screen.queryByText(/No se pudo deshabilitar el acceso/)).not.toBeNull();
    // And nothing refetched the list, which is what a success does.
    expect(listReads()).toBe(before);
  });

  it("restores access with no confirm — giving it back is not destructive", async () => {
    await mount([BETO]);
    const item = openMenu("Beto Ruiz").getByRole("menuitem", { name: "Habilitar acceso" });
    await act(async () => { item.click(); });

    await waitFor(() => expect(disableCalls()).toHaveLength(1));
    const [url, init] = disableCalls()[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/members/m2/disable");
    expect(JSON.parse(String(init.body))).toEqual({ disabled: false });
  });
});

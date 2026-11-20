/** @vitest-environment jsdom */
// «Apps conectadas» (ADR-0091, spec D9): the rows, the one-session revoke that drops a row only on
// success, and the impersonation line that replaces the list.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectedAppsPanel, { type ConnectedAppRow } from "../ConnectedAppsPanel";
import { ToastProvider } from "../ui/Toast";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROWS: ConnectedAppRow[] = [
  { id: "appAuthGrant.3b241101-e2bb-4255-8caf-4136c566a962", platform: "ios", createdAt: "2026-11-01T18:00:00.000Z", lastUsedAt: "2026-11-19T18:00:00.000Z" },
  { id: "appAuthGrant.9b241101-e2bb-4255-8caf-4136c566a962", platform: "android", createdAt: "2026-11-02T18:00:00.000Z", lastUsedAt: null },
];

function mount(props: { initial: ConnectedAppRow[]; impersonating?: boolean }) {
  return render(
    <ToastProvider>
      <ConnectedAppsPanel {...props} />
    </ToastProvider>,
  );
}

describe("ConnectedAppsPanel", () => {
  it("renders nothing without sessions", () => {
    const { container } = mount({ initial: [] });
    expect(container.textContent).toBe("");
  });

  it("lists each session with its platform and a close button", () => {
    mount({ initial: ROWS });
    expect(screen.getByText(/iPhone, iPad o Mac/)).not.toBeNull();
    expect(screen.getByText(/Android/)).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Cerrar sesión en ese dispositivo" })).toHaveLength(2);
  });

  it("hides the list while impersonating and says why", () => {
    mount({ initial: ROWS, impersonating: true });
    expect(screen.getByText("Termina la suplantación para ver las apps conectadas.")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("drops a row only when the revoke succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    mount({ initial: ROWS });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Cerrar sesión en ese dispositivo" })[0]!);
    });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Cerrar sesión en ese dispositivo" })).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith(`/api/me/app-sessions/${encodeURIComponent(ROWS[0]!.id)}/revoke`, { method: "POST" });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Cerrar sesión en ese dispositivo" })[0]!);
    });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Cerrar sesión en ese dispositivo" })).toHaveLength(1));
    expect(screen.queryByText(/iPhone, iPad o Mac/)).toBeNull();
  });
});

/** @vitest-environment jsdom */
// app/components/kids/__tests__/pairRoster.test.tsx
//
// R6 Task 3: the roster's list now reflows through `AnimatedList`, its retire
// confirm rises through `Presence`, and its flashes moved to the one toast
// stack — this pins those three primitives are actually wired, not just
// imported.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { ToastProvider } from "@/app/components/ui/Toast";
import PairRoster, { type RosterMember, type RosterPair } from "../PairRoster";

installMotionTestEnv();
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const withProviders = (ui: React.ReactNode) =>
  render(
    <ToastProvider>
      <MotionProvider>{ui}</MotionProvider>
    </ToastProvider>,
  );

const members: RosterMember[] = [
  { _id: "m1", member_name: "Ana Pérez" },
  { _id: "m2", member_name: "Luis Gómez" },
];

const pairs: RosterPair[] = [
  { id: "p1", name: "Ana y Luis", room: "chiquitos", active: true, memberIds: ["m1", "m2"] },
];

describe("PairRoster", () => {
  it("lists pairs through AnimatedList and shows the retire confirm inside Presence", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/kids/pairs" && (!init || init.method === undefined)) {
        return { ok: true, status: 200, json: async () => pairs } as Response;
      }
      if (url === "/api/kids/pairs/p1" && init?.method === "PATCH") {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    withProviders(<PairRoster initialPairs={pairs} initialMembers={members} />);

    // The row body renders inside AnimatedList's own <li>, which real list
    // semantics — the roster's list must still answer to getByRole("list").
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.getByText("Ana y Luis")).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Pareja retirada.")).toBeTruthy();
  });

  it("creates through a primary Button that reads Creando… while busy", async () => {
    let resolvePost: (() => void) | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/kids/pairs" && init?.method === "POST") {
        await new Promise<void>((resolve) => {
          resolvePost = resolve;
        });
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      if (url === "/api/kids/pairs") {
        return { ok: true, status: 200, json: async () => pairs } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    withProviders(<PairRoster initialPairs={pairs} initialMembers={members} />);

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Sol y Mar" } });
    fireEvent.change(screen.getByLabelText("Integrante 1"), { target: { value: "m1" } });
    fireEvent.change(screen.getByLabelText("Integrante 2"), { target: { value: "m2" } });

    const createButton = screen.getByRole("button", { name: "Crear pareja" }) as HTMLButtonElement;
    expect(createButton.disabled).toBe(false);
    fireEvent.click(createButton);

    expect(await screen.findByRole("button", { name: "Creando…" })).toBeTruthy();

    resolvePost?.();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Creando…" })).toBeNull());
  });
});

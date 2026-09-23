/** @vitest-environment jsdom */
// R6 Task 5: the sign-in screen joins the reveal cadence and stops hand-rolling
// its own controls.
//
// Three things are pinned here, and each one is a thing a refactor silently
// loses: the stagger ORDER (the lockup, then the panel, then each control), the
// alert's arrival through `Presence` (absent from the DOM until there is
// something to say, so a screen reader is not handed an empty live region), and
// the 16 px inputs — `inputFontSize.test.ts` guards the source string, this one
// guards that the string is still on the control the member actually focuses.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import { MotionProvider } from "@/app/components/ui/MotionProvider";

installMotionTestEnv();

const signInMock = vi.fn();

vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signInMock(...args) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));
// next/image needs Next's loader config under jsdom; the lockup's own contract
// here is only that it renders inside the revealed block.
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/app/utils/native", () => ({
  isNativeApp: () => false,
  nativeGoogleIdToken: vi.fn(),
}));

import SignInPage from "../signin/page";

// Warm the LazyMotion feature chunk (ADR-0031), precedent Collapse.test.tsx.
beforeAll(async () => {
  await import("@/app/components/ui/motionFeatures");
});

afterEach(() => {
  cleanup();
  signInMock.mockReset();
});

const renderSignIn = () => render(<MotionProvider><SignInPage /></MotionProvider>);

describe("sign-in", () => {
  it("staggers lockup, panel, Google, fields and submit in that order", () => {
    const { container } = renderSignIn();
    const idx = [...container.querySelectorAll("[data-reveal]")].map((el) =>
      (el as HTMLElement).style.getPropertyValue("--reveal-i"),
    );
    expect(idx).toEqual(["0", "3", "4", "5", "6", "7"]);
  });

  it("rises the alert in and reads Entrando… while submitting", async () => {
    let resolveSignIn: (v: { error: string }) => void = () => {};
    signInMock.mockImplementationOnce(
      () => new Promise<{ error: string }>((resolve) => { resolveSignIn = resolve; }),
    );

    renderSignIn();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "a@b.mx" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secreto" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    // The submit button reads its busy label and is disabled while in flight.
    const busy = await screen.findByRole("button", { name: "Entrando…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(true);

    resolveSignIn({ error: "CredentialsSignin" });

    expect((await screen.findByRole("alert")).textContent).toContain("Email o contraseña incorrectos.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeTruthy());
  });

  it("keeps 16px inputs on a phone", () => {
    renderSignIn();
    expect(screen.getByLabelText("Correo electrónico").className).toMatch(/text-\[16px\]/);
    expect(screen.getByLabelText("Contraseña").className).toMatch(/text-\[16px\]/);
  });

  it("offers Google through the house Button", () => {
    renderSignIn();
    const google = screen.getByRole("button", { name: /Continuar con Google/ });
    expect(google.className).toMatch(/rounded-lg/);
    expect(google.className).toMatch(/w-full/);
  });
});

/** @vitest-environment jsdom */
// R6 Task 5: the sign-in screen joins the reveal cadence and stops hand-rolling
// its own controls.
//
// Three things are pinned here, and each one is a thing a refactor silently
// loses: the stagger ORDER (the lockup, then the form block, then each control),
// the alert's arrival through `Presence` (absent from the DOM until there is
// something to say, so a screen reader is not handed an empty live region), and
// the phone-safe inputs — since the «millones» pass (ADR-0070, phase 8) they are
// the hairline fields of Mi perfil at 17 px; `inputFontSize.test.ts` guards the
// source string, this one guards that it is on the control the member focuses.

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
import { HAIRLINE_INPUT_CLASS } from "@/app/components/ui/hairlineField";
import { PAGE_TITLE } from "@/app/utils/homeHero";

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
  it("staggers lockup, form block, Google, fields and submit in that order", () => {
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

    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "a@b.mx" } });
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

  it("draws the hairline fields, never under 16px on a phone", () => {
    renderSignIn();
    expect(screen.getByLabelText("Correo").className).toContain(HAIRLINE_INPUT_CLASS);
    expect(screen.getByLabelText("Contraseña").className).toContain(HAIRLINE_INPUT_CLASS);
    expect(HAIRLINE_INPUT_CLASS).toMatch(/text-\[17px\]/);
  });

  it("reveals the typed password behind «Mostrar» and hides it again", () => {
    renderSignIn();
    const field = screen.getByLabelText("Contraseña") as HTMLInputElement;
    expect(field.type).toBe("password");
    // The field's accessible name is its label alone: the toggle is a sibling,
    // never a second control inside the <label>.
    expect(field.getAttribute("aria-label")).toBeNull();
    expect(document.querySelector(`label[for="${field.id}"]`)?.textContent).toBe("Contraseña");
    const toggle = screen.getByRole("button", { name: "Mostrar" });
    // Its text is its state — no `aria-pressed` beside a label that swaps.
    expect(toggle.getAttribute("aria-pressed")).toBeNull();
    expect(toggle.getAttribute("aria-controls")).toBe(field.id);
    fireEvent.click(toggle);
    expect(field.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar" }));
    expect(field.type).toBe("password");
  });

  it("names the screen with the page title and reads the error as a strip", async () => {
    signInMock.mockResolvedValueOnce({ error: "CredentialsSignin" });
    renderSignIn();
    expect(screen.getByRole("heading", { level: 1, name: "Backstage" }).className).toBe(PAGE_TITLE);
    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "a@b.mx" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secreto" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    const alert = await screen.findByRole("alert");
    expect(alert.className).toMatch(/border-l-2/);
    expect(alert.className).not.toMatch(/rounded/);
  });

  it("offers Google through the house Button", () => {
    renderSignIn();
    const google = screen.getByRole("button", { name: /Continuar con Google/ });
    expect(google.className).toMatch(/rounded-lg/);
    expect(google.className).toMatch(/w-full/);
  });
});

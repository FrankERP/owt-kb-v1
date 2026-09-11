/** @vitest-environment jsdom */
// `/me`'s identity header (R3, spec §12.4). What is asserted here is the LINE —
// the one sentence that replaced the page's two `h2`s — and its gating: a
// kids-only member gets their Kids Sunday, never worship copy.
//
// Fake timers, because every line carries a countdown computed from "today".
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";

installMotionTestEnv();

// next/image needs Next's loader config and emits WebP srcsets; the component's
// own contract is the `unoptimized` original, which is all this asserts.
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import MeHeader from "../MeHeader";

// Warm the LazyMotion feature chunk (ADR-0031), precedent Collapse.test.tsx.
beforeAll(async () => {
  await import("@/app/components/ui/motionFeatures");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** 2026-09-10 local — a Thursday, three days before Sunday the 13th. */
function freezeToday() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0));
}

const mount = (ui: React.ReactNode) => render(<MotionProvider>{ui}</MotionProvider>);

describe("MeHeader", () => {
  it("names the member, their alias and their Tipo chips", () => {
    freezeToday();
    mount(
      <MeHeader
        name="Ana Rocha"
        alias="Ani"
        memberTypes={["voz", "sunday_lead"]}
        inWorship
        next={{ dateKey: "2026-09-13", day: "Domingo", seat: "Lead" }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ana Rocha");
    expect(screen.getByText("Ani")).toBeTruthy();
    expect(screen.getByText("Voz")).toBeTruthy();
    expect(screen.getByText("Líder Domingo")).toBeTruthy();
    // Initials stand in for a member with no photo.
    expect(screen.getByText("AN")).toBeTruthy();
  });

  it("leads with the seat: «Te toca el domingo 13 · Lead» and the countdown", () => {
    freezeToday();
    const { container } = mount(
      <MeHeader name="Ana" inWorship next={{ dateKey: "2026-09-13", day: "Domingo", seat: "Lead" }} />,
    );
    // ICU spells the weekday lowercase in es-MX; the separator is the house «·».
    expect(container.textContent).toMatch(/Te toca el domingo 13 · Lead/i);
    expect(container.textContent).toContain("En 3 días");
  });

  it("keeps a special service's own name, and drops the seat when there is none", () => {
    freezeToday();
    const { container } = mount(
      <MeHeader name="Ana" inWorship next={{ dateKey: "2026-09-11", day: "Noche de Adoración", seat: "" }} />,
    );
    expect(container.textContent).toMatch(/Te toca el viernes 11 · Noche de Adoración/i);
    expect(container.textContent).toContain("Mañana");
  });

  it("says so when a worship member has nothing assigned", () => {
    freezeToday();
    mount(<MeHeader name="Ana" inWorship />);
    expect(screen.getByText("Sin servicios asignados próximamente")).toBeTruthy();
  });

  it("gives a kids-only member their next Kids Sunday and NO worship copy", () => {
    freezeToday();
    const { container } = mount(<MeHeader name="Ana" kidsNext="2026-09-13" />);
    expect(container.textContent).toMatch(/En Oasis Kids te toca el domingo 13/i);
    expect(container.textContent).toContain("En 3 días");
    expect(container.textContent).not.toContain("Sin servicios asignados próximamente");
  });

  it("renders no line at all for a kids-only member with nothing assigned", () => {
    freezeToday();
    const { container } = mount(<MeHeader name="Ana" />);
    expect(container.textContent).not.toContain("Sin servicios asignados próximamente");
    expect(container.textContent).not.toContain("Te toca");
  });

  it("serves the avatar unoptimized, and points «Editar perfil» at the Ajustes card", () => {
    freezeToday();
    const { container } = mount(<MeHeader name="Ana" photoUrl="https://example.test/ana.jpg" inWorship />);
    // `alt=""` on purpose — the name sits beside it, so the avatar is decorative,
    // which is why this queries the element rather than an image role.
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://example.test/ana.jpg");
    expect(screen.getByRole("link", { name: "Editar perfil" }).getAttribute("href")).toBe("#ajustes");
  });
});

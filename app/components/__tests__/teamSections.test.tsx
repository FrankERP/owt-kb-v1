/** @vitest-environment jsdom */
// The service card's team as folding sections of faces (the Inicio redesign,
// 2026-10-21). The pure rules — what each section holds, which ones open — are
// `app/utils/__tests__/teamSections.test.ts`; this asserts what the member sees:
// a closed section still names everyone, a tap overrides the default, a face
// falls back to initials, and «+ foto» is offered only on your own face.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { TeamInput } from "@/app/utils/teamSections";

installMotionTestEnv();

// next/image needs Next's loader config; the contract here is the URL and the
// fallback, so a plain <img> that forwards onError is enough (precedent: meHeader).
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- a test double for next/image itself
  default: ({ src, alt, onError }: { src: string; alt: string; onError?: () => void }) => <img src={src} alt={alt} onError={onError} />,
}));

import TeamSections from "../TeamSections";

beforeAll(async () => {
  await import("@/app/components/ui/motionFeatures");
});
afterEach(cleanup);

const team: TeamInput = {
  leads: ["Gaby"],
  bgvs: [{ member_name: "Paulina", alias: "Pau" }],
  instruments: [{ label: "Bajo", person: "Frank" }, { label: "Batería", person: "Raúl" }],
  fohTeam: [{ label: "Audio", person: "Toño" }],
};

const mount = (props: Partial<Parameters<typeof TeamSections>[0]> = {}) =>
  render(
    <MotionProvider>
      <TeamSections team={team} myName="" {...props} />
    </MotionProvider>,
  );

const header = (label: RegExp) => screen.getByRole("button", { name: label });

describe("TeamSections", () => {
  it("opens the section you serve in and lists the rest by name while closed", () => {
    mount({ myName: "frank", viewerTypes: ["voz"] });
    expect(header(/Banda/).getAttribute("aria-expanded")).toBe("true");
    const voces = header(/Voces/);
    expect(voces.getAttribute("aria-expanded")).toBe("false");
    expect(voces.textContent).toContain("Gaby · Pau");
    expect(header(/Cabina/).textContent).toContain("Toño");
  });

  it("falls back to the Tipo when you hold no seat, and a tap overrides either way", () => {
    mount({ myName: "lupe", viewerTypes: ["voz"] });
    expect(header(/Voces/).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header(/Cabina/));
    expect(header(/Cabina/).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header(/Voces/));
    expect(header(/Voces/).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows a photo when the map has one, initials when it does not or the photo fails", () => {
    const { container } = mount({ myName: "frank", photos: { raúl: "https://lh3.googleusercontent.com/r" } });
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://lh3.googleusercontent.com/r");
    expect(screen.getByText("FR")).toBeTruthy();
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("RA")).toBeTruthy();
  });

  it("offers «+ foto» only on your own face, only where the surface knows photos", () => {
    mount({ myName: "frank", photos: {} });
    expect(screen.getByRole("link", { name: /^\+\sfoto$/ }).getAttribute("href")).toBe("/me/ajustes");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    cleanup();
    mount({ myName: "frank" });
    expect(screen.queryByRole("link", { name: /^\+\sfoto$/ })).toBeNull();
    cleanup();
    mount({ myName: "frank", photos: { frank: "https://lh3.googleusercontent.com/f" } });
    expect(screen.queryByRole("link", { name: /^\+\sfoto$/ })).toBeNull();
  });

  it("flags a person seated twice in one section, never as «tú»", () => {
    mount({ myName: "frank", team: { ...team, instruments: [{ label: "Bajo", person: "Frank" }, { label: "Guitarra", person: "frank " }] } });
    expect(header(/Banda/).getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll('[data-icon="warning"]').length).toBeGreaterThan(0);
    expect(screen.queryByText(/· tú/)).toBeNull();
  });

  it("opens a section with a double booking even for a viewer with no seat or Tipo, and keeps the ⚠ in its header when closed", () => {
    mount({ team: { ...team, fohTeam: [{ label: "Audio", person: "Toño" }, { label: "Luces", person: "Toño" }] } });
    const cabina = header(/Cabina/);
    expect(cabina.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(cabina);
    expect(header(/Cabina/).getAttribute("aria-expanded")).toBe("false");
    expect(header(/Cabina/).textContent).toContain("repetido");
    expect(header(/Cabina/).querySelector('[data-icon="warning"]')).not.toBeNull();
  });

  it("splits an open Voces into Lead, BGV and Coro panels whose label is the seat", () => {
    mount({ myName: "pau", team: { ...team, chorus: [{ member_name: "Lupe" }] } });
    expect(header(/Voces/).getAttribute("aria-expanded")).toBe("true");
    for (const label of ["Lead", "BGV", "Coro"]) expect(screen.getByText(`${label} · 1`, { selector: "p" })).toBeTruthy();
    // The seat is the panel's label, so only «tú» sits under a name there.
    expect(screen.getByText("tú").className).toContain("text-positive-fg");
    expect(screen.queryByText("Lead", { selector: "p.text-xs" })).toBeNull();
  });

  it("opens every section for an admin, whatever their seat or Tipo, and a tap still closes one", () => {
    mount({ myName: "frank", viewerTypes: ["instrumento"], openAll: true });
    for (const s of [/Voces/, /Banda/, /Cabina/]) expect(header(s).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header(/Cabina/));
    expect(header(/Cabina/).getAttribute("aria-expanded")).toBe("false");
  });

  it("opens every section from `lg` on the run sheet (`openAllFrom`), and leaves a phone folded", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === "(min-width: 1024px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      mount({ myName: "", viewerTypes: null, openAllFrom: "lg" });
      for (const s of [/Voces/, /Banda/, /Cabina/]) expect(header(s).getAttribute("aria-expanded")).toBe("true");
      // A tap still closes one, the rail is not locked open.
      fireEvent.click(header(/Cabina/));
      expect(header(/Cabina/).getAttribute("aria-expanded")).toBe("false");
      cleanup();
      // The phone: the query does not match, so the defaults decide as before.
      matchMedia.mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
      mount({ myName: "", viewerTypes: null, openAllFrom: "lg" });
      expect(header(/Voces/).getAttribute("aria-expanded")).toBe("false");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders nothing for a service with no one seated", () => {
    const { container } = mount({ team: {} });
    expect(container.textContent).toBe("");
  });
});

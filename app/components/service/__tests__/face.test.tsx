/** @vitest-environment jsdom */
// A team member as a face, and several of them overlapped on a folded service card (ADR-0087).
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// next/image needs Next's loader config; the contract here is the URL and the fallback, so a
// plain <img> that forwards onError is enough (precedent: teamSections.test.tsx).
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element -- a test double for next/image itself
  default: ({ src, alt, onError }: { src: string; alt: string; onError?: () => void }) => <img src={src} alt={alt} onError={onError} />,
}));

import Face, { FaceStack } from "../Face";
import ServiceFacts from "../ServiceFacts";

afterEach(cleanup);

describe("Face", () => {
  it("draws the photo, and falls back to initials when there is none or it fails to load", () => {
    const { container, rerender } = render(<Face name="Gaby" photo="https://cdn.sanity.io/images/x/production/gaby.jpg" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("");
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("GA");
    rerender(<Face name="Raúl" />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("is decoration: the name beside it is what a screen reader hears", () => {
    const { container } = render(<Face name="Gaby" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("rings «tú» in the one green — dashed while there is no photo — and nobody else", () => {
    const ring = (el: HTMLElement) => el.querySelector("span > span")!.className;
    expect(ring(render(<Face name="Gaby" />).container)).not.toContain("positive");
    cleanup();
    expect(ring(render(<Face name="Gaby" me />).container)).toContain("border-positive-fg");
    cleanup();
    expect(ring(render(<Face name="Gaby" me dashed />).container)).toContain("border-dashed");
  });

  it("wears the seat's glyph on its corner when given one", () => {
    const { container } = render(<Face name="Gaby" badge={<svg data-testid="glyph" />} />);
    expect(container.querySelector("[data-testid=glyph]")).toBeTruthy();
  });
});

describe("FaceStack", () => {
  it("shows one face per PERSON, at most `max`, then «+N»", () => {
    const { container } = render(<FaceStack names={["Gaby", "Pau", "Gaby", "Raúl", "Toño"]} max={3} />);
    expect(container.querySelectorAll(".animate-scale-in")).toHaveLength(3);
    expect(container.textContent).toContain("+1");
  });

  it("enters one face after the other, on top of the card's own stagger", () => {
    const { container } = render(<FaceStack names={["Gaby", "Pau"]} />);
    const delays = Array.from(container.querySelectorAll<HTMLElement>(".animate-scale-in")).map((el) => el.style.animationDelay);
    expect(delays[0]).toContain("var(--reveal-i, 0)");
    expect(delays[0]).not.toBe(delays[1]);
  });

  it("finds a photo and «tú» by the person's key, not by the spelling", () => {
    const { container } = render(<FaceStack names={["Gaby", "Pau"]} photos={{ gaby: "https://lh3.googleusercontent.com/a/gaby" }} myName="pau" />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.innerHTML).toContain("border-positive-fg");
  });

  it("draws nothing for nobody", () => {
    expect(render(<FaceStack names={[]} />).container.innerHTML).toBe("");
  });
});

describe("ServiceFacts", () => {
  it("says who leads beside their faces, and the set as pictures beside its count", () => {
    const { container } = render(
      <ServiceFacts leads={["Gaby", "Pau"]} songs={[{ cover: "https://cdn.sanity.io/images/ebb8vcnk/production/abc123-1000x1000.jpg" }, { cover: null }]} />,
    );
    expect(container.textContent).toContain("Lead Gaby y Pau");
    expect(container.textContent).toContain("2 canciones");
    // One cover, one neutral tile: a song with no cover never draws a broken picture.
    expect(container.querySelectorAll('img[src*="cdn.sanity.io/images/"]')).toHaveLength(1);
  });

  it("says «Setlist pendiente» when the team was published before the songs, and no lead line without leads", () => {
    const { container } = render(<ServiceFacts leads={[]} songs={[]} />);
    expect(container.textContent).toBe("Setlist pendiente");
  });
});

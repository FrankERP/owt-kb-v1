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
import SongCover, { CoverRow } from "../SongCover";

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

describe("ServiceFacts — the data it is handed", () => {
  it("survives a setlist document with no `songs` field (GROQ projects null, which a default parameter does not catch)", () => {
    const { container } = render(<ServiceFacts leads={null} songs={null} />);
    expect(container.textContent).toBe("Setlist pendiente");
  });

  it("says nothing is pending for a service that already happened, and draws nothing at all when there is nothing to say", () => {
    const past = render(<ServiceFacts leads={["Ana"]} songs={[]} pending={false} />).container.textContent;
    expect(past).toContain("Lead Ana");
    expect(past).not.toContain("pendiente");
    cleanup();
    expect(render(<ServiceFacts leads={[]} songs={null} pending={false} />).container.firstChild).toBeNull();
  });
});

describe("SongCover", () => {
  const COVER = "https://cdn.sanity.io/images/ebb8vcnk/production/abc123-1000x1000.jpg?w=160&h=160&fit=crop&fm=jpg";

  it("draws the cover, and the neutral tile with a note when there is none or it fails to load", () => {
    const { container, rerender } = render(<SongCover src={COVER} n={3} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(COVER);
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
    // The song's place in the set stays on the corner either way.
    expect(container.textContent).toBe("3");
    rerender(<SongCover src={null} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("is decoration, alone and in a row — the words beside it name the song and count the set", () => {
    expect(render(<SongCover src={COVER} />).container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    cleanup();
    expect(render(<CoverRow covers={[COVER]} />).container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows at most `max` covers side by side (five by default), and nothing for an empty set", () => {
    const seven = Array.from({ length: 7 }, (_, i) => (i === 1 ? null : COVER));
    const { container } = render(<CoverRow covers={seven} />);
    // Five tiles: four pictures and the one song with no cover, as its neutral tile.
    expect(container.querySelectorAll("img")).toHaveLength(4);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    cleanup();
    expect(render(<CoverRow covers={seven} max={2} />).container.querySelectorAll("img, svg")).toHaveLength(2);
    cleanup();
    expect(render(<CoverRow covers={[]} />).container.firstChild).toBeNull();
  });
});

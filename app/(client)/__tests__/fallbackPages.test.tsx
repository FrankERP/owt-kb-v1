/** @vitest-environment jsdom */
// R6 Task 5: the four dead-end screens — not-a-member, the client error
// boundary and the two 404s — reveal like every other route and offer the house
// `Button` rather than a bespoke link or a hand-spelled control.
//
// These pages are the ones nobody looks at until something has already gone
// wrong, which is exactly why a guard is worth more here than a screenshot: a
// class string that drifts on `/biblioteca` is noticed in a day, one that drifts
// on `posts/not-found` is noticed by a member who followed a dead link.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import NotAMemberPage from "../auth/not-a-member/page";
import ClientError from "../error";
import PageNotFound from "../not-found";
import SongNotFound from "../posts/not-found";

afterEach(cleanup);

/** The revealed block, and the action inside it. */
const revealed = (container: HTMLElement) => container.querySelector("[data-reveal]") as HTMLElement | null;

describe("fallback pages", () => {
  it("reveals the not-a-member card and signs out through a Button", () => {
    const { container } = render(<NotAMemberPage />);
    const block = revealed(container);
    expect(block).not.toBeNull();
    expect(block!.style.getPropertyValue("--reveal-i")).toBe("0");

    const action = container.querySelector("button");
    expect(action?.textContent).toContain("Cerrar sesión e intentar con otra cuenta");
    expect(action?.className).toMatch(/rounded-lg/);
  });

  it("reveals the error boundary and keeps both of its Buttons", () => {
    const { container } = render(<ClientError error={new Error("x")} reset={() => {}} />);
    const block = revealed(container);
    expect(block).not.toBeNull();
    expect(block!.style.getPropertyValue("--reveal-i")).toBe("0");

    const actions = [...container.querySelectorAll("button, a")];
    expect(actions.map((el) => el.textContent?.trim())).toEqual(["Reintentar", "Ir al inicio"]);
    for (const el of actions) expect(el.className).toMatch(/rounded-lg/);
  });

  it("reveals the group 404 and links home through a Button", () => {
    const { container } = render(<PageNotFound />);
    const block = revealed(container);
    expect(block).not.toBeNull();
    expect(block!.style.getPropertyValue("--reveal-i")).toBe("0");

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/");
    expect(link?.textContent).toContain("Ir al inicio");
    expect(link?.className).toMatch(/rounded-lg/);
  });

  it("reveals the song 404 and links back to the catalogue through a Button", () => {
    const { container } = render(<SongNotFound />);
    const block = revealed(container);
    expect(block).not.toBeNull();
    expect(block!.style.getPropertyValue("--reveal-i")).toBe("0");

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/");
    expect(link?.textContent).toContain("Ver todas las canciones");
    expect(link?.className).toMatch(/rounded-lg/);
  });
});

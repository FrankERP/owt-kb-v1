/** @vitest-environment jsdom */
// app/components/ui/__tests__/Skeleton.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Skeleton, { SkeletonGroup, NavbarSkeleton } from "../Skeleton";

afterEach(cleanup);

describe("Skeleton", () => {
  it("is decorative: aria-hidden, with the shimmer class and the size classes", () => {
    render(<Skeleton className="h-4 w-32" data-testid="s" />);
    const el = screen.getByTestId("s");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toContain("brand-skeleton");
    expect(el.className).toContain("h-4 w-32");
    expect(el.className).toContain("rounded-md");
  });

  it("maps rounded to a radius utility", () => {
    render(<Skeleton rounded="full" data-testid="s" />);
    expect(screen.getByTestId("s").className).toContain("rounded-full");
  });

  it("SkeletonGroup announces itself once, as a busy status region", () => {
    render(
      <SkeletonGroup label="Cargando servicios">
        <Skeleton className="h-4" />
      </SkeletonGroup>,
    );
    const g = screen.getByRole("status");
    expect(g.getAttribute("aria-busy")).toBe("true");
    expect(g.getAttribute("aria-label")).toBe("Cargando servicios");
  });

  it("NavbarSkeleton draws the mark, title, and avatar so the swap to the real bar is invisible", () => {
    const { container } = render(<NavbarSkeleton />);
    const outer = container.firstElementChild as HTMLElement;
    const inner = outer.firstElementChild as HTMLElement;
    const skeletons = inner.querySelectorAll(".brand-skeleton");

    expect(outer.getAttribute("aria-hidden")).toBe("true");
    expect(outer.className).toContain("pt-[env(safe-area-inset-top)]");
    expect(outer.className).not.toContain("border-b");
    expect(inner.className).toContain("h-20");
    expect(inner.className).toContain("lg:h-24");
    expect(inner.className).toContain("border-b");
    expect(inner.className).toContain("border-surface-accent-20");
    expect(skeletons).toHaveLength(3);
  });
});

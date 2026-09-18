/** @vitest-environment jsdom */
// R6 Task 6: a tutorial paints a poster and mounts its player only on press.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import TutorialPoster from "../TutorialPoster";

// The house next/image mock (see meHeader.test.tsx) — jsdom has no loader.
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

installMotionTestEnv();
afterEach(cleanup);

const withProviders = (ui: React.ReactNode) => render(<MotionProvider>{ui}</MotionProvider>);

describe("TutorialPoster", () => {
  it("renders a poster and mounts the iframe only on press", () => {
    withProviders(
      <TutorialPoster url="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Tutorial" />,
    );
    expect(document.querySelector("iframe")).toBeNull();
    const poster = document.querySelector("img");
    expect(poster?.getAttribute("src")).toContain("dQw4w9WgXcQ");

    fireEvent.click(screen.getByRole("button", { name: "Reproducir Tutorial" }));

    expect(document.querySelector("iframe")?.getAttribute("src")).toContain(
      "youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    );
    // The poster and its button go with it — one thing plays, nothing overlays it.
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reproducir Tutorial" })).toBeNull();
  });

  it("names the button for an untitled tutorial without inventing a title", () => {
    withProviders(<TutorialPoster url="https://youtu.be/dQw4w9WgXcQ" title={null} />);
    expect(screen.getByRole("button", { name: "Reproducir el tutorial" })).toBeTruthy();
  });

  it("falls back to the raw iframe when the url is not YouTube", () => {
    withProviders(<TutorialPoster url="https://player.vimeo.com/video/1" title="V" />);
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://player.vimeo.com/video/1",
    );
    expect(document.querySelector("img")).toBeNull();
  });
});

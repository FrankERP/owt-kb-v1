/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Equalizer from "../Equalizer";

afterEach(cleanup);

describe("Equalizer", () => {
  it("renders three bars", () => {
    const { container } = render(<Equalizer playing={false} />);
    expect(container.querySelectorAll(".brand-eq-bar").length).toBe(3);
  });

  it("carries data-playing following the prop", () => {
    const { container, rerender } = render(<Equalizer playing={false} />);
    expect(container.querySelector("[data-playing]")?.getAttribute("data-playing")).toBe("false");

    rerender(<Equalizer playing={true} />);
    expect(container.querySelector("[data-playing]")?.getAttribute("data-playing")).toBe("true");
  });
});

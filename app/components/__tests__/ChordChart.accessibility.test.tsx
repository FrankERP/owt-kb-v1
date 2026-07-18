/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ChordChart from "../ChordChart";

afterEach(() => cleanup());

describe("ChordChart accessibility", () => {
  it("names duplicate chart selectors and exposes pressed state", () => {
    const { getByRole } = render(
      <ChordChart
        charts={[
          { key: "D", content: "[D]Santo" },
          { key: "D", content: "[D]Digno" },
        ]}
      />,
    );

    const first = getByRole("button", { name: "D · versión 1 de 2" });
    const second = getByRole("button", { name: "D · versión 2 de 2" });
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(second.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(second);
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(second.getAttribute("aria-pressed")).toBe("true");
  });

  it("names the chord visibility switch while preserving checked state", () => {
    const { getByRole } = render(<ChordChart charts={[{ key: "C", content: "[C]Gloria" }]} />);

    const toggle = getByRole("switch", { name: "Mostrar acordes" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ChordChart from "../ChordChart";
import { TransposeProvider, useTransposeOptional } from "../song/TransposeProvider";
import { MotionProvider } from "../ui/MotionProvider";
import { installMotionTestEnv } from "../ui/__tests__/motionTestSetup";

installMotionTestEnv();
afterEach(() => cleanup());

const CHARTS = [{ key: "G", content: "[G]Santo [D]Dios" }];

const chords = (root: HTMLElement) =>
  Array.from(root.querySelectorAll(".font-mono")).map((n) => n.textContent?.trim());
const readout = (root: HTMLElement) => root.querySelector(".brand-key-dial")?.textContent?.trim();
const chart = (root: HTMLElement) => root.querySelector(".animate-fade-in") as HTMLElement;

describe("ChordChart transposition", () => {
  it("steps the chart up and back with the ± pair and the «Original» reset", () => {
    const { container, getByRole, queryByRole } = render(
      <MotionProvider><ChordChart charts={CHARTS} /></MotionProvider>,
    );

    expect(chords(container)).toEqual(["G", "D"]);
    expect(readout(container)).toBe("G");
    expect(queryByRole("button", { name: "Original" })).toBeNull();

    const before = chart(container);
    expect(before.className).toContain("animate-fade-in");

    fireEvent.click(getByRole("button", { name: "Subir medio tono" }));

    expect(chords(container)).toEqual(["Ab", "Eb"]);
    expect(readout(container)).toBe("Ab");
    // The keyed container remounts, so the old node is detached rather than reused.
    expect(before.isConnected).toBe(false);
    expect(chart(container).className).toContain("animate-fade-in");

    fireEvent.click(getByRole("button", { name: "Original" }));

    expect(chords(container)).toEqual(["G", "D"]);
    expect(readout(container)).toBe("G");
    expect(queryByRole("button", { name: "Original" })).toBeNull();
  });

  it("steps the chart down with the minus button", () => {
    const { container, getByRole } = render(
      <MotionProvider><ChordChart charts={CHARTS} /></MotionProvider>,
    );

    fireEvent.click(getByRole("button", { name: "Bajar medio tono" }));
    expect(chords(container)).toEqual(["F#", "C#"]);
    expect(readout(container)).toBe("F#");
  });

  it("takes its transposition from the provider when one is present", () => {
    function Sibling() {
      const t = useTransposeOptional();
      return <button type="button" onClick={() => t?.setSemitones(2)}>dos</button>;
    }

    const { container, getByText } = render(
      <MotionProvider>
        <TransposeProvider nativeKey="G">
          <Sibling />
          <ChordChart charts={CHARTS} />
        </TransposeProvider>
      </MotionProvider>,
    );

    fireEvent.click(getByText("dos"));
    expect(chords(container)).toEqual(["A", "E"]);
    expect(readout(container)).toBe("A");
  });
});

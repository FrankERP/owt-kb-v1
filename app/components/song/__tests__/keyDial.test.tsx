/** @vitest-environment jsdom */
// The hero key: a dial that reads the SOUNDING key and opens the 12-key drawer.
// Covers `KeyDial` on its own and `SongHeroPills`, which owns the disclosure —
// the two halves are one control and a test of either alone would not see the
// wiring between them.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import KeyDial from "../KeyDial";
import SongHeroPills from "../SongHeroPills";
import { TransposeProvider, useTransposeOptional } from "../TransposeProvider";
import { MotionProvider } from "../../ui/MotionProvider";
import { installMotionTestEnv } from "../../ui/__tests__/motionTestSetup";

installMotionTestEnv();
afterEach(() => cleanup());

function Stepper() {
  const t = useTransposeOptional();
  return (
    <button type="button" onClick={() => t?.setSemitones(2)}>
      dos
    </button>
  );
}

function Probe() {
  const t = useTransposeOptional();
  return <p data-testid="semitones">{t?.semitones ?? "—"}</p>;
}

describe("KeyDial", () => {
  it("reads the sounding key and follows the provider", () => {
    const { container, getByRole, getByText } = render(
      <MotionProvider>
        <TransposeProvider nativeKey="G">
          <KeyDial open={false} onToggle={() => {}} controls="song-transposer" keyLabel="G" />
          <Stepper />
        </TransposeProvider>
      </MotionProvider>,
    );

    const dial = container.querySelector(".brand-key-dial") as HTMLButtonElement;
    expect(dial.textContent).toContain("G");
    expect(getByRole("button", { name: /Tonalidad G/ }).getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(getByText("dos"));
    expect((container.querySelector(".brand-key-dial") as HTMLElement).textContent).toContain("A");
  });

  it("points at the drawer it opens", () => {
    const { getByRole } = render(
      <MotionProvider>
        <TransposeProvider nativeKey="G">
          <KeyDial open onToggle={() => {}} controls="song-transposer" keyLabel="G" />
        </TransposeProvider>
      </MotionProvider>,
    );
    const dial = getByRole("button", { name: /Transponer/ });
    expect(dial.getAttribute("aria-expanded")).toBe("true");
    expect(dial.getAttribute("aria-controls")).toBe("song-transposer");
  });
});

describe("SongHeroPills", () => {
  it("leaves the key a static badge when the song carries no ChordPro chart", () => {
    const { container, queryByRole } = render(
      <MotionProvider>
        <TransposeProvider nativeKey="G">
          <SongHeroPills keyLabel="G" bpm={null} timeSig="4/4" transposable={false} />
        </TransposeProvider>
      </MotionProvider>,
    );

    expect(queryByRole("radiogroup")).toBeNull();
    const badge = container.querySelector(".brand-key-dial") as HTMLElement;
    expect(badge.tagName).toBe("SPAN");
    expect(badge.textContent?.trim()).toBe("G");
  });

  it("opens the drawer from the dial and transposes the shared seat", () => {
    const { getByRole, getByTestId } = render(
      <MotionProvider>
        <TransposeProvider nativeKey="G">
          <SongHeroPills keyLabel="G" bpm={null} timeSig={null} transposable />
          <Probe />
        </TransposeProvider>
      </MotionProvider>,
    );

    const dial = getByRole("button", { name: /Transponer/ });
    expect(dial.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(dial);
    expect(dial.getAttribute("aria-expanded")).toBe("true");

    const group = getByRole("radiogroup", { name: "Transponer a" });
    expect(group).toBeTruthy();

    fireEvent.click(getByRole("radio", { name: "A" }));
    expect(getByTestId("semitones").textContent).toBe("2");
  });
});

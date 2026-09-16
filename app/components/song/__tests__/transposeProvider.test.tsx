/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TransposeProvider, useTransposeOptional } from "../TransposeProvider";

afterEach(() => cleanup());

function Probe() {
  const t = useTransposeOptional();
  if (!t) return <p data-testid="state">sin proveedor</p>;
  return (
    <div>
      <p data-testid="state">{`${t.semitones}|${t.soundingKey ?? "null"}|${t.nativeKey ?? "null"}`}</p>
      <button type="button" onClick={() => t.setSemitones(13)}>trece</button>
      <button type="button" onClick={() => t.setSemitones(-1)}>menos uno</button>
      <button type="button" onClick={() => t.setSemitones(2)}>dos</button>
    </div>
  );
}

describe("TransposeProvider", () => {
  it("wraps semitones into 0..11 in both directions", () => {
    const { getByTestId, getByText } = render(
      <TransposeProvider nativeKey="G"><Probe /></TransposeProvider>,
    );

    expect(getByTestId("state").textContent).toBe("0|G|G");

    fireEvent.click(getByText("trece"));
    expect(getByTestId("state").textContent?.split("|")[0]).toBe("1");

    fireEvent.click(getByText("menos uno"));
    expect(getByTestId("state").textContent?.split("|")[0]).toBe("11");
  });

  it("reports the sounding key for the native key plus the offset", () => {
    const { getByTestId, getByText } = render(
      <TransposeProvider nativeKey="G"><Probe /></TransposeProvider>,
    );

    fireEvent.click(getByText("dos"));
    expect(getByTestId("state").textContent).toBe("2|A|G");
  });

  it("leaves soundingKey null when the song has no key", () => {
    const { getByTestId, getByText } = render(
      <TransposeProvider nativeKey={null}><Probe /></TransposeProvider>,
    );

    fireEvent.click(getByText("dos"));
    expect(getByTestId("state").textContent).toBe("2|null|null");
  });

  it("returns null outside a provider so a consumer can fall back to local state", () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("state").textContent).toBe("sin proveedor");
  });
});

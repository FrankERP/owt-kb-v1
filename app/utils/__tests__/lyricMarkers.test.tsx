/** @vitest-environment jsdom */
// R6 Task 6: the lyric block's repeat markers dim, and the eyebrow token is the
// one spelling shared by the song page and ChordChart.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dimRepeatMarkers, LYRIC_EYEBROW } from "../lyricMarkers";

afterEach(cleanup);

describe("dimRepeatMarkers", () => {
  it("dims every // marker and leaves the words alone", () => {
    render(<p>{dimRepeatMarkers("Santo, santo // es el Señor //")}</p>);
    expect(screen.getAllByLabelText("repetir")).toHaveLength(2);
    expect(screen.getByText(/Santo, santo/)).toBeTruthy();
  });

  it("leaves a marker-free string exactly as it came", () => {
    expect(dimRepeatMarkers("Santo es el Señor")).toBe("Santo es el Señor");
  });

  it("passes non-string nodes through untouched", () => {
    const el = <em key="x">x</em>;
    expect(dimRepeatMarkers(el)).toBe(el);
  });

  it("walks an array of children, dimming only its strings", () => {
    const { container } = render(
      <p>{dimRepeatMarkers(["Canta // otra vez", <strong key="s">fuerte</strong>])}</p>,
    );
    expect(screen.getAllByLabelText("repetir")).toHaveLength(1);
    expect(container.querySelector("strong")?.textContent).toBe("fuerte");
  });

  it("is a neutral module — the eyebrow is a token string, not a component", () => {
    expect(LYRIC_EYEBROW).toContain("uppercase");
  });
});

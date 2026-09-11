/** @vitest-environment jsdom */
// app/components/ui/__tests__/AnimatedList.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MotionProvider } from "../MotionProvider";
import AnimatedList from "../AnimatedList";
import { installMotionTestEnv } from "./motionTestSetup";

installMotionTestEnv();
afterEach(cleanup);

describe("AnimatedList", () => {
  it("renders one list item per entry, in order, inside the requested host", () => {
    render(
      <MotionProvider>
        <AnimatedList
          as="ul"
          items={[
            { key: "a", node: "Alaba" },
            { key: "b", node: "Bueno" },
          ]}
        />
      </MotionProvider>,
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Alaba", "Bueno"]);
    expect(items[0].closest("ul")).not.toBeNull();
  });

  it("keeps semantics: the host is the list, items carry the item class", () => {
    render(
      <MotionProvider>
        <AnimatedList as="ol" itemClassName="row" items={[{ key: "a", node: "x" }]} />
      </MotionProvider>,
    );
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(screen.getByRole("listitem").className).toContain("row");
  });
});

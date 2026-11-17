/** @vitest-environment jsdom */
// Planear's three sections (2026-11-17): on a phone one at a time, picked by a control; from `lg`
// all three. jsdom has no layout or media queries, so what is pinned is the CONTRACT the CSS
// keeps: a section is hidden by a class, never unmounted — each owns open sheets and half-filled
// forms that a peek at another section must not throw away.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import PlannerSections from "../PlannerSections";

installMotionTestEnv();
afterEach(cleanup);

function view() {
  render(
    <PlannerSections
      map={<p>mapa</p>}
      saturday={<input aria-label="sábado" />}
      classes={<p>clases</p>}
      groups={<p>grupos</p>}
    />,
  );
}

const wrapper = (text: string) => screen.getByText(text).parentElement!;
const pick = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));
const hiddenOnPhone = (el: Element) => el.className.includes("hidden lg:block");

describe("PlannerSections", () => {
  it("opens on the Saturdays; the other two wait behind the control, the month map under it", () => {
    view();
    expect(screen.getByRole("radio", { name: "Sábados" }).getAttribute("aria-checked")).toBe("true");
    expect(hiddenOnPhone(screen.getByLabelText("sábado").parentElement!)).toBe(false);
    expect(hiddenOnPhone(wrapper("clases"))).toBe(true);
    expect(hiddenOnPhone(wrapper("grupos"))).toBe(true);
    expect(hiddenOnPhone(screen.getByRole("complementary", { name: "El mes de un vistazo" }))).toBe(false);
  });

  it("the control is a phone's: from `lg` every section shows and it is not drawn", () => {
    view();
    expect(screen.getByRole("radiogroup", { name: "Sección" }).className).toContain("lg:hidden");
  });

  it("the classes run across months, so the month map steps aside for them and comes back", () => {
    view();
    pick("Clases");
    expect(hiddenOnPhone(wrapper("clases"))).toBe(false);
    expect(hiddenOnPhone(screen.getByLabelText("sábado").parentElement!)).toBe(true);
    expect(hiddenOnPhone(screen.getByRole("complementary", { name: "El mes de un vistazo" }))).toBe(true);
    pick("Grupos");
    expect(hiddenOnPhone(wrapper("grupos"))).toBe(false);
    expect(hiddenOnPhone(screen.getByRole("complementary", { name: "El mes de un vistazo" }))).toBe(false);
  });

  it("a section left is hidden, never unmounted: what was typed in it is still there", () => {
    view();
    const field = screen.getByLabelText("sábado") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "a medias" } });
    pick("Grupos");
    pick("Sábados");
    expect(screen.getByLabelText("sábado")).toBe(field);
    expect(field.value).toBe("a medias");
  });
});

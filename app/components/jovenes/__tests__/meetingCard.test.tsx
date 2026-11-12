/** @vitest-environment jsdom */
// The meeting card on `/jovenes` (ADR-0086): what is folded and what is open, that the fold is a
// real disclosure (a button with `aria-expanded`, the closed half inert), and that only the next
// meeting wears the light pass.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { MinistryEventView } from "@/app/utils/ministryEventReads";
import { jovenesDayEntry } from "@/app/utils/calendarMinistry";
import { MINISTRIES } from "@/app/ministries";
import JovenesMeetingCard from "../MeetingCard";

installMotionTestEnv();
afterEach(cleanup);

const [G1, G2] = MINISTRIES.jovenes.groups;

function ev(over: Partial<MinistryEventView> = {}): MinistryEventView {
  return {
    _id: "ministryEvent.a",
    rev: "r1",
    ministry: "jovenes",
    audience: { kind: "ministry" },
    kind: "saturday",
    date: "2026-11-14",
    time: "18:10",
    arrival: "17:30",
    title: null,
    notes: null,
    place: "Oasis Tlalpan",
    lesson: null,
    published: true,
    seats: [
      { _key: "s1", role: "encargado", memberId: "m1", name: "Ana", mine: false },
      { _key: "s2", role: "predica", memberId: "m2", name: "Beto", mine: true },
    ],
    program: [{ _key: "l1", label: "Dinámica", note: "10 min", memberId: "m1", name: "Ana", mine: false }],
    createdById: null,
    createdByName: null,
    ...over,
  };
}

function card(e: MinistryEventView, props: { featured?: boolean; mine?: string[]; children?: React.ReactNode } = {}) {
  return render(
    <JovenesMeetingCard event={e} entry={jovenesDayEntry(e)} mine={props.mine ?? []} countdown="En 2 días" featured={props.featured}>
      {props.children}
    </JovenesMeetingCard>,
  );
}

/** The fold's two halves: the summary sits in the head, the body is what the button controls. */
function halves() {
  const button = screen.getByRole("button");
  const body = document.getElementById(button.getAttribute("aria-controls")!)!;
  return { button, body };
}

describe("JovenesMeetingCard", () => {
  it("a later meeting is folded: the summary shows, the body is inert, and a tap opens it", () => {
    card(ev());
    const { button, body } = halves();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("Ver detalles");
    expect(body.hasAttribute("inert")).toBe(true);
    expect(screen.getByText("Ana, Beto")).toBeTruthy();
    expect(screen.getByText("Programa · 1 parte")).toBeTruthy();

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Ocultar detalles");
    expect(body.hasAttribute("inert")).toBe(false);

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // `inert` returns only after the close animation, which never runs without the app's
    // MotionProvider — `Collapse.test.tsx` owns that half.
  });

  it("the next meeting opens by itself, shows its countdown, and is the lit one", () => {
    const { container } = card(ev(), { featured: true, mine: ["Predica"] });
    const { button, body } = halves();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(body.hasAttribute("inert")).toBe(false);
    expect(screen.getByText("En 2 días")).toBeTruthy();
    expect(screen.getByText("Tú · Predica")).toBeTruthy();
    expect(container.querySelectorAll(".brand-lit-card[data-lit]").length).toBe(1);
    expect(screen.getByRole("article").getAttribute("aria-label")).toMatch(/, en 2 días$/);
  });

  it("a folded card is not lit and hides its countdown chip", () => {
    const { container } = card(ev());
    expect(container.querySelector("[data-lit]")).toBeNull();
    expect(screen.queryByText("En 2 días")).toBeNull();
  });

  it("a meeting with only a note has no fold: the note is on the card", () => {
    card(ev({ seats: [], program: [], notes: "Traer Biblia" }));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Traer Biblia")).toBeTruthy();
  });

  it("a single seat reads «Role · Name» in the summary, and an empty seat shows no face there", () => {
    card(ev({ seats: [{ _key: "s1", role: "encargado", memberId: "m1", name: "Ana", mine: false }, { _key: "s2", role: "predica", memberId: null, name: null, mine: false }], program: [] }));
    const summary = screen.getByText("Encargado · Ana");
    // One face in the folded summary: Ana's initials, nothing for the seat with nobody.
    const faces = summary.parentElement!.querySelectorAll(".-space-x-1\\.5 > *");
    expect(faces.length).toBe(1);
    expect(faces[0].textContent).toBe("AN");
  });

  it("the heading says the date to a screen reader, and the drawn leaf is hidden from it", () => {
    const { container } = card(ev());
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Sábado de Jóvenes, Sábado 14 de noviembre");
    expect(container.querySelector("time")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("the toggle stretches over the head and gives up the press transform that would shrink it", () => {
    // A transformed button is the containing block of its own `::after`: with the house press
    // (`active:scale`) the stretched hit area collapsed to the circle mid-tap and a tap on the
    // title never clicked. jsdom has no layout, so the class is the contract.
    card(ev());
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("after:absolute");
    expect(cls).toContain("after:inset-0");
    expect(cls).toContain("active:!transform-none");
  });

  it("names every group of a shared meeting, monogram and name, and draws a rail segment each", () => {
    const { container } = card(ev({ audience: { kind: "groups", groups: [G1.id, G2.id] } }));
    const chips = screen.getByRole("list", { name: "Para" });
    expect(chips.textContent).toContain(G1.name);
    expect(chips.textContent).toContain(G2.name);
    expect(container.querySelectorAll(`.bg-group-${G1.id}`).length).toBeGreaterThan(0);
    expect(container.querySelectorAll(`.bg-group-${G2.id}`).length).toBeGreaterThan(0);
  });

  it("the program editor makes a seatless meeting foldable, and sits in the body", () => {
    card(ev({ seats: [], program: [] }), { children: <button type="button">Editar programa</button> });
    const toggle = screen.getByRole("button", { name: "Ver detalles" });
    const body = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(body.textContent).toContain("Editar programa");
  });
});

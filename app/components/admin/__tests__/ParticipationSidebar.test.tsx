/** @vitest-environment jsdom */
// The «Incluir especiales» switch on the Participaciones panel.
//
// The solver balances weekend services only, so a special (a CAMP set, a
// vigil) skews the picture of who served. The panel therefore leaves specials
// out unless asked — and one component serves the Servicios board and the
// planner, so the switch lives in it and these tests render it directly.
//
// Fixtures are chosen so each assertion has ONE way to pass: every special-only
// member is absent when the switch is off, and the member who serves both kinds
// has a different count on each side of the switch.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ParticipationSidebar } from "../ParticipationSidebar";
import { MotionProvider } from "../../ui/MotionProvider";
import { installMotionTestEnv } from "../../ui/__tests__/motionTestSetup";
import type { ParticipantRole } from "@/app/utils/computeParticipation";

installMotionTestEnv();

const KEY = "owt_participation_include_specials";

const frank = { _id: "m1", member_name: "Frank" };
const gaby = { _id: "m2", member_name: "Gaby" };
const samo = { _id: "m3", member_name: "Samo" };
const ana = { _id: "m4", member_name: "Ana" };

const roles: ParticipantRole[] = [
  // Sunday 2026-03-01: Frank leads, plays an instrument that week.
  {
    _type: "sunday_role",
    date: "2026-03-01",
    leads: [frank],
    bgvs: [],
    chorus: [],
    instruments: [{ person: frank }],
    foh: [],
  },
  // A Wednesday special (week of Sunday 2026-03-08): Frank leads, Gaby sings
  // BGV, Samo plays and Ana is on FOH. Gaby, Samo and Ana serve ONLY here.
  {
    _type: "special_role",
    date: "2026-03-04",
    leads: [frank],
    bgvs: [gaby],
    chorus: [],
    instruments: [{ person: frank }, { person: samo }],
    foh: [{ person: ana }],
  },
];

function mount(placement?: "default" | "board") {
  return render(
    <MotionProvider>
      <ParticipationSidebar roles={roles} monthLabel="Marzo 2026" placement={placement} />
    </MotionProvider>,
  );
}

const switchEl = () => screen.getByRole("switch", { name: "Incluir especiales" });

/** The row for `name`, or `null` when the member is not listed. */
function row(name: string): HTMLElement | null {
  const nameEl = screen.queryByText(name);
  return nameEl ? nameEl.parentElement!.parentElement! : null;
}
/** The caption line under a member's name, whitespace-normalised. */
const caption = (name: string) => row(name)!.children[0].children[1].textContent!.replace(/\s+/g, " ").trim();
/** The count the row ends on. */
const total = (name: string) => Number(row(name)!.lastElementChild!.textContent);

const showInstruments = () => fireEvent.click(screen.getByRole("radio", { name: "Instrumentos" }));

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("by default the panel leaves special services out", () => {
  it("starts with the switch off and named", () => {
    mount();
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
  });

  it("does not count a special's seats", () => {
    mount();
    // Frank's Sunday lead only; his special lead is not counted.
    expect(total("Frank")).toBe(1);
    expect(caption("Frank")).toBe("Líder 1·0 · BGV 0·0 · Coro 0");
    // Gaby serves only the special, so she is not on the panel at all.
    expect(row("Gaby")).toBeNull();
  });

  it("shows no «Especial» segment, legend entry or row caption", () => {
    const { container } = mount();
    expect(screen.queryByText("Especial")).toBeNull();
    // Case-sensitive: the switch's own label says «especiales».
    expect(container.textContent).not.toMatch(/Especial(?!es)/);
    for (const label of ["Líder", "BGV", "Coro"]) expect(screen.getByText(label)).toBeTruthy();
  });
});

describe("turning the switch on counts them", () => {
  it("counts the special's seats and shows the segment", async () => {
    const { container } = mount();
    fireEvent.click(switchEl());
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(total("Frank")).toBe(2));
    expect(caption("Frank")).toBe("Líder 1·0 · BGV 0·0 · Coro 0 · Especial 1");
    expect(total("Gaby")).toBe(1);
    expect(screen.getByText("Especial")).toBeTruthy(); // the legend entry
    expect(container.textContent).toMatch(/Especial 1/);
  });

  it("goes back to leaving them out", async () => {
    mount();
    fireEvent.click(switchEl());
    await waitFor(() => expect(total("Frank")).toBe(2));
    fireEvent.click(switchEl());
    await waitFor(() => expect(total("Frank")).toBe(1));
    expect(row("Gaby")).toBeNull();
    expect(screen.queryByText("Especial")).toBeNull();
  });
});

describe("the choice is remembered per browser", () => {
  it("writes the key on every flip", () => {
    mount();
    expect(window.localStorage.getItem(KEY)).toBeNull(); // nothing is written by merely mounting
    fireEvent.click(switchEl());
    expect(window.localStorage.getItem(KEY)).toBe("true");
    fireEvent.click(switchEl());
    expect(window.localStorage.getItem(KEY)).toBe("false");
  });

  it("starts ON when storage says «true»", () => {
    window.localStorage.setItem(KEY, "true");
    mount();
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(total("Frank")).toBe(2);
    expect(screen.getByText("Especial")).toBeTruthy();
  });

  it("restores the choice on a fresh mount", () => {
    const first = mount();
    fireEvent.click(switchEl());
    first.unmount();
    mount();
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
  });

  it("starts OFF for any other stored value", () => {
    window.localStorage.setItem(KEY, "1");
    mount();
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
  });
});

describe("a localStorage that throws", () => {
  it("still renders, OFF, and still flips for this visit", async () => {
    const boom = () => {
      throw new Error("SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);

    mount();
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(total("Frank")).toBe(1);

    fireEvent.click(switchEl());
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(total("Frank")).toBe(2));
  });
});

describe("the instrument and FOH week counts follow the switch", () => {
  it("leaves a special's instruments and FOH out of the weeks while off", () => {
    mount();
    showInstruments();
    // Frank plays on Sunday 03-01 AND on the special (week of 03-08): one week counted.
    expect(caption("Frank")).toBe("Instrumentos 1 sem · FOH 0 sem");
    // Samo and Ana appear only on the special.
    expect(row("Samo")).toBeNull();
    expect(row("Ana")).toBeNull();
    expect(screen.queryByText("Especial")).toBeNull();
  });

  it("counts them once the switch is on", async () => {
    mount();
    showInstruments();
    fireEvent.click(switchEl());
    await waitFor(() => expect(caption("Frank")).toBe("Instrumentos 2 sem · FOH 0 sem"));
    expect(caption("Samo")).toBe("Instrumentos 1 sem · FOH 0 sem");
    expect(caption("Ana")).toBe("Instrumentos 0 sem · FOH 1 sem");
  });

  it("keeps the switch, and its state, across the Voces/Instrumentos view", () => {
    mount();
    fireEvent.click(switchEl());
    showInstruments();
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
  });
});

describe("it works in both placements, inside the stacked header", () => {
  it.each(["default", "board"] as const)("%s", async (placement) => {
    const { container } = mount(placement);
    const header = container.querySelector("[data-rail-header]") as HTMLElement;
    expect(within(header).getByRole("switch", { name: "Incluir especiales" })).toBeTruthy();
    expect(total("Frank")).toBe(1);
    fireEvent.click(switchEl());
    await waitFor(() => expect(total("Frank")).toBe(2));
  });

  it("is toggled exactly once by a tap on the label text or on the switch itself", () => {
    // The row is a <label>, so the text is part of the tap target on a phone.
    // A double flip (label click re-firing the switch's click) would leave it
    // where it started — and write the key twice.
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mount();
    fireEvent.click(screen.getByText("Incluir especiales"));
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(setItem).toHaveBeenCalledTimes(1);
    fireEvent.click(switchEl());
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it("names itself with visible text, so the label a sighted user reads is the one announced", () => {
    mount();
    const sw = switchEl();
    const labelId = sw.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)!.textContent).toBe("Incluir especiales");
  });
});

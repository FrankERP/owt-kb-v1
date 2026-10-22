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
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(caption("Frank")).toBe("1 Líder");
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
    expect(caption("Frank")).toBe("1 Líder · 1 Especial");
    expect(total("Gaby")).toBe(1);
    expect(screen.getByText("Especial")).toBeTruthy(); // the legend entry
    expect(container.textContent).toMatch(/1 Especial/);
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

  it("still flips when only the WRITE fails (a readable, full storage)", () => {
    // A write-only failure is the quota case: reads work, `setItem` throws. An
    // unguarded `setItem` would throw out of the click handler — which vitest
    // reports as an unhandled error, not as this test failing, so the click is
    // wrapped and asserted on explicitly.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    });
    mount();
    expect(() => fireEvent.click(switchEl())).not.toThrow();
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(total("Frank")).toBe(2);
    // Not remembered, and the panel does not pretend it was.
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(() => fireEvent.click(switchEl())).not.toThrow();
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
  });
});

/** What another tab does to this one: write the key, then the browser fires `storage` HERE. */
function otherTabWrites(value: string | null, key: string | null = KEY) {
  if (key !== null) {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } else {
    window.localStorage.clear();
  }
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  });
}

describe("another tab's change", () => {
  // The rule: the panel's value changes on exactly two things — the user's flip
  // here, and a `storage` event for this key (or a `clear()`). A render never
  // re-reads storage, so a change never shows up «on the next re-render».
  it("shows up here immediately, with no user action and no re-render of our own", () => {
    mount();
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    otherTabWrites("true");
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    expect(total("Frank")).toBe(2);
    otherTabWrites("false");
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
  });

  it("is the last word, even over a choice made here earlier", () => {
    mount();
    fireEvent.click(switchEl()); // this tab: ON
    expect(window.localStorage.getItem(KEY)).toBe("true");
    otherTabWrites("false"); // the other tab, later: OFF
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
  });

  it("never flips the panel on a re-render that was not preceded by an event", () => {
    const { rerender } = mount();
    // Storage changes with NO `storage` event (nothing here announced it).
    window.localStorage.setItem(KEY, "true");
    // An unrelated re-render from the parent…
    rerender(
      <MotionProvider>
        <ParticipationSidebar roles={[...roles]} monthLabel="Marzo 2026" />
      </MotionProvider>,
    );
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    // …and one from the panel's own state.
    showInstruments();
    expect(switchEl().getAttribute("aria-checked")).toBe("false");
    // The event is what moves it.
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "true" }));
    });
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
  });

  it("ignores another key's event, hears a storage.clear() (null key), and stops listening on unmount", () => {
    const { unmount } = mount();
    window.localStorage.setItem(KEY, "true");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "owt_something_else", newValue: "x" }));
    });
    expect(switchEl().getAttribute("aria-checked")).toBe("false");

    otherTabWrites("true");
    expect(switchEl().getAttribute("aria-checked")).toBe("true");
    otherTabWrites(null, null); // another tab called localStorage.clear()
    expect(switchEl().getAttribute("aria-checked")).toBe("false");

    const removed = vi.spyOn(window, "removeEventListener");
    unmount();
    expect(removed).toHaveBeenCalledWith("storage", expect.any(Function));
  });
});

describe("the server render and the hydrating one agree", () => {
  it("renders OFF on the server whatever storage says, then hydrates into the stored choice", () => {
    // The server snapshot `useSyncExternalStore` is handed is the only thing
    // keeping the server render and the hydrating one in agreement. This file
    // runs in jsdom, so `window.localStorage` exists while `renderToString`
    // runs: a server snapshot of `() => true` would render the SERVER markup ON
    // and fail the first half — and on a real server, where `window` is
    // missing, a `useState(read)` would render OFF and then hydrate ON, a
    // hydration mismatch.
    window.localStorage.setItem(KEY, "true");
    const element = (
      <MotionProvider>
        <ParticipationSidebar roles={roles} monthLabel="Marzo 2026" />
      </MotionProvider>
    );

    // Attached before it is queried: computing a name from `aria-labelledby`
    // asks the node's root for `getElementById`, which a detached div lacks.
    // Removed in `finally` so a failed assertion cannot leave it for the next test.
    const host = document.createElement("div");
    document.body.appendChild(host);
    let root: Root | undefined;
    try {
      host.innerHTML = renderToString(element);
      const serverSwitch = within(host).getByRole("switch", { name: "Incluir especiales" });
      expect(serverSwitch.getAttribute("aria-checked")).toBe("false");
      expect(host.textContent).not.toMatch(/Especial(?!es)/); // no «Especial» legend or caption
      expect(within(host).queryByText("Gaby")).toBeNull(); // special-only member left out

      // The stored choice arrives AFTER hydration, as an update — never as a
      // mismatch React has to recover from.
      const errors = vi.spyOn(console, "error");
      const recoverable = vi.fn();
      act(() => {
        root = hydrateRoot(host, element, { onRecoverableError: recoverable });
      });
      expect(recoverable).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();

      const hydrated = within(host).getByRole("switch", { name: "Incluir especiales" });
      expect(hydrated.getAttribute("aria-checked")).toBe("true");
      expect(host.textContent).toMatch(/1 Especial/);
      expect(within(host).getByText("Gaby")).toBeTruthy();
    } finally {
      act(() => root?.unmount());
      host.remove();
    }
  });
});

describe("the instrument and FOH week counts follow the switch", () => {
  it("leaves a special's instruments and FOH out of the weeks while off", () => {
    mount();
    showInstruments();
    // Frank plays on Sunday 03-01 AND on the special (week of 03-08): one week counted.
    expect(caption("Frank")).toBe("1 sem instrumento");
    // Samo and Ana appear only on the special.
    expect(row("Samo")).toBeNull();
    expect(row("Ana")).toBeNull();
    expect(screen.queryByText("Especial")).toBeNull();
  });

  it("counts them once the switch is on", async () => {
    mount();
    showInstruments();
    fireEvent.click(switchEl());
    await waitFor(() => expect(caption("Frank")).toBe("2 sem instrumento"));
    expect(caption("Samo")).toBe("1 sem instrumento");
    expect(caption("Ana")).toBe("1 sem FOH");
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

// ─── The «Editar mes» redesign (2026-10-21) ──────────────────────────────────
//
// The caption says what the bar is made of in words (zeros left out, Saturday
// services counted), an average marker answers "above or below the others",
// a name can be picked so the grid outlines that member's chips, and the people
// who could serve but have no seat are listed under the chart.

describe("what each row says, and the panel's planner-only extras", () => {
  const liu = { _id: "m5", member_name: "Liu" };
  const month: ParticipantRole[] = [
    { _type: "sunday_role", date: "2026-03-01", leads: [frank], bgvs: [gaby], chorus: [liu], instruments: [], foh: [] },
    { _type: "saturday_role", date: "2026-03-07", leads: [frank], bgvs: [frank], chorus: [], instruments: [], foh: [] },
    { _type: "sunday_role", date: "2026-03-08", leads: [gaby], bgvs: [frank], chorus: [], instruments: [], foh: [] },
    // Ana sings only at a vigil, so the switch (off) leaves her out of the chart.
    { _type: "special_role", date: "2026-03-11", leads: [], bgvs: [], chorus: [ana], instruments: [], foh: [] },
  ];
  const pool = [
    { id: "m1", name: "Frank", voces: true, instrumentos: false, unavailable: false },
    { id: "m4", name: "Ana", voces: true, instrumentos: false, unavailable: false },
    { id: "m6", name: "Raúl", voces: true, instrumentos: false, unavailable: true },
    { id: "m7", name: "Beto", voces: true, instrumentos: false, unavailable: false },
    { id: "m3", name: "Samo", voces: false, instrumentos: true, unavailable: false },
  ];
  const mountMonth = (props: Partial<React.ComponentProps<typeof ParticipationSidebar>> = {}) =>
    render(
      <MotionProvider>
        <ParticipationSidebar roles={month} monthLabel="Marzo 2026" {...props} />
      </MotionProvider>,
    );

  it("words the bar with its zeros left out, and counts the Saturday SERVICES served", () => {
    mountMonth();
    // Frank: Lead Sun + Lead Sat, BGV Sat + BGV Sun = 4 seats; one Saturday service (two seats on it).
    expect(caption("Frank")).toBe("2 Líder · 2 BGV · 1 en sábado");
    expect(caption("Gaby")).toBe("1 Líder · 1 BGV");
    expect(caption("Liu")).toBe("1 Coro");
  });

  it("marks the average of the people serving, on the legend and on every bar", () => {
    const { container } = mountMonth();
    // Frank 4, Gaby 2, Liu 1 → 7 / 3.
    expect(container.querySelector("[data-average]")!.textContent).toBe("Promedio 2.3");
    expect(container.querySelectorAll("[data-average-marker]")).toHaveLength(3);
  });

  it("draws no average for a single row, where it would only restate that bar", () => {
    const { container } = render(
      <MotionProvider>
        <ParticipationSidebar roles={[month[0]].map((r) => ({ ...r, bgvs: [], chorus: [] }))} monthLabel="Marzo 2026" />
      </MotionProvider>,
    );
    expect(container.querySelector("[data-average]")).toBeNull();
    expect(container.querySelector("[data-average-marker]")).toBeNull();
  });

  it("makes each name a toggle only when the planner asks, and reports the pick", () => {
    const onSelect = vi.fn();
    const { rerender } = mountMonth({ onSelect });
    const name = screen.getByRole("button", { name: "Gaby" });
    expect(name.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(name);
    expect(onSelect).toHaveBeenLastCalledWith("m2");

    rerender(
      <MotionProvider>
        <ParticipationSidebar roles={month} monthLabel="Marzo 2026" onSelect={onSelect} selectedId="m2" />
      </MotionProvider>,
    );
    expect(screen.getByRole("button", { name: "Gaby" }).getAttribute("aria-pressed")).toBe("true");
    expect(row("Gaby")!.getAttribute("data-selected")).toBe("true");
    // A second tap drops the pick.
    fireEvent.click(screen.getByRole("button", { name: "Gaby" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("leaves names as plain text on the board, which has no grid to highlight", () => {
    mountMonth({ placement: "board" });
    expect(screen.queryByRole("button", { name: "Gaby" })).toBeNull();
    expect(row("Gaby")).not.toBeNull();
  });

  it("lists who could serve and has no seat — never someone who served only a special", () => {
    const { container } = mountMonth({ pool });
    const idle = container.querySelector("[data-idle-pool]") as HTMLElement;
    // Frank served; Ana sang at the vigil (out of the chart with the switch off, but she DID
    // participate); Samo's Tipo is instruments only. Beto and Raúl remain, by name.
    expect([...idle.querySelectorAll("[data-idle-member]")].map((el) => el.getAttribute("data-idle-member"))).toEqual(["m7", "m6"]);
    expect(idle.textContent).toBe("Sin participar este mes · 2Beto, Raúl (no disponible)");
  });

  it("asks the instruments question on the Instrumentos view", () => {
    const { container } = mountMonth({ pool });
    showInstruments();
    const idle = container.querySelector("[data-idle-pool]") as HTMLElement;
    expect(idle.textContent).toContain("Samo");
    expect(idle.textContent).not.toContain("Beto");
  });

  it("renders no idle list without a pool", () => {
    const { container } = mountMonth();
    expect(container.querySelector("[data-idle-pool]")).toBeNull();
  });
});

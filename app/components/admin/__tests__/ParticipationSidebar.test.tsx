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
      expect(host.textContent).toMatch(/Especial 1/);
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

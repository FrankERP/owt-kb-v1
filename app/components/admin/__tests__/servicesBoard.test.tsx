/** @vitest-environment jsdom */
//
// Servicios is a board (R5 ruling 5, Task 4).
//
// What this pins, and why each one is a fact rather than a preference:
//
//  1. The cards container is a SNAP TRACK from `lg` and scrolls ITSELF
//     (`lg:overflow-x-auto`), with `lg:snap-start` on every card. The board is
//     the only horizontal scroller this panel introduces; a card that stops
//     carrying `snap-start`, or a container that stops carrying its own
//     `overflow-x-auto`, is how a fixed-width track starts widening the page
//     instead (ADR-0035).
//  2. The month filter stays MULTI-select and says so through `aria-pressed`.
//     The pills look like a one-of-N control and are not one: pressing a second
//     month must leave the first pressed. A `SegmentedControl`-shaped
//     "improvement" here silently deletes the ability to compare two months.
//  3. The card's one primary action is a house `Button` that still carries
//     `data-action-kind` / `-rule` / `-route` — the 15-rule ladder's only
//     debuggable trace in the DOM (`docs/SERVICE_READINESS_UI.md`).
//  4. Loading draws `Skeleton`s, not an `animate-pulse` block.
//
// jsdom applies no CSS, so these are class/attribute assertions by design: the
// breakpoint behaviour is Tailwind's, the contract is that the classes are there.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ServicePrimaryAction from "../ServicePrimaryAction";
import ServicesPanel from "../ServicesPanel";
import { ToastProvider } from "../../ui/Toast";
import { CueDialogProvider } from "../../ui/CueDialogProvider";
import { SOURCE_ENDPOINTS } from "../serviceSourceState";
import type { PrimaryActionProps, ServiceRole } from "../serviceCardModel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Two months ahead of any plausible "today", so the default «Próximos» filter
// shows both and the month pills have something to multi-select.
const YEAR = new Date().getFullYear() + 1;
const MONTH_A = `${YEAR}-03`;
const MONTH_B = `${YEAR}-04`;

function role(id: string, date: string): ServiceRole {
  return {
    _id: id,
    _rev: `rev-${id}`,
    _type: "sunday_role",
    date,
    published: false,
    leads: [],
    bgvs: [],
    chorus: [],
    instruments: [],
    foh: [],
    songs: [],
  };
}

const ROLES = [role("role-a", `${MONTH_A}-01`), role("role-b", `${MONTH_B}-05`)];

/** A 200 with the right SHAPE per source — an unusable body is a failed load. */
const PAYLOAD: Record<string, unknown> = {
  [SOURCE_ENDPOINTS.roles]: ROLES,
  [SOURCE_ENDPOINTS.members]: [],
  [SOURCE_ENDPOINTS.roleTargets]: { targets: [], recordIssues: [], lockIssues: [] },
  [SOURCE_ENDPOINTS.setlistTargets]: { targets: [], recordIssues: [] },
  [SOURCE_ENDPOINTS.proposals]: {
    records: [],
    serviceRefConflicts: [],
    targetKeyConflicts: [],
    recordIssues: [],
    draftIds: [],
  },
};

/** Never resolves — the panel stays in its loading view. */
function stubPendingFetch() {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => PAYLOAD[url] ?? {},
    })),
  );
}

function mount() {
  return render(
    <ToastProvider>
      <CueDialogProvider>
        <ServicesPanel />
      </CueDialogProvider>
    </ToastProvider>,
  );
}

const board = (container: HTMLElement) =>
  container.querySelector("[data-card-id]")?.parentElement as HTMLElement;

describe("the Servicios board", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubFetch();
  });

  it("scrolls itself: the cards container is the snap track, not the page", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));

    const track = board(container);
    for (const cls of ["lg:flex", "lg:snap-x", "lg:snap-mandatory", "lg:overflow-x-auto", "lg:scroll-px-6"]) {
      expect(track.className, cls).toContain(cls);
    }
    // The track is a `min-w-0` child, so its fixed-width cards size the SCROLLER
    // and never the column that holds it.
    expect(track.className).toContain("min-w-0");
  });

  it("gives every card a snap stop and a fixed desktop width", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));

    for (const card of container.querySelectorAll("[data-card-id]")) {
      expect(card.className).toContain("lg:snap-start");
      expect(card.className).toContain("lg:shrink-0");
      expect(card.className).toContain("lg:w-[380px]");
      // Route reveal, capped stagger — the cards arrive, they do not pop.
      expect(card.getAttribute("data-reveal")).toBe("");
    }
  });

  it("keeps the month filter multi-select, and says so with aria-pressed", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("[data-card-id]").length).toBe(2));

    const monthLabel = (ym: string) =>
      new Date(ym + "-01T12:00:00").toLocaleDateString("es-MX", { month: "short", year: "2-digit" });

    const first = screen.getByRole("button", { name: monthLabel(MONTH_A) });
    const second = screen.getByRole("button", { name: monthLabel(MONTH_B) });
    expect(first.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(first);
    expect(first.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(second);
    // BOTH stay pressed: this is not a one-of-N control.
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll("[data-card-id]").length).toBe(2);
  });

  it("draws skeletons while the sources load, never a bare pulsing block", () => {
    vi.unstubAllGlobals();
    stubPendingFetch();
    const { container } = mount();

    const group = screen.getByRole("status", { name: "Cargando servicios" });
    expect(group.querySelectorAll(".brand-skeleton").length).toBe(6);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(0);
  });
});

describe("the card's one primary action", () => {
  const ACTION: PrimaryActionProps = {
    kind: "edit_team",
    label: "Editar equipo",
    disabled: false,
    rule: 9,
    route: "service_modal",
    reason: null,
  };

  it("is a house Button that still carries the ladder's trace", () => {
    render(<ServicePrimaryAction action={ACTION} onAction={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Editar equipo" });

    expect(button.getAttribute("data-action-kind")).toBe("edit_team");
    expect(button.getAttribute("data-action-rule")).toBe("9");
    expect(button.getAttribute("data-action-route")).toBe("service_modal");
    // The house button's base, and the ≥44px full-width target it keeps.
    expect(button.className).toContain("ease-out-brand");
    expect(button.className).toContain("min-h-[44px]");
    expect(button.className).toContain("w-full");
  });

  it("stays disabled with its reason when a source is missing", () => {
    const reason = "Faltan los miembros. Usa «Reintentar carga».";
    render(<ServicePrimaryAction action={{ ...ACTION, disabled: true, reason }} onAction={vi.fn()} />);

    expect((screen.getByRole("button", { name: "Editar equipo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(reason)).toBeTruthy();
  });
});

/** @vitest-environment jsdom */
// R2 Task 4 — the agenda and the mode host.
//
// The agenda's arithmetic (order, month breaks, the summary line, the conflict count)
// is `app/utils/agenda.ts`, tested in `app/utils/__tests__/agenda.test.ts`. What is
// asserted here is the LAYOUT contract: one row per service in date order under its
// month divider, the summary, the conflict flag, the countdown pill, and the one
// output a row has (`onSelect(date)`).
//
// The `CalendarView` half is a smoke test of the host: which mode it opens in, that
// Mes brings the grid and the legend, and that a pick opens the day sheet with the
// full `DayCard` — the sheet R2 deliberately left alone.
//
// `SwipeStrip` is mocked for the same reason `dayStrip.test.tsx` mocks it: motion's
// drag gesture cannot be driven in jsdom.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { SetlistSong } from "@/app/utils/interface";

installMotionTestEnv();

vi.mock("@/app/context/PlayerContext", () => ({ usePlayer: () => ({ openSheet: vi.fn() }) }));
// Mutable so a test can play a different signed-in member — the F1 «Tú» pill
// needs one seated in a row and one who isn't, same pattern as `bottomNav.test.tsx`.
let mockUser: { name?: string; alias?: string; role?: string } = { name: "Ana", alias: "Ani", role: "member" };
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: mockUser } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../ui/SwipeStrip", () => ({
  default: ({
    onSwipe,
    className,
    children,
  }: {
    onSwipe: (direction: -1 | 1) => void;
    className?: string;
    children: ReactNode;
  }) => (
    <div className={className}>
      <button type="button" data-testid="swipe-next" onClick={() => onSwipe(1)} />
      {children}
    </div>
  ),
}));

import AgendaView from "../AgendaView";
import CalendarView, { type ActiveDay } from "../CalendarView";

// Warm the LazyMotion feature chunk (ADR-0031), precedent Collapse.test.tsx — the
// toggle's thumb is a `layoutId` element and the sheet drags.
beforeAll(async () => { await import("@/app/components/ui/motionFeatures"); });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mockUser = { name: "Ana", alias: "Ani", role: "member" };
});

const song = (id: string): SetlistSong =>
  ({ _id: id, title: `Canción ${id}`, author: "Oasis", slug: { current: id }, timeSig: "4/4", bpm: "", key: "G", play_key: "G" }) as SetlistSong;

const sunday = (date: string, extra: Partial<ActiveDay> = {}): ActiveDay =>
  ({ day: "Domingo", date, leads: ["Ana"], ...extra });

const special = (date: string, extra: Partial<ActiveDay> = {}): ActiveDay =>
  ({ day: "Noche de alabanza", date, roleId: "sp1", leads: ["Ana"], ...extra });

// 13 and 20 September, 4 October — two months, so a divider has to appear twice.
const ACTIVE: Record<string, ActiveDay[]> = {
  "2026-09-13": [
    sunday("2026-09-13", {
      leads: ["Ana", "Beto"],
      instruments: [{ label: "Keys", person: "Sofi" }],
      setlist: { week: "2026-09-13", songs: [song("s1"), song("s2")] },
    }),
  ],
  "2026-09-20": [{ day: "Sábado", date: "2026-09-20", leads: ["Beto"] }],
  "2026-10-04": [sunday("2026-10-04")],
};

/** The agenda's rows — the only buttons that carry a date. */
const rows = () => screen.queryAllByRole("button").filter((b) => b.hasAttribute("data-date"));

function mountAgenda(activeDays: Record<string, ActiveDay[]> = ACTIVE, onSelect = vi.fn()) {
  render(
    <MotionProvider>
      <AgendaView activeDays={activeDays} todayStr="2026-09-10" onSelect={onSelect} emptyMessage="No hay servicios próximos." />
    </MotionProvider>,
  );
  return onSelect;
}

describe("AgendaView", () => {
  it("lists one row per service in date order, under its month divider", () => {
    mountAgenda();
    expect(rows().map((b) => b.dataset.date)).toEqual(["2026-09-13", "2026-09-20", "2026-10-04"]);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Septiembre 2026",
      "Octubre 2026",
    ]);
  });

  it("reads the day and its short date, with the service's summary under it", () => {
    mountAgenda();
    const row = rows()[0];
    // jsdom's ICU renders es-MX `weekday: short` as "dom." and `month: short` as
    // "sept."; only the day number is stable across ICU builds, so the words are
    // matched loosely (the uppercase is CSS, invisible to textContent).
    expect(row.textContent).toMatch(/dom.*13.*sep/i);
    expect(within(row).getByText("Lead Ana, Beto · Keys Sofi · 2 canciones")).toBeTruthy();
  });

  it("names the day, the long date, the countdown and the summary in the row's label", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0)); // 2026-09-10 local
    mountAgenda();
    expect(rows()[0].getAttribute("aria-label")).toMatch(
      /^Domingo, .*13.*septiembre, En 3 días, Lead Ana, Beto · Keys Sofi · 2 canciones$/i,
    );
  });

  it("carries no countdown in the label for a day the fetch already passed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0));
    render(
      <MotionProvider>
        <AgendaView
          activeDays={{ "2026-09-06": [sunday("2026-09-06")] }}
          todayStr="2026-09-10"
          onSelect={vi.fn()}
          emptyMessage="vacío"
        />
      </MotionProvider>,
    );
    expect(rows()[0].getAttribute("aria-label")).toMatch(/^Domingo, .*6.*septiembre, Lead Ana$/i);
  });

  it("counts down to an upcoming service in the pill", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0)); // 2026-09-10 local
    mountAgenda();
    expect(within(rows()[0]).getByText("En 3 días")).toBeTruthy();
  });

  it("carries no countdown on a day the fetch already passed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0));
    render(
      <MotionProvider>
        <AgendaView
          activeDays={{ "2026-09-06": [sunday("2026-09-06")] }}
          todayStr="2026-09-10"
          onSelect={vi.fn()}
          emptyMessage="vacío"
        />
      </MotionProvider>,
    );
    expect(rows()[0].textContent).not.toMatch(/Hace|En \d/);
  });

  it("flags a service that seats someone twice, once per affected section", () => {
    mountAgenda({
      "2026-09-13": [
        sunday("2026-09-13", {
          leads: ["Ana", "Ana"],
          instruments: [
            { label: "Keys", person: "Sofi" },
            { label: "Bajo", person: "Sofi" },
          ],
        }),
      ],
    });
    expect(within(rows()[0]).getByText("⚠ 2 conflictos")).toBeTruthy();
    expect(rows()[0].getAttribute("aria-label")).toMatch(/, 2 conflictos$/);
  });

  it("says «conflicto» in the singular — same wording in the chip and the label — and nothing at all when there is none", () => {
    mountAgenda({ "2026-09-13": [sunday("2026-09-13", { leads: ["Ana", "Ana"] })] });
    expect(within(rows()[0]).getByText("⚠ 1 conflicto")).toBeTruthy();
    expect(rows()[0].getAttribute("aria-label")).toMatch(/, 1 conflicto$/);
    cleanup();
    mountAgenda();
    expect(screen.queryByText(/⚠/)).toBeNull();
    expect(rows()[0].getAttribute("aria-label")).not.toMatch(/conflicto/);
  });

  it("names a special service after its date — Sábado/Domingo rows don't repeat the day word", () => {
    mountAgenda({ "2026-09-13": [special("2026-09-13")] });
    expect(within(rows()[0]).getByText("Noche de alabanza")).toBeTruthy();
    // A regular Sunday/Saturday row carries no second name — the day word already said it.
    cleanup();
    mountAgenda({ "2026-09-13": [sunday("2026-09-13")] });
    expect(within(rows()[0]).queryByText("Domingo")).toBeNull();
  });

  it("F1 — pills «Tú · Keys» for the row where the signed-in member is seated", () => {
    mockUser = { alias: "Sofi" };
    mountAgenda({
      "2026-09-13": [sunday("2026-09-13", { leads: ["Ana"], instruments: [{ label: "Keys", person: "Sofi" }] })],
    });
    expect(within(rows()[0]).getByText("Tú · Keys")).toBeTruthy();
    expect(rows()[0].getAttribute("aria-label")).toMatch(/, te toca: Keys$/);
  });

  it("gives no pill to a member not seated in the row", () => {
    mockUser = { alias: "Beto" };
    mountAgenda({
      "2026-09-13": [sunday("2026-09-13", { leads: ["Ana"], instruments: [{ label: "Keys", person: "Sofi" }] })],
    });
    expect(within(rows()[0]).queryByText(/^Tú/)).toBeNull();
    expect(rows()[0].getAttribute("aria-label")).not.toMatch(/te toca/);
  });

  it("gates the countdown on todayStr, not the client's clock, even mid-window", () => {
    // The client thinks it's 2026-09-01; the SERVER fetched from 2026-09-10 (a
    // browsed month, say). A row on 2026-09-05 sits before that boundary, so no
    // pill — the `row.date >= todayStr` half of the guard, isolated from `days >= 0`.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 1, 9, 0, 0)); // 2026-09-01 local
    render(
      <MotionProvider>
        <AgendaView
          activeDays={{ "2026-09-05": [sunday("2026-09-05")] }}
          todayStr="2026-09-10"
          onSelect={vi.fn()}
          emptyMessage="vacío"
        />
      </MotionProvider>,
    );
    expect(rows()[0].textContent).not.toMatch(/Hace|En \d|Hoy|Mañana/);
  });

  it("reports the ISO date of the picked row", () => {
    const onSelect = mountAgenda();
    fireEvent.click(rows()[1]);
    expect(onSelect).toHaveBeenCalledWith("2026-09-20");
  });

  it("says so when the window carries no service", () => {
    mountAgenda({});
    expect(screen.getByText("No hay servicios próximos.")).toBeTruthy();
    expect(rows()).toHaveLength(0);
  });
});

function mountHost(activeDays: Record<string, ActiveDay[]> = ACTIVE) {
  render(
    <MotionProvider>
      <CueDialogProvider>
        <CalendarView activeDays={activeDays} viewMonth={null} todayStr="2026-09-10" />
      </CueDialogProvider>
    </MotionProvider>,
  );
}

describe("CalendarView host", () => {
  it("opens in Agenda — rows, no grid, no legend", () => {
    mountHost();
    expect(screen.getByRole("radio", { name: "Agenda" }).getAttribute("aria-checked")).toBe("true");
    expect(rows()).toHaveLength(3);
    expect(screen.queryByText("Varios servicios")).toBeNull();
    expect(screen.queryByText("Mié")).toBeNull();
  });

  it("renders the first paint at rest — no `appear` above the fold (M0b, ADR-0031)", () => {
    // `Presence.test.tsx`'s own precedent for `appear={false}`: the crossfade
    // exists for MODE SWITCHES only, so the panel that mounts on first render
    // must not carry the enter animation's opacity: 0.
    mountHost();
    expect(["", "1"]).toContain(screen.getByTestId("mode-panel").style.opacity);
  });

  it("switches to Mes: the month grid and its legend, and no agenda rows", () => {
    mountHost();
    fireEvent.click(screen.getByRole("radio", { name: "Mes" }));
    expect(screen.getByRole("radio", { name: "Mes" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Varios servicios")).toBeTruthy();
    expect(screen.getAllByText("Mié")).toHaveLength(3); // one per month of the window
    expect(rows()).toHaveLength(0);
  });

  it("retires «Lista» — the mode is Agenda or Mes", () => {
    mountHost();
    expect(screen.queryByRole("radio", { name: "Lista" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Calendario" })).toBeNull();
  });

  it("opens the day sheet with the full card when a row is picked", () => {
    mountHost();
    fireEvent.click(rows()[0]);
    const dialog = screen.getByRole("dialog", { name: "Detalle del día" });
    expect(within(dialog).getByRole("heading", { level: 3 }).textContent).toMatch(/Domingo/);
  });

  it("brings the agenda along when the strip pages to another week", () => {
    // jsdom implements no `scrollIntoView`, so the host calls it optionally; the stub
    // is what proves the row it picks is the first one on or after the new Monday.
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: scrollIntoView });
    mountHost();
    fireEvent.click(screen.getByTestId("swipe-next")); // 2026-09-10 → week of 2026-09-14
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect((scrollIntoView.mock.instances[0] as HTMLElement).dataset.date).toBe("2026-09-20");
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("carries the month header as the route's only heading level 2", () => {
    mountHost();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Septiembre 2026"]);
  });
});

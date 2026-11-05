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
import { ToastProvider } from "@/app/components/ui/Toast";
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

  it("leads with the day number, then «Domingo · 11:00» and the service's summary under it", () => {
    mountAgenda();
    const row = rows()[0];
    // The number first (the display face, like the library's key), the day word as the
    // title, the clock by the feed's one rule (`serviceClock`: a Sunday at 11:00).
    expect(within(row).getByText("13").className).toContain("font-display");
    expect(within(row).getByText("Domingo")).toBeTruthy();
    expect(within(row).getByText("11:00")).toBeTruthy();
    expect(within(row).getByText("Lead Ana, Beto · Keys Sofi · 2 canciones")).toBeTruthy();
    // A Saturday row at the standing 18:00.
    expect(within(rows()[1]).getByText("18:00")).toBeTruthy();
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
    expect(within(rows()[0]).getByText("2 conflictos")).toBeTruthy();
    expect(rows()[0].querySelector('[data-icon="warning"]')).not.toBeNull();
    expect(rows()[0].getAttribute("aria-label")).toMatch(/, 2 conflictos$/);
  });

  it("says «conflicto» in the singular — same wording in the chip and the label — and nothing at all when there is none", () => {
    mountAgenda({ "2026-09-13": [sunday("2026-09-13", { leads: ["Ana", "Ana"] })] });
    expect(within(rows()[0]).getByText("1 conflicto")).toBeTruthy();
    expect(rows()[0].getAttribute("aria-label")).toMatch(/, 1 conflicto$/);
    cleanup();
    mountAgenda();
    expect(screen.queryByText(/conflicto/)).toBeNull();
    expect(document.querySelector('[data-icon="warning"]')).toBeNull();
    expect(rows()[0].getAttribute("aria-label")).not.toMatch(/conflicto/);
  });

  it("titles a special row with its own name and no day word; a Sunday row says «Domingo» once", () => {
    mountAgenda({ "2026-09-13": [special("2026-09-13", { time: "19:30" })] });
    expect(within(rows()[0]).getByText("Noche de alabanza")).toBeTruthy();
    expect(within(rows()[0]).queryByText("Domingo")).toBeNull();
    // A special's clock is its own `time`; a weekend's is the standing hour.
    expect(within(rows()[0]).getByText("19:30")).toBeTruthy();
    cleanup();
    mountAgenda({ "2026-09-13": [sunday("2026-09-13")] });
    expect(within(rows()[0]).getAllByText("Domingo")).toHaveLength(1);
  });

  it("F1 — pills «Tú · Keys» for the row where the signed-in member is seated", () => {
    // The clock is FIXED here for the same reason four tests above it fix theirs:
    // `mountAgenda` passes `todayStr="2026-09-10"`, but `upcoming` is
    // `row.date >= todayStr && days >= 0`, and `daysUntil` reads the real clock
    // on purpose (AgendaView:65 — a browsed month must not go stale against a
    // page rendered yesterday). So the tense in this aria-label followed the
    // machine's own date: green on 2026-09-13, red on the 14th, and red for
    // every PR gate after it.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0)); // 2026-09-10 local
    mockUser = { alias: "Sofi" };
    mountAgenda({
      "2026-09-13": [sunday("2026-09-13", { leads: ["Ana"], instruments: [{ label: "Keys", person: "Sofi" }] })],
    });
    expect(within(rows()[0]).getByText("Tú · Keys")).toBeTruthy();
    expect(rows()[0].getAttribute("aria-label")).toMatch(/, te toca: Keys$/);
  });

  it("F1 — says «te tocó», past tense, for a seated row the fetch already passed", () => {
    mockUser = { alias: "Sofi" };
    render(
      <MotionProvider>
        <AgendaView
          activeDays={{ "2026-09-06": [sunday("2026-09-06", { leads: ["Ana"], instruments: [{ label: "Keys", person: "Sofi" }] })] }}
          todayStr="2026-09-10"
          onSelect={vi.fn()}
          emptyMessage="vacío"
        />
      </MotionProvider>,
    );
    expect(rows()[0].getAttribute("aria-label")).toMatch(/, te tocó: Keys$/);
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

// `DayCard` raises a toast from its quick-actions sheet (F3), so it needs the stack
// its real host mounts app-wide in `app/utils/Provider.tsx`.
function mountHost(activeDays: Record<string, ActiveDay[]> = ACTIVE) {
  render(
    <MotionProvider>
      <ToastProvider>
        <CueDialogProvider>
          <CalendarView activeDays={activeDays} viewMonth={null} todayStr="2026-09-10" />
        </CueDialogProvider>
      </ToastProvider>
    </MotionProvider>,
  );
}

describe("CalendarView host", () => {
  it("opens in Agenda — rows, no grid, no legend", () => {
    mountHost();
    expect(screen.getByRole("radio", { name: "Agenda" }).getAttribute("aria-checked")).toBe("true");
    expect(rows()).toHaveLength(3);
    expect(screen.queryByText("Especial")).toBeNull();
    expect(screen.getAllByText("Jue")).toHaveLength(1); // the week strip's own label; no grid headers
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
    expect(screen.getByText("Especial")).toBeTruthy(); // the legend's three dots
    expect(screen.queryByText("Varios servicios")).toBeNull(); // a second service is a second dot, not a legend entry
    expect(screen.getAllByText("Jue")).toHaveLength(4); // the strip's label + one column header per month of the window
    expect(rows()).toHaveLength(0);
  });

  it("ADR-0067 — the grid's selected cell keeps today's ring visible by turning it base on the accent fill", () => {
    // 2026-09-10 is `todayStr`; give it a service so it can be selected.
    mountHost({ ...ACTIVE, "2026-09-10": [{ day: "Domingo", date: "2026-09-10", leads: ["Ana"] }] });
    fireEvent.click(screen.getByRole("radio", { name: "Mes" }));
    // The grid's today cell (the strip has one too, without `aspect-square`). After the
    // pick the day sheet opens and the page behind it goes inert, so the cell is read
    // from the DOM rather than by role.
    // (The grid's circle is `h-9`; the strip's is `h-10`.)
    const gridToday = () => document.querySelector<HTMLButtonElement>('button.h-9[aria-current="date"]')!;
    expect(gridToday().className).toContain("ring-ink/70");
    fireEvent.click(gridToday());
    // The sheet is titled by the date now, not «Detalle del día».
    expect(screen.getByRole("dialog", { name: /jueves.*10.*septiembre/i })).toBeTruthy();
    expect(gridToday().className).toContain("bg-accent");
    expect(gridToday().className).toContain("ring-surface-base/70");
    expect(gridToday().className).not.toContain("ring-ink/70");
  });

  it("retires «Lista» — the mode is Agenda or Mes", () => {
    mountHost();
    expect(screen.queryByRole("radio", { name: "Lista" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Calendario" })).toBeNull();
  });

  it("opens the day sheet — titled by the date, the clock under it, the run sheet with «Ensayar» — when a row is picked", () => {
    mountHost();
    fireEvent.click(rows()[0]);
    // The same run sheet Inicio opens on (`DayCard hero`), not the default card with its
    // own uppercase header inside a sheet called «Detalle del día».
    const dialog = screen.getByRole("dialog", { name: /domingo.*13.*septiembre/i });
    expect(within(dialog).getByText("11:00")).toBeTruthy();
    expect(within(dialog).getByText("Setlist")).toBeTruthy();
    expect(within(dialog).getByText(/Ensayar el setlist/)).toBeTruthy();
    // One service on the day: the sheet's line names it, so the card's own identity
    // line («Domingo · 13 sep · 11:00») is not said twice.
    expect(within(dialog).queryByText(/Domingo · 13/)).toBeNull();
  });

  it("switches to Mes: the legend names the green dot too", () => {
    mountHost();
    fireEvent.click(screen.getByRole("radio", { name: "Mes" }));
    expect(screen.getByText("Te toca")).toBeTruthy();
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

// 2026-10-29 — the ministry filter, for a member of Alabanza and Oasis Kids.
describe("CalendarView — ministry filter", () => {
  const kidsSunday = (date: string, mine = false): ActiveDay => ({
    day: "Oasis Kids",
    date,
    kids: {
      seats: [
        { seat: "ensenanza", label: "Enseñanza", pair: "Ana y Luis", mine: false },
        { seat: "chiquitos", label: "RG Chiquitos", pair: "Beto y Sofi", mine },
        { seat: "medianos", label: "RG Medianos", pair: null, mine: false },
        { seat: "grandes", label: "RG Grandes", pair: "Mkz y Caro", mine: false },
      ],
    },
  });
  const BOTH: Record<string, ActiveDay[]> = {
    ...ACTIVE,
    "2026-09-13": [...ACTIVE["2026-09-13"], kidsSunday("2026-09-13", true)],
    "2026-09-27": [kidsSunday("2026-09-27")],
  };

  function mountFiltered(view: "all" | "worship" | "kids" | undefined, activeDays = BOTH) {
    render(
      <MotionProvider>
        <ToastProvider>
          <CueDialogProvider>
            <CalendarView activeDays={activeDays} viewMonth={null} todayStr="2026-09-10" ministryView={view} />
          </CueDialogProvider>
        </ToastProvider>
      </MotionProvider>,
    );
  }

  afterEach(() => {
    document.cookie = "owt_calendar_view=; path=/; max-age=0";
  });

  it("shows no ministry control to a reader of one ministry", () => {
    mountHost();
    expect(screen.queryByRole("radiogroup", { name: "Ministerio" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Todos" })).toBeNull();
  });

  it("opens on the remembered view and lists both ministries under «Todos»", () => {
    mountFiltered("all");
    expect(screen.getByRole("radio", { name: "Todos" }).getAttribute("aria-checked")).toBe("true");
    expect(rows().map((r) => r.getAttribute("aria-label")?.split(",")[0])).toEqual([
      "Domingo", "Oasis Kids", "Sábado", "Oasis Kids", "Domingo",
    ]);
  });

  it("«Alabanza» hides every Kids Sunday; «Oasis Kids» hides every worship service", () => {
    mountFiltered("all");
    fireEvent.click(screen.getByRole("radio", { name: "Alabanza" }));
    expect(rows().map((r) => r.getAttribute("aria-label")?.split(",")[0])).toEqual(["Domingo", "Sábado", "Domingo"]);
    fireEvent.click(screen.getByRole("radio", { name: "Oasis Kids" }));
    expect(rows().map((r) => r.getAttribute("aria-label")?.split(",")[0])).toEqual(["Oasis Kids", "Oasis Kids"]);
  });

  it("starts on a remembered single ministry", () => {
    mountFiltered("kids");
    expect(screen.getByRole("radio", { name: "Oasis Kids" }).getAttribute("aria-checked")).toBe("true");
    expect(rows()).toHaveLength(2);
  });

  it("remembers the choice on this device", () => {
    mountFiltered("all");
    fireEvent.click(screen.getByRole("radio", { name: "Alabanza" }));
    expect(document.cookie).toContain("owt_calendar_view=worship");
  });

  it("counts only what the chosen view shows", () => {
    mountFiltered("all");
    expect(screen.getByText(/5 servicios por venir/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Oasis Kids" }));
    expect(screen.getByText(/2 servicios por venir/)).toBeTruthy();
  });

  it("marks the reader's Kids seat «Tú» in the row, decided by the server's flag", () => {
    mountFiltered("kids");
    const row = rows()[0];
    // «te tocó» or «te toca» by the real clock; the seat is what this pins.
    expect(row.getAttribute("aria-label")).toMatch(/te toc[aó]: RG Chiquitos$/);
    expect(within(row).getByText("Tú · RG Chiquitos")).toBeTruthy();
  });

  it("opens a Kids Sunday as the four seats, with «Tú» on the reader's pair", () => {
    mountFiltered("kids");
    fireEvent.click(rows()[0]);
    const sheet = screen.getByRole("dialog");
    const kids = within(sheet).getByRole("region", { name: "Oasis Kids" });
    expect(within(kids).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "EnseñanzaAna y Luis",
      "RG ChiquitosTú · Beto y Sofi",
      "RG MedianosSin asignar",
      "RG GrandesMkz y Caro",
    ]);
    expect(within(kids).getByRole("link", { name: "Ver Oasis Kids" }).getAttribute("href")).toBe("/kids");
  });

  it("names Oasis Kids in the Mes legend only while a Kids Sunday is shown", () => {
    mountFiltered("all");
    fireEvent.click(screen.getByRole("radio", { name: "Mes" }));
    const legendKids = () => screen.queryAllByText("Oasis Kids").filter((el) => el.className.includes("text-[13px]"));
    expect(legendKids()).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "Alabanza" }));
    expect(legendKids()).toHaveLength(0);
  });
});

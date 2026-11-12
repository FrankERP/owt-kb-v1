/** @vitest-environment jsdom */
// The service card (R1 Task 6, spec §12.1/§18/§19.2; its head and frame: ADR-0087). What is asserted here is
// the contract Task 7 composes against: the header reads `DÍA · fecha` with no
// eyebrow, the countdown replaces the `Próximo` pill, `hero` carries the one
// Ensayar, rows show BPM, and `wide` puts the two sections side by side.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CueDialogProvider } from "@/app/components/ui/CueDialogProvider";
import { ToastProvider } from "@/app/components/ui/Toast";
import { MotionProvider } from "@/app/components/ui/MotionProvider";
import { installMotionTestEnv } from "@/app/components/ui/__tests__/motionTestSetup";
import type { SetlistSong } from "@/app/utils/interface";

installMotionTestEnv();

// A STABLE spy: the long-press cases assert that a press opens no sheet, which a
// fresh `vi.fn()` per render could never show.
const openSheet = vi.fn();
vi.mock("@/app/context/PlayerContext", () => ({ usePlayer: () => ({ openSheet }) }));
// Mutable so a test can seat a different session alias — the F1 refactor's guard
// needs one seated on an instrument, same pattern as `agendaView.test.tsx`.
let mockUser: { name?: string; alias?: string; role?: string } = { name: "Ana", alias: "Ani", role: "member" };
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: mockUser } }),
}));

import { DayCard, type DayCardProps } from "../DayCard";

const song = (id: string, extra: Partial<SetlistSong> = {}): SetlistSong =>
  ({ _id: id, title: `Canción ${id}`, author: "Oasis", slug: { current: id }, timeSig: "4/4", bpm: "", key: "G", play_key: "G", ...extra }) as SetlistSong;

function mount(props: Partial<DayCardProps> = {}) {
  return render(
    <MotionProvider>
      <ToastProvider>
        <CueDialogProvider>
          <DayCard day="Domingo" date="2026-09-13" setlist={{ week: "2026-09-13", songs: [song("s1")] }} leads={["Ana"]} {...props} />
        </CueDialogProvider>
      </ToastProvider>
    </MotionProvider>,
  );
}

afterEach(() => {
  cleanup();
  openSheet.mockClear();
  vi.useRealTimers();
  mockUser = { name: "Ana", alias: "Ani", role: "member" };
});

describe("DayCard", () => {
  it("heads the card with the day and its short date, and no `Servicio` eyebrow", () => {
    mount();
    const heading = screen.getByRole("heading", { level: 3 });
    // jsdom's ICU renders es-MX `month: short` as "13 sep"; only the day number
    // is stable across ICU builds, so the month is matched case-insensitively.
    expect(heading.textContent).toMatch(/Domingo\s*·\s*13\s*sep/i);
    expect(screen.queryByText("Servicio")).toBeNull();
    expect(screen.queryByText("Próximo")).toBeNull();
  });

  it("shows the set's time after the date, and nothing when there is none", () => {
    mount({ day: "Campamento · Alabanza", time: "18:45" });
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/Campamento · Alabanza\s*·\s*13\s*sep\s*·\s*18:45/i);
    cleanup();
    mount({ day: "Campamento · Alabanza" });
    expect(screen.getByRole("heading", { level: 3 }).textContent).not.toMatch(/\d\d:\d\d/);
  });

  it("counts down to the next service instead of labelling it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 11, 9, 0, 0)); // 2026-09-11 local
    mount({ isNext: true });
    expect(screen.getByText("En 2 días")).toBeTruthy();
  });

  it("D — the next service's pill carries the start time: a weekend at the team's standing hour", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 11, 9, 0, 0));
    const { container } = mount({ isNext: true });
    expect(container.textContent).toContain("En 2 días · 11:00");
    cleanup();
    expect(mount({ isNext: true, day: "Sábado", date: "2026-09-12" }).container.textContent).toContain("Mañana · 18:00");
  });

  it("D — a special's own time is in the heading already, so the pill does not repeat it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 11, 9, 0, 0));
    const { container } = mount({ isNext: true, day: "Campamento", roleId: "r1", time: "18:45" });
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/18:45/);
    expect(container.textContent).toContain("En 2 días");
    expect(container.textContent).not.toContain("En 2 días · 18:45");
    // An untimed special is all-day: no clock anywhere.
    cleanup();
    expect(mount({ isNext: true, day: "Campamento", roleId: "r1" }).container.textContent).not.toMatch(/\d\d:\d\d/);
  });

  it("shows no countdown on a card that is not the next service", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 11, 9, 0, 0));
    mount();
    expect(screen.queryByText("En 2 días")).toBeNull();
  });

  describe("D — «Mensaje para el equipo» folds to three lines", () => {
    const note = "Mensaje del Pastor: la plática es de la Justicia.\nSubirían cuando empiezo a narrar la escena.";
    // jsdom lays nothing out, so the clamped paragraph's overflow is staged on
    // the prototype: `scrollHeight` beyond `clientHeight` is the fourth line.
    function stageOverflow(overflowing: boolean) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 60 });
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => (overflowing ? 120 : 60) });
    }
    afterEach(() => {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    });

    it("clamps the note and offers «Leer todo» only when a fourth line exists", () => {
      stageOverflow(true);
      mount({ setlist: { week: "2026-09-13", songs: [song("s1")], team_notes: note } });
      const text = screen.getByText(/Mensaje del Pastor/);
      expect(text.className).toContain("line-clamp-3");
      const toggle = screen.getByRole("button", { name: "Leer todo" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(toggle.getAttribute("aria-controls")).toBe(text.id);
      fireEvent.click(toggle);
      expect(text.className).not.toContain("line-clamp-3");
      expect(screen.getByRole("button", { name: "Leer menos" }).getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Leer menos" }));
      expect(text.className).toContain("line-clamp-3");
    });

    it("arrives folded again when the same card is handed another day's note", () => {
      stageOverflow(true);
      const card = (team_notes: string) => (
        <MotionProvider>
          <ToastProvider>
            <CueDialogProvider>
              <DayCard day="Domingo" date="2026-09-13" setlist={{ week: "2026-09-13", songs: [song("s1")], team_notes }} leads={["Ana"]} />
            </CueDialogProvider>
          </ToastProvider>
        </MotionProvider>
      );
      // `CalendarView` keys its cards by index: the Saturday card's instance is
      // reused for Sunday, and Sunday's note must not inherit Saturday's «Leer todo».
      const { rerender } = render(card(note));
      fireEvent.click(screen.getByRole("button", { name: "Leer todo" }));
      expect(screen.getByText(/Mensaje del Pastor/).className).not.toContain("line-clamp-3");
      rerender(card("Otro domingo, otra nota del pastor, igual de larga."));
      expect(screen.getByText(/Otro domingo/).className).toContain("line-clamp-3");
      expect(screen.getByRole("button", { name: "Leer todo" })).toBeTruthy();
    });

    it("grows no toggle for a note that already fits", () => {
      stageOverflow(false);
      mount({ setlist: { week: "2026-09-13", songs: [song("s1")], team_notes: note } });
      expect(screen.getByText(/Mensaje del Pastor/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Leer/ })).toBeNull();
    });
  });

  it("shows the pastor's message to everyone, in its own box ABOVE the team note (ADR-0065, 2026-10-24)", () => {
    const { container } = mount({
      pastorMessage: "Efesios 2: por gracia",
      setlist: { week: "2026-09-13", songs: [song("s1")], team_notes: "Lleguen 8:30" },
    });
    // Each note is a `section` whose small-caps title comes before its text.
    const titles = Array.from(container.querySelectorAll("section p.uppercase")).map((p) => p.textContent);
    expect(titles.indexOf("Mensaje del pastor")).toBeGreaterThan(-1);
    expect(titles.indexOf("Mensaje del pastor")).toBeLessThan(titles.indexOf("Mensaje para el equipo"));
    expect(screen.getByText("Efesios 2: por gracia")).toBeTruthy();
  });

  it("draws no pastor's box when there is none", () => {
    mount({ pastorMessage: null, setlist: { week: "2026-09-13", songs: [song("s1")], team_notes: "Lleguen 8:30" } });
    expect(screen.queryByText("Mensaje del pastor")).toBeNull();
  });

  it("gives a hero card ONE Ensayar and drops the inline practice pill", () => {
    mount({ hero: true });
    expect(screen.getAllByRole("button", { name: /Ensayar/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Practicar/ })).toBeNull();
  });

  describe("ADR-0087 — the next service is a card with a head of its own", () => {
    it("heads the card with the date as a leaf, the day as its title, the clock and the countdown", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 8, 11, 9, 0, 0));
      const { container } = mount({ hero: true, isNext: true });
      // One object with an edge and the day's rail, drawn once.
      const card = container.querySelector("article.brand-surface")!;
      expect(card).toBeTruthy();
      expect(card.querySelector(".w-\\[3px\\]")!.className).toContain("animate-rail-draw");
      const head = card.querySelector("header")!;
      expect(within(head).getByRole("heading", { level: 3 }).textContent).toBe("Domingo");
      // The leaf says the date to a screen reader too — the title says only the day.
      const leaf = head.querySelector("time")!;
      expect(leaf.getAttribute("datetime")).toBe("2026-09-13");
      expect(leaf.getAttribute("aria-hidden")).toBeNull();
      // The weekend's standing hour, the countdown as a chip, then the one Ensayar.
      expect(within(head).getByText("11:00")).toBeTruthy();
      expect(head.textContent).toContain("En 2 días");
      expect(within(head).getAllByRole("button", { name: /Ensayar/ })).toHaveLength(1);
      cleanup();
      // Without `isNext` (`/me`, whose header already counts down) the card carries no countdown.
      expect(mount({ hero: true }).container.querySelector("header")!.textContent).not.toMatch(/En \d+ días/);
      cleanup();
      // A special carries its own clock; an untimed one has none.
      expect(mount({ hero: true, day: "Campamento", roleId: "r1", time: "18:45" }).container.querySelector("header")!.textContent).toContain("18:45");
      cleanup();
      expect(mount({ hero: true, day: "Campamento", roleId: "r1" }).container.querySelector("header")!.textContent).not.toMatch(/\d\d:\d\d/);
    });

    it("says «Tú · Lead» in the card's head, in the positive tone, only for a service the viewer serves", () => {
      mount({ hero: true, leads: ["Ani"] });
      const chip = within(document.querySelector("header")!).getByText("Tú · Lead");
      expect(chip.className).toContain("text-positive-fg");
      cleanup();
      mount({ hero: true, leads: ["Beto"] });
      expect(within(document.querySelector("header")!).queryByText(/^Tú ·/)).toBeNull();
    });

    it("lights the border once only where the host asks for it (`lit`), and only on a framed card", () => {
      expect(mount({ hero: true }).container.querySelector("[data-lit]")).toBeNull();
      cleanup();
      const lit = mount({ hero: true, lit: true }).container.querySelector(".brand-lit-card[data-lit]")!;
      expect(lit.firstElementChild?.tagName).toBe("ARTICLE");
      cleanup();
      // A sheet whose host names the service has no frame, so nothing to light.
      expect(mount({ hero: true, identity: false, lit: true }).container.querySelector("[data-lit]")).toBeNull();
    });

    it("draws the body alone — no frame, no head — where the host already names the service (`identity={false}`)", () => {
      const { container } = mount({ hero: true, identity: false });
      expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
      expect(container.querySelector(".brand-surface")).toBeNull();
      expect(container.querySelector("time")).toBeNull();
      // The calendar's day sheet still gets the one Ensayar.
      expect(screen.getAllByRole("button", { name: /Ensayar/ })).toHaveLength(1);
    });

    it("says «Setlist pendiente» in the setlist's place when the team was published before the songs", () => {
      mount({ hero: true, setlist: null, instruments: [{ label: "Keys", person: "Gaby" }] });
      expect(screen.getByRole("heading", { level: 4, name: "Setlist" })).toBeTruthy();
      expect(screen.getByText("Setlist pendiente")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Ensayar/ })).toBeNull();
      cleanup();
      // With songs in, the placeholder is gone and the title counts them.
      mount({ hero: true });
      expect(screen.queryByText("Setlist pendiente")).toBeNull();
      expect(screen.getByRole("heading", { level: 4, name: /^Setlist\s*·\s*1$/ })).toBeTruthy();
    });

    it("titles the team «Equipo» in the sheet's small caps, and labels its sections in sentence-case body type", () => {
      mount({ hero: true, instruments: [{ label: "Keys", person: "Gaby" }] });
      const equipo = screen.getByRole("heading", { level: 4, name: "Equipo" });
      expect(equipo.className).toContain("uppercase");
      const banda = screen.getAllByText(/^Banda/)[0];
      expect(banda.className).toContain("text-[17px]");
      expect(banda.className).not.toContain("uppercase");
      // An ordinary card keeps the tracked small caps and no «Equipo» title.
      cleanup();
      mount({ instruments: [{ label: "Keys", person: "Gaby" }] });
      expect(screen.queryByRole("heading", { level: 4, name: "Equipo" })).toBeNull();
      expect(screen.getAllByText(/^Banda/)[0].className).toContain("uppercase");
    });

    it("`sheet` without `hero` is the same body minus the head — no frame, no date, no Ensayar", () => {
      const { container } = mount({ sheet: true });
      expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
      expect(screen.queryByRole("button", { name: /Ensayar/ })).toBeNull();
      expect(container.textContent).not.toMatch(/13\s*sep/i);
      expect(container.querySelector(".brand-surface")).toBeNull();
      expect(screen.getByRole("heading", { level: 4, name: /^Setlist/ }).className).toContain("tracking-[0.22em]");
    });

    it("sets a sheet row as picture with its number · 17 px title · artist and tempo under it · key pill", () => {
      mount({
        hero: true,
        setlist: {
          week: "2026-09-13",
          songs: [
            song("s1", { author: "Oasis Worship", bpm: "132", cover: "https://cdn.sanity.io/images/ebb8vcnk/production/abc123-1000x1000.jpg" }),
            song("s2"),
          ],
        },
      });
      const row = screen.getByRole("button", { name: /Canción s1/ });
      // The album's cover, with the song's place in the set on the corner.
      expect(row.querySelector("img")?.getAttribute("src")).toBe("https://cdn.sanity.io/images/ebb8vcnk/production/abc123-1000x1000.jpg?w=160&h=160&fit=crop");
      expect(within(row).getByText("1").className).toContain("tabular-nums");
      expect(screen.getByText("Canción s1").className).toContain("text-[17px]");
      const author = screen.getByText("Oasis Worship");
      expect(author.className).not.toContain("hidden");
      expect(within(row).getByText("132")).toBeTruthy();
      // The key stays INK inside a day card (ADR-0071), as a hairline pill.
      const key = within(row).getByText("G");
      expect(key.className).toContain("rounded-full");
      expect(key.className).toContain("text-ink");
      // A song with no cover gets the neutral tile, never a broken picture.
      expect(screen.getByRole("button", { name: /Canción s2/ }).querySelector("img")).toBeNull();
    });
  });

  it("keeps the inline practice pill on an ordinary card", () => {
    mount();
    expect(screen.getByRole("button", { name: /Practicar/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ensayar/ })).toBeNull();
  });

  it("carries the BPM after the key, and nothing at all when the song has none", () => {
    // Both halves in one case on purpose: a row with no BPM must not render an
    // empty column, and the assertion is only worth anything next to a row that
    // does render one.
    mount({ setlist: { week: "2026-09-13", songs: [song("s1"), song("s2", { bpm: "144" })] } });
    const [blank, withBpm] = screen.getAllByRole("listitem");
    expect(within(blank).queryByText("144")).toBeNull();
    expect(blank.textContent!.trimEnd().endsWith("G")).toBe(true);
    expect(within(withBpm).getByText("144")).toBeTruthy();
    expect(withBpm.textContent!.trimEnd().endsWith("G144")).toBe(true);
  });

  it("puts the setlist and the team in two columns only when `wide` has both a setlist and a team", () => {
    // The two columns are the service card's (`hero`): the plain card has no wide caller.
    const { container, unmount } = mount({ layout: "wide", hero: true });
    expect(container.querySelector(".lg\\:grid")).not.toBeNull();
    unmount();
    expect(mount({ hero: true }).container.querySelector(".lg\\:grid")).toBeNull();
  });

  it("keeps «Mensaje para el equipo» in the setlist's column on the run sheet, with the team as the rail", () => {
    // Frank, 2026-10-22: on a big screen the message spanned both columns and
    // pushed the whole sheet down; it belongs over the setlist, beside the team.
    const { container } = mount({ layout: "wide", hero: true, setlist: { week: "2026-09-13", songs: [song("s1")], team_notes: "Hoy a las 10" } });
    const grid = container.querySelector(".lg\\:grid") as HTMLElement;
    const main = grid.querySelector("[data-run-sheet-main]") as HTMLElement;
    expect(main).toBe(grid.firstElementChild);
    expect(main.textContent).toContain("Mensaje para el equipo");
    expect(main.textContent).toContain("Setlist");
    expect(grid.lastElementChild?.textContent).toContain("Voces");
    expect(grid.lastElementChild?.contains(main)).toBe(false);
    // The rail's team is laid out open from `lg` (the CSS-switched rendering).
    expect(grid.lastElementChild?.querySelector("[data-team-open]")).not.toBeNull();
  });

  it("wraps nothing on a stacked card: the message and the setlist are the card's own children", () => {
    const { container } = mount({ setlist: { week: "2026-09-13", songs: [song("s1")], team_notes: "Hoy a las 10" } });
    expect(container.querySelector("[data-run-sheet-main]")).toBeNull();
    expect(container.querySelector("[data-team-open]")).toBeNull();
  });

  it("stacks a `wide` card with a setlist but no team, instead of reserving an empty rail", () => {
    const { container } = mount({ layout: "wide", hero: true, leads: [] });
    expect(container.querySelector(".lg\\:grid")).toBeNull();
  });

  it("F3 — a long press on a setlist row opens the card's one quick-actions sheet", () => {
    // 450 ms / 8 px / scroll-cancel live in `useLongPress`; what matters here is
    // that the ROW reports the press and the CARD owns the sheet.
    vi.useFakeTimers();
    mount();
    const row = screen.getByRole("button", { name: /Canción s1/ });
    act(() => {
      fireEvent.pointerDown(row, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
      vi.advanceTimersByTime(450);
      fireEvent.pointerUp(row, { isPrimary: true });
    });
    // The press swallows the click it produced — it must not also open the song.
    act(() => {
      fireEvent.click(row);
    });
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Abrir" })).toBeTruthy();
    expect(openSheet).not.toHaveBeenCalled();
  });

  it("F3 — a plain tap still opens the song sheet and no quick-actions sheet", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Canción s1/ }));
    expect(openSheet).toHaveBeenCalledWith("s1", "G");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("F1 — marks «tú» in the positive tone for a session alias seated on an instrument", () => {
    mockUser = { alias: "Sofi", role: "member" };
    mount({ leads: ["Ana"], instruments: [{ label: "Keys", person: "Sofi" }] });
    // Her seat opens Banda (the section she serves in), so her face shows with
    // the seat line «Keys · tú» in the positive tone.
    const seat = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Keys · tú");
    expect(seat.className).toContain("text-positive-fg");
  });

  it("opens every team section for an admin, not just the one they serve in", () => {
    mockUser = { alias: "Sofi", role: "admin" };
    mount({ leads: ["Ana"], instruments: [{ label: "Keys", person: "Sofi" }], fohTeam: [{ label: "Audio", person: "Beto" }] });
    for (const s of [/Voces/, /Banda/, /Cabina/]) expect(screen.getByRole("button", { name: s }).getAttribute("aria-expanded")).toBe("true");
    cleanup();
    mockUser = { alias: "Sofi", role: "member" };
    mount({ leads: ["Ana"], instruments: [{ label: "Keys", person: "Sofi" }], fohTeam: [{ label: "Audio", person: "Beto" }] });
    expect(screen.getByRole("button", { name: /Voces/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /Banda/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("shows who leads a song under its title, and nothing when nobody does", () => {
    mount({ setlist: { week: "2026-09-13", songs: [
      song("s1", { leads: [{ member_name: "Ana López", alias: "Ani" }, { member_name: "Beto" }] }),
      song("s2"),
    ] } });
    expect(screen.getByText("Dirige: Ani y Beto")).toBeTruthy();
    expect(screen.getAllByText(/^Dirige:/)).toHaveLength(1);
  });

  it("tells the member which songs they lead", () => {
    mount({ myLeadSongs: ["Canción A", "Canción B"] });
    expect(screen.getByText("Diriges: Canción A, Canción B")).toBeTruthy();
    cleanup();
    mount();
    expect(screen.queryByText(/^Diriges:/)).toBeNull();
  });
});

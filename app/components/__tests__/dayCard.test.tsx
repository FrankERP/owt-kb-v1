/** @vitest-environment jsdom */
// The run-sheet card (R1 Task 6, spec §12.1/§18/§19.2). What is asserted here is
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

  it("shows no countdown on a card that is not the next service", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 11, 9, 0, 0));
    mount();
    expect(screen.queryByText("En 2 días")).toBeNull();
  });

  it("gives a hero card ONE Ensayar and drops the inline practice pill", () => {
    mount({ hero: true });
    expect(screen.getAllByRole("button", { name: /Ensayar/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Practicar/ })).toBeNull();
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
    const { container, unmount } = mount({ layout: "wide" });
    expect(container.querySelector(".lg\\:grid")).not.toBeNull();
    unmount();
    expect(mount().container.querySelector(".lg\\:grid")).toBeNull();
  });

  it("stacks a `wide` card with a setlist but no team, instead of reserving an empty rail", () => {
    const { container } = mount({ layout: "wide", leads: [] });
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

  it("F1 — highlights the positive `isMe` glow for a session alias seated on an instrument", () => {
    mockUser = { alias: "Sofi", role: "member" };
    mount({ leads: ["Ana"], instruments: [{ label: "Keys", person: "Sofi" }] });
    const row = screen.getByText("Sofi");
    expect(row.className).toContain("text-positive-fg");
  });
});

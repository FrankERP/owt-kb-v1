/** @vitest-environment jsdom */
// The section bar's practice cluster (R4, task 4): once the hero scrolls away the
// bar picks up the title, the sounding key, the tempo and the play control, so a
// member practising halfway down the page never scrolls back up for them. The
// right-hand slot is always in the DOM — it reserves its height so the bar does
// not grow when the cluster fades in.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectionNav from "../SectionNav";
import { TransposeProvider } from "../song/TransposeProvider";
import { MotionProvider } from "../ui/MotionProvider";
import { installMotionTestEnv } from "../ui/__tests__/motionTestSetup";

installMotionTestEnv();

const playTrack = vi.fn();
const togglePlay = vi.fn();
let player = { track: null as null | { url: string }, isPlaying: false };

vi.mock("@/app/context/PlayerContext", () => ({
  usePlayer: () => ({ playTrack, togglePlay, player }),
}));

interface FakeObserver {
  callback: IntersectionObserverCallback;
  targets: Element[];
  init?: IntersectionObserverInit;
}
let observers: FakeObserver[] = [];

class MockIntersectionObserver implements IntersectionObserver {
  root: Element | null = null;
  rootMargin = "";
  thresholds: ReadonlyArray<number> = [];
  private entry: FakeObserver;
  constructor(cb: IntersectionObserverCallback, init?: IntersectionObserverInit) {
    this.entry = { callback: cb, targets: [], init };
    observers.push(this.entry);
  }
  observe(el: Element) {
    this.entry.targets.push(el);
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/** Fire the observer watching `el` with the given intersection state. */
function report(el: Element, isIntersecting: boolean) {
  const obs = observers.find((o) => o.targets.includes(el));
  if (!obs) throw new Error("no observer watches that element");
  act(() => {
    obs.callback(
      [{ isIntersecting, target: el } as unknown as IntersectionObserverEntry],
      null as unknown as IntersectionObserver,
    );
  });
}

const sections = [
  { id: "audio", label: "Audio" },
  { id: "letra", label: "Letra" },
];

const track = {
  url: "https://cdn.test/guia.mp3",
  title: "Guía",
  tone: "G",
  songTitle: "Sólo en Jesús",
  songSlug: "solo-en-jesus",
};

const practice = { title: "Sólo en Jesús", bpm: 120, track };

function mount(ui: React.ReactNode) {
  const hero = document.createElement("div");
  hero.id = "song-hero";
  document.body.appendChild(hero);
  sections.forEach((s) => {
    const el = document.createElement("section");
    el.id = s.id;
    document.body.appendChild(el);
  });
  const result = render(
    <MotionProvider>
      <TransposeProvider nativeKey="G">{ui}</TransposeProvider>
    </MotionProvider>,
  );
  return { ...result, hero };
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  playTrack.mockReset();
  togglePlay.mockReset();
  player = { track: null, isPlaying: false };
  vi.unstubAllGlobals();
});

describe("SectionNav practice cluster", () => {
  it("stays out of the bar while the hero is on screen", () => {
    const { hero, queryByRole, queryByText } = mount(<SectionNav sections={sections} practice={practice} />);
    report(hero, true);

    expect(queryByText("120 BPM")).toBeNull();
    expect(queryByRole("button", { name: "Reproducir Guía" })).toBeNull();
  });

  it("carries the title, key, tempo and play control once the hero is gone", () => {
    const { container, hero, getByRole, getByText } = mount(
      <SectionNav sections={sections} practice={practice} />,
    );
    report(hero, false);

    const title = getByText("Sólo en Jesús");
    expect(title.className).toContain("lg:block");
    expect((container.querySelector(".brand-key-dial") as HTMLElement).textContent).toContain("G");
    expect(getByText("120 BPM")).toBeTruthy();
    expect(getByRole("button", { name: "Reproducir Guía" })).toBeTruthy();
  });

  it("hands an idle track to the player and toggles the one already loaded", () => {
    const first = mount(<SectionNav sections={sections} practice={practice} />);
    report(first.hero, false);
    fireEvent.click(first.getByRole("button", { name: "Reproducir Guía" }));
    expect(playTrack).toHaveBeenCalledWith(track);
    expect(togglePlay).not.toHaveBeenCalled();

    cleanup();
    document.body.innerHTML = "";
    observers = [];
    player = { track: { url: track.url }, isPlaying: true };

    const second = mount(<SectionNav sections={sections} practice={practice} />);
    report(second.hero, false);
    fireEvent.click(second.getByRole("button", { name: "Pausar Guía" }));
    expect(togglePlay).toHaveBeenCalledTimes(1);
    expect(playTrack).toHaveBeenCalledTimes(1);
  });

  it("insets the hero observer by the chrome that covers the top of the page", () => {
    // The hand-off must happen when the hero passes under the navbar + this bar,
    // not under the viewport's top edge — otherwise the hero's controls are
    // already hidden behind the chrome while the bar still shows nothing.
    const { hero } = mount(<SectionNav sections={sections} practice={practice} />);
    const obs = observers.find((o) => o.targets.includes(hero))!;
    expect(obs.init?.rootMargin).toMatch(/^-\d+px /);
  });

  it("reserves the slot even with no practice info, and keeps the section links", () => {
    const { container, hero, getByRole } = mount(<SectionNav sections={sections} />);
    report(hero, false);

    const slot = container.querySelector(".min-h-\\[44px\\]") as HTMLElement;
    expect(slot).toBeTruthy();
    expect(slot.textContent).toBe("");

    const audio = getByRole("link", { name: "Audio" });
    expect(audio.getAttribute("aria-current")).toBe("location");
    report(document.getElementById("letra")!, true);
    expect(getByRole("link", { name: "Letra" }).getAttribute("aria-current")).toBe("location");
  });
});

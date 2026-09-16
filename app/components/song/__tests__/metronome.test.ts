/** @vitest-environment jsdom */
// The click under the tempo ring. A "tale of two clocks" scheduler: a coarse
// `setTimeout` loop looks ahead on the AudioContext's own clock and books every
// beat that falls inside the window, so the sound is sample-accurate even when
// the main thread stalls. What the tests pin is exactly that — WHEN each click is
// booked on the context clock, not when the timer happened to fire.
//
// The fake context is hand-rolled rather than mocked from a library because the
// only thing that matters is `currentTime`, which the test advances in lockstep
// with the fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLICK, createMetronome } from "../metronome";

type FakeOsc = {
  type: string;
  frequency: { value: number };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

class FakeAudioContext {
  currentTime = 0;
  state = "suspended";
  destination = {};
  resume = vi.fn(() => {
    this.state = "running";
    return Promise.resolve();
  });
  suspend = vi.fn(() => {
    this.state = "suspended";
    return Promise.resolve();
  });
  oscillators: FakeOsc[] = [];
  gains: { gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn> }[] = [];

  createOscillator() {
    const osc: FakeOsc = {
      type: "sine",
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.oscillators.push(osc);
    return osc;
  }

  createGain() {
    const node = {
      gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
    this.gains.push(node);
    return node;
  }
}

let ctx: FakeAudioContext;
let factory: ReturnType<typeof vi.fn<() => AudioContext>>;

/** Advance wall time and the context clock together, in sub-lookahead steps.
 *  From wherever the clock already is: an AudioContext clock never rewinds, and
 *  a test whose second `advance()` started from zero again would be testing a
 *  machine that does not exist. */
function advance(ms: number) {
  const step = 5;
  const base = ctx.currentTime;
  for (let elapsed = step; elapsed <= ms; elapsed += step) {
    ctx.currentTime = base + elapsed / 1000;
    vi.advanceTimersByTime(step);
  }
}

/** The moment each click was booked on the context clock. */
function clickTimes() {
  return ctx.oscillators.map((o) => o.start.mock.calls[0][0] as number);
}

beforeEach(() => {
  vi.useFakeTimers();
  ctx = new FakeAudioContext();
  factory = vi.fn<() => AudioContext>(() => ctx as unknown as AudioContext);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createMetronome", () => {
  it("books one click per beat on the context clock", () => {
    const m = createMetronome({ bpm: 120, beatsPerBar: 4, audioContext: factory });
    m.start();
    expect(m.running).toBe(true);
    expect(ctx.resume).toHaveBeenCalled();

    advance(1000);

    // Two beats SOUND inside the first second — 0.05 s (the seed, one lookahead
    // window after the tap) and 0.55 s at 120 BPM. The scheduler has also already
    // booked 1.05 s, which is the whole point of looking ahead.
    const times = clickTimes();
    const heard = times.filter((t) => t <= 1);
    expect(heard).toHaveLength(2);
    expect(heard[0]).toBeCloseTo(0.05, 5);
    expect(heard[1]).toBeCloseTo(0.55, 5);
    expect(times[2]).toBeCloseTo(1.05, 5);

    // Each click is an oscillator through its own gain envelope, into the
    // destination — and it is stopped, or the node would run forever.
    const osc = ctx.oscillators[0];
    expect(osc.connect).toHaveBeenCalledWith(ctx.gains[0]);
    expect(ctx.gains[0].connect).toHaveBeenCalledWith(ctx.destination);
    expect(ctx.gains[0].gain.setValueAtTime).toHaveBeenCalledWith(CLICK.gain, expect.any(Number));
    expect(ctx.gains[0].gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      0.0001,
      expect.closeTo(0.05 + CLICK.lengthMs / 1000, 5),
    );
    expect(osc.stop).toHaveBeenCalled();

    m.stop();
  });

  it("accents beat 1 of every bar", () => {
    const m = createMetronome({ bpm: 120, beatsPerBar: 4, audioContext: factory });
    m.start();
    advance(2200);

    const hz = ctx.oscillators.map((o) => o.frequency.value);
    expect(hz.slice(0, 5)).toEqual([
      CLICK.accentHz,
      CLICK.beatHz,
      CLICK.beatHz,
      CLICK.beatHz,
      CLICK.accentHz,
    ]);
    m.stop();
  });

  it("accents the downbeat of a 3/4 bar", () => {
    const m = createMetronome({ bpm: 120, beatsPerBar: 3, audioContext: factory });
    m.start();
    advance(1700);

    const hz = ctx.oscillators.map((o) => o.frequency.value);
    expect(hz.slice(0, 4)).toEqual([CLICK.accentHz, CLICK.beatHz, CLICK.beatHz, CLICK.accentHz]);
    m.stop();
  });

  it("skips the beats a stalled main thread missed, keeping the bar's phase", () => {
    const m = createMetronome({ bpm: 120, beatsPerBar: 4, audioContext: factory });
    m.start();
    advance(20);
    expect(clickTimes()).toHaveLength(1); // the seed at 0.05, beat 1 of the bar

    // The tab was throttled: the context clock ran on while no timer fired, and
    // the next beat (0.55) plus the one after are now in the PAST. Booking them
    // would fire them all at once — `osc.start(t)` with t < currentTime plays
    // immediately.
    ctx.currentTime = 1.2;
    vi.advanceTimersByTime(CLICK.lookaheadMs);
    advance(900);

    const times = clickTimes();
    expect(times.every((t, i) => i === 0 || t >= 1.2)).toBe(true);
    expect(times[1]).toBeCloseTo(1.55, 5);
    expect(times[2]).toBeCloseTo(2.05, 5);
    // Phase kept: 0.05 was beat 1 of the bar, so 2.05 (four beats later) is too,
    // and 1.55 — beat 4 — is not.
    const hz = ctx.oscillators.map((o) => o.frequency.value);
    expect(hz.slice(0, 3)).toEqual([CLICK.accentHz, CLICK.beatHz, CLICK.accentHz]);
    m.stop();
  });

  it("silences the clicks it had already booked when it stops", () => {
    const m = createMetronome({ bpm: 120, beatsPerBar: 4, audioContext: factory });
    m.start();
    advance(20);

    const osc = ctx.oscillators[0];
    // Only the scheduled tail so far — the click is still ahead of the clock.
    expect(osc.stop).toHaveBeenCalledTimes(1);

    m.stop();
    // Suspending would only FREEZE it: the context clock stops where it is and
    // the booked click sounds off-phase the moment the next tap resumes it.
    expect(osc.stop).toHaveBeenCalledTimes(2);
    expect(osc.stop).toHaveBeenLastCalledWith();

    // The list was cleared with it, so a second stop silences nothing twice —
    // and nothing accumulates across a long run.
    m.stop();
    expect(osc.stop).toHaveBeenCalledTimes(2);
  });

  it("prunes finished clicks rather than holding a rehearsal's worth", () => {
    const m = createMetronome({ bpm: 120, beatsPerBar: 4, audioContext: factory });
    m.start();
    advance(3000);
    expect(ctx.oscillators.length).toBeGreaterThan(4);

    m.stop();
    // Everything already over was dropped on a tick; only what is still live (at
    // most one scheduling window of clicks) is stopped by hand.
    const silenced = ctx.oscillators.filter((o) => o.stop.mock.calls.some((c) => c.length === 0));
    expect(silenced.length).toBeLessThanOrEqual(2);
    expect(silenced.length).toBeGreaterThan(0);
  });

  it("stop() clears the loop, suspends the context", () => {
    const m = createMetronome({ bpm: 120, beatsPerBar: 4, audioContext: factory });
    m.start();
    advance(100);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    m.stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(m.running).toBe(false);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);

    // No stray click after the stop: the loop is a self-rescheduling timeout,
    // never an interval.
    const booked = ctx.oscillators.length;
    advance(1000);
    expect(ctx.oscillators).toHaveLength(booked);
  });

  it("reuses the same context across starts", () => {
    const m = createMetronome({ bpm: 120, beatsPerBar: 4, audioContext: factory });
    m.start();
    advance(100);
    m.stop();
    m.start();
    advance(100);
    m.stop();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it("stops and reports when the tab is hidden", () => {
    const onStop = vi.fn();
    const m = createMetronome({ bpm: 120, beatsPerBar: 4, onStop, audioContext: factory });
    m.start();
    advance(100);

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(m.running).toBe(false);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    // The listener came off with the stop: a second visibility flip is silent.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onStop).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  it("is a silent no-op where the Web Audio API does not exist", () => {
    const m = createMetronome({ bpm: 120, beatsPerBar: 4 });
    // jsdom ships no AudioContext, prefixed or not — the ring still runs, the
    // click simply never sounds.
    m.start();
    expect(m.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => m.stop()).not.toThrow();
  });
});

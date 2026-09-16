// The click under the tempo ring (R4 ruling 11). Browser-only, but NOT a
// component: no "use client", no React, no `motion` — `TempoPill` is the only
// importer and it is the client boundary.
//
// A TALE OF TWO CLOCKS. `setTimeout` is not accurate enough to place a beat —
// it drifts under load and jitters by tens of milliseconds — while the
// AudioContext clock is sample-accurate but cannot call code. So the loop is
// coarse and the booking is precise: every `lookaheadMs` a self-rescheduling
// timeout books every click whose time falls inside the next `scheduleAheadMs`
// on `ctx.currentTime`. It is a `setTimeout` and never a `setInterval` precisely
// so a stop can never race a queued tick.
//
// Two consequences of booking ahead, both handled explicitly. A tick that ran
// LATE (a stall longer than the window, a phone that throttled the tab) would
// otherwise book beats already in the past, and `osc.start(pastTime)` fires at
// once — a flam of stacked clicks catching up. So the loop skips the missed
// beats and keeps the bar's accent phase. And a `stop()` leaves up to one window
// of clicks already booked: SUSPENDING THE CONTEXT DOES NOT SILENCE THEM, it
// freezes the clock they are pinned to, so they would sound off-phase the moment
// the next tap resumes it. Every booked oscillator is therefore stopped by hand.
//
// ONE AT A TIME. The module keeps a "current" and a `start()` takes the floor
// from it (F2, ruling 15) — two pills can be on screen at once, the song page's
// hero under the `SongSheet` opened over it, and two tempos sounding together is
// noise. The instance that loses the floor is stopped through its own path and
// reports it through `onStop`, so its pill un-presses rather than ringing silently.
//
// The SOUND is the master clock; the RING is not. The ring stays CSS-clocked on
// `--tempo-period` (see `TempoPill`), which keeps the reduced-motion story
// unchanged — the ring collapses with every other animation and the click keeps
// playing, because sound is not motion. The two clocks are monotonic and their
// drift over a rehearsal is inaudible.

export interface Metronome {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/** A metronome plus the private hand-over path only this module may call. */
interface OwnedMetronome extends Metronome {
  /** Stop because something else took the floor, and tell the owner so its pill un-presses. */
  handOver(): void;
}

// ONE metronome sounds at a time, app-wide (F2, ruling 15). Two pills can exist
// at once — the song page's hero and the `SongSheet` opened over it — and two
// tempos at once is noise, not a feature. The module, not the pills, owns that
// rule: a `start()` hands the floor over from whoever held it, and the loser
// hears about it through its own `onStop`.
let current: OwnedMetronome | null = null;

/** Stop whatever is currently sounding, from outside any instance. The owning pill un-presses. */
export function stopCurrentMetronome(): void {
  current?.handOver();
}

export const CLICK = {
  /** Beat 1 of the bar. */
  accentHz: 1000,
  beatHz: 800,
  lengthMs: 30,
  gain: 0.5,
  /** How often the scheduling loop wakes. */
  lookaheadMs: 25,
  /** How far ahead of the context clock it books. */
  scheduleAheadMs: 100,
} as const;

/** The first beat lands one lookahead window after the tap, never at `currentTime` itself. */
const START_DELAY_S = 0.05;
/** `exponentialRampToValueAtTime` cannot reach 0. */
const SILENCE = 0.0001;

type AudioContextCtor = new () => AudioContext;

function nativeAudioContext(): AudioContextCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

export function createMetronome(opts: {
  bpm: number;
  beatsPerBar: number;
  /** Fired when the metronome stops itself (the tab went hidden) so the pill can drop its state. */
  onStop?: () => void;
  /** Test seam only — production passes none and the context is created lazily. */
  audioContext?: () => AudioContext;
}): Metronome {
  const secondsPerBeat = 60 / (opts.bpm > 0 ? opts.bpm : 80);
  const bar = opts.beatsPerBar > 0 ? Math.round(opts.beatsPerBar) : 4;

  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let nextBeatTime = 0;
  let beat = 0;
  // Everything booked and not yet finished, so `stop()` can silence it. Pruned
  // on every tick, so a rehearsal-long run holds at most one window of nodes.
  let booked: { osc: OscillatorNode; end: number }[] = [];

  // Lazy and cached: an AudioContext may only be created from a user gesture, and
  // a second start must reuse the one the first tap earned.
  function context(): AudioContext | null {
    if (ctx) return ctx;
    if (opts.audioContext) {
      ctx = opts.audioContext();
      return ctx;
    }
    const Ctor = nativeAudioContext();
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  }

  function book(time: number, accent: boolean) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    // Sine, not square: a square click is a tick with an edge on it, and this
    // plays under a band rehearsing, not through a studio monitor.
    osc.type = "sine";
    osc.frequency.value = accent ? CLICK.accentHz : CLICK.beatHz;
    osc.connect(env);
    env.connect(ctx.destination);
    const end = time + CLICK.lengthMs / 1000;
    env.gain.setValueAtTime(CLICK.gain, time);
    env.gain.exponentialRampToValueAtTime(SILENCE, end);
    osc.start(time);
    // The extra 10 ms lets the ramp finish before the node is torn down.
    osc.stop(end + 0.01);
    booked.push({ osc, end });
  }

  function tick() {
    if (!ctx || !running) return;
    const now = ctx.currentTime;
    booked = booked.filter((b) => b.end >= now);
    // Late tick: skip the beats that are already behind us rather than booking
    // them in the past, where they would all fire at once.
    if (nextBeatTime < now) {
      const missed = Math.ceil((now - nextBeatTime) / secondsPerBeat);
      beat = (beat + missed) % bar;
      nextBeatTime += missed * secondsPerBeat;
    }
    const horizon = now + CLICK.scheduleAheadMs / 1000;
    while (nextBeatTime < horizon) {
      book(nextBeatTime, beat === 0);
      beat = (beat + 1) % bar;
      nextBeatTime += secondsPerBeat;
    }
    timer = setTimeout(tick, CLICK.lookaheadMs);
  }

  // A stop nobody in the UI asked for: the tab went hidden, or another pill took
  // the floor. Same shape either way — silence, then tell the owner.
  function handOver() {
    stop();
    opts.onStop?.();
  }

  function onVisibility() {
    if (typeof document !== "undefined" && document.hidden) handOver();
  }

  function stop() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
    // Silence what is already booked, ALWAYS — a suspended context freezes its
    // clock instead of cancelling them, so they would sound on the next resume.
    for (const { osc } of booked) {
      // A node already finished throws on a second stop(); that is not a failure.
      try {
        osc.stop();
      } catch {
        /* already done */
      }
    }
    booked = [];
    // Only ever release the floor if this instance still holds it: a stop that
    // arrives after another pill took over must not blank out the new holder.
    if (current === self) current = null;
    if (!running) return;
    running = false;
    // Suspended, never closed: a closed context cannot be resumed, and the next
    // tap would have to earn a new one outside a gesture.
    void ctx?.suspend();
  }

  const self: OwnedMetronome = {
    start() {
      if (running) return;
      const audio = context();
      // No Web Audio API (an old WebView, a server-rendered probe): the pill
      // still rings, it simply never sounds. Checked BEFORE the hand-over, so a
      // pill that cannot sound never silences the one that can.
      if (!audio) return;
      // Ruling 15: take the floor from whoever had it, through its own stop, so
      // its pill drops the pressed state instead of showing a beat nobody hears.
      if (current && current !== self) current.handOver();
      current = self;
      running = true;
      // Returns a promise; a rejected resume just means no sound, never a throw.
      void audio.resume();
      beat = 0;
      nextBeatTime = audio.currentTime + START_DELAY_S;
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibility);
      }
      tick();
    },
    stop,
    handOver,
    get running() {
      return running;
    },
  };

  return self;
}

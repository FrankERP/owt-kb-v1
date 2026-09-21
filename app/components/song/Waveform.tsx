"use client";

// The rehearsal player's waveform: the ISOLATED instrument's envelope (600
// peaks from abletonnl's manifest, spec §5) drawn as bars, the `active` spans
// painted in the accent so a member sees where their part sounds, and the
// playhead. One canvas per row; it redraws on resize, progress or theme
// change. Colours come from `themeColour` — a canvas cannot read Tailwind
// classes, and a concatenated hex is the failure `themeColour` exists to
// prevent. Seeking is a click (fraction of width) or ←/→ (5 %).
import { useCallback, useEffect, useRef } from "react";
import { isActiveAt, waveformBars } from "@/app/utils/rehearsalMixes";
import { themeColour } from "@/app/utils/themeColour";

const BAR_W = 2;
const GAP = 1;
const STEP = 5 / 100;

export default function Waveform({
  peaks, active, duration, progress, label, onSeek, className = "",
}: {
  peaks: number[];
  active?: number[][];
  duration: number;
  progress: number;
  label: string;
  onSeek?: (fraction: number) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    // Assigning width/height resets the canvas's 2D transform, which is why
    // ctx.scale(dpr, dpr) below never accumulates across redraws.
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const bars = Math.max(1, Math.floor(w / (BAR_W + GAP)));
    const values = waveformBars(peaks, bars);
    const playedUntil = progress * w;
    for (let i = 0; i < bars; i++) {
      const x = i * (BAR_W + GAP);
      const seconds = duration > 0 ? ((i + 0.5) / bars) * duration : -1;
      const on = seconds >= 0 && isActiveAt(active, seconds);
      const played = x <= playedUntil;
      ctx.fillStyle = on
        ? themeColour("--accent-rgb", played ? 1 : 0.55)
        : themeColour("--mono-400-rgb", played ? 0.9 : 0.35);
      const bh = Math.max(2, values[i] * (h - 2));
      ctx.fillRect(x, (h - bh) / 2, BAR_W, bh);
    }
    // playhead — only once playback has started; an idle row at progress 0
    // should show no line at x=0.
    if (progress > 0) {
      ctx.fillStyle = themeColour("--accent-rgb");
      ctx.fillRect(Math.min(w - 1, playedUntil), 0, 1, h);
    }
  }, [peaks, active, duration, progress]);

  // `draw` changes on every progress tick (cheap: redraw the canvas), but the
  // ResizeObserver itself must not be torn down and recreated that often —
  // disconnecting/reobserving every tick is wasted work and can miss a resize
  // that lands mid-cycle. So the observer is created ONCE ([] deps) and calls
  // through a ref that always holds the latest `draw`.
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  const seekFromEvent = (e: React.MouseEvent<HTMLElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  };
  const seekFromKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!onSeek) return;
    if (e.key === "ArrowRight") { e.preventDefault(); onSeek(Math.min(1, +(progress + STEP).toFixed(2))); }
    if (e.key === "ArrowLeft") { e.preventDefault(); onSeek(Math.max(0, +(progress - STEP).toFixed(2))); }
  };

  if (!onSeek) {
    return (
      <div className={className}>
        <canvas ref={canvasRef} role="img" aria-label={label} className="block h-10 w-full" />
      </div>
    );
  }
  // The button is the ONLY accessible node here — a nested role="img" with
  // its own aria-label would give assistive tech two nodes announcing the
  // same label. The canvas is purely decorative in this branch.
  return (
    <button
      type="button"
      aria-label={label}
      onClick={seekFromEvent}
      onKeyDown={seekFromKey}
      className={`block w-full cursor-pointer rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${className}`}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="block h-10 w-full" />
    </button>
  );
}

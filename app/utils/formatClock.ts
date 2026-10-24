// `m:ss` for a playback position — the ONE clock format: the fixed
// AudioTransport and the rehearsal player's loaded row («1:42 / 4:36») both read
// it, so the two can never disagree on a second. NEUTRAL module.

export function formatClock(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

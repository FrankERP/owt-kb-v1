// The rehearsal player's pure half — grouping, preselection and the waveform's
// bar reduction. Neutral (no "use client", no imports from client modules) so
// the song page, a Server Component, may call `preselectMix` (ADR-0028).
//
// Family names are abletonnl's (`families.toml`): bass, keys, organ, synth,
// drums, electric, acoustic are the seven the render step isolates (spec
// 2026-09-20-rehearsal-mixes §4). App seats (`INSTRUMENT_SEAT_OPTIONS`) map onto
// five of them; organ and synth have no seat of their own and sit with keys.
import type { RehearsalMix } from "@/app/utils/interface";

export const FAMILY_ORDER = ["bass", "keys", "organ", "synth", "drums", "electric", "acoustic"] as const;

export const FAMILY_LABEL: Record<string, string> = {
  full: "Banda completa",
  bass: "Bajo",
  keys: "Teclado",
  organ: "Órgano",
  synth: "Sinte",
  drums: "Batería",
  electric: "Guitarra eléctrica",
  acoustic: "Guitarra acústica",
  other: "Otros",
};

/** App seat (`teamMembers.instruments[]`) → abletonnl family. */
export const SEAT_TO_FAMILY: Record<string, string> = {
  Bass: "bass",
  Keys: "keys",
  Drums: "drums",
  EG: "electric",
  AG: "acoustic",
};

export function mixLabel(mix: RehearsalMix): string {
  return mix.kind === "full" ? FAMILY_LABEL.full : (mix.track ?? "Pista");
}

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

export function groupMixes(mixes: RehearsalMix[]): { family: string; label: string; mixes: RehearsalMix[] }[] {
  if (mixes.length === 0) return [];
  const fulls = mixes.filter((m) => m.kind === "full");
  const byFamily = new Map<string, RehearsalMix[]>();
  for (const m of mixes) {
    if (m.kind === "full") continue;
    const fam = m.family ?? "other";
    if (!byFamily.has(fam)) byFamily.set(fam, []);
    byFamily.get(fam)!.push(m);
  }
  const rank = (fam: string) => {
    const i = (FAMILY_ORDER as readonly string[]).indexOf(fam);
    return i === -1 ? FAMILY_ORDER.length : i;
  };
  const families = [...byFamily.keys()].sort((a, b) => rank(a) - rank(b) || collator.compare(a, b));
  const groups = families.map((family) => ({
    family,
    label: FAMILY_LABEL[family] ?? FAMILY_LABEL.other,
    mixes: [...byFamily.get(family)!].sort((a, b) => collator.compare(a.track ?? "", b.track ?? "")),
  }));
  return fulls.length ? [{ family: "full", label: FAMILY_LABEL.full, mixes: fulls }, ...groups] : groups;
}

/**
 * Which mix a member sees highlighted on arrival: the first track of the family
 * their FIRST declared instrument maps to, else Full, else the first mix.
 * Highlight only — nothing autoplays.
 */
export function preselectMix(mixes: RehearsalMix[], instruments?: string[] | null): RehearsalMix | null {
  if (mixes.length === 0) return null;
  const family = instruments?.length ? SEAT_TO_FAMILY[instruments[0]] : undefined;
  if (family) {
    const group = groupMixes(mixes).find((g) => g.family === family);
    if (group) return group.mixes[0];
  }
  return mixes.find((m) => m.kind === "full") ?? mixes[0];
}

/** Collapse a 0–255 envelope to `bars` values in 0..1 (max per slice). */
export function waveformBars(peaks: number[], bars: number): number[] {
  const out = new Array<number>(bars).fill(0);
  if (peaks.length === 0 || bars <= 0) return out;
  for (let b = 0; b < bars; b++) {
    const from = Math.floor((b * peaks.length) / bars);
    const to = Math.max(from + 1, Math.floor(((b + 1) * peaks.length) / bars));
    let max = 0;
    for (let i = from; i < to && i < peaks.length; i++) max = Math.max(max, peaks[i]);
    out[b] = max / 255;
  }
  return out;
}

export function isActiveAt(active: number[][] | undefined, seconds: number): boolean {
  if (!active) return false;
  return active.some(([s, e]) => seconds >= s && seconds < e);
}

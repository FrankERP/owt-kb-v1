// The song page's title split (ADR-0070, the Canción pass): the catalogue stores
// «Cordero y León (Lion and The Lamb)» as ONE string, and the page shows the
// Spanish name as its title and the original beside the authors. NEUTRAL module
// (no "use client"): the page is a Server Component and calls this (ADR-0028).

export type SplitTitle = { main: string; original: string | null };

/**
 * «Cordero y León (Lion and The Lamb)» → main «Cordero y León», original «Lion
 * and The Lamb». Only a parenthetical that CLOSES the title counts, and only
 * when something is left in front of it: «(Live)» alone, or «Así Eres Tú (Way
 * Maker) [acústica]», keep the whole string as the title. Whitespace around
 * both parts is trimmed; an empty title gives an empty main.
 */
export function splitSongTitle(title: string | null | undefined): SplitTitle {
  const whole = (title ?? "").trim();
  const m = whole.match(/^(.*\S)\s*\(([^()]+)\)$/);
  if (!m) return { main: whole, original: null };
  const main = m[1].trim();
  const original = m[2].trim();
  if (!main || !original) return { main: whole, original: null };
  return { main, original };
}

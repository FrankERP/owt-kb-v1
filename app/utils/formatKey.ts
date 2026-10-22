// How a musical key is SHOWN. Neutral module — no "use client", no imports — so
// Server Components (the song page's history) and client rows share it.
//
// The catalogue stores keys as typed in Studio: "Bb", "F#m", "Db". That spelling
// is the identity (the transposer's tables, the library's key filter and the
// setlist's `play_key` all compare on it) and is NOT touched here. What a musician
// reads is "B♭" and "F♯": `LibraryRow` used to force `uppercase` on the chip and
// showed "BB" and "GB", which is a different note. One formatter for every place
// a key is displayed — the library chip, the setlist row, the song sheet, the
// hero badge, the rehearsal mixes and the play history — so the same key can
// never be spelled two ways on one screen (Frank, 2026-10-22: «Prefiero B♭»).
//
// Only the accidental right after the root moves: a suffix ("m", "maj7", "/G")
// is left as written, and anything that is not a key ("—", "Modal", "") is
// returned untouched.

const KEY_RE = /^([A-Ga-g])([b#])(.*)$/;

export function formatKey(key: string | null | undefined): string {
  if (!key) return "";
  const m = KEY_RE.exec(key.trim());
  if (!m) return key;
  const [, root, accidental, rest] = m;
  return `${root.toUpperCase()}${accidental === "b" ? "♭" : "♯"}${rest}`;
}

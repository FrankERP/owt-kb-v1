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
// The root is upper-cased (the chip no longer does it) and the accidental right
// after it becomes a symbol; a suffix ("m", "maj7") is left as written. A slash
// key ("Gb/Bb") is two roots and both are spelled the same way. Anything that is
// not a key ("—", "Modal", "") is returned untouched, apart from trimming.

const KEY_RE = /^([A-Ga-g])([b#])?(.*)$/;

function formatRoot(part: string): string {
  const m = KEY_RE.exec(part);
  if (!m) return part;
  const [, root, accidental, rest] = m;
  return `${root.toUpperCase()}${accidental === "b" ? "♭" : accidental === "#" ? "♯" : ""}${rest}`;
}

export function formatKey(key: string | null | undefined): string {
  if (!key) return "";
  return key.trim().split("/").map(formatRoot).join("/");
}

/** Several keys on one line, as a history reads: «B♭ · A♭». One separator, everywhere. */
export function formatKeys(keys: ReadonlyArray<string>, separator = " · "): string {
  return keys.map(formatKey).join(separator);
}

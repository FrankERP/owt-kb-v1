// Fold text for accent- and case-insensitive search matching.
// Lowercases and strips combining diacritics (e.g. "Adoración" -> "adoracion")
// so users can search Spanish content without typing accents.
export function normalizeText(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

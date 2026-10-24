// Neutral: the library's count wording. «147 canciones · 43 temas · 82 artistas»
// under the title and «3 resultados» in the results line (ADR-0070, Biblioteca).

/** `pluralize(1, "canción", "canciones")` → «1 canción»; `pluralize(3, …)` → «3 canciones». */
export function pluralize(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

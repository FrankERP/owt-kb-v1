// The Spanish «N thing / N things» line, spelled ONCE: «1 canción», «3 canciones»,
// «0 próximos». Neutral (no React), so a Server Component, a client component and
// the admin's command summary can never disagree on the rule.
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

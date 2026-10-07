// Source-level JSX readers shared by the static guards (`inputFontSize.test.ts`,
// `hiddenControlContainment.test.ts`). Not a test file: vitest only collects
// `*.test.*`. Brace- and quote-aware, so an attribute expression containing `>`
// (`onChange={(e) => …}`, `disabled={n > 0}`) does not end a tag early, and a
// template literal's tail after `${…}` is not lost.

/**
 * Walk a balanced region of source from `start`, quote-aware, stopping at the
 * first character for which `done` is true at depth 0. Used twice: once to take a
 * whole JSX opening tag (so a `>` inside an attribute expression does not end it),
 * once to take a whole `className={…}` expression (so a template literal's tail
 * after `${…}` is not lost).
 */
export function balanced(src: string, start: number, done: (c: string, depth: number) => boolean): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    if (done(c, depth)) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** The source text of one JSX opening tag, from `<` to its own `>`. */
export function tagText(src: string, start: number): string {
  return balanced(src, start, (c, depth) => c === ">" && depth === 0);
}

/** The className attribute's value as source text — `"…"` or the whole `{…}`. */
export function classNameExpr(tag: string): string | null {
  const at = tag.search(/\bclassName\s*=\s*/);
  if (at === -1) return null;
  const valueAt = at + tag.slice(at).match(/\bclassName\s*=\s*/)![0].length;
  if (tag[valueAt] === '"' || tag[valueAt] === "'") {
    const q = tag[valueAt];
    const end = tag.indexOf(q, valueAt + 1);
    return end === -1 ? tag.slice(valueAt) : tag.slice(valueAt + 1, end);
  }
  if (tag[valueAt] !== "{") return null;
  // `depth === 0` first becomes true on the closing brace of the expression.
  return balanced(tag, valueAt, (_, depth) => depth === 0).slice(1, -1);
}

/** Every `const NAME = "…"` / `const NAME = \`…\`` string, for one-level resolution. */
export function stringConstants(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\r?\n\s*)?(?:"([^"]*)"|`([^`]*)`)/g;
  for (const m of src.matchAll(re)) out.set(m[1], m[2] ?? m[3]);
  return out;
}

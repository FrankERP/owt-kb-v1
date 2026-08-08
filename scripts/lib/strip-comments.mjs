// Blank out comments while preserving byte offsets, so a value named in prose is
// never mistaken for a real one.
//
// Extracted from `app/utils/protectedReadAudit.ts` so the colour inventory
// (`scripts/colour-inventory.mjs`) and the protected-read audit share ONE
// implementation. `protectedReadAudit.ts` re-exports `stripComments` from here,
// so its existing importers are unaffected.
//
// TWO GRAMMARS, and picking the wrong one corrupts the source:
//   - JS/TS: `//` line comments, `/* */` blocks, quoted strings, and template
//     literals with `${}` interpolation (whose bodies are code, not string).
//   - CSS:   `/* */` blocks ONLY. `//` is NOT a comment in CSS — treating it as
//     one would blank the rest of the line on any `url(https://…)`.
//
// Offsets are preserved (comment bytes become spaces, newlines are kept) so a
// caller can still report accurate line numbers against the ORIGINAL source.

/**
 * @param {string} src
 * @param {{ syntax?: "js" | "css" }} [opts]
 * @returns {string} `src` with comment bodies replaced by spaces, same length
 */
export function stripComments(src, opts = {}) {
  const css = opts.syntax === "css";
  const out = src.split("");
  const stack = [];
  const n = src.length;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (src[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const top = stack[stack.length - 1];
    if (top && top.kind === "tpl") {
      const c = src[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { stack.pop(); i++; continue; }
      if (c === "$" && src[i + 1] === "{") { stack.push({ kind: "expr", depth: 0 }); i += 2; continue; }
      i++;
      continue;
    }
    const c = src[i];
    // `//` is a comment in JS/TS only. In CSS it is two division-free slashes that
    // occur inside `url(https://…)`, and blanking to end-of-line would corrupt it.
    if (!css && c === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      const end = Math.min(j + 2, n);
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j++;
        else if (src[j] === "\n") break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (!css && c === "`") { stack.push({ kind: "tpl" }); i++; continue; }
    if (top && top.kind === "expr") {
      if (c === "{") top.depth++;
      else if (c === "}") {
        if (top.depth === 0) { stack.pop(); i++; continue; }
        top.depth--;
      }
    }
    i++;
  }
  return out.join("");
}

/** Pick the grammar from a file path. */
export function syntaxFor(filePath) {
  return filePath.endsWith(".css") ? "css" : "js";
}

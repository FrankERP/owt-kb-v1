// iOS auto-zoom guard (F3, after the 2026-09-16 simulator look).
//
// WebKit zooms the page into any focused form control whose computed font size is
// under 16 px, and it does NOT zoom back out when the field blurs. On the iPhone
// 17 Pro simulator a tap on Biblioteca's filter search (`font-label text-xs`,
// 12 px) left the whole app scaled up with the phone tab bar off screen, and the
// only way back was a pinch. The accessible fix is 16 px on the phone, never
// `maximum-scale=1` / `user-scalable=no` on the viewport — that disables pinch
// zoom for everyone.
//
// The house pattern is therefore `text-[16px] sm:text-<size>`: phones get 16 px,
// `sm` and up keep the design's own size (a mouse pointer never triggers the
// zoom). This guard fails on any `<input>` / `<textarea>` / `<select>` under
// `app/**` whose className carries an UNPREFIXED sub-16 px text utility.
//
// Scope and honest limits:
//  - `admin/` and `kids/` are excluded BY PATH, not by a baseline count: those are
//    dense desk surfaces that were deliberately left alone in this pass. Moving a
//    file out of them brings it under the guard, which is the point.
//  - className expressions are resolved one level: a bare identifier is looked up
//    as a `const <id> = "…"` STRING in the same file (`inputCls` and friends). A
//    size carried in an object map (`ui/Select`'s and `ui/DateField`'s `SIZE`) is
//    NOT resolved and therefore not covered here — those two primitives render at
//    `text-sm`/`text-[11px]` and remain a known gap, recorded in the F3 report.
//  - A control with no text utility at all inherits its size and is not checkable
//    from source; this guard makes no claim about those.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const EXCLUDED = ["__tests__", `${path.sep}admin${path.sep}`, `${path.sep}kids${path.sep}`];

/** Sub-16 px text utilities with NO responsive/state prefix — the ones that apply
 *  at phone width, which is the only width WebKit zooms at. `sm:text-xs` is fine;
 *  `text-xs` is not. */
const SMALL_TEXT = /(?<![\w:-])text-(?:xs|sm|\[1[0-5]px\])(?![\w-])/;

function tsxFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (EXCLUDED.some((x) => `${path.sep}${rel}${path.sep}`.includes(x))) continue;
      if (e.isDirectory()) walk(rel);
      else if (rel.endsWith(".tsx")) out.push(rel);
    }
  };
  walk("app");
  return out;
}

/** The source text of one JSX opening tag, from `<` to its own `>` — quote- and
 *  brace-aware so a `>` inside an attribute expression does not end it early. */
function tagText(src: string, start: number): string {
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
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

/** Every `const NAME = "…"` string in a file, for one-level identifier resolution. */
function stringConstants(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\r?\n\s*)?"([^"]*)"/g;
  for (const m of src.matchAll(re)) out.set(m[1], m[2]);
  return out;
}

export function findZoomingControls(files = tsxFiles()): string[] {
  const offenders: string[] = [];
  for (const rel of files) {
    const src = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const consts = stringConstants(src);
    for (const m of src.matchAll(/<(input|textarea|select)\b/g)) {
      const tag = tagText(src, m.index!);
      const cls = tag.match(/className=(?:"([^"]*)"|\{([\s\S]*?)\}(?=\s|\/?>))/);
      if (!cls) continue;
      let expr = cls[1] ?? cls[2] ?? "";
      for (const id of expr.matchAll(/[A-Za-z_$][\w$]*/g)) {
        const resolved = consts.get(id[0]);
        if (resolved) expr += ` ${resolved}`;
      }
      if (SMALL_TEXT.test(expr)) {
        const line = src.slice(0, m.index!).split("\n").length;
        offenders.push(`${rel}:${line} <${m[1]}>`);
      }
    }
  }
  return offenders;
}

describe("form controls do not trigger iOS auto-zoom", () => {
  it("no member-facing input, textarea or select renders under 16 px on a phone", () => {
    const offenders = findZoomingControls();
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("recognises a violation and the house fix", () => {
    // The regex is the whole guard, so it is exercised directly rather than
    // trusted: a bare `text-xs` fails, the phone-first pair passes.
    expect(SMALL_TEXT.test("w-full font-label text-xs text-ink")).toBe(true);
    expect(SMALL_TEXT.test("w-full font-label text-[16px] sm:text-xs text-ink")).toBe(false);
    expect(SMALL_TEXT.test("px-3 text-base")).toBe(false);
  });
});

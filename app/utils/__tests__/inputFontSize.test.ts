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
// `app/**` carrying a sub-16 px text utility that APPLIES AT PHONE WIDTH — that
// is, one whose variant chain contains no min-width breakpoint. `sm:text-xs` is
// fine; `text-xs`, `focus:text-xs` and `dark:text-sm` are not, and `focus:` in
// particular is exactly when the zoom fires.
//
// Scope and honest limits:
//  - `admin/` and `kids/` are excluded BY PATH, not by a baseline count: those are
//    dense desk surfaces that were deliberately left alone in this pass. Moving a
//    file out of them brings it under the guard, which is the point.
//  - className expressions are read whole (brace-aware, so a `${inputCls}
//    resize-none` tail is seen) and bare identifiers are resolved ONE level, to a
//    `const <id> = "…"` or `` `…` `` string in the same file. A size carried in an
//    object map — `ui/Select`'s and `ui/DateField`'s `SIZE` — is still not
//    resolved by the scan; both maps are compliant today and carry a comment
//    saying why, but the scanner would not catch a regression inside them.
//  - A control with no text utility at all inherits its size and is not checkable
//    from source; this guard makes no claim about those.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const EXCLUDED = ["__tests__", `${path.sep}admin${path.sep}`, `${path.sep}kids${path.sep}`];

/** Sub-16 px text utilities, with whatever variant chain precedes them. */
const SMALL_TEXT = /(?:[\w[\]#./-]+:)*text-(?:xs|sm|\[1[0-5]px\])(?![\w-])/g;
/** The only variants that keep a small size OFF a phone. Anything else —
 *  `focus:`, `dark:`, `hover:`, `peer-*`, `group-*` — still applies at 390 px. */
const BREAKPOINTS = new Set(["sm", "md", "lg", "xl", "2xl"]);

/** True when the utility paints at phone width, which is the only width that zooms. */
export function appliesOnPhone(utility: string): boolean {
  const parts = utility.split(":");
  return !parts.slice(0, -1).some((v) => BREAKPOINTS.has(v));
}

export function hasPhoneSmallText(className: string): boolean {
  return [...className.matchAll(SMALL_TEXT)].some((m) => appliesOnPhone(m[0]));
}

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

/**
 * Walk a balanced region of source from `start`, quote-aware, stopping at the
 * first character for which `done` is true at depth 0. Used twice: once to take a
 * whole JSX opening tag (so a `>` inside an attribute expression does not end it),
 * once to take a whole `className={…}` expression (so a template literal's tail
 * after `${…}` is not lost).
 */
function balanced(src: string, start: number, done: (c: string, depth: number) => boolean): string {
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
function tagText(src: string, start: number): string {
  return balanced(src, start, (c, depth) => c === ">" && depth === 0);
}

/** The className attribute's value as source text — `"…"` or the whole `{…}`. */
function classNameExpr(tag: string): string | null {
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
function stringConstants(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\r?\n\s*)?(?:"([^"]*)"|`([^`]*)`)/g;
  for (const m of src.matchAll(re)) out.set(m[1], m[2] ?? m[3]);
  return out;
}

export function findZoomingControls(files = tsxFiles()): string[] {
  const offenders: string[] = [];
  for (const rel of files) {
    const src = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    const consts = stringConstants(src);
    for (const m of src.matchAll(/<(input|textarea|select)\b/g)) {
      const expr = classNameExpr(tagText(src, m.index!));
      if (expr === null) continue;
      let expanded = expr;
      for (const id of expr.matchAll(/[A-Za-z_$][\w$]*/g)) {
        const resolved = consts.get(id[0]);
        if (resolved) expanded += ` ${resolved}`;
      }
      if (hasPhoneSmallText(expanded)) {
        offenders.push(`${rel}:${src.slice(0, m.index!).split("\n").length} <${m[1]}>`);
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
    // The matcher is the whole guard, so it is exercised directly rather than trusted.
    expect(hasPhoneSmallText("w-full font-label text-xs text-ink")).toBe(true);
    expect(hasPhoneSmallText("w-full font-label text-[16px] sm:text-xs text-ink")).toBe(false);
    expect(hasPhoneSmallText("px-3 text-base")).toBe(false);
    expect(hasPhoneSmallText("min-h-[44px] px-3 py-2 text-[16px] lg:text-sm")).toBe(false);
  });

  it("counts a non-breakpoint variant as a phone-width size — focus is when the zoom fires", () => {
    expect(hasPhoneSmallText("text-[16px] focus:text-xs")).toBe(true);
    expect(hasPhoneSmallText("text-[16px] dark:text-sm")).toBe(true);
    expect(hasPhoneSmallText("text-[16px] hover:text-[12px]")).toBe(true);
    // A breakpoint anywhere in the chain still keeps it off the phone.
    expect(hasPhoneSmallText("text-[16px] dark:sm:text-xs")).toBe(false);
  });

  it("reads a whole className expression, tail included, and resolves both const shapes", () => {
    // `${inputCls} resize-none` — the tail after the interpolation used to be
    // invisible, which is where a small size could hide.
    const src = [
      'const inputCls = "w-full text-[16px] sm:text-sm";',
      "export const A = () => <textarea className={`${inputCls} resize-none text-xs`} />;",
    ].join("\n");
    const tag = tagText(src, src.indexOf("<textarea"));
    expect(classNameExpr(tag)).toContain("resize-none text-xs");
    expect(stringConstants('const a = `px-2 text-xs`;').get("a")).toBe("px-2 text-xs");
  });
});

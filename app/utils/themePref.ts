/**
 * Theme preference plumbing for Child E.
 *
 * NO `"use client"` DIRECTIVE — and that is load-bearing, not an oversight. Both
 * root layouts are Server Components and import `THEME_MIGRATION_SCRIPT` from this
 * file; under a client boundary that export becomes a client *reference* rather
 * than a string, and the `<script>` would render nothing usable. `textZoom.ts`,
 * the precedent this file follows, omits it for the same reason.
 * Guarded by `themePrefModule.test.ts`.
 *
 * THIS FILE DOES NOT OWN STORAGE. `next-themes` already does both halves —
 * `setTheme` writes the mirror, its injected script does the pre-hydration seed —
 * so a second mirror on a second key is the failure mode to avoid. What lives here
 * is the read helper, the validator, the mirror CLEAR, and the migration script.
 *
 * EVERY `localStorage` ACCESS IS WRAPPED. `localStorage` throws — SecurityError
 * with storage blocked, Safari private mode, some Capacitor WebView configs — and
 * `next-themes` wraps every access for exactly that reason. One of the calls below
 * runs inside four sign-out `onClick` handlers, where an unguarded throw would
 * abort the handler BEFORE `signOut()` and leave the "Salir" button silently doing
 * nothing, permanently, for that population. Fail soft, like `textZoom.ts`.
 */

export type ThemePref = "dark" | "light";

/**
 * The accepted literal set. "system" is NOT a member: with `enableSystem={false}`
 * next-themes adds a literal `system` class and strips light/dark, so the app
 * stays dark forever while Sanity stores "system" and nothing logs. Child F owns
 * the `enableSystem` flip and inherits this constant when it does.
 */
const VALID: ReadonlySet<string> = new Set<ThemePref>(["dark", "light"]);

export function isThemePref(v: unknown): v is ThemePref {
  return typeof v === "string" && VALID.has(v);
}

/** `next-themes`' default storageKey. We do not choose it; we clear it. */
export const THEME_MIRROR_KEY = "theme";

/** Set once by the migration script below, so it reconciles a browser only once. */
export const THEME_MIGRATED_KEY = "owt-theme-migrated";

/**
 * Runs as an inline `<script>`, the FIRST CHILD OF `<body>` in the two root
 * layouts that have a Provider, immediately before `<Provider>` renders.
 *
 * WHY THERE AND NOT `<head>`: the operative constraint is document order. Neither
 * layout renders a `<head>` element, and React 19 hoists only `<script async src>`,
 * never inline `dangerouslySetInnerHTML`. next-themes' own seed is a plain inline
 * script inside its provider, so this one — sitting just above it — runs first.
 * Anything in a React component runs after BOTH, which is why the reconciliation
 * cannot live in `ThemeBootstrap`: by then the seed has already painted.
 *
 * WHY A CLEAR AND NOT `setTheme("dark")`: both land the member on dark, but only
 * the clear preserves "no mirror means no preference" — the property Child F
 * depends on. Writing "dark" would pin the entire unset population to dark and
 * quietly defeat F's rollout.
 *
 * WHY `removeItem` IS UNCONDITIONAL: the rule is "clear any value this codebase
 * did not write", not "clear light". An unrecognised value is worse than a light
 * one — "system" under `enableSystem={false}` yields a CLASS-LESS document, not
 * merely a light page. Tightening this to `if (v === "light")` would look more
 * careful and be strictly less safe.
 *
 * WHY THE `catch` BODY ADDS A CLASS: with `forcedTheme` gone, next-themes' seed
 * takes its `try { getItem(...) ... apply }` branch — and the WHOLE apply sits
 * inside that try. For a storage-blocked browser the pre-hydration document would
 * then carry neither `dark` nor `light`: all 94 `dark:` utilities stop applying at
 * once, and per CLAUDE.md a `dark:` base at (0,2,0) was masking bare hover:/focus:
 * rules that now come unmasked. One line prevents it.
 *
 * NOTE: this is the THIRD copy of the dark default, after `Provider.tsx`'s
 * `defaultTheme` and `ThemeBootstrap`'s repair literal. Child F must change all
 * three together, or a storage-blocked member stays pinned to dark under F's
 * Follow-System default.
 */
export const THEME_MIGRATION_SCRIPT = `try{if(!localStorage.getItem("${THEME_MIGRATED_KEY}")){localStorage.removeItem("${THEME_MIRROR_KEY}");localStorage.setItem("${THEME_MIGRATED_KEY}","1")}}catch(e){document.documentElement.classList.add("dark")}`;

/**
 * Clears next-themes' mirror. Called at the four sign-out sites and by
 * `ThemeBootstrap`'s durable repair — NOT when impersonation ends, where there is
 * nothing of the member's to clear (the read is skipped) and no value to hand
 * `setTheme()`.
 *
 * Throws are swallowed: see the file header. A sign-out that cannot clear the
 * mirror is a far better outcome than a sign-out that does not happen.
 */
export function clearThemeMirror(): void {
  try {
    localStorage.removeItem(THEME_MIRROR_KEY);
  } catch {
    /* storage blocked — nothing to clear, and never worth breaking sign-out */
  }
}

/** True when a mirror exists. A throw resolves to "no mirror" — fail soft. */
export function hasThemeMirror(): boolean {
  try {
    return localStorage.getItem(THEME_MIRROR_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Reads the member's own `themePref` from the `GET /api/me` projection.
 *
 * Returns `undefined` for "unset" AND for any failure, with the two deliberately
 * distinguished by the second element: callers must not treat a failed fetch as
 * unset. `ThemeBootstrap`'s repair clears the mirror on unset, and firing that on
 * a network blip would wipe an explicit-Light member's mirror and repaint them
 * dark on every hiccup.
 *
 * `GET /api/me` can return `null` when the session id resolves to no document,
 * hence the optional chaining rather than a bare property read.
 */
export async function fetchThemePref(): Promise<{
  ok: boolean;
  pref: ThemePref | undefined;
}> {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return { ok: false, pref: undefined };
    const data = await res.json() as { themePref?: unknown } | null;
    const pref = data?.themePref;
    return { ok: true, pref: isThemePref(pref) ? pref : undefined };
  } catch {
    return { ok: false, pref: undefined };
  }
}

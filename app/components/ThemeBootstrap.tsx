"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useSession } from "next-auth/react";
import {
  clearThemeMirror,
  fetchThemePref,
  hasThemeMirror,
  type ThemePref,
} from "@/app/utils/themePref";

/**
 * Applies the member's server-side `themePref` to the browser, and exposes the
 * LITERAL value to the `/me` control.
 *
 * Mounted inside `Provider.tsx` rather than in a layout, for two reasons: it needs
 * `setTheme`, so it must sit inside `<ThemeProvider>`; and `TextScaleBootstrap`'s
 * placement at `(client)/layout.tsx` alone would leave an admin whose first load of
 * a session is `/admin` on a preference they never fetched. Mounting in `Provider`
 * covers both root layouts and correctly excludes the provider-less gallery.
 *
 * It WRAPS `children` rather than rendering beside them, because the control needs
 * the literal value and props cannot reach it — `ThemeControl` renders from
 * `app/(client)/me/page.tsx`, several layers below `Provider`. One read, shared.
 */

/**
 * `undefined` means "not known yet OR unset" — the control must distinguish those
 * two itself via `loaded`, and must NOT initialise to a concrete default. An unset
 * `themePref` is the signal Child F's staged rollout reads, and a control that
 * writes "dark" on mount destroys it for that member with no route to undo it.
 */
type ThemePrefContext = {
  /** The member's stored literal, or `undefined` when they have never chosen. */
  pref: ThemePref | undefined;
  /** False until a successful `GET /api/me` has landed. Not the same as "unset". */
  loaded: boolean;
  /** Called by the control after its own PATCH succeeds, to keep both in step. */
  setPref: (p: ThemePref) => void;
};

const Ctx = createContext<ThemePrefContext>({
  pref: undefined,
  loaded: false,
  setPref: () => {},
});

export function useThemePref(): ThemePrefContext {
  return useContext(Ctx);
}

/** `--surface-base`'s dark triplet — the value already in the server markup. */
// eslint-disable-next-line no-restricted-syntax -- pre-CSS <meta> colour, cannot take a var(); see parent invariant 17
const META_DARK = "#010b17";
/** `--surface-base`'s light triplet — the page wash itself. */
// eslint-disable-next-line no-restricted-syntax -- pre-CSS <meta> colour, cannot take a var(); see parent invariant 17
const META_LIGHT = "#eef3f9";

export function ThemeBootstrap({ children }: { children: React.ReactNode }) {
  const { setTheme, resolvedTheme } = useTheme();
  const { status, data } = useSession();
  const [pref, setPref] = useState<ThemePref | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const applied = useRef(false);

  const isImpersonating = Boolean(
    (data?.user as { isImpersonating?: boolean } | undefined)?.isImpersonating,
  );

  useEffect(() => {
    // Gate on the SESSION, not on bare mount. While status is "loading" the
    // isImpersonating flag is not readable, and a fetch issued in that window
    // would bypass the isolation below.
    if (status !== "authenticated") return;

    // READ-SIDE IMPERSONATION ISOLATION. GET /api/me returns the IMPERSONATED
    // member's record, so without this the admin's browser would adopt — and
    // mirror — someone else's theme. Skipping leaves the admin on their own.
    if (isImpersonating) return;

    if (applied.current) return;
    applied.current = true;

    let cancelled = false;
    void (async () => {
      const { ok, pref: stored } = await fetchThemePref();
      if (cancelled || !ok) return;   // A FAILED FETCH IS NOT "UNSET" — see below.

      setLoaded(true);
      setPref(stored);

      if (stored) {
        // Only ever the literal "dark" or "light". An unrecognised value never
        // reaches setTheme: next-themes has no falsy guard on the setter, so
        // setTheme(undefined) would persist the string "undefined" and poison the
        // NEXT load into `classList.add("undefined")` — no dark, no light, and
        // all 94 dark: utilities off at once.
        setTheme(stored);
        return;
      }

      // UNSET, and a mirror is nonetheless present. That mirror is not a
      // preference — it is either a legacy ThemeSwitch value or a writeback from
      // another tab answering our own removeItem. Repair it durably, on every
      // load, rather than trusting the one-shot migration flag.
      //
      // ORDER MATTERS. setTheme("dark") first makes next-themes' own state
      // truthful and paints the right class; clearThemeMirror() then removes the
      // key it just wrote, so the member ends on dark with NO mirror — the
      // property Child F depends on. Only the clear would leave next-themes
      // holding "light" internally; only the setTheme would pin the whole unset
      // population to a "dark" mirror and quietly defeat F's rollout.
      //
      // This is the THIRD copy of the dark default (Provider's defaultTheme and
      // the migration script's catch are the others). Child F must change all three.
      if (hasThemeMirror()) {
        setTheme("dark");
        clearThemeMirror();
      }
    })();

    return () => { cancelled = true; };
  }, [status, isImpersonating, setTheme]);

  // The browser/PWA chrome colour, keyed on the RESOLVED theme so an unset member
  // (who resolves to dark) simply gets the value already in the markup.
  //
  // NULL-GUARDED because (admin)/layout.tsx exports no `viewport` at all — there is
  // no theme-color meta on any admin page, while this component mounts in Provider,
  // which both layouts use. An unguarded setAttribute on a null query result would
  // throw INSIDE this component and take the setTheme call down with it, disabling
  // the member's theme on every admin route. Query, skip if absent, never create.
  //
  // `appleWebApp.statusBarStyle` is deliberately NOT swapped: black-translucent is
  // what makes the WebView extend under the iOS status bar, which is what gives
  // env(safe-area-inset-top) a non-zero value for Navbar/CueDialog/PlannerGrid.
  // Every light-appropriate value is non-translucent, so swapping it would collapse
  // the inset and move all three — geometry, not colour. Recorded as a remnant.
  useEffect(() => {
    if (!resolvedTheme) return;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    meta.setAttribute("content", resolvedTheme === "light" ? META_LIGHT : META_DARK);
  }, [resolvedTheme]);

  return (
    <Ctx.Provider value={{ pref, loaded, setPref }}>
      {children}
    </Ctx.Provider>
  );
}

// Service Readiness A3 §3 "Read-only Deployment Protection preflight" — the
// runner-side Deployment Protection bypass, and the redaction proof.
//
// Deployment Protection is ENABLED on the canonical project
// (`ssoProtection: prod_deployment_urls_and_all_previews`), so every request the
// harness makes to the verification deployment — navigations, static assets,
// NextAuth redirects, and client `fetch` follow-ups — must be authorized.
//
// The rules encoded here, and nowhere else:
//
//   · the secret comes from ONE runner-side variable (`SR_VERIFY_BYPASS_SECRET`)
//     and from nothing else. There is no fallback to a tracked file, to the app's
//     environment, or to Vercel's managed `VERCEL_AUTOMATION_BYPASS_SECRET` —
//     that name is on a deny list, not on a fallback chain.
//   · it travels as the `x-vercel-protection-bypass` HEADER. Never as a query
//     parameter, never in the base URL, never in storage state.
//   · `x-vercel-set-bypass-cookie: true` is sent on the INITIAL navigation only,
//     so the provider returns a bypass cookie which the in-memory browser context
//     then carries for everything else. A separate `APIRequestContext` does not
//     inherit that cookie automatically, so it is given the header explicitly.
//   · the value is never printed, never hashed into evidence, and never written to
//     a report, trace, video or log. `scanForSecretLeak` PROVES that over the
//     retained artifacts, and a planted secret makes it fail.
//
// This module is pure: header construction and text scanning only. The filesystem
// walk lives in the global teardown.

import { BYPASS_SECRET_ENV, PROVIDER_MANAGED_BYPASS_ENV } from "./harnessGuards";

export const BYPASS_HEADER = "x-vercel-protection-bypass";
export const SET_BYPASS_COOKIE_HEADER = "x-vercel-set-bypass-cookie";

/** The query-parameter forms Vercel also accepts, which this harness must NEVER use. */
export const FORBIDDEN_BYPASS_QUERY_PARAMS: readonly string[] = Object.freeze([
  "x-vercel-protection-bypass",
  "x-vercel-set-bypass-cookie",
]);

export interface BypassSecretResult {
  /** The secret VALUE. Never logged, never serialized, never put in a URL. */
  secret: string | null;
  /** Why it is absent, for an operator message that names no value. */
  reason: "present" | "absent" | "provider_managed_only";
}

/**
 * Read the bypass secret from the runner's environment.
 *
 * If the runner supplied nothing but Vercel's managed variable happens to be
 * visible, the result is `provider_managed_only` and the secret stays null: the
 * plan forbids consuming the provider-managed value, and "it was in the env" is
 * not the same as "the runner supplied it".
 */
export function resolveBypassSecret(
  env: Readonly<Record<string, string | undefined>>,
): BypassSecretResult {
  const runnerSupplied = env[BYPASS_SECRET_ENV];
  if (typeof runnerSupplied === "string" && runnerSupplied.trim().length) {
    return { secret: runnerSupplied.trim(), reason: "present" };
  }
  const providerManaged = env[PROVIDER_MANAGED_BYPASS_ENV];
  if (typeof providerManaged === "string" && providerManaged.trim().length) {
    return { secret: null, reason: "provider_managed_only" };
  }
  return { secret: null, reason: "absent" };
}

/**
 * Headers for every ordinary request (navigations after the first, assets,
 * NextAuth redirects, client fetch). Empty when there is no secret, so an
 * unprotected deployment needs no special casing.
 */
export function bypassHeaders(secret: string | null): Record<string, string> {
  return secret ? { [BYPASS_HEADER]: secret } : {};
}

/**
 * Headers for the INITIAL navigation only. `x-vercel-set-bypass-cookie: true`
 * makes the provider hand back a bypass cookie, which the in-memory context then
 * retains — that cookie, not a repeated header, is what authorizes redirects and
 * sub-resources on the same exact deployment host.
 */
export function initialNavigationHeaders(secret: string | null): Record<string, string> {
  if (!secret) return {};
  return { [BYPASS_HEADER]: secret, [SET_BYPASS_COOKIE_HEADER]: "true" };
}

/* ------------------------------------------------------------------ *
 * Redaction proof
 * ------------------------------------------------------------------ */

export type LeakKind = "secret_value" | "bypass_query_param";

export interface SecretLeak {
  /** Where the leak was found: a retained report/trace/log path, or a label. */
  source: string;
  kind: LeakKind;
  /**
   * A NON-REVEALING locator: the offending byte offset and the matched parameter
   * name. The matched secret value is deliberately NOT included — a leak report
   * that quotes the secret would itself be a leak.
   */
  at: number;
  detail: string;
}

/**
 * Scan one retained artifact's text for either the secret VALUE or a bypass query
 * parameter.
 *
 * The secret is matched literally and also in its URL-encoded form, because a
 * value that reached a URL would appear percent-encoded. The query-parameter check
 * is independent of the secret: `?x-vercel-protection-bypass=` is a violation even
 * when the value beside it is wrong, redacted or truncated — the plan forbids the
 * SHAPE, not merely the disclosure.
 */
export function scanForSecretLeak(
  source: string,
  text: string,
  secret: string | null,
): SecretLeak[] {
  const leaks: SecretLeak[] = [];

  if (secret && secret.length) {
    for (const needle of new Set([secret, encodeURIComponent(secret)])) {
      let at = text.indexOf(needle);
      while (at >= 0) {
        leaks.push({
          source,
          kind: "secret_value",
          at,
          // Length only. The value itself is never echoed.
          detail: `bypass secret value present (${needle.length} bytes) — redaction failed`,
        });
        at = text.indexOf(needle, at + needle.length);
      }
    }
  }

  const lower = text.toLowerCase();
  for (const param of FORBIDDEN_BYPASS_QUERY_PARAMS) {
    for (const form of [`?${param}=`, `&${param}=`, `${param}%3d`]) {
      let at = lower.indexOf(form);
      while (at >= 0) {
        leaks.push({
          source,
          kind: "bypass_query_param",
          at,
          detail: `bypass parameter "${param}" appears as a query parameter — it must only ever be a header`,
        });
        at = lower.indexOf(form, at + form.length);
      }
    }
  }

  return leaks;
}

/** Aggregate verdict over every retained artifact. */
export function summarizeLeaks(leaks: readonly SecretLeak[]): {
  ok: boolean;
  message: string;
} {
  if (!leaks.length) {
    return { ok: true, message: "redaction verified: no bypass secret and no bypass query parameter in retained output" };
  }
  const lines = ["Retained Playwright output failed the A3 redaction assertion:"];
  for (const leak of leaks) lines.push(`  ✗ ${leak.source} @${leak.at} [${leak.kind}] ${leak.detail}`);
  return { ok: false, message: lines.join("\n") };
}

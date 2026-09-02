/**
 * Which origins `scripts/dev-verify.ts` may open. Two independent axes, checked in
 * this order, mirroring `e2e/service-readiness/lib/harnessGuards.ts`:
 *
 *   1. FORBIDDEN by name — production and its git-main alias, exact host or any
 *      subdomain. Checked first so a later loosening of the allow-list can never
 *      silently admit production.
 *   2. ALLOWED — the stable dev origin, or a preview deployment host of THIS
 *      project (`owt-backstage-<hash>-frank-rochas-projects.vercel.app`).
 *
 * Spec: docs/superpowers/specs/2026-09-01-dev-verify-runner-design.md §4.2
 */

export const DEFAULT_ORIGIN = "https://dev-owt-backstage.vercel.app";

const FORBIDDEN_HOSTS = [
  "owt-backstage.vercel.app",
  "owt-backstage-git-main-frank-rochas-projects.vercel.app",
] as const;

const ALLOWED_EXACT = ["dev-owt-backstage.vercel.app"] as const;
const ALLOWED_PREVIEW = /^owt-backstage-[a-z0-9-]+-frank-rochas-projects\.vercel\.app$/;

export type TargetDecision =
  | { ok: true; origin: string }
  | { ok: false; code: "forbidden_production" | "not_allowed" | "not_https" | "invalid_url" };

function isForbidden(host: string): boolean {
  return FORBIDDEN_HOSTS.some((f) => host === f || host.endsWith(`.${f}`));
}

export function resolveTarget(input: string | undefined): TargetDecision {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: true, origin: DEFAULT_ORIGIN };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  const host = url.hostname.toLowerCase();
  if (isForbidden(host)) return { ok: false, code: "forbidden_production" };
  if (url.protocol !== "https:") return { ok: false, code: "not_https" };
  const allowed = (ALLOWED_EXACT as readonly string[]).includes(host) || ALLOWED_PREVIEW.test(host);
  if (!allowed) return { ok: false, code: "not_allowed" };
  return { ok: true, origin: `https://${host}` };
}

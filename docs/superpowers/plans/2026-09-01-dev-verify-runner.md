# Dev Verification Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, read-only Playwright runner (`scripts/dev-verify.ts`) that lets an agent observe `dev-owt-backstage.vercel.app` as a signed-in verification member and return screenshots, page text, an accessibility tree and console errors — without anyone typing a credential and without any request that could write reaching the server.

**Architecture:** Four pure, unit-tested policy modules under `scripts/lib/dev-verify/` (host allow-list, mutation block, argument parsing, report redaction) feed one thin runner that owns the browser. The runner reuses the A3 harness's bypass-header and leak-scanner helpers rather than copying them. A separate dry-run seed script creates the «Verificador» member once; the agent never runs its `--apply`.

**Tech Stack:** Playwright 1.60 (already a devDependency, Chromium already installed locally), `tsx` for running the TypeScript runner, vitest for the pure modules, `@sanity/client` + `bcryptjs` for the seed script.

**Spec:** `docs/superpowers/specs/2026-09-01-dev-verify-runner-design.md`

## Global Constraints

- **No server change.** Nothing under `app/`, `auth.ts`, or `proxy.ts` is modified. The runner is the only new executable path.
- **Never a credential in a tracked file, a URL, a report, or stdout.** Secrets come only from `.env.local`; the bypass secret travels only as the header `x-vercel-protection-bypass`.
- **Production is forbidden before anything is allowed.** `owt-backstage.vercel.app` and `owt-backstage-git-main-frank-rochas-projects.vercel.app` are rejected by name before the allow-list is consulted.
- **Read-only lock 1 is mechanical:** every request to the target origin whose method is not `GET`/`HEAD` is aborted in the browser and recorded as `blocked_mutation`; the only exception is `POST /api/auth/callback/credentials` during the sign-in step.
- **Two app-side writes exist and are disclosed, not hidden:** (1) every credentials sign-in creates one `loginEvent` document (`auth.ts` `events.signIn` → `createLoginEvent`, a `client.create` on the production dataset) — bounded to once per cached session (7-day JWT) or per rotation, and accepted by Frank on 2026-09-01; (2) the app's `ActivityPing` component POSTs `/api/activity/ping` (a `lastSeen` patch) on the first authenticated page of every fresh browser, keyed in `sessionStorage`, which `storageState` does not carry — the runner **suppresses** it by seeding that key via `addInitScript`, so the request never fires and lock 1 is never tripped by the app's own heartbeat. It is never allow-listed.
- **Landed-origin rule:** after every navigation and every click, `new URL(page.url()).origin` must equal the target origin; otherwise the run is refused (`host:landed_off_origin`, exit 2). Dev is SSO-protected and answers `302 https://vercel.com/sso-api?…` without the bypass header; without this rule a rotated or unhonoured secret would report a green run of vercel.com.
- **Exit codes:** `0` success · `2` refused (host, env, sign-in) · `3` ≥1 `blocked_mutation` · `4` page error (uncaught exception or HTTP ≥ 500 on the route).
- **Tests** are `*.test.ts` under `scripts/__tests__/` so `npm test` runs them (`vitest.config.ts` includes `scripts/**/*.test.{ts,mjs}`). Runner entry files must NOT be named `*.test.*` or `*.spec.*`.
- **Gates before "done":** `npx tsc --noEmit`, `npm test`, `npx eslint .` with 0 errors.
- **Sanity writes need explicit consent:** the seed script defaults to dry run; only Frank runs `--apply`.
- Conventional commits, no AI attribution trailers.

---

### Task 1: Host policy

**Files:**
- Create: `scripts/lib/dev-verify/hostPolicy.ts`
- Test: `scripts/__tests__/devVerifyHostPolicy.test.ts`

**Interfaces:**
- Produces: `resolveTarget(input: string | undefined): TargetDecision` where
  `type TargetDecision = { ok: true; origin: string } | { ok: false; code: "forbidden_production" | "not_allowed" | "not_https" | "invalid_url" }`.
  `DEFAULT_ORIGIN = "https://dev-owt-backstage.vercel.app"`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/__tests__/devVerifyHostPolicy.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_ORIGIN, resolveTarget } from "../lib/dev-verify/hostPolicy";

describe("dev-verify host policy", () => {
  it("defaults to the stable dev origin", () => {
    expect(resolveTarget(undefined)).toEqual({ ok: true, origin: DEFAULT_ORIGIN });
    expect(resolveTarget("")).toEqual({ ok: true, origin: DEFAULT_ORIGIN });
  });

  it("refuses production by name BEFORE consulting the allow-list", () => {
    for (const url of [
      "https://owt-backstage.vercel.app",
      "https://owt-backstage.vercel.app/admin",
      "https://owt-backstage-git-main-frank-rochas-projects.vercel.app",
      "https://OWT-BACKSTAGE.vercel.app",
    ]) {
      expect(resolveTarget(url)).toEqual({ ok: false, code: "forbidden_production" });
    }
  });

  it("allows the stable dev origin and preview deployment hosts", () => {
    expect(resolveTarget("https://dev-owt-backstage.vercel.app/")).toEqual({ ok: true, origin: DEFAULT_ORIGIN });
    expect(resolveTarget("https://owt-backstage-bukd0yleb-frank-rochas-projects.vercel.app")).toEqual({
      ok: true,
      origin: "https://owt-backstage-bukd0yleb-frank-rochas-projects.vercel.app",
    });
    expect(resolveTarget("https://owt-backstage-git-preview-frank-rochas-projects.vercel.app")).toEqual({
      ok: true,
      origin: "https://owt-backstage-git-preview-frank-rochas-projects.vercel.app",
    });
  });

  it("strips any path, query and fragment from the accepted origin", () => {
    expect(resolveTarget("https://dev-owt-backstage.vercel.app/admin?x=1#y")).toEqual({ ok: true, origin: DEFAULT_ORIGIN });
  });

  it("refuses http, other hosts, subdomains of production, and garbage", () => {
    expect(resolveTarget("http://dev-owt-backstage.vercel.app")).toEqual({ ok: false, code: "not_https" });
    expect(resolveTarget("https://example.com")).toEqual({ ok: false, code: "not_allowed" });
    expect(resolveTarget("https://a.owt-backstage.vercel.app")).toEqual({ ok: false, code: "forbidden_production" });
    expect(resolveTarget("https://owt-backstage-x-someone-else.vercel.app")).toEqual({ ok: false, code: "not_allowed" });
    expect(resolveTarget("not a url")).toEqual({ ok: false, code: "invalid_url" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/devVerifyHostPolicy.test.ts`
Expected: FAIL — cannot resolve `../lib/dev-verify/hostPolicy`.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/lib/dev-verify/hostPolicy.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/devVerifyHostPolicy.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/dev-verify/hostPolicy.ts scripts/__tests__/devVerifyHostPolicy.test.ts
git commit -m "feat(dev-verify): host policy — production forbidden by name before the allow-list"
```

---

### Task 2: Mutation policy

**Files:**
- Create: `scripts/lib/dev-verify/mutationPolicy.ts`
- Test: `scripts/__tests__/devVerifyMutationPolicy.test.ts`

**Interfaces:**
- Produces: `decideRequest(input: { method: string; url: string; phase: "signin" | "observe" }): RequestDecision` where
  `type RequestDecision = { action: "allow" } | { action: "block"; reason: "mutation" }`.
  `SIGNIN_CALLBACK_PATH = "/api/auth/callback/credentials"`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/__tests__/devVerifyMutationPolicy.test.ts
import { describe, expect, it } from "vitest";
import { decideRequest, SIGNIN_CALLBACK_PATH } from "../lib/dev-verify/mutationPolicy";

const ORIGIN = "https://dev-owt-backstage.vercel.app";

describe("dev-verify mutation policy", () => {
  it("allows GET and HEAD everywhere", () => {
    for (const path of ["/", "/admin", "/api/admin/roles", "/api/cron/notify", "/_next/data/x.json"]) {
      expect(decideRequest({ method: "GET", url: ORIGIN + path, phase: "observe" })).toEqual({ action: "allow" });
      expect(decideRequest({ method: "HEAD", url: ORIGIN + path, phase: "observe" })).toEqual({ action: "allow" });
    }
  });

  it("blocks every non-GET method under /api/** while observing", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const path of ["/api/admin/roles/abc", "/api/me/theme", "/api/cron/notify", "/api/auth/signout"]) {
        expect(decideRequest({ method, url: ORIGIN + path, phase: "observe" }))
          .toEqual({ action: "block", reason: "mutation" });
      }
    }
  });

  it("allows ONLY the credentials callback POST, and only during sign-in", () => {
    expect(decideRequest({ method: "POST", url: ORIGIN + SIGNIN_CALLBACK_PATH, phase: "signin" })).toEqual({ action: "allow" });
    expect(decideRequest({ method: "POST", url: ORIGIN + SIGNIN_CALLBACK_PATH + "?x=1", phase: "signin" })).toEqual({ action: "allow" });
    expect(decideRequest({ method: "POST", url: ORIGIN + SIGNIN_CALLBACK_PATH, phase: "observe" }))
      .toEqual({ action: "block", reason: "mutation" });
    expect(decideRequest({ method: "POST", url: ORIGIN + "/api/auth/callback/google", phase: "signin" }))
      .toEqual({ action: "block", reason: "mutation" });
    expect(decideRequest({ method: "POST", url: ORIGIN + "/api/auth/signin/credentials", phase: "signin" }))
      .toEqual({ action: "block", reason: "mutation" });
  });

  it("allows NextAuth's csrf/session/providers GETs during sign-in (they are GETs)", () => {
    expect(decideRequest({ method: "GET", url: ORIGIN + "/api/auth/csrf", phase: "signin" })).toEqual({ action: "allow" });
    expect(decideRequest({ method: "GET", url: ORIGIN + "/api/auth/session", phase: "observe" })).toEqual({ action: "allow" });
  });

  it("blocks non-GET to non-/api paths too (server actions post to the page URL)", () => {
    expect(decideRequest({ method: "POST", url: ORIGIN + "/admin", phase: "observe" }))
      .toEqual({ action: "block", reason: "mutation" });
  });

  it("is case-insensitive on method", () => {
    expect(decideRequest({ method: "delete", url: ORIGIN + "/api/admin/roles/x", phase: "observe" }))
      .toEqual({ action: "block", reason: "mutation" });
    expect(decideRequest({ method: "get", url: ORIGIN + "/api/admin/roles", phase: "observe" })).toEqual({ action: "allow" });
  });
});
```

Note the fifth test: the spec names `/api/**`, but a Next.js server action is a `POST` to the page's own URL. Blocking every non-GET/HEAD to the target origin is strictly safer and still lets every read through; the plan widens the spec here on purpose and the runner's docs say so.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/devVerifyMutationPolicy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/lib/dev-verify/mutationPolicy.ts
/**
 * Read-only lock 1 (spec §4.1): decide, per browser request, whether the runner
 * lets it reach the server. Pure — the Playwright `page.route` handler calls this
 * and aborts on `block`.
 *
 * Wider than the spec's `/api/**`: ANY non-GET/HEAD to the target is blocked,
 * because a Next.js server action is a POST to the page URL, not to /api. A read
 * never needs a non-GET, so nothing observable is lost.
 *
 * The one exception is the credentials callback POST, matched by exact path,
 * and only while the runner is in its sign-in phase.
 */

export const SIGNIN_CALLBACK_PATH = "/api/auth/callback/credentials";

export type Phase = "signin" | "observe";

export type RequestDecision = { action: "allow" } | { action: "block"; reason: "mutation" };

const READ_METHODS = new Set(["GET", "HEAD"]);

export function decideRequest(input: { method: string; url: string; phase: Phase }): RequestDecision {
  const method = input.method.toUpperCase();
  if (READ_METHODS.has(method)) return { action: "allow" };
  if (input.phase === "signin" && method === "POST") {
    let pathname: string;
    try {
      pathname = new URL(input.url).pathname;
    } catch {
      return { action: "block", reason: "mutation" };
    }
    if (pathname === SIGNIN_CALLBACK_PATH) return { action: "allow" };
  }
  return { action: "block", reason: "mutation" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/devVerifyMutationPolicy.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/dev-verify/mutationPolicy.ts scripts/__tests__/devVerifyMutationPolicy.test.ts
git commit -m "feat(dev-verify): mutation policy — block every non-GET except the sign-in callback"
```

---

### Task 3: Argument parsing

**Files:**
- Create: `scripts/lib/dev-verify/args.ts`
- Test: `scripts/__tests__/devVerifyArgs.test.ts`

**Interfaces:**
- Produces: `parseArgs(argv: string[]): ParsedArgs | ArgsError` with

```ts
export interface ParsedArgs {
  route: string;                      // required, must start with "/"
  baseUrl?: string;                   // raw; Task 1 validates it
  screenshot?: string;                // file name or path
  fullPage: boolean;
  text: boolean;
  a11y: boolean;
  console: boolean;
  viewport: { width: number; height: number };   // default 1280x800
  theme?: "light" | "dark";
  clicks: string[];                   // in order
  waitFor?: string;
  json: boolean;
}
export type ArgsError = { error: string };   // human sentence naming the flag
export function isArgsError(v: ParsedArgs | ArgsError): v is ArgsError;
```

- [ ] **Step 1: Write the failing test**

```ts
// scripts/__tests__/devVerifyArgs.test.ts
import { describe, expect, it } from "vitest";
import { isArgsError, parseArgs } from "../lib/dev-verify/args";

describe("dev-verify args", () => {
  it("requires --route starting with /", () => {
    expect(parseArgs([])).toEqual({ error: "--route is required and must start with /" });
    expect(parseArgs(["--route", "admin"])).toEqual({ error: "--route is required and must start with /" });
  });

  it("applies defaults", () => {
    const parsed = parseArgs(["--route", "/admin"]);
    expect(parsed).toEqual({
      route: "/admin",
      fullPage: false,
      text: false,
      a11y: false,
      console: false,
      viewport: { width: 1280, height: 800 },
      clicks: [],
      json: false,
    });
  });

  it("parses every flag, repeating --click in order", () => {
    const parsed = parseArgs([
      "--route", "/admin", "--base-url", "https://x", "--screenshot", "out.png", "--full-page",
      "--text", "--a11y", "--console", "--viewport", "375x812", "--theme", "dark",
      "--click", "Editar mes", "--click", "Cerrar", "--wait", "Servicios", "--json",
    ]);
    expect(parsed).toEqual({
      route: "/admin", baseUrl: "https://x", screenshot: "out.png", fullPage: true,
      text: true, a11y: true, console: true, viewport: { width: 375, height: 812 }, theme: "dark",
      clicks: ["Editar mes", "Cerrar"], waitFor: "Servicios", json: true,
    });
  });

  it("rejects bad viewport, bad theme, unknown flags and missing values", () => {
    expect(parseArgs(["--route", "/", "--viewport", "wide"])).toEqual({ error: "--viewport must be WxH, e.g. 1280x800" });
    expect(parseArgs(["--route", "/", "--theme", "blue"])).toEqual({ error: "--theme must be light or dark" });
    expect(parseArgs(["--route", "/", "--bogus"])).toEqual({ error: "unknown flag --bogus" });
    expect(parseArgs(["--route", "/", "--click"])).toEqual({ error: "--click needs a value" });
    expect(parseArgs(["--route"])).toEqual({ error: "--route needs a value" });
  });

  it("isArgsError narrows", () => {
    expect(isArgsError({ error: "x" })).toBe(true);
    expect(isArgsError(parseArgs(["--route", "/"]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/devVerifyArgs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/lib/dev-verify/args.ts
/** CLI flags for scripts/dev-verify.ts (spec §5). Pure; no process access. */

export interface ParsedArgs {
  route: string;
  baseUrl?: string;
  screenshot?: string;
  fullPage: boolean;
  text: boolean;
  a11y: boolean;
  console: boolean;
  viewport: { width: number; height: number };
  theme?: "light" | "dark";
  clicks: string[];
  waitFor?: string;
  json: boolean;
}

export type ArgsError = { error: string };

export function isArgsError(v: ParsedArgs | ArgsError): v is ArgsError {
  return typeof (v as ArgsError).error === "string";
}

const BOOLEAN_FLAGS: Record<string, keyof ParsedArgs> = {
  "--full-page": "fullPage",
  "--text": "text",
  "--a11y": "a11y",
  "--console": "console",
  "--json": "json",
};

const VALUE_FLAGS = new Set(["--route", "--base-url", "--screenshot", "--viewport", "--theme", "--click", "--wait"]);

export function parseArgs(argv: string[]): ParsedArgs | ArgsError {
  const out: ParsedArgs = {
    route: "",
    fullPage: false,
    text: false,
    a11y: false,
    console: false,
    viewport: { width: 1280, height: 800 },
    clicks: [],
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (flag in BOOLEAN_FLAGS) {
      (out as unknown as Record<string, unknown>)[BOOLEAN_FLAGS[flag]!] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) return { error: `unknown flag ${flag}` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { error: `${flag} needs a value` };
    i += 1;
    switch (flag) {
      case "--route": out.route = value; break;
      case "--base-url": out.baseUrl = value; break;
      case "--screenshot": out.screenshot = value; break;
      case "--wait": out.waitFor = value; break;
      case "--click": out.clicks.push(value); break;
      case "--theme":
        if (value !== "light" && value !== "dark") return { error: "--theme must be light or dark" };
        out.theme = value;
        break;
      case "--viewport": {
        const m = /^(\d{3,5})x(\d{3,5})$/.exec(value);
        if (!m) return { error: "--viewport must be WxH, e.g. 1280x800" };
        out.viewport = { width: Number(m[1]), height: Number(m[2]) };
        break;
      }
    }
  }
  if (!out.route.startsWith("/")) return { error: "--route is required and must start with /" };
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/devVerifyArgs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/dev-verify/args.ts scripts/__tests__/devVerifyArgs.test.ts
git commit -m "feat(dev-verify): CLI argument parsing"
```

---

### Task 4: Report shape, redaction and leak scan

**Files:**
- Create: `scripts/lib/dev-verify/report.ts`
- Test: `scripts/__tests__/devVerifyReport.test.ts`

**Interfaces:**
- Consumes: `scanForSecretLeak(source, text, secret)` from `e2e/service-readiness/lib/bypass.ts` (existing).
- Produces:

```ts
export interface BlockedMutation { method: string; url: string; phase: "signin" | "observe" }
export interface RunReport {
  origin: string;
  route: string;
  observedDeployment: string | null;     // x-vercel-id header of the first navigation
  status: number | null;                 // HTTP status of the route response
  artifacts: { screenshot?: string; text?: string; a11y?: string };   // paths
  consoleErrors: string[];
  failedRequests: { method: string; url: string; status: number | null }[];
  blockedMutations: BlockedMutation[];
  pageErrors: string[];
  exitCode: 0 | 2 | 3 | 4;
  refusal?: string;
}
export function decideExitCode(r: Pick<RunReport, "blockedMutations" | "pageErrors" | "status" | "refusal">): 0 | 2 | 3 | 4;
export function redactReport(r: RunReport, secrets: (string | null)[]): RunReport;   // replaces any secret value with "[redacted]" in every string field
export function assertNoLeak(texts: { source: string; text: string }[], secrets: (string | null)[]): void;  // throws Error("secret_leak:<source>") if scanForSecretLeak finds one
export function formatHuman(r: RunReport): string;
```

- [ ] **Step 1: Write the failing test**

```ts
// scripts/__tests__/devVerifyReport.test.ts
import { describe, expect, it } from "vitest";
import { assertNoLeak, decideExitCode, formatHuman, redactReport, type RunReport } from "../lib/dev-verify/report";

function base(over: Partial<RunReport> = {}): RunReport {
  return {
    origin: "https://dev-owt-backstage.vercel.app", route: "/admin", observedDeployment: "iad1::abc",
    status: 200, artifacts: {}, consoleErrors: [], failedRequests: [], blockedMutations: [], pageErrors: [],
    exitCode: 0, ...over,
  };
}

describe("dev-verify report", () => {
  it("exit code precedence: refusal 2 > blocked mutation 3 > page error 4 > 0", () => {
    expect(decideExitCode(base())).toBe(0);
    expect(decideExitCode(base({ pageErrors: ["boom"] }))).toBe(4);
    expect(decideExitCode(base({ status: 500 }))).toBe(4);
    expect(decideExitCode(base({ status: 404 }))).toBe(0);
    expect(decideExitCode(base({ blockedMutations: [{ method: "DELETE", url: "x", phase: "observe" }], pageErrors: ["boom"] }))).toBe(3);
    expect(decideExitCode(base({ refusal: "host", blockedMutations: [{ method: "DELETE", url: "x", phase: "observe" }] }))).toBe(2);
  });

  it("redacts every occurrence of every secret in every string field, including nested", () => {
    const r = base({
      consoleErrors: ["token s3cr3t leaked"],
      failedRequests: [{ method: "GET", url: "https://x/?a=s3cr3t", status: 401 }],
      blockedMutations: [{ method: "POST", url: "https://x/s3cr3t", phase: "observe" }],
      artifacts: { text: "/tmp/s3cr3t.txt" },
    });
    const out = redactReport(r, ["s3cr3t", null]);
    expect(JSON.stringify(out)).not.toContain("s3cr3t");
    expect(out.consoleErrors[0]).toBe("token [redacted] leaked");
    expect(r.consoleErrors[0]).toBe("token s3cr3t leaked"); // input untouched
  });

  it("assertNoLeak throws naming the source, never the value", () => {
    expect(() => assertNoLeak([{ source: "out.txt", text: "hello s3cr3t" }], ["s3cr3t"])).toThrow("secret_leak:out.txt");
    expect(() => assertNoLeak([{ source: "out.txt", text: "?x-vercel-protection-bypass=zzz" }], [null])).toThrow("secret_leak:out.txt");
    expect(() => assertNoLeak([{ source: "out.txt", text: "clean" }], ["s3cr3t"])).not.toThrow();
  });

  it("formatHuman leads with the deployment and the exit code", () => {
    const text = formatHuman(base({ blockedMutations: [{ method: "DELETE", url: "https://x/api/admin/roles/1", phase: "observe" }], exitCode: 3 }));
    expect(text.split("\n")[0]).toBe("dev-verify: exit 3 · https://dev-owt-backstage.vercel.app/admin · deployment iad1::abc · HTTP 200");
    expect(text).toContain("blocked_mutation DELETE https://x/api/admin/roles/1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/devVerifyReport.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/lib/dev-verify/report.ts
/**
 * Run report for scripts/dev-verify.ts (spec §5) and the redaction/leak proof
 * (spec §3.3). Pure. The leak scanner is the A3 harness's own, reused so the two
 * tools can never disagree on what a leak looks like.
 */
import { scanForSecretLeak } from "../../../e2e/service-readiness/lib/bypass";

export interface BlockedMutation { method: string; url: string; phase: "signin" | "observe" }

export interface RunReport {
  origin: string;
  route: string;
  observedDeployment: string | null;
  status: number | null;
  artifacts: { screenshot?: string; text?: string; a11y?: string };
  consoleErrors: string[];
  failedRequests: { method: string; url: string; status: number | null }[];
  blockedMutations: BlockedMutation[];
  pageErrors: string[];
  exitCode: 0 | 2 | 3 | 4;
  refusal?: string;
}

export function decideExitCode(
  r: Pick<RunReport, "blockedMutations" | "pageErrors" | "status" | "refusal">,
): 0 | 2 | 3 | 4 {
  if (r.refusal) return 2;
  if (r.blockedMutations.length > 0) return 3;
  if (r.pageErrors.length > 0 || (r.status !== null && r.status >= 500)) return 4;
  return 0;
}

function redactString(s: string, secrets: string[]): string {
  let out = s;
  for (const secret of secrets) {
    for (const needle of new Set([secret, encodeURIComponent(secret)])) {
      out = out.split(needle).join("[redacted]");
    }
  }
  return out;
}

function redactValue<T>(value: T, secrets: string[]): T {
  if (typeof value === "string") return redactString(value, secrets) as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, secrets);
    return out as T;
  }
  return value;
}

export function redactReport(r: RunReport, secrets: (string | null)[]): RunReport {
  const live = secrets.filter((s): s is string => typeof s === "string" && s.length > 0);
  return redactValue(r, live);
}

export function assertNoLeak(texts: { source: string; text: string }[], secrets: (string | null)[]): void {
  for (const { source, text } of texts) {
    for (const secret of secrets.length ? secrets : [null]) {
      if (scanForSecretLeak(source, text, secret).length > 0) throw new Error(`secret_leak:${source}`);
    }
  }
}

export function formatHuman(r: RunReport): string {
  const lines = [
    `dev-verify: exit ${r.exitCode} · ${r.origin}${r.route} · deployment ${r.observedDeployment ?? "unknown"} · HTTP ${r.status ?? "none"}`,
  ];
  if (r.refusal) lines.push(`refused: ${r.refusal}`);
  for (const [k, v] of Object.entries(r.artifacts)) if (v) lines.push(`${k}: ${v}`);
  for (const b of r.blockedMutations) lines.push(`blocked_mutation ${b.method} ${b.url} (${b.phase})`);
  for (const e of r.pageErrors) lines.push(`page_error ${e}`);
  for (const e of r.consoleErrors) lines.push(`console ${e}`);
  for (const f of r.failedRequests) lines.push(`failed ${f.method} ${f.url} → ${f.status ?? "no response"}`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/devVerifyReport.test.ts`
Expected: PASS (4 tests). If the relative import of `bypass.ts` fails under vitest, use the alias form `@/e2e/service-readiness/lib/bypass` (the `@` alias resolves to the repo root in `vitest.config.ts`) and keep whichever form also satisfies `tsc`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/dev-verify/report.ts scripts/__tests__/devVerifyReport.test.ts
git commit -m "feat(dev-verify): run report with exit-code precedence, redaction and leak assertion"
```

---

### Task 5: The runner

**Files:**
- Create: `scripts/dev-verify.ts`
- Modify: `.gitignore` (add `/playwright/.dev-verify-storageState.json` explicitly under the existing A3 block — the glob already matches, the explicit line is documentation)

**Interfaces:**
- Consumes: Tasks 1–4; `resolveBypassSecret`, `initialNavigationHeaders`, `bypassHeaders` from `e2e/service-readiness/lib/bypass.ts`; `SIGNIN_CALLBACK_PATH`, `decideRequest`.
- Env: `DEV_VERIFY_EMAIL`, `DEV_VERIFY_PASSWORD`, `SR_VERIFY_BYPASS_SECRET` (all from `.env.local` via `--env-file`).
- Produces: the CLI in spec §5. Storage state at `playwright/.dev-verify-storageState.json`. Artifacts default into `$DEV_VERIFY_OUT_DIR` if set, else `./test-results/dev-verify/`.

No unit test: the runner is the thin I/O shell. Its proof is the manual runs in Task 7.

- [ ] **Step 1: Write the runner**

```ts
// scripts/dev-verify.ts
/**
 * Read-only observation of a dev deployment as the «Verificador» member.
 *
 *   npx tsx --env-file=.env.local scripts/dev-verify.ts --route /admin --screenshot admin.png --text --console
 *
 * Spec: docs/superpowers/specs/2026-09-01-dev-verify-runner-design.md
 * Docs: docs/DEV_VERIFY.md
 *
 * Three locks keep this read-only (spec §4): every non-GET/HEAD request is aborted
 * in the browser (mutationPolicy), production is refused by name (hostPolicy), and
 * the member is retired from every ministry. No Sanity client is imported here.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

import { bypassHeaders, initialNavigationHeaders, resolveBypassSecret } from "../e2e/service-readiness/lib/bypass";
import { isArgsError, parseArgs, type ParsedArgs } from "./lib/dev-verify/args";
import { resolveTarget } from "./lib/dev-verify/hostPolicy";
import { decideRequest, type Phase } from "./lib/dev-verify/mutationPolicy";
import { assertNoLeak, decideExitCode, formatHuman, redactReport, type RunReport } from "./lib/dev-verify/report";

const STORAGE_STATE = path.resolve("playwright/.dev-verify-storageState.json");
const OUT_DIR = path.resolve(process.env.DEV_VERIFY_OUT_DIR ?? "test-results/dev-verify");
const SIGNIN_PATH = "/auth/signin";
/** `app/components/ActivityPing.tsx` — its sessionStorage key. Seeded so the heartbeat POST never fires. */
const PING_KEY = "owt_last_ping";

let SECRETS: (string | null)[] = [];

/** Every exit goes through redaction and the leak proof, refusals included. */
function emit(report: RunReport, json: boolean): void {
  const final = redactReport(report, SECRETS);
  final.exitCode = decideExitCode(final);
  assertNoLeak([{ source: "report", text: JSON.stringify(final) }], SECRETS);
  process.stdout.write((json ? JSON.stringify(final, null, 2) : formatHuman(final)) + "\n");
}

function refuse(report: RunReport, reason: string, json: boolean): never {
  report.refusal = reason;
  emit(report, json);
  process.exit(2);
}

async function newContext(origin: string, args: ParsedArgs, bypass: string | null, useState: boolean): Promise<BrowserContext> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: origin,
    viewport: args.viewport,
    colorScheme: args.theme,
    extraHTTPHeaders: bypassHeaders(bypass),
    storageState: useState && existsSync(STORAGE_STATE) ? STORAGE_STATE : undefined,
    serviceWorkers: "block",
  });
  // Suppress the app's own heartbeat (a production `lastSeen` patch) without a policy
  // exception: with a fresh timestamp in sessionStorage, ActivityPing returns early.
  await context.addInitScript((key: string) => {
    try { sessionStorage.setItem(key, String(Date.now())); } catch { /* no storage: the request would be blocked by lock 1 */ }
  }, PING_KEY);
  return context;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (isArgsError(parsed)) {
    process.stderr.write(parsed.error + "\n");
    process.exit(2);
  }
  const args = parsed;
  const report: RunReport = {
    origin: "", route: args.route, observedDeployment: null, status: null, artifacts: {},
    consoleErrors: [], failedRequests: [], blockedMutations: [], pageErrors: [], exitCode: 0,
  };

  const target = resolveTarget(args.baseUrl);
  if (!target.ok) refuse(report, `host:${target.code}`, args.json);
  report.origin = target.origin;

  const email = process.env.DEV_VERIFY_EMAIL;
  const password = process.env.DEV_VERIFY_PASSWORD;
  const { secret: bypass, reason } = resolveBypassSecret(process.env);
  SECRETS = [password ?? null, bypass];
  if (!email || !password) refuse(report, "env:DEV_VERIFY_EMAIL/DEV_VERIFY_PASSWORD missing", args.json);
  if (!bypass) refuse(report, `env:SR_VERIFY_BYPASS_SECRET ${reason}`, args.json);

  /** Landed-origin rule: an SSO redirect lands on vercel.com; that is a refusal, never a green run. */
  const assertOnOrigin = (page: Page): void => {
    let origin = "";
    try { origin = new URL(page.url()).origin; } catch { origin = ""; }
    if (origin !== target.origin) refuse(report, `host:landed_off_origin:${origin || "unparseable"}`, args.json);
  };

  mkdirSync(OUT_DIR, { recursive: true });
  let phase: Phase = "observe";

  const attachContext = async (context: BrowserContext): Promise<void> => {
    // Context-wide, awaited: covers popups and any page the context opens later.
    await context.route("**/*", async (route) => {
      const req = route.request();
      if (!req.url().startsWith(target.origin)) return route.continue();
      const decision = decideRequest({ method: req.method(), url: req.url(), phase });
      if (decision.action === "allow") return route.continue();
      report.blockedMutations.push({ method: req.method(), url: req.url(), phase });
      return route.abort("blockedbyclient");
    });
  };
  const attach = (page: Page): void => {
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") report.consoleErrors.push(`${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => report.pageErrors.push(String(e)));
    page.on("requestfailed", (r) => {
      if (r.failure()?.errorText === "net::ERR_BLOCKED_BY_CLIENT") return; // ours, already recorded
      report.failedRequests.push({ method: r.method(), url: r.url(), status: null });
    });
    page.on("response", (r) => { if (r.status() >= 400 && r.request().resourceType() !== "image") report.failedRequests.push({ method: r.request().method(), url: r.url(), status: r.status() }); });
  };

  const signIn = async (): Promise<BrowserContext> => {
    if (existsSync(STORAGE_STATE)) rmSync(STORAGE_STATE);
    const context = await newContext(target.origin, args, bypass, false);
    await attachContext(context);
    const page = await context.newPage();
    attach(page);
    phase = "signin";
    await page.setExtraHTTPHeaders(initialNavigationHeaders(bypass)); // asks Vercel for the bypass cookie, as A3 does
    await page.goto(SIGNIN_PATH, { waitUntil: "networkidle" });
    assertOnOrigin(page);
    await page.getByLabel("Correo electrónico").fill(email!);
    await page.getByLabel("Contraseña").fill(password!);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith(SIGNIN_PATH), { timeout: 30_000 })
      .catch(() => refuse(report, "signin:still on /auth/signin after submit", args.json));
    assertOnOrigin(page);
    phase = "observe";
    await context.storageState({ path: STORAGE_STATE });
    await page.close();
    return context;
  };

  let context = await newContext(target.origin, args, bypass, true);
  await attachContext(context);
  let page = await context.newPage();
  attach(page);
  await page.setExtraHTTPHeaders(initialNavigationHeaders(bypass));
  let response = await page.goto(args.route, { waitUntil: "networkidle" });
  assertOnOrigin(page); // an SSO wall on vercel.com is refused here, before any sign-in attempt
  if (page.url().includes(SIGNIN_PATH) || response?.status() === 401) {
    await context.browser()?.close();
    context = await signIn();
    page = await context.newPage();
    attach(page);
    response = await page.goto(args.route, { waitUntil: "networkidle" });
    assertOnOrigin(page);
    if (page.url().includes(SIGNIN_PATH)) refuse(report, "signin:session not accepted", args.json);
  }
  report.status = response?.status() ?? null;
  report.observedDeployment = response?.headers()["x-vercel-id"] ?? null;

  if (args.waitFor) await page.getByText(args.waitFor).first().waitFor({ timeout: 30_000 }).catch(() => report.pageErrors.push(`wait:${args.waitFor} not visible`));
  for (const name of args.clicks) {
    const target = page.getByRole("button", { name }).or(page.getByRole("link", { name })).first();
    await target.click({ timeout: 10_000 }).catch(() => report.pageErrors.push(`click:${name} not found`));
    await page.waitForLoadState("networkidle").catch(() => undefined);
    assertOnOrigin(page);
  }

  const stem = args.route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
  if (args.screenshot) {
    const file = path.isAbsolute(args.screenshot) ? args.screenshot : path.join(OUT_DIR, args.screenshot);
    await page.screenshot({ path: file, fullPage: args.fullPage });
    report.artifacts.screenshot = file;
  }
  if (args.text) {
    const text = await page.locator("main").first().innerText().catch(() => page.locator("body").innerText());
    const file = path.join(OUT_DIR, `${stem}.txt`);
    writeFileSync(file, text);
    report.artifacts.text = file;
  }
  if (args.a11y) {
    const tree = await page.locator("body").ariaSnapshot();
    const file = path.join(OUT_DIR, `${stem}.a11y.yaml`);
    writeFileSync(file, tree);
    report.artifacts.a11y = file;
  }
  if (!args.console) { report.consoleErrors = []; report.failedRequests = []; }

  await context.browser()?.close();

  // Redaction proof on every written artifact; `emit` covers the report itself.
  const texts = Object.values(report.artifacts).filter((f): f is string => !!f && !f.endsWith(".png"))
    .map((f) => ({ source: path.basename(f), text: readFileSync(f, "utf8") }));
  assertNoLeak(texts, SECRETS);
  emit(report, args.json);
  process.exit(decideExitCode(report));
}

main().catch((err) => {
  process.stderr.write(`dev-verify: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(4);
});
```

Implementation notes the executor must honour:
- `owt_last_ping` must be replaced with the literal value of `PING_KEY` in `app/components/ActivityPing.tsx` (read it; do not import the component). Add a one-line vitest in `scripts/__tests__/devVerifyPingKey.test.ts` that reads that file with `readFileSync` and asserts the runner's constant equals it, so a rename there fails the gate instead of silently re-enabling the heartbeat.
- `context.route("**/*")` with an origin check is used instead of `"**/api/**"` because of the server-action widening in Task 2. Third-party origins (fonts, Sanity CDN images) are continued untouched — which means lock 1 is origin-scoped: `/studio` talks to `api.sanity.io` unpoliced. That is safe only because the runner holds no Sanity login; `DEV_VERIFY.md` says so.
- `page.setExtraHTTPHeaders(initialNavigationHeaders(bypass))` before the first navigation mirrors `e2e/service-readiness/fixtures.ts`; page-level headers merge over the context's `extraHTTPHeaders`.
- The `.catch(() => refuse(...))` inside `signIn` calls `process.exit`; that is intentional — a failed sign-in must not fall through to observation.
- If `tsc` complains that `scripts/dev-verify.ts` is outside the project's `include`, check `tsconfig.json`; `scripts/set-password.ts` already compiles, so the pattern exists. Do not add `// @ts-nocheck`.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint scripts/dev-verify.ts scripts/lib/dev-verify`
Expected: no errors (warnings are acceptable only if they match the existing backlog classes).

- [ ] **Step 3: Prove the refusals without any network**

Run: `npx tsx scripts/dev-verify.ts --route /admin --base-url https://owt-backstage.vercel.app --json`
Expected: JSON with `"refusal": "host:forbidden_production"`, exit code 2, and no browser launched (the refusal happens before `chromium.launch`).

Run: `env -u DEV_VERIFY_EMAIL npx tsx scripts/dev-verify.ts --route /admin`
Expected: `refused: env:DEV_VERIFY_EMAIL/DEV_VERIFY_PASSWORD missing`, exit 2.

- [ ] **Step 4: Add the explicit ignore line**

In `.gitignore`, directly under `*storageState*.json`, add:

```
# scripts/dev-verify.ts — the Verificador member's live session. Same rule as above.
/playwright/.dev-verify-storageState.json
```

Run: `git check-ignore playwright/.dev-verify-storageState.json` → prints the path.

- [ ] **Step 5: Commit**

```bash
git add scripts/dev-verify.ts .gitignore
git commit -m "feat(dev-verify): read-only Playwright runner for the dev deployment"
```

---

### Task 6: Seed script for the «Verificador» member

**Files:**
- Create: `scripts/lib/dev-verify/seedDoc.ts` (pure document builder)
- Create: `scripts/dev-verify-seed.mjs`
- Test: `scripts/__tests__/devVerifySeedDoc.test.ts`

**Interfaces:**
- Produces: `buildVerifierDoc(input: { email: string; passwordHash: string }): VerifierDoc` — the exact `teamMembers` document from spec §3.1, **never carrying `disabled`**. `VERIFIER_ID = "member-dev-verify"` (deterministic `_id` with a hyphen, not a dot: a dotted id is a Sanity "path" hidden from untokened reads, i.e. the hidden-member mechanism §3.1 rejects). The seed **patches** an existing document and **creates** only when absent, so a Studio-set `disabled: true` survives a rotation.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/__tests__/devVerifySeedDoc.test.ts
import { describe, expect, it } from "vitest";
import { buildVerifierDoc, VERIFIER_ID } from "../lib/dev-verify/seedDoc";

describe("dev-verify seed doc", () => {
  it("builds the spec §3.1 member exactly", () => {
    expect(buildVerifierDoc({ email: "v@example.com", passwordHash: "$2a$10$hash" })).toEqual({
      _id: VERIFIER_ID,
      _type: "teamMembers",
      member_name: "Verificador (bot)",
      alias: "Verificador",
      slug: { _type: "slug", current: "verificador-bot" },
      email: "v@example.com",
      role: "admin",
      ministries: ["worship"],
      managesMinistries: ["kids"],
      retiredFrom: ["worship"],
      notifPrefs: {
        assignments: false,
        email: false,
        emailAssigned: false,
        emailRemoved: false,
        emailRoleChanged: false,
        emailSetlist: false,
        emailProposals: false,
        setlist: "off",
        proposals: false,
        reminders: false,
      },
      passwordHash: "$2a$10$hash",
    });
  });

  it("never sets memberType, disabled, or super-admin", () => {
    const doc = buildVerifierDoc({ email: "v@example.com", passwordHash: "h" }) as Record<string, unknown>;
    expect(doc.memberType).toBeUndefined();
    expect(doc.disabled).toBeUndefined();
    expect(doc.role).toBe("admin");
  });

  it("uses a deterministic, non-dotted id so re-seeding patches rather than duplicates", () => {
    expect(VERIFIER_ID).toBe("member-dev-verify");
    expect(VERIFIER_ID).not.toContain(".");
  });

  it("is a worship member only: kids reads ignore retiredFrom, so kids membership would seat the bot", () => {
    const doc = buildVerifierDoc({ email: "v@example.com", passwordHash: "h" });
    expect(doc.ministries).toEqual(["worship"]);
    expect(doc.managesMinistries).toEqual(["kids"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/devVerifySeedDoc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure builder**

```ts
// scripts/lib/dev-verify/seedDoc.ts
/**
 * The «Verificador» teamMembers document (spec §3.1). Pure so the exact shape is
 * unit-tested; scripts/dev-verify-seed.mjs is the only writer.
 *
 * `retiredFrom` is the load-bearing field: it is hidden in Studio, so this script
 * is the only way to set it, and it is what keeps the member out of every pool.
 */
export const VERIFIER_ID = "member-dev-verify";

export interface VerifierDoc {
  _id: string;
  _type: "teamMembers";
  member_name: string;
  alias: string;
  slug: { _type: "slug"; current: string };
  email: string;
  role: "admin";
  ministries: string[];
  managesMinistries: string[];
  retiredFrom: string[];
  notifPrefs: Record<string, boolean | string>;
  passwordHash: string;
}

export function buildVerifierDoc(input: { email: string; passwordHash: string }): VerifierDoc {
  return {
    _id: VERIFIER_ID,
    _type: "teamMembers",
    member_name: "Verificador (bot)",
    alias: "Verificador",
    slug: { _type: "slug", current: "verificador-bot" },
    email: input.email,
    role: "admin",
    // Worship member, retired from it: every worship selection point honours
    // retiredFrom. NOT a kids member — kids reads are resolution-only and never
    // filter on retiredFrom (retirementGatingCoverage.test.ts pins that), so kids
    // membership would make the bot a seatable pair member. Kids MANAGEMENT alone
    // is enough for /kids/admin (requireMinistryManager needs no membership).
    ministries: ["worship"],
    managesMinistries: ["kids"],
    retiredFrom: ["worship"],
    notifPrefs: {
      assignments: false,
      email: false,
      emailAssigned: false,
      emailRemoved: false,
      emailRoleChanged: false,
      emailSetlist: false,
      emailProposals: false,
      setlist: "off",
      proposals: false,
      reminders: false,
    },
    passwordHash: input.passwordHash,
  };
}
```

Expected test count after this step: 4. Before committing, confirm the `notifPrefs` keys against `sanity/schemas/worshipTeam.ts` lines 123–170 (`assignments`, `email`, `emailAssigned`, `emailRemoved`, `emailRoleChanged`, `emailSetlist`, `emailProposals`, `setlist`, `proposals`, `reminders`). If the schema has a key this list lacks, add it as `false`; if `slug` is not a `slug`-typed field there, match its actual type.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/devVerifySeedDoc.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the seed script**

```js
// scripts/dev-verify-seed.mjs
// Creates or replaces the «Verificador (bot)» member used by scripts/dev-verify.ts.
//
//   node --env-file=.env.local scripts/dev-verify-seed.mjs           # dry run: prints the doc, writes nothing
//   node --env-file=.env.local scripts/dev-verify-seed.mjs --apply   # writes to the dataset in .env.local
//
// Env: DEV_VERIFY_EMAIL, DEV_VERIFY_PASSWORD_HASH (bcrypt; generate with
//   node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" '<password>'
//   and NEVER paste the hash anywhere tracked), NEXT_PUBLIC_SANITY_PROJECT_ID,
//   NEXT_PUBLIC_SANITY_DATASET, SANITY_WRITE_TOKEN.
//
// Idempotent: deterministic _id. An EXISTING document is PATCHED (so a Studio-set
// `disabled: true` — the kill switch — survives a password rotation); the document
// is CREATED only when absent. Re-running with a new hash rotates the password.
//
// Spec: docs/superpowers/specs/2026-09-01-dev-verify-runner-design.md §3.1

import { buildVerifierDoc, VERIFIER_ID } from "./lib/dev-verify/seedDoc.ts";

const APPLY = process.argv.includes("--apply");
const email = process.env.DEV_VERIFY_EMAIL;
const passwordHash = process.env.DEV_VERIFY_PASSWORD_HASH;

if (!email || !passwordHash) {
  console.error("Missing DEV_VERIFY_EMAIL or DEV_VERIFY_PASSWORD_HASH in env.");
  process.exit(2);
}
if (!/^\$2[aby]\$\d{2}\$/.test(passwordHash)) {
  console.error("DEV_VERIFY_PASSWORD_HASH does not look like a bcrypt hash; refusing.");
  process.exit(2);
}

const doc = buildVerifierDoc({ email, passwordHash });
console.log(JSON.stringify({ ...doc, passwordHash: "[redacted]" }, null, 2));

if (!APPLY) {
  console.log("\nDry run. Nothing written. Re-run with --apply to write.");
  process.exit(0);
}

const { createClient } = await import("@sanity/client");
const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-07-23",
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
});
if (!process.env.SANITY_WRITE_TOKEN) {
  console.error("Missing SANITY_WRITE_TOKEN in env.");
  process.exit(2);
}
const twin = await client.fetch(
  `*[_type == "teamMembers" && lower(email) == lower($email) && _id != $id][0]._id`,
  { email, id: VERIFIER_ID },
);
if (twin) {
  console.error(`Another member already uses ${email} (${twin}). Refusing to create a twin.`);
  process.exit(2);
}
const current = await client.fetch(`*[_id == $id][0]{ _id, _rev, disabled }`, { id: VERIFIER_ID });
if (current) {
  const { _id, _type, ...fields } = doc; // never touches `disabled`
  void _id; void _type;
  const patched = await client.patch(VERIFIER_ID).set(fields).commit();
  console.log(`Patched ${patched._id} (rev ${current._rev} → ${patched._rev}); disabled stays ${current.disabled === true}.`);
} else {
  const created = await client.create(doc);
  console.log(`Created ${created._id} (rev ${created._rev}).`);
}
```

Note on `import ... from "./lib/dev-verify/seedDoc.ts"`: Node 22 cannot import TypeScript from an `.mjs` without a loader. If `node --env-file=.env.local scripts/dev-verify-seed.mjs` fails on that import, rename the seed to `scripts/dev-verify-seed.ts` and document the invocation as `npx tsx --env-file=.env.local scripts/dev-verify-seed.ts [--apply]` — the same runtime the runner uses. Do NOT duplicate the document literal into the `.mjs`.

- [ ] **Step 6: Dry-run the seed locally (no write)**

Run: `DEV_VERIFY_EMAIL=v@example.com DEV_VERIFY_PASSWORD_HASH='$2a$10$abcdefghijklmnopqrstuv' node --env-file=.env.local scripts/dev-verify-seed.mjs` (or the `tsx` form)
Expected: the redacted document printed, then `Dry run. Nothing written.`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/dev-verify/seedDoc.ts scripts/__tests__/devVerifySeedDoc.test.ts scripts/dev-verify-seed.*
git commit -m "feat(dev-verify): dry-run seed script for the Verificador member"
```

---

### Task 7: Documentation, secrets entries, ADR, agent charter

**Files:**
- Create: `docs/DEV_VERIFY.md`
- Create: `docs/adr/00NN-agent-dev-verification-is-a-local-read-only-runner.md` (next free number; check `ls docs/adr`)
- Modify: `docs/SECRETS.md` (four entries; remove `SR_VERIFY_BYPASS_SECRET` from "Not yet documented" if listed there)
- Modify: `CLAUDE.md` — one bullet under "Vercel safety", after the push-order bullet
- Modify: `~/.claude/agents/visual-verifier.md` — the "Never enter credentials" paragraph

- [ ] **Step 1: Write `docs/DEV_VERIFY.md`**

```markdown
# Dev verification runner (`scripts/dev-verify.ts`)

Read-only observation of `dev-owt-backstage.vercel.app` as the «Verificador (bot)» member,
so an agent can see what a change renders without anyone typing a credential.
Spec: `docs/superpowers/specs/2026-09-01-dev-verify-runner-design.md`. Decision record:
`docs/adr/00NN-agent-dev-verification-is-a-local-read-only-runner.md`.

## Run

    npx tsx --env-file=.env.local scripts/dev-verify.ts --route /admin --screenshot admin.png --text --console

| Flag | Meaning |
|---|---|
| `--route <path>` | Required. |
| `--base-url <origin>` | Default `https://dev-owt-backstage.vercel.app`. Only dev and this project's preview hosts are accepted; production is refused by name. |
| `--screenshot <file>` / `--full-page` | PNG into `test-results/dev-verify/` (or `$DEV_VERIFY_OUT_DIR`, or an absolute path). |
| `--text` / `--a11y` | Page text / accessibility tree, written next to the screenshot. |
| `--console` | Include console errors and failed requests in the report. |
| `--viewport WxH` · `--theme light|dark` | Emulation. `--theme` never touches `/me`. |
| `--click "<accessible name>"` | Repeatable, in order, before capture. Still read-only (see locks). |
| `--wait "<text>"` | Wait for text before capture (30 s). |
| `--json` | Machine-readable report. |

Exit codes: `0` ok · `2` refused (host, env, sign-in) · `3` a mutation was attempted and blocked · `4` page error or HTTP ≥ 500.

Pair every run with the alias check: the report's `observedDeployment` is the `x-vercel-id`
of the response, not a commit. `get_deployment(dev-owt-backstage.vercel.app)` gives the SHA.

## Why it cannot write

1. Every request to the target that is not `GET`/`HEAD` is aborted in the browser and
   reported as `blocked_mutation` (exit 3). The single exception is `POST
   /api/auth/callback/credentials` during sign-in. This is wider than `/api/**` on purpose:
   Next.js server actions POST to the page URL.
2. Production hosts are refused before the allow-list is consulted (`hostPolicy.ts`).
3. The member is a worship member retired from worship, a kids *manager* but not a kids
   *member* (kids reads never filter on retirement, so membership would seat it), and opted
   out of every notification.

Lock 1 is origin-scoped: Studio's calls to `api.sanity.io` are not policed. That is safe
only because the runner holds no Sanity login and imports no Sanity client.

## Writes that DO happen, and why they are accepted

- **One `loginEvent` document per sign-in** (`auth.ts` `events.signIn`). Unavoidable without
  changing `auth.ts`, which is out of scope. Bounded: once per cached session (7 days) or per
  rotation. The bot appears in the admin login-activity view. Accepted by Frank, 2026-09-01.
- **`lastSeen` heartbeat — suppressed.** `ActivityPing` would POST `/api/activity/ping` on the
  first authenticated page of every fresh browser; the runner seeds its `sessionStorage` key so
  the request never fires. It is not allow-listed: if the seed ever stops working, the POST is
  blocked and the run exits 3, which is the correct failure.

## Session and secrets

Env (all in `.env.local`, never in Vercel): `DEV_VERIFY_EMAIL`, `DEV_VERIFY_PASSWORD`,
`SR_VERIFY_BYPASS_SECRET`. See `docs/SECRETS.md`. The session is cached at
`playwright/.dev-verify-storageState.json` (gitignored; a live session — delete it to force a
fresh sign-in). The bypass secret travels only as the `x-vercel-protection-bypass` header;
every artifact and the report are scanned with the A3 leak scanner before anything is printed.

## Seeding the member (once, Frank)

    node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" '<password>'
    # put the hash in .env.local as DEV_VERIFY_PASSWORD_HASH, the password as DEV_VERIFY_PASSWORD
    node --env-file=.env.local scripts/dev-verify-seed.mjs            # dry run
    node --env-file=.env.local scripts/dev-verify-seed.mjs --apply    # creates or patches member-dev-verify

Kill switch: set `disabled: true` on `member-dev-verify` in Studio; the seed script never
touches that field, so rotating afterwards keeps it disabled. Rotate: new hash, re-run
`--apply`, update `DEV_VERIFY_PASSWORD`, delete the storage state.

## Verified runs

(Filled in by Task 8.)
```

- [ ] **Step 2: Add the `docs/SECRETS.md` entries**

Append, following the file's existing entry shape (Name / platforms / purpose / where it came from / how to rotate / blast radius):

```markdown
## `DEV_VERIFY_EMAIL`, `DEV_VERIFY_PASSWORD`, `DEV_VERIFY_PASSWORD_HASH`

- **Needed on:** local `.env.local` only. **Not needed on:** Vercel (any environment), CI, the mobile build.
- **Purpose:** `scripts/dev-verify.ts` signs in to dev as the «Verificador (bot)» member
  (`member-dev-verify`, role `admin`, retired from worship, kids manager only). Without `EMAIL`/`PASSWORD`
  the runner refuses (exit 2). `PASSWORD_HASH` is read only by `scripts/dev-verify-seed.mjs`.
- **Where it came from:** the password is chosen by Frank; the hash is generated locally with
  `bcryptjs` (see `docs/DEV_VERIFY.md`). The email is any address Frank controls; it is never mailed.
- **Rotate:** generate a new hash → run the seed with `--apply` → update `DEV_VERIFY_PASSWORD`
  in `.env.local` → delete `playwright/.dev-verify-storageState.json`.
- **Blast radius of rotation:** the runner fails to sign in between the seed and the env update.
  Nothing else uses the member. **Kill switch:** `disabled: true` on the member in Studio.
- **Exposure:** this is an `admin` credential on the production dataset. A leaked `.env.local`
  lets a human sign in to production as an admin; the runner's host check does not bind a human.
  Use an address with **no Google account**: Google SSO signs in by email lookup too, so a Google
  identity on `DEV_VERIFY_EMAIL` would be a second door to the same admin.
- **Writes the sign-in causes:** one `loginEvent` document per credentials sign-in (bounded by
  the cached session; accepted by Frank 2026-09-01). The `lastSeen` heartbeat is suppressed.

## `SR_VERIFY_BYPASS_SECRET`

- **Needed on:** local `.env.local` (A3 harness and `scripts/dev-verify.ts`). **Not needed on:**
  Vercel — Vercel holds its own copy as the project's Protection Bypass for Automation.
- **Purpose:** passes Vercel SSO protection on preview deployments, sent only as the
  `x-vercel-protection-bypass` header. Without it both tools refuse.
- **Where it came from:** Vercel → project `owt-backstage` → Settings → Deployment Protection →
  Protection Bypass for Automation.
- **Rotate:** regenerate in that Vercel screen (the old value stops working immediately) → update
  `.env.local`.
- **Blast radius of rotation:** every local A3 and dev-verify run fails until `.env.local` is
  updated. Deployments themselves are unaffected.
```

- [ ] **Step 3: Write the ADR**

```markdown
# ADR-00NN: Agent verification on dev uses a local read-only runner, not a server login path

**Status:** accepted 2026-09-01

## Context

Every app surface is session-gated and dev sits behind Vercel SSO. Agents may not enter
credentials. ADR-0017 solved this for one page by making it public; that does not scale to
`/admin`. The A3 harness signs in from env credentials but refuses dev by design (dev is the
production dataset).

## Decision

`scripts/dev-verify.ts`: a local Playwright runner that signs in as a dedicated retired
`admin` member with credentials from `.env.local`, caches the session in a gitignored
storage state, and aborts every non-GET request in the browser. No server code changes.

## Alternatives rejected

- **A server-minted verification session (token route).** New auth boundary, new production
  secret, critical review, and exactly what ADR-0017 declined.
- **Frank's own account.** Super-admin credential on disk; login events attributed to a person.
- **Fixed smoke specs only.** Cannot answer "look at what I just built"; may be layered on later.

## Consequences

An `admin` credential lives in a local env file (see `docs/SECRETS.md`, kill switch
`disabled: true`, which the seed script preserves across rotations). Each sign-in writes one
`loginEvent`; the `lastSeen` heartbeat is suppressed client-side. The member is a worship
member (retired) and a kids manager only, because kids reads ignore `retiredFrom`. `visual-verifier` may consume the runner's artifacts for gated routes but
still never enters a credential. The block is wider than the spec's `/api/**` — every
non-GET to the target — because server actions POST to page URLs.
```

- [ ] **Step 4: `CLAUDE.md` bullet** (under "Vercel safety", after the push-order bullet)

```markdown
- **Agents can now look at dev.** `scripts/dev-verify.ts` (see `docs/DEV_VERIFY.md`) observes
  `dev-owt-backstage` read-only as the «Verificador (bot)» member — screenshots, text, a11y
  tree, console. Use it for the human-eyes step of the push order when the change is visual;
  it never writes, and it still is not a substitute for Frank's own look at a release.
```

- [ ] **Step 5: `visual-verifier.md`** — after the sentence "Working around an auth wall is never part of this job.", add:

```markdown
The one sanctioned route to a gated page is `scripts/dev-verify.ts` (`docs/DEV_VERIFY.md`):
if the coordinator ran it, read its artifacts (screenshot, text, a11y, report) as your
starting state and cite the report's `observedDeployment`. You still never run the sign-in
yourself and never touch `.env.local`.
```

- [ ] **Step 6: Gates and commit**

Run: `npx tsc --noEmit && npm test && npx eslint .`
Expected: clean, 0 eslint errors.

```bash
git add docs/DEV_VERIFY.md docs/SECRETS.md docs/adr/00NN-*.md CLAUDE.md
git commit -m "docs(dev-verify): runner guide, secrets entries, ADR, agent charter note"
```

(`~/.claude/agents/visual-verifier.md` is outside the repo; edit it, but it is not part of the commit.)

---

### Task 8: Manual verification runs (needs the seeded member)

**Precondition (Frank, not the agent):** `DEV_VERIFY_EMAIL`, `DEV_VERIFY_PASSWORD`,
`DEV_VERIFY_PASSWORD_HASH`, `SR_VERIFY_BYPASS_SECRET` in `.env.local`, and
`scripts/dev-verify-seed.mjs --apply` run once.

**Files:**
- Modify: `docs/DEV_VERIFY.md` "Verified runs" section

- [ ] **Step 1: (a) Signed-in render**

Run: `npx tsx --env-file=.env.local scripts/dev-verify.ts --route /admin --screenshot admin.png --text --console --json`
Expected: exit 0; `status` 200; `artifacts.screenshot` exists; the text artifact contains `Servicios`; `blockedMutations` empty. Open the PNG with `Read` and confirm the Servicios panel is rendered (not the sign-in page).

- [ ] **Step 2: (b) Read-only lock with a real destructive control**

Run: `npx tsx --env-file=.env.local scripts/dev-verify.ts --route /admin --click "Eliminar servicio" --click "Eliminar" --screenshot blocked.png --json`
Expected: exit 3; `blockedMutations` contains one entry with `method: "DELETE"` and a URL under `/api/admin/roles/`; the screenshot shows the delete modal with an error state ("Error de conexión." is the panel's wording for a fetch that threw). Then confirm in the app (Frank, or `get_deployment` plus a `--route /admin --text` run) that the service still exists.

If no card exposes a button named exactly "Eliminar servicio", read the a11y tree (`--a11y`) and use the actual accessible name; record the names used.

- [ ] **Step 3: (c) Production refusal without network**

Run: `npx tsx --env-file=.env.local scripts/dev-verify.ts --route /admin --base-url https://owt-backstage.vercel.app --console --json`
Expected: exit 2, `refusal: "host:forbidden_production"`, `failedRequests` and `consoleErrors` empty (no browser ever launched).

- [ ] **Step 4: Record and commit**

Replace "(Filled in by Task 8.)" in `docs/DEV_VERIFY.md` with a dated list of the three runs: command, exit code, `observedDeployment`, the alias SHA from `get_deployment` at that moment, and the artifact names. No secret values, no storage-state path contents.

```bash
git add docs/DEV_VERIFY.md
git commit -m "docs(dev-verify): record the three verification runs"
```

---

## Self-review against the spec

- §1–2 (no server change, read-only only): Global Constraints; no task touches `app/`.
- §3.1 member: Task 6 (`buildVerifierDoc`, deterministic id, `retiredFrom`, notif prefs off, no `memberType`).
- §3.2 secrets: Task 7 Step 2 (four entries, `SR_VERIFY_BYPASS_SECRET` newly documented).
- §3.3 cached session + leak scan: Task 5 (storage state path, `assertNoLeak` before emit), Task 4 (redaction), `.gitignore` line.
- §3.4 threat model: Task 7 (SECRETS "Exposure" line, ADR consequences).
- §4 locks 1–3: Task 2 + Task 5 context-wide route handler (lock 1, widened to all non-GET; heartbeat suppressed via `addInitScript`; landed-origin refusal after every navigation and click); Task 1 (lock 2); Task 6 (lock 3, worship-only membership because kids reads ignore `retiredFrom`).
- Disclosed writes: `loginEvent` per sign-in (accepted by Frank) and the suppressed `lastSeen` heartbeat — Global Constraints, Task 7 (`DEV_VERIFY.md`, SECRETS, ADR).
- Kill switch survives rotation: Task 6 patches an existing document and never carries `disabled`.
- §5 interface and exit codes: Task 3 (flags), Task 4 (`decideExitCode`), Task 5 (`observedDeployment` from `x-vercel-id`).
- §6 shape: Tasks 1–6 match the module list; `.ts` runner via `tsx`.
- §7 verification: unit tests in Tasks 1–4 and 6; manual (a)(b)(c) in Task 8.
- §8 docs: Task 7 (all five artifacts).
- §9: Chromium already installed (`~/Library/Caches/ms-playwright/chromium-1234` present 2026-09-01); `DEV_VERIFY.md` need not add an install step, but the ADR/guide may mention `npx playwright install chromium` for a fresh machine.

Type consistency checked: `ParsedArgs`, `RunReport`, `BlockedMutation`, `Phase`, `TargetDecision`, `RequestDecision`, `VerifierDoc` are each defined once and consumed by name in Task 5/6.

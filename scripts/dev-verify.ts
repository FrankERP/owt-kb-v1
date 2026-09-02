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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

import { initialNavigationHeaders, resolveBypassSecret } from "../e2e/service-readiness/lib/bypass";
import { isArgsError, parseArgs, type ParsedArgs } from "./lib/dev-verify/args";
import { resolveTarget } from "./lib/dev-verify/hostPolicy";
import { decideRequest, type Phase } from "./lib/dev-verify/mutationPolicy";
import { PING_KEY } from "./lib/dev-verify/pingKey";
import { assertNoLeak, decideExitCode, formatHuman, redactReport, type RunReport } from "./lib/dev-verify/report";

const STORAGE_STATE = path.resolve("playwright/.dev-verify-storageState.json");
const OUT_DIR = path.resolve(process.env.DEV_VERIFY_OUT_DIR ?? "test-results/dev-verify");
const SIGNIN_PATH = "/auth/signin";

let SECRETS: (string | null)[] = [];

/**
 * Every exit goes through redaction and the leak proof, refusals included.
 * The storage state file — a live session, written by `signIn` — is scanned here
 * too, alongside the report, so a refusal that fires AFTER sign-in wrote it (e.g.
 * `host:landed_off_origin` on a later navigation) still proves the file clean; an
 * `if (existsSync(...))` further down that only ran on the success path would miss
 * exactly those refusal exits.
 */
function emit(report: RunReport, json: boolean): void {
  const final = redactReport(report, SECRETS);
  final.exitCode = decideExitCode(final);
  const texts = [{ source: "report", text: JSON.stringify(final) }];
  if (existsSync(STORAGE_STATE)) texts.push({ source: "storageState", text: readFileSync(STORAGE_STATE, "utf8") });
  assertNoLeak(texts, SECRETS);
  // Synchronous: process.stdout.write can be asynchronous on a pipe, and the
  // process.exit() every caller of emit performs right after can truncate the
  // report before it flushes. writeSync(1, ...) blocks until the write lands.
  writeSync(1, (json ? JSON.stringify(final, null, 2) : formatHuman(final)) + "\n");
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
    // NO extraHTTPHeaders: Playwright sends those with EVERY request, including
    // cdn.sanity.io and vercel.com. The bypass header is injected per request, for
    // the target origin only, inside the route handler below.
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
    origin: "", route: args.route, observedDeployment: null, status: null, landedUrl: null,
    theme: args.theme ?? "light", artifacts: {},
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

  /** Pathname check, not a substring match: a route like /admin/auth/signin-log must not read as sign-in. */
  const isSignInUrl = (page: Page): boolean => {
    try { return new URL(page.url()).pathname.startsWith(SIGNIN_PATH); } catch { return false; }
  };

  mkdirSync(OUT_DIR, { recursive: true });
  let phase: Phase = "observe";
  let firstNavigation = true;

  const attachContext = async (context: BrowserContext): Promise<void> => {
    // Context-wide, awaited: covers popups and any page the context opens later.
    await context.route("**/*", async (route) => {
      const req = route.request();
      let origin = "";
      try { origin = new URL(req.url()).origin; } catch { origin = ""; }
      if (origin !== target.origin) return route.continue(); // third-party: untouched, and NO bypass header
      const decision = decideRequest({ method: req.method(), url: req.url(), phase });
      if (decision.action === "allow") {
        // Bypass header only on the first navigation of a context, only for the
        // target origin — the A3 harness's own model (e2e/service-readiness/lib/bypass.ts).
        // After that we attach nothing and rely on the bypass cookie Vercel set in
        // response to x-vercel-set-bypass-cookie: a header re-attached on every request
        // would ride along on a cross-origin redirect too, which the cookie does not.
        if (firstNavigation) {
          firstNavigation = false;
          return route.continue({ headers: { ...req.headers(), ...initialNavigationHeaders(bypass) } });
        }
        return route.continue();
      }
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
    firstNavigation = true;
    const signinResponse = await page.goto(SIGNIN_PATH, { waitUntil: "networkidle" });
    assertOnOrigin(page);
    // A wrong or rotated bypass value can answer 401 ON origin; that is a refusal, not a "page error".
    if ((signinResponse?.status() ?? 0) >= 400) refuse(report, `signin:HTTP ${signinResponse?.status()} on ${SIGNIN_PATH}`, args.json);
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

  let context: BrowserContext | undefined;
  try {
    context = await newContext(target.origin, args, bypass, true);
    await attachContext(context);
    let page = await context.newPage();
    attach(page);
    let response = await page.goto(args.route, { waitUntil: "networkidle" });
    assertOnOrigin(page); // an SSO wall on vercel.com is refused here, before any sign-in attempt
    // Only a redirect to the sign-in page triggers a sign-in. NOT a 401: a CRON_SECRET-gated
    // route answers 401 to a browser, and re-signing-in on that would write a loginEvent per
    // run, exceeding the once-per-session bound Frank accepted.
    if (isSignInUrl(page)) {
      await context.browser()?.close();
      context = await signIn();
      page = await context.newPage();
      attach(page);
      response = await page.goto(args.route, { waitUntil: "networkidle" });
      assertOnOrigin(page);
      if (isSignInUrl(page)) refuse(report, "signin:session not accepted", args.json);
    }
    report.status = response?.status() ?? null;
    report.observedDeployment = response?.headers()["x-vercel-id"] ?? null;

    // An on-origin 401/403 on the OBSERVED route (e.g. a rotated bypass secret
    // answering in place, never redirecting to /auth/signin) is a refusal, not a
    // green run with a bad status. Other 4xx (404, …) stay ordinary observations.
    if (report.status === 401 || report.status === 403) {
      refuse(report, `auth:HTTP ${report.status} on ${args.route}`, args.json);
    }

    if (args.waitFor) await page.getByText(args.waitFor).first().waitFor({ timeout: 30_000 }).catch(() => report.pageErrors.push(`wait:${args.waitFor} not visible`));
    for (const name of args.clicks) {
      const el = page.getByRole("button", { name }).or(page.getByRole("link", { name })).first();
      await el.click({ timeout: 10_000 }).catch(() => report.pageErrors.push(`click:${name} not found`));
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

    report.landedUrl = page.url();
    const landedPath = (() => { try { return new URL(report.landedUrl!).pathname; } catch { return null; } })();
    const routePath = (() => { try { return new URL(args.route, target.origin).pathname; } catch { return args.route; } })();
    // An in-origin redirect (e.g. /admin → /) is not the refusal that
    // assertOnOrigin catches — same origin, different page — so it must still
    // surface as a page error rather than a silently green run.
    if (landedPath !== null && landedPath !== routePath) {
      report.pageErrors.push(`redirected:${args.route} → ${landedPath}`);
    }
  } catch (err) {
    // A thrown Playwright/Node error (timeout, navigation failure, …) must still go
    // through `emit`: redaction, the leak scan, and exit-code precedence (a
    // `blockedMutations` entry recorded before the throw must still win as exit 3
    // over this becoming exit 4). Record it as a page error and fall through.
    report.pageErrors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await context?.browser()?.close().catch(() => undefined);
  }

  // Redaction proof on the artifact files the runner wrote (screenshots excluded —
  // binary, and the report/storage-state proof already covers text). The storage
  // state scan itself now lives in `emit`, which every exit path — this one and
  // every `refuse()` — routes through.
  const texts = Object.values(report.artifacts).filter((f): f is string => !!f && !f.endsWith(".png"))
    .map((f) => ({ source: path.basename(f), text: readFileSync(f, "utf8") }));
  assertNoLeak(texts, SECRETS);
  emit(report, args.json);
  process.exit(decideExitCode(report));
}

main().catch((err) => {
  // Last resort only: nothing before `report` exists in `main` should throw in
  // practice (arg parsing is pure), but if it somehow does, there is no report to
  // redact or scan yet — so plain stderr is the only option here.
  process.stderr.write(`dev-verify: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(4);
});

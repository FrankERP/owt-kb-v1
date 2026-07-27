// Service Readiness A3 §4 — the Playwright fixtures every scenario builds on.
//
// What the fixtures guarantee, so no individual spec has to remember it:
//
//   · `run`        the run identity, and an evidence writer that never records a secret
//   · `freshData`  deterministic fixtures are reset BEFORE the scenario, under the
//                  live dataset lease
//   · `admin`      a real credentials sign-in as the seeded verification administrator,
//                  performed through the DEPLOYED sign-in page (never an imported
//                  handler), carrying the run-ownership headers so the resulting
//                  `loginEvent` is deletable by exact id
//   · `member`     the same, as an ordinary seeded member (for authorization rejection)
//   · `anon`       an unauthenticated request context, bypass header supplied explicitly
//
// Deployment Protection: the browser context carries the bypass secret as a HEADER
// on every request AND asks the provider for a bypass COOKIE on the initial
// navigation, so redirects, assets, NextAuth's own redirect hops and client `fetch`
// calls are all authorized on the same exact deployment host. `page.request` shares
// that context's cookies and headers, which is why the scenarios can call the
// deployed API routes directly while still being a real signed-in browser session.
//
// The secret is never put in a URL, never asserted on, and never written to any
// artifact; `globalTeardown` proves that over the retained output.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { test as base, expect, request as playwrightRequest } from "@playwright/test";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

import { bypassHeaders, initialNavigationHeaders, resolveBypassSecret } from "./lib/bypass";
import { recordCreatedDocument } from "./lib/createdDocs";
import { assertLeaseOwned, resetFixtures } from "./lib/dataset";
import { fetchOwnedLoginEvents } from "./lib/loginEvents";
import {
  ADMIN_EMAIL_ENV,
  ADMIN_PASSWORD_ENV,
  MEMBER_EMAIL_ENV,
  MEMBER_PASSWORD_ENV,
} from "./lib/harnessGuards";
import {
  AttemptLedger,
  fileAttemptStore,
  reconcileLoginEvents,
  verificationHeaders,
  type RunIdentity,
} from "./lib/runIdentity";
import { RUN_EVIDENCE_FILE } from "./lib/runState";

/* ------------------------------------------------------------------ *
 * Run context
 * ------------------------------------------------------------------ */

export interface RunContext {
  identity: RunIdentity;
  ledger: AttemptLedger;
  /**
   * Append one structured evidence line. Callers pass non-secret fields only; the
   * run id is added here so every line is run-scoped.
   */
  evidence(event: string, fields?: Record<string, unknown>): void;
  /**
   * Record a document a DEPLOYED route just created, so it can be removed by EXACT
   * id. Server-generated ids are not covered by the deterministic fixture allowlist,
   * and a discovery query is never an acceptable substitute — so a spec that creates
   * something must say so here, and the reset/teardown deletes exactly what was said.
   */
  recordCreated(id: string, context?: string): void;
}

function makeRunContext(): RunContext {
  const identity: RunIdentity = {
    runId: process.env.SR_VERIFY_RUN_ID as string,
    candidateSha: process.env.SR_VERIFY_CANDIDATE_SHA as string,
    deploymentId: process.env.SR_VERIFY_DEPLOYMENT_ID as string,
  };
  const path = resolve(process.cwd(), RUN_EVIDENCE_FILE);
  mkdirSync(dirname(path), { recursive: true });
  const context: RunContext = {
    identity,
    // RUN-scoped, not test-scoped. `fetchOwnedLoginEvents` matches on
    // runId+candidateSha+deploymentId, so it returns every event this RUN created —
    // including earlier scenarios'. A fresh per-test ledger would therefore report
    // each of those as `unexpected_attempt`.
    ledger: new AttemptLedger(fileAttemptStore(identity.runId)),
    evidence(event, fields = {}) {
      appendFileSync(
        path,
        `${JSON.stringify({ event, runId: identity.runId, deploymentId: identity.deploymentId, at: new Date().toISOString(), ...fields })}\n`,
        "utf8",
      );
    },
    recordCreated(id, label = "deployed-route-create") {
      recordCreatedDocument(id, label);
      context.evidence("run_created_document", { id, context: label });
    },
  };
  return context;
}

/* ------------------------------------------------------------------ *
 * Signed-in session
 * ------------------------------------------------------------------ */

export interface Session {
  context: BrowserContext;
  page: Page;
  /** Shares the browser context's cookies AND its bypass header. */
  api: APIRequestContext;
  attemptId: string;
  email: string;
}

/**
 * Sign in through the REAL deployed credentials flow.
 *
 * A fresh browser context per session, so `storageState` is only ever in memory —
 * it is never written to disk and therefore never published or committed.
 */
async function signIn({
  browser,
  run,
  email,
  password,
}: {
  browser: import("@playwright/test").Browser;
  run: RunContext;
  email: string;
  password: string;
}): Promise<Session> {
  const { secret } = resolveBypassSecret(process.env);
  const attemptId = run.ledger.next();

  const context = await browser.newContext({
    extraHTTPHeaders: {
      ...bypassHeaders(secret),
      ...verificationHeaders(run.identity, attemptId),
    },
  });
  const page = await context.newPage();

  // Surface anything the page logs into the run's evidence, so a `delivery_attempt`
  // that reaches the client is captured rather than lost.
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("delivery_attempt") || text.includes("delivery_blocked")) {
      run.evidence("browser_console", { level: msg.type(), text });
    }
  });

  // INITIAL navigation: ask the provider for the bypass cookie. Playwright merges
  // page-level extra headers over the context's, so the run-ownership headers stay.
  await page.setExtraHTTPHeaders({
    ...initialNavigationHeaders(secret),
    ...verificationHeaders(run.identity, attemptId),
  });
  const response = await page.goto("/auth/signin", { waitUntil: "domcontentloaded" });

  // The redirect chain must stay on the exact recorded deployment host.
  const landedHost = new URL(page.url()).hostname;
  const expectedHost = new URL(process.env.SR_VERIFY_BASE_URL as string).hostname;
  expect(
    landedHost,
    "the initial navigation must stay on the exact recorded deployment host",
  ).toBe(expectedHost);
  expect(response?.status(), "the sign-in page must be reachable with the bypass").toBeLessThan(400);

  // Drop `x-vercel-set-bypass-cookie` now that the cookie is held by the context;
  // the bypass header itself stays for requests that race the cookie.
  await page.setExtraHTTPHeaders({
    ...bypassHeaders(secret),
    ...verificationHeaders(run.identity, attemptId),
  });

  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), { timeout: 60_000 }),
    page.getByRole("button", { name: "Iniciar sesión" }).click(),
  ]);

  run.evidence("verification_sign_in", { attemptId, email });

  return { context, page, api: page.request, attemptId, email };
}

/**
 * Reconcile the login events this run has created so far against the attempt ids it
 * actually used. Called after every awaited sign-in: a missing, duplicate, foreign or
 * late event fails the scenario immediately rather than at teardown.
 */
export async function reconcileRunLoginEvents(run: RunContext): Promise<void> {
  await assertLeaseOwned(run.identity);
  const events = await fetchOwnedLoginEvents(run.identity);
  const verdict = reconcileLoginEvents({
    events,
    identity: run.identity,
    expectedAttemptIds: run.ledger.expected(),
  });
  for (const id of verdict.matchedIds) {
    run.evidence("verification_login_event_reconciled", { eventId: id });
  }
  expect(
    verdict.failures,
    `run-owned login events did not reconcile: ${verdict.failures
      .map((f) => `${f.code}(attempt=${f.attemptId ?? "-"}, event=${f.eventId ?? "-"})`)
      .join(", ")}`,
  ).toEqual([]);
}

/* ------------------------------------------------------------------ *
 * The fixtures
 * ------------------------------------------------------------------ */

interface SrFixtures {
  run: RunContext;
  /** Auto-fixture: resets deterministic fixtures before the scenario. */
  freshData: void;
  admin: Session;
  member: Session;
  anon: APIRequestContext;
}

export const test = base.extend<SrFixtures>({
  run: async ({}, use) => {
    await use(makeRunContext());
  },

  freshData: [
    async ({ run }, use) => {
      // Every scenario starts from byte-identical deterministic state, under the
      // live lease. A scenario that mutated a fixture cannot leak into the next one.
      const reset = await resetFixtures(run.identity);
      run.evidence("fixtures_reset", {
        fixtures: reset.fixtures.length,
        runCreated: reset.runCreated.length,
      });
      await use();
    },
    { auto: true },
  ],

  admin: async ({ browser, run, freshData }, use) => {
    void freshData;
    const email = process.env[ADMIN_EMAIL_ENV] as string;
    const password = process.env[ADMIN_PASSWORD_ENV] as string;
    const session = await signIn({ browser, run, email, password });
    await reconcileRunLoginEvents(run);
    await use(session);
    await session.context.close();
  },

  member: async ({ browser, run, freshData }, use) => {
    void freshData;
    const email = process.env[MEMBER_EMAIL_ENV] as string;
    const password = process.env[MEMBER_PASSWORD_ENV] as string;
    const session = await signIn({ browser, run, email, password });
    await reconcileRunLoginEvents(run);
    await use(session);
    await session.context.close();
  },

  anon: async ({}, use) => {
    // No session cookie at all — but the bypass header IS supplied explicitly,
    // because a separate APIRequestContext inherits no bypass cookie. Otherwise the
    // "unauthenticated caller is rejected" assertion would be satisfied by
    // Deployment Protection rather than by the app's own authorization.
    const { secret } = resolveBypassSecret(process.env);
    const ctx = await playwrightRequest.newContext({
      baseURL: process.env.SR_VERIFY_BASE_URL,
      extraHTTPHeaders: bypassHeaders(secret),
    });
    await use(ctx);
    await ctx.dispose();
  },
});

export { expect };

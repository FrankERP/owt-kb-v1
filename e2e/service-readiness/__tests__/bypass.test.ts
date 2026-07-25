// Offline proof of the A3 §3 bypass contract and the redaction assertion.
//
// Four claims, each with a test:
//   1. the secret comes from the runner's OWN variable and from nothing else — in
//      particular never from Vercel's managed `VERCEL_AUTOMATION_BYPASS_SECRET`;
//   2. it travels as a header, and `x-vercel-set-bypass-cookie` is an
//      initial-navigation-only header;
//   3. a planted secret in a retained report FAILS the redaction assertion;
//   4. a bypass QUERY PARAMETER fails it too, even when the value beside it is
//      redacted — the plan forbids the shape, not merely the disclosure.

import { describe, expect, it } from "vitest";

import {
  BYPASS_HEADER,
  FORBIDDEN_BYPASS_QUERY_PARAMS,
  SET_BYPASS_COOKIE_HEADER,
  bypassHeaders,
  initialNavigationHeaders,
  resolveBypassSecret,
  scanForSecretLeak,
  summarizeLeaks,
} from "../lib/bypass";
import { BYPASS_SECRET_ENV, PROVIDER_MANAGED_BYPASS_ENV } from "../lib/harnessGuards";

const SECRET = "s3cret-runner-side-bypass-value";

describe("bypass secret resolution", () => {
  it("reads the secret ONLY from the runner's own variable", () => {
    expect(resolveBypassSecret({ [BYPASS_SECRET_ENV]: SECRET })).toEqual({
      secret: SECRET,
      reason: "present",
    });
    expect(resolveBypassSecret({ [BYPASS_SECRET_ENV]: "   " }).secret).toBeNull();
    expect(resolveBypassSecret({}).reason).toBe("absent");
  });

  it("NEVER consumes Vercel's managed bypass variable, even when it is visible", () => {
    const result = resolveBypassSecret({ [PROVIDER_MANAGED_BYPASS_ENV]: "provider-managed" });
    expect(result.secret).toBeNull();
    expect(result.reason).toBe("provider_managed_only");
    // And it is not silently used as a fallback when the runner's own is blank.
    expect(
      resolveBypassSecret({
        [BYPASS_SECRET_ENV]: "",
        [PROVIDER_MANAGED_BYPASS_ENV]: "provider-managed",
      }).secret,
    ).toBeNull();
  });
});

describe("bypass headers", () => {
  it("sends the secret as a header, never as anything else", () => {
    expect(bypassHeaders(SECRET)).toEqual({ [BYPASS_HEADER]: SECRET });
    expect(bypassHeaders(null)).toEqual({});
  });

  it("asks for the bypass COOKIE only on the initial navigation", () => {
    expect(initialNavigationHeaders(SECRET)).toEqual({
      [BYPASS_HEADER]: SECRET,
      [SET_BYPASS_COOKIE_HEADER]: "true",
    });
    // The steady-state headers do NOT keep requesting a new cookie.
    expect(Object.keys(bypassHeaders(SECRET))).not.toContain(SET_BYPASS_COOKIE_HEADER);
    expect(initialNavigationHeaders(null)).toEqual({});
  });
});

describe("redaction assertion", () => {
  it("catches a planted secret in a retained report fixture", () => {
    // The exact failure mode the plan wants proven: a trace/report that recorded the
    // header value.
    const plantedReport = JSON.stringify({
      suites: [
        {
          title: "role create",
          requests: [
            { url: "https://example-deploy.vercel.app/api/admin/roles", headers: { [BYPASS_HEADER]: SECRET } },
          ],
        },
      ],
    });

    const leaks = scanForSecretLeak("playwright-report/index.html", plantedReport, SECRET);
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks[0].kind).toBe("secret_value");

    const summary = summarizeLeaks(leaks);
    expect(summary.ok).toBe(false);
    expect(summary.message).toContain("failed the A3 redaction assertion");
    // The leak REPORT must not itself echo the secret.
    expect(summary.message).not.toContain(SECRET);
    expect(leaks.every((l) => !l.detail.includes(SECRET))).toBe(true);
  });

  it("catches a URL-encoded secret too", () => {
    const secret = "a secret/with+special=chars";
    const text = `https://example.test/x?token=${encodeURIComponent(secret)}`;
    expect(scanForSecretLeak("test-results/trace.json", text, secret).length).toBeGreaterThan(0);
  });

  it("catches a bypass QUERY PARAMETER even when the value is redacted", () => {
    for (const param of FORBIDDEN_BYPASS_QUERY_PARAMS) {
      const redacted = `https://example-deploy.vercel.app/admin?${param}=%5BREDACTED%5D`;
      const leaks = scanForSecretLeak("test-results/results.json", redacted, SECRET);
      expect(leaks.map((l) => l.kind), param).toContain("bypass_query_param");
    }
    // Also in an `&`-joined position, and percent-encoded.
    expect(
      scanForSecretLeak(
        "x",
        "https://e.test/a?foo=1&x-vercel-protection-bypass=zzz",
        null,
      ).map((l) => l.kind),
    ).toContain("bypass_query_param");
    expect(
      scanForSecretLeak("x", "https://e.test/a?x-vercel-protection-bypass%3Dzzz", null).map(
        (l) => l.kind,
      ),
    ).toContain("bypass_query_param");
  });

  it("passes clean output, including output that merely names the HEADER", () => {
    const clean = JSON.stringify({
      requests: [{ url: "https://example-deploy.vercel.app/api/me", headers: { [BYPASS_HEADER]: "[redacted]" } }],
    });
    expect(scanForSecretLeak("playwright-report/index.html", clean, SECRET)).toEqual([]);
    expect(summarizeLeaks([]).ok).toBe(true);
    expect(summarizeLeaks([]).message).toContain("redaction verified");
  });

  it("does not crash or over-report when no secret was configured", () => {
    expect(scanForSecretLeak("x", "totally ordinary output", null)).toEqual([]);
    expect(scanForSecretLeak("x", "totally ordinary output", "")).toEqual([]);
  });
});

// app/appAuth/__tests__/preflight.test.ts — kill switch, host, secret, in that order.
import { describe, expect, it } from "vitest";
import { appAudienceFor, appPreflight, loadAppSecret } from "../preflight";

const SECRET = "x".repeat(32);
const req = (host: string | null) => ({ headers: new Headers(host === null ? {} : { host }) });

describe("appPreflight", () => {
  it("answers 503 to the kill switch before anything else", () => {
    expect(appPreflight(req("evil.example"), { APP_AUTH_DISABLED: "1" })).toEqual({ ok: false, status: 503 });
    expect(appPreflight(req("localhost:3000"), { APP_AUTH_DISABLED: "yes", APP_AUTH_SECRET: SECRET })).toEqual({ ok: false, status: 503 });
  });

  it("answers 404 to a host that is not this deployment's", () => {
    expect(appPreflight(req("evil.example"), { APP_AUTH_SECRET: SECRET })).toEqual({ ok: false, status: 404 });
    expect(appPreflight(req(null), { APP_AUTH_SECRET: SECRET })).toEqual({ ok: false, status: 404 });
    expect(appPreflight(req("dev-owt-backstage.vercel.app"), { VERCEL_ENV: "production", APP_AUTH_SECRET: SECRET })).toEqual({ ok: false, status: 404 });
    expect(appPreflight(req("owt-backstage.vercel.app"), { VERCEL_ENV: "staging", APP_AUTH_SECRET: SECRET })).toEqual({ ok: false, status: 404 });
  });

  it("fails closed (503) without a usable APP_AUTH_SECRET — never the MCP one", () => {
    expect(appPreflight(req("localhost:3000"), {})).toEqual({ ok: false, status: 503 });
    expect(appPreflight(req("localhost:3000"), { APP_AUTH_SECRET: "short" })).toEqual({ ok: false, status: 503 });
    expect(appPreflight(req("localhost:3000"), { MCP_OAUTH_SECRET: SECRET })).toEqual({ ok: false, status: 503 });
  });

  it("returns the canonical origin and the key", () => {
    const res = appPreflight(req("owt-backstage.vercel.app"), { VERCEL_ENV: "production", APP_AUTH_SECRET: SECRET });
    expect(res.ok && res.origin).toBe("https://owt-backstage.vercel.app");
    expect(res.ok && Buffer.from(res.key).toString()).toBe(SECRET);
    expect(loadAppSecret({ APP_AUTH_SECRET: SECRET })).toMatchObject({ ok: true });
    expect(appAudienceFor("https://owt-backstage.vercel.app")).toBe("https://owt-backstage.vercel.app/api/app");
  });
});

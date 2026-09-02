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

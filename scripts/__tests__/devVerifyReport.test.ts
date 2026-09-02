import { describe, expect, it } from "vitest";
import { assertNoLeak, decideExitCode, formatHuman, redactReport, type RunReport } from "../lib/dev-verify/report";

function base(over: Partial<RunReport> = {}): RunReport {
  return {
    origin: "https://dev-owt-backstage.vercel.app", route: "/admin", observedDeployment: "iad1::abc",
    status: 200, landedUrl: null, theme: "light", artifacts: {}, consoleErrors: [], failedRequests: [],
    blockedMutations: [], pageErrors: [],
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

  it("formatHuman reports a differing landed pathname, in the summary line and its own line", () => {
    const text = formatHuman(base({ landedUrl: "https://dev-owt-backstage.vercel.app/", pageErrors: ["redirected:/admin → /"], exitCode: 4 }));
    expect(text.split("\n")[0]).toBe(
      "dev-verify: exit 4 · https://dev-owt-backstage.vercel.app/admin · deployment iad1::abc · HTTP 200 · landed https://dev-owt-backstage.vercel.app/",
    );
    expect(text).toContain("landed https://dev-owt-backstage.vercel.app/");
  });

  it("formatHuman omits the landed suffix on the summary line when the landed URL matches the route", () => {
    const text = formatHuman(base({ landedUrl: "https://dev-owt-backstage.vercel.app/admin" }));
    expect(text.split("\n")[0]).toBe("dev-verify: exit 0 · https://dev-owt-backstage.vercel.app/admin · deployment iad1::abc · HTTP 200");
  });

  it("formatHuman always prints the effective theme", () => {
    expect(formatHuman(base({ theme: "dark" }))).toContain("theme dark");
    expect(formatHuman(base())).toContain("theme light");
  });
});

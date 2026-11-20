// app/appAuth/__tests__/authorizeRequest.test.ts — the app's authorize-request
// validator (spec §3.1): verify the client and its exact redirect first (an
// error page otherwise — never a redirect to an unverified target), then every
// other rule as an error redirect with `state` and `iss`.
import { describe, expect, it } from "vitest";
import { s256Challenge } from "@/app/mcp/oauth/pkce";
import {
  appAuthorizeFormFields,
  appAuthorizeSuccessLocation,
  validateAppAuthorizeRequest,
} from "../authorizeRequest";

const ORIGIN = "https://owt-backstage.vercel.app";
const REDIRECT = `${ORIGIN}/app/callback/ios`;
const CHALLENGE = s256Challenge("v".repeat(43));
const STATE = "s".repeat(32);

function params(over: Record<string, string | string[] | null> = {}): URLSearchParams {
  const base: Record<string, string | string[] | null> = {
    response_type: "code",
    client_id: "backstage-ios",
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: STATE,
    ...over,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v === null) continue;
    for (const one of Array.isArray(v) ? v : [v]) p.append(k, one);
  }
  return p;
}

function errorOf(res: ReturnType<typeof validateAppAuthorizeRequest>) {
  if (res.kind !== "error-redirect") throw new Error(`expected error-redirect, got ${res.kind}`);
  const url = new URL(res.location);
  return { error: url.searchParams.get("error"), state: url.searchParams.get("state"), iss: url.searchParams.get("iss"), base: url.origin + url.pathname };
}

describe("validateAppAuthorizeRequest", () => {
  it("renders a valid request", () => {
    const res = validateAppAuthorizeRequest(params(), ORIGIN);
    expect(res).toEqual({ kind: "render", request: { clientId: "backstage-ios", redirectUri: REDIRECT, codeChallenge: CHALLENGE, state: STATE } });
  });

  it("shows an error PAGE for an unknown, missing or repeated client", () => {
    for (const client_id of ["backstage-web", null, ["backstage-ios", "backstage-ios"]]) {
      expect(validateAppAuthorizeRequest(params({ client_id }), ORIGIN)).toEqual({ kind: "error-page", reason: "invalid_client" });
    }
  });

  it("shows an error PAGE for a redirect that is not exactly the client's", () => {
    for (const redirect_uri of [
      `${ORIGIN}/app/callback/android`,
      `${ORIGIN}/app/callback/ios?x=1`,
      "app.vercel.owt-backstage:/oauth/callback/ios",
      "https://evil.example/app/callback/ios",
      null,
      [REDIRECT, REDIRECT],
    ]) {
      expect(validateAppAuthorizeRequest(params({ redirect_uri }), ORIGIN)).toEqual({ kind: "error-page", reason: "invalid_redirect_uri" });
    }
  });

  it("accepts the private scheme on local only", () => {
    const local = "http://localhost:3000";
    const res = validateAppAuthorizeRequest(params({ redirect_uri: "app.vercel.owt-backstage:/oauth/callback/ios" }), local);
    expect(res.kind).toBe("render");
  });

  it("redirects every later error back with state and iss", () => {
    const cases: [Record<string, string | string[] | null>, string][] = [
      [{ response_type: null }, "invalid_request"],
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ code_challenge_method: null }, "invalid_request"],
      [{ code_challenge: null }, "invalid_request"],
      [{ code_challenge: "short" }, "invalid_request"],
      [{ scope: "openid" }, "invalid_scope"],
      [{ resource: `${ORIGIN}/api/app` }, "invalid_scope"],
      [{ code_challenge: [CHALLENGE, CHALLENGE] }, "invalid_request"],
    ];
    for (const [over, expected] of cases) {
      const e = errorOf(validateAppAuthorizeRequest(params(over), ORIGIN));
      expect(e).toEqual({ error: expected, state: STATE, iss: ORIGIN, base: REDIRECT });
    }
  });

  it("requires a state of 16–256 visible ASCII characters, sent once", () => {
    for (const state of [null, "short", "s".repeat(257), `${"s".repeat(20)} x`, `${"s".repeat(20)}ñ`]) {
      expect(errorOf(validateAppAuthorizeRequest(params({ state }), ORIGIN)).error).toBe("invalid_request");
    }
    const repeated = errorOf(validateAppAuthorizeRequest(params({ state: [STATE, STATE] }), ORIGIN));
    expect(repeated.error).toBe("invalid_request");
    expect(repeated.state).toBeNull();
    expect(validateAppAuthorizeRequest(params({ state: "s".repeat(16) }), ORIGIN).kind).toBe("render");
    expect(validateAppAuthorizeRequest(params({ state: "~".repeat(256) }), ORIGIN).kind).toBe("render");
  });

  it("ignores unknown parameters", () => {
    expect(validateAppAuthorizeRequest(params({ prompt: "login", foo: ["a", "b"] }), ORIGIN).kind).toBe("render");
  });

  it("round-trips through the form fields", () => {
    const res = validateAppAuthorizeRequest(params(), ORIGIN);
    if (res.kind !== "render") throw new Error("expected render");
    const again = validateAppAuthorizeRequest(new URLSearchParams(appAuthorizeFormFields(res.request)), ORIGIN);
    expect(again).toEqual(res);
  });

  it("builds the success redirect with code, state and iss, each encoded once", () => {
    const url = new URL(appAuthorizeSuccessLocation(REDIRECT, ORIGIN, "c.o+d=e", "st&ate~1234567890ab"));
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("code")).toBe("c.o+d=e");
    expect(url.searchParams.get("state")).toBe("st&ate~1234567890ab");
    expect(url.searchParams.get("iss")).toBe(ORIGIN);
  });
});

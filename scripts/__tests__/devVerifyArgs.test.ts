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

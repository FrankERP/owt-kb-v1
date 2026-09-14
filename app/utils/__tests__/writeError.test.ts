// The filter that decides whether a route's own words reach the admin.
//
// This file exists because the review proved the fix it guards could be deleted
// with a green suite: `writeErrorMessage` had no test, no component test drives a
// failing save, and stubbing its body to `return undefined` — which neuters the
// whole delivery's user-visible half — changed nothing the gates could see.
//
// The two halves being pinned: a short sentence from the route is SHOWN (the
// point), and anything else is refused so a caller falls back to its own copy (a
// stack trace or an HTML error page must never land in a toast).

import { describe, it, expect } from "vitest";
import { writeErrorMessage } from "../writeError";

function res(body: unknown, { json = true } = {}): Response {
  return {
    json: async () => {
      if (!json) throw new SyntaxError("Unexpected token < in JSON at position 0");
      return body;
    },
  } as unknown as Response;
}

describe("shows the route's message", () => {
  it("returns a short single-line error", async () => {
    await expect(
      writeErrorMessage(res({ error: "«Spotify» necesita una URL que empiece con http:// o https://" })),
    ).resolves.toBe("«Spotify» necesita una URL que empiece con http:// o https://");
  });

  it("trims it", async () => {
    await expect(writeErrorMessage(res({ error: "  Falta el título.  " }))).resolves.toBe("Falta el título.");
  });

  it("accepts a message right at the length limit", async () => {
    const at = "a".repeat(200);
    await expect(writeErrorMessage(res({ error: at }))).resolves.toBe(at);
  });
});

describe("refuses anything that is not a sentence", () => {
  it("a body that is not JSON — an HTML error page, an SSO redirect", async () => {
    await expect(writeErrorMessage(res(null, { json: false }))).resolves.toBeUndefined();
  });

  it("no error field, a null body, a non-string error", async () => {
    await expect(writeErrorMessage(res({}))).resolves.toBeUndefined();
    await expect(writeErrorMessage(res(null))).resolves.toBeUndefined();
    await expect(writeErrorMessage(res({ error: 123 }))).resolves.toBeUndefined();
    await expect(writeErrorMessage(res({ error: { message: "x" } }))).resolves.toBeUndefined();
  });

  it("an empty or whitespace-only string", async () => {
    await expect(writeErrorMessage(res({ error: "" }))).resolves.toBeUndefined();
    await expect(writeErrorMessage(res({ error: "   " }))).resolves.toBeUndefined();
  });

  it("anything longer than the limit", async () => {
    await expect(writeErrorMessage(res({ error: "a".repeat(201) }))).resolves.toBeUndefined();
  });

  it("a multi-line dump, however short", async () => {
    // A stack trace's first line reads like a sentence; the newline is the tell.
    await expect(writeErrorMessage(res({ error: "Error: boom\n  at f (x.ts:1:1)" }))).resolves.toBeUndefined();
  });
});

describe("the route's own worst case still fits", () => {
  it("a 60-char-capped label leaves the message well inside the limit", async () => {
    // `normalizeLinkRows` truncates the label at 60 so this can never be the
    // reason the admin falls back to «Error al actualizar.»
    const label = "x".repeat(60);
    const message = `«${label}…» necesita una URL que empiece con http:// o https://`;
    expect(message.length).toBeLessThanOrEqual(200);
    await expect(writeErrorMessage(res({ error: message }))).resolves.toBe(message);
  });
});

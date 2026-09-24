// app/mcp/oauth/__tests__/requestBody.test.ts
//
// The capped body reader and media-type check shared by the register, consent
// and token routes. The route suites pin each route's own cap and error body;
// these pin the mechanics once: a declared length over the cap is refused
// without touching the body, the bytes ACTUALLY read are capped even when
// `Content-Length` lies, and a media type is compared without its parameters.

import { describe, expect, it } from "vitest";

import { hasMediaType, readCappedBody } from "../requestBody";

const CAP = 64;

function bodyRequest(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("https://ignored.example/x", {
    method: "POST",
    headers,
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  } as RequestInit);
}

/** An endless stream of `chunkSize`-byte chunks that records how it was stopped. */
function endlessStream(chunkSize: number) {
  const seen = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulls += 1;
      controller.enqueue(new Uint8Array(chunkSize).fill(0x61));
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { stream, seen };
}

describe("readCappedBody — the declared Content-Length", () => {
  it("refuses a declared length over the cap without reading or locking the body", async () => {
    const request = bodyRequest("small", { "content-length": String(CAP + 1) });
    expect(await readCappedBody(request, CAP)).toEqual({ ok: false });
    expect(request.bodyUsed).toBe(false);
    expect(request.body!.locked).toBe(false);
  });

  it("a declared length AT the cap is read normally", async () => {
    const text = "x".repeat(CAP);
    const result = await readCappedBody(bodyRequest(text, { "content-length": String(CAP) }), CAP);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(new TextDecoder().decode(result.bytes)).toBe(text);
  });

  it("ignores a declared length that is not a number — the read cap still applies", async () => {
    const ok = await readCappedBody(bodyRequest("hello", { "content-length": "not-a-number" }), CAP);
    expect(ok.ok).toBe(true);
    const over = await readCappedBody(bodyRequest("x".repeat(CAP + 1), { "content-length": "nope" }), CAP);
    expect(over).toEqual({ ok: false });
  });
});

describe("readCappedBody — the bytes actually read", () => {
  it("refuses a body over the cap even when Content-Length claims it is small", async () => {
    const request = bodyRequest("x".repeat(CAP * 4), { "content-length": "10" });
    expect(await readCappedBody(request, CAP)).toEqual({ ok: false });
  });

  it("refuses a body over the cap with no Content-Length at all", async () => {
    expect(await readCappedBody(bodyRequest("x".repeat(CAP + 1)), CAP)).toEqual({ ok: false });
  });

  it("stops reading and cancels the stream once the cap is passed — an endless body cannot hang it", async () => {
    const { stream, seen } = endlessStream(16);
    const request = bodyRequest(stream, { "content-length": "1" });
    expect(await readCappedBody(request, CAP)).toEqual({ ok: false });
    expect(seen.cancelled).toBe(true);
    // 64 bytes fit in four 16-byte chunks; the fifth crosses the cap. A couple
    // of extra pulls are the stream's own read-ahead, never an unbounded read.
    expect(seen.pulls).toBeLessThanOrEqual(8);
  });

  it("returns every byte, in order, across several chunks up to exactly the cap", async () => {
    const parts = ["abc", "", "defgh", "i".repeat(CAP - 8)];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    });
    const result = await readCappedBody(bodyRequest(stream), CAP);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.bytes.byteLength).toBe(CAP);
    expect(new TextDecoder().decode(result.bytes)).toBe(parts.join(""));
  });

  it("an absent body is an empty one", async () => {
    const result = await readCappedBody(bodyRequest(null), CAP);
    expect(result).toEqual({ ok: true, bytes: new Uint8Array(0) });
  });
});

describe("hasMediaType", () => {
  it("matches the media type exactly", () => {
    expect(hasMediaType("application/json", "application/json")).toBe(true);
    expect(hasMediaType("application/x-www-form-urlencoded", "application/x-www-form-urlencoded")).toBe(true);
  });

  it("ignores parameters and surrounding whitespace", () => {
    expect(hasMediaType("application/json; charset=utf-8", "application/json")).toBe(true);
    expect(hasMediaType("application/x-www-form-urlencoded;charset=UTF-8", "application/x-www-form-urlencoded")).toBe(true);
    expect(hasMediaType("  application/json ; charset=utf-8", "application/json")).toBe(true);
  });

  it("compares case-insensitively", () => {
    expect(hasMediaType("Application/JSON", "application/json")).toBe(true);
    expect(hasMediaType("APPLICATION/X-WWW-FORM-URLENCODED; charset=UTF-8", "application/x-www-form-urlencoded")).toBe(true);
  });

  it("refuses another type, a look-alike, a parameter-only value, and an absent header", () => {
    expect(hasMediaType("text/plain", "application/json")).toBe(false);
    expect(hasMediaType("application/json-patch+json", "application/json")).toBe(false);
    expect(hasMediaType("application/jsonx", "application/json")).toBe(false);
    expect(hasMediaType("multipart/form-data; boundary=x", "application/x-www-form-urlencoded")).toBe(false);
    expect(hasMediaType("; application/json", "application/json")).toBe(false);
    expect(hasMediaType("", "application/json")).toBe(false);
    expect(hasMediaType(null, "application/json")).toBe(false);
  });
});

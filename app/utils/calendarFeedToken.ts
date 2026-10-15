import "server-only";

// The member calendar feed's credential (docs/superpowers/specs/2026-10-15-member-calendar-feed-design.md
// D1–D2, ADR-0057). The token is SIGNED, not stored: an HMAC of the member id and a per-member,
// non-secret generation counter under `CALENDAR_FEED_SECRET`, which lives only in Vercel. Nothing
// secret ever reaches the public dataset, the server can recompute a member's URL any time, and
// bumping the generation revokes every earlier URL of that member. The generation also travels IN
// the URL, so the feed route verifies the signature with zero I/O before it reads anything.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FeedUrls } from "./calendarFeed";

/** Shortest accepted secret, in UTF-8 bytes (an HMAC-SHA256 key of ≥ 256 bits). */
export const MIN_FEED_SECRET_BYTES = 32;

/** The env shape these helpers read. `process.env` satisfies it. */
export type FeedEnv = Readonly<Record<string, string | undefined>>;

/** The signing secret, or null when absent or shorter than 32 bytes — callers then answer 503
 *  before reading anything (fail closed). */
export function feedSecret(env: FeedEnv = process.env): string | null {
  const secret = env.CALENDAR_FEED_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < MIN_FEED_SECRET_BYTES) return null;
  return secret;
}

/** True when the read token the generation read needs is present. A token-less read of the
 *  dotted `calendarFeed.<id>` answers «no document» with HTTP 200; read as generation 0, that
 *  would RESURRECT every revoked URL — so callers refuse instead (D2). */
export function hasReadToken(env: FeedEnv = process.env): boolean {
  return !!env.SANITY_API_READ_TOKEN?.trim();
}

/** The document holding a member's generation counter. Dotted: never served untokened. */
export function calendarFeedDocId(memberId: string): string {
  return `calendarFeed.${memberId}`;
}

/**
 * A STORED generation: absent (`null`/`undefined`) is 0; a non-negative safe integer is itself;
 * anything else is `null` — a corrupt counter, which callers refuse (503), never coerce to 0.
 */
export function parseStoredGeneration(value: unknown): number | null {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** The URL's generation segment: canonical decimal only (`0`, or no leading zero, ≤ 9 digits). */
export const URL_GENERATION_RE = /^(0|[1-9][0-9]{0,8})$/;

export function parseUrlGeneration(raw: string | undefined): number | null {
  return raw && URL_GENERATION_RE.test(raw) ? Number(raw) : null;
}

/** base64url HMAC-SHA256 — always 43 characters. */
export function signFeedToken(secret: string, memberId: string, generation: number): string {
  return createHmac("sha256", secret)
    .update(`owt-calendar-feed:v1\n${memberId}\n${generation}`)
    .digest("base64url");
}

/** The shape every real token has. Checked before any Sanity read so junk costs nothing. */
export const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** `<token>.ics` → the bare token (the route separately requires the suffix). */
export function stripIcsSuffix(raw: string): string {
  return raw.endsWith(".ics") ? raw.slice(0, -4) : raw;
}

/** Constant-time comparison; a length mismatch is a plain `false`, never a throw. */
export function verifyFeedToken(secret: string, memberId: string, generation: number, presented: string): boolean {
  const expected = Buffer.from(signFeedToken(secret, memberId, generation), "utf8");
  const given = Buffer.from(presented, "utf8");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}


/** Every URL the settings panel shows, from the canonical origin and a signed token. */
export function feedUrls(origin: string, memberId: string, generation: number, secret: string): FeedUrls {
  const token = signFeedToken(secret, memberId, generation);
  const all = `${origin}/api/calendar/${encodeURIComponent(memberId)}/${generation}/${token}.ics`;
  const mine = `${all}?solo=mios`;
  const webcal = (u: string) => u.replace(/^https?:\/\//, "webcal://");
  const google = (u: string) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal(u))}`;
  return {
    all,
    mine,
    webcalAll: webcal(all),
    webcalMine: webcal(mine),
    googleAll: google(all),
    googleMine: google(mine),
  };
}

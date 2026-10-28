import "server-only";

// The two HMACs of the song tools (admin parity phase 3, S3, D5/D6), under `MCP_OAUTH_SECRET` with
// their own labels — key separation, as `changeSetTokens.ts`:
//
//   · the edit token: "mcp-song-edits|" + the canonical JSON of {songId, rev, edits, lines} as checked,
//     `lines` being the before/after the check rendered (without its Studio-draft warning). The save
//     re-renders them from a fresh read and refuses any other edit list, song, revision or result, so
//     a tag renamed or an artist created between check and save cannot change what is written unseen;
//   · the create token: "mcp-song-create|" + its issue time + "|" + the canonical JSON of the song as
//     checked. It carries the issue time and dies after `CREATE_TOKEN_TTL_S` (A6), so an old
//     `create_song` replayed after the song was deleted cannot recreate it; the song's `_id` is derived
//     from it, so a retry after an unknown outcome never makes a second copy.
//
// Rotating the secret voids every pending song check: the save answers «revisa de nuevo»
// (`docs/SECRETS.md`).

import { createHmac } from "node:crypto";

import { canonicalJson, sameMac } from "../monthProposals/changeSetTokens";

const EDITS_LABEL = "mcp-song-edits|";
const CREATE_LABEL = "mcp-song-create|";

/** How long a create check stays good, in seconds. */
export const CREATE_TOKEN_TTL_S = 30 * 60;

export interface SongEditsTokenInput {
  songId: string;
  rev: string;
  edits: unknown;
  lines: readonly string[];
}

export function songEditsToken(key: Uint8Array, input: SongEditsTokenInput): string {
  const body = canonicalJson({ songId: input.songId, rev: input.rev, edits: input.edits, lines: input.lines });
  return createHmac("sha256", key)
    .update(`${EDITS_LABEL}${body}`, "utf8")
    .digest()
    .toString("base64url");
}

export function sameSongEditsToken(key: Uint8Array, given: string, input: SongEditsTokenInput): boolean {
  return sameMac(given, songEditsToken(key, input));
}

function createMac(key: Uint8Array, iat: number, song: unknown): Buffer {
  return createHmac("sha256", key).update(`${CREATE_LABEL}${iat}|${canonicalJson(song)}`, "utf8").digest();
}

/** `<iat>.<mac>`: the issue time travels with the token, so the save can tell its age. */
export function songCreateToken(key: Uint8Array, song: unknown, nowS: number): string {
  return `${nowS}.${createMac(key, nowS, song).toString("base64url")}`;
}

/** The song id a create token names: `post-mcp-` + 24 hex of its MAC. */
export function songCreateId(token: string): string | null {
  const mac = token.split(".")[1];
  if (!mac) return null;
  const hex = Buffer.from(mac, "base64url").toString("hex");
  return hex.length >= 24 ? `post-mcp-${hex.slice(0, 24)}` : null;
}

export type CreateTokenCheck = { ok: true; id: string } | { ok: false; reason: "mismatch" | "expired" };

export function checkSongCreateToken(key: Uint8Array, token: string, song: unknown, nowS: number): CreateTokenCheck {
  const [iatText, mac, extra] = token.split(".");
  if (extra !== undefined || !iatText || !mac || !/^\d{1,12}$/.test(iatText)) return { ok: false, reason: "mismatch" };
  const iat = Number(iatText);
  if (!sameMac(mac, createMac(key, iat, song).toString("base64url"))) return { ok: false, reason: "mismatch" };
  if (nowS - iat > CREATE_TOKEN_TTL_S || iat - nowS > 60) return { ok: false, reason: "expired" };
  const id = songCreateId(token);
  return id ? { ok: true, id } : { ok: false, reason: "mismatch" };
}

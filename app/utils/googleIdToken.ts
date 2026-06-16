import { OAuth2Client } from "google-auth-library";

// aud allowlist = our own OAuth client IDs (web + native). A token minted for
// any other app must be rejected. iOS/Android client IDs are separate from web.
let ALLOWED = [
  process.env.GOOGLE_CLIENT_ID,        // web (existing)
  process.env.GOOGLE_IOS_CLIENT_ID,
  process.env.GOOGLE_ANDROID_CLIENT_ID,
].filter(Boolean) as string[];

/** For tests only. */
export function __setAllowedAudiences(ids: string[]) { ALLOWED = ids; }

const client = new OAuth2Client();

/** Verify a Google ID token (signature via JWKS, aud, iss, exp) and require a verified email. */
export async function verifyGoogleIdToken(idToken: string): Promise<{ email: string }> {
  const ticket = await client.verifyIdToken({ idToken, audience: ALLOWED });
  const payload = ticket.getPayload();
  if (!payload?.email) throw new Error("Google token has no email");
  if (payload.email_verified !== true) throw new Error("Google email_verified is false");
  return { email: payload.email };
}

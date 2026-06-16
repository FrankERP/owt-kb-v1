import { describe, it, expect, vi, beforeEach } from "vitest";

const { verifyIdToken } = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock("google-auth-library", () => ({
  OAuth2Client: class { verifyIdToken = verifyIdToken; },
}));

import { verifyGoogleIdToken, __setAllowedAudiences } from "../googleIdToken";

beforeEach(() => { verifyIdToken.mockReset(); __setAllowedAudiences(["web-id", "ios-id", "android-id"]); });

describe("verifyGoogleIdToken", () => {
  it("returns the email for a valid, verified token", async () => {
    verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ email: "a@b.com", email_verified: true }) });
    expect(await verifyGoogleIdToken("tok")).toEqual({ email: "a@b.com" });
    expect(verifyIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: "tok", audience: ["web-id", "ios-id", "android-id"] })
    );
  });

  it("rejects an unverified email", async () => {
    verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ email: "a@b.com", email_verified: false }) });
    await expect(verifyGoogleIdToken("tok")).rejects.toThrow(/email_verified/);
  });

  it("rejects when the library throws (bad signature / aud / exp)", async () => {
    verifyIdToken.mockRejectedValueOnce(new Error("Invalid token"));
    await expect(verifyGoogleIdToken("tok")).rejects.toThrow();
  });
});

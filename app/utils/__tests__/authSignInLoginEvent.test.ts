/**
 * `auth.ts`'s `events.signIn` writes the sign-in audit record through the REAL
 * `createLoginEvent` (not mocked here), so these tests pin the call site:
 *   · every sign-in creates exactly one `loginEvent` with a private dotted id;
 *   · a failed audit write — an id that already exists included — is not
 *     retried and never fails the sign-in itself (it is logged and swallowed).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ fetch: vi.fn(), create: vi.fn(), patch: vi.fn() }));

vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (...a: unknown[]) => h.fetch(...a) },
  writeClient: { create: (...a: unknown[]) => h.create(...a), patch: (...a: unknown[]) => h.patch(...a) },
}));
vi.mock("@/app/utils/memberAccess", () => ({
  isMemberActive: vi.fn(async () => true),
  getMemberAccess: vi.fn(),
}));
vi.mock("@/app/utils/googleIdToken", () => ({ verifyGoogleIdToken: vi.fn() }));

const DOTTED_UUID_V4 = /^loginEvent\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type SignInEvent = (message: unknown) => Promise<void>;

async function signIn(user: Record<string, unknown>, account: Record<string, unknown>) {
  const { authOptions } = await import("@/auth");
  const handler = authOptions.events?.signIn as unknown as SignInEvent | undefined;
  if (!handler) throw new Error("no signIn event");
  return handler({ user, account });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.fetch.mockResolvedValue({ _id: "m-1", member_name: "Test", role: "member" });
  h.create.mockImplementation(async (doc: { _id: string }) => ({ _id: doc._id }));
});

describe("events.signIn → loginEvent", () => {
  it("writes one loginEvent with a private dotted id on a credentials sign-in", async () => {
    await signIn({ email: "t@example.com" }, { provider: "credentials" });
    expect(h.create).toHaveBeenCalledTimes(1);
    const doc = h.create.mock.calls[0][0] as { _id: string; _type: string; member: { _ref: string } };
    expect(doc._id).toMatch(DOTTED_UUID_V4);
    expect(doc._type).toBe("loginEvent");
    expect(doc.member._ref).toBe("m-1");
  });

  it("writes the same single dotted create on a Google sign-in without an image", async () => {
    await signIn({ email: "t@example.com" }, { provider: "google" });
    expect(h.create).toHaveBeenCalledTimes(1);
    expect((h.create.mock.calls[0][0] as { _id: string })._id).toMatch(DOTTED_UUID_V4);
    expect(h.patch).not.toHaveBeenCalled();
  });

  it("does not fail the sign-in, and does not retry, when the audit write fails", async () => {
    const conflict = Object.assign(new Error("Document by ID loginEvent.x already exists"), { statusCode: 409 });
    h.create.mockRejectedValue(conflict);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(signIn({ email: "t@example.com" }, { provider: "credentials" })).resolves.toBeUndefined();
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("[auth] Failed to log sign-in event:", conflict);
    error.mockRestore();
  });
});

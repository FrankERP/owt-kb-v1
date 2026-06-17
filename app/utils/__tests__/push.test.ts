import { describe, it, expect, vi, beforeEach } from "vitest";

const sendEachForMulticast = vi.fn();
vi.mock("../firebaseAdmin", () => ({
  getMessaging: () => ({ sendEachForMulticast }),
}));
const fetchMock = vi.fn();
const patchCommit = vi.fn();
const patchUnset = vi.fn(() => ({ commit: patchCommit }));
const patchFn = vi.fn((_id: unknown) => ({ unset: patchUnset }));
vi.mock("@/sanity/lib/serverClient", () => ({
  serverClient: { fetch: (...a: unknown[]) => fetchMock(...a) },
  writeClient: { patch: (id: unknown) => patchFn(id) },
}));

import { sendPush } from "../push";

beforeEach(() => {
  sendEachForMulticast.mockReset();
  fetchMock.mockReset();
  patchFn.mockReset();
  patchUnset.mockReset();
  patchCommit.mockReset();
  patchUnset.mockReturnValue({ commit: patchCommit });
  patchFn.mockReturnValue({ unset: patchUnset });
});

describe("sendPush", () => {
  it("skips members who opted out of the category", async () => {
    fetchMock.mockResolvedValueOnce([
      { _id: "m1", deviceTokens: [{ token: "t1" }], notifPrefs: { assignments: false } },
    ]);
    const r = await sendPush(["m1"], "assignments", { title: "x", body: "y", path: "/" });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
  });

  it("sends to opted-in tokens", async () => {
    fetchMock.mockResolvedValueOnce([
      { _id: "m1", deviceTokens: [{ token: "t1" }, { token: "t2" }], notifPrefs: { assignments: true } },
    ]);
    sendEachForMulticast.mockResolvedValueOnce({ responses: [{ success: true }, { success: true }] });
    const r = await sendPush(["m1"], "assignments", { title: "x", body: "y", path: "/" });
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(r.sent).toBe(2);
  });

  it("prunes tokens FCM reports as unregistered", async () => {
    fetchMock.mockResolvedValueOnce([
      { _id: "m1", deviceTokens: [{ token: "good" }, { token: "dead" }], notifPrefs: {} },
    ]);
    sendEachForMulticast.mockResolvedValueOnce({
      responses: [
        { success: true },
        { success: false, error: { code: "messaging/registration-token-not-registered" } },
      ],
    });
    const r = await sendPush(["m1"], "assignments", { title: "x", body: "y", path: "/" });
    expect(r.pruned).toBe(1);
    expect(patchUnset).toHaveBeenCalled();
    expect(patchFn).toHaveBeenCalledWith("m1");
    expect(patchUnset).toHaveBeenCalledWith([`deviceTokens[token == "dead"]`]);
  });

  it("never throws on send failure", async () => {
    fetchMock.mockResolvedValueOnce([{ _id: "m1", deviceTokens: [{ token: "t1" }], notifPrefs: {} }]);
    sendEachForMulticast.mockRejectedValueOnce(new Error("boom"));
    await expect(sendPush(["m1"], "assignments", { title: "x", body: "y", path: "/" })).resolves.toEqual(
      expect.objectContaining({ sent: 0 })
    );
  });

  it("respects the setlist tri-state (off = skip, non-off = send)", async () => {
    fetchMock.mockResolvedValueOnce([
      { _id: "m1", deviceTokens: [{ token: "t1" }], notifPrefs: { setlist: "off" } },
      { _id: "m2", deviceTokens: [{ token: "t2" }], notifPrefs: { setlist: "assigned" } },
    ]);
    sendEachForMulticast.mockResolvedValueOnce({ responses: [{ success: true }] });
    const r = await sendPush(["m1", "m2"], "setlist", { title: "x", body: "y", path: "/" });
    // only m2's token is sent (m1 opted "off")
    expect(sendEachForMulticast).toHaveBeenCalledWith(expect.objectContaining({ tokens: ["t2"] }));
    expect(r.sent).toBe(1);
  });
});

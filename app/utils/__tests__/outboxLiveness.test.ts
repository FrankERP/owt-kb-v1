import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// `assignmentEmail` reaches `sanity/env`, which asserts on real project vars this
// suite has no reason to carry. Stubbed rather than set, so the test declares its
// own independence from the deployment's configuration.
vi.mock("@/sanity/env", () => ({
  apiVersion: "2024-07-23",
  dataset: "test",
  projectId: "test",
}));

const operationalFetch = vi.fn();
const sendEmailMock = vi.fn();

vi.mock("@/sanity/lib/operationalClient", () => ({
  operationalClient: { fetch: (...a: unknown[]) => operationalFetch(...a) },
  rawIntegrityClient: { fetch: vi.fn() },
}));
vi.mock("@/app/utils/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmailMock(...a),
}));

import type { SweepReport } from "../outboxSweep";
import { reportDestroyedMail } from "../outboxLiveness";

const SUPER_ADMIN = [{ _id: "m1", email: "owner@example.com" }];

/** A clean report; each test names only the counters it is about. */
const report = (over: Partial<SweepReport> = {}): SweepReport => ({
  claimed: 0,
  emailed: 0,
  consumed: 0,
  deferred: 0,
  unserved: 0,
  repended: 0,
  lost: 0,
  failed: 0,
  skipped: 0,
  ...over,
});

const htmlOf = (call: number = 0) => sendEmailMock.mock.calls[call][0].html as string;

beforeEach(() => {
  vi.restoreAllMocks();
  operationalFetch.mockReset();
  sendEmailMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.EMAIL_ALLOWLIST = "*";
  delete process.env.EMAIL_REDIRECT_TO;
  operationalFetch.mockResolvedValue(SUPER_ADMIN);
  sendEmailMock.mockResolvedValue({ ok: true });
});

describe("reportDestroyedMail", () => {
  it("stays quiet when the sweep destroyed nothing", async () => {
    const r = await reportDestroyedMail(report({ emailed: 5, consumed: 2 }));
    expect(r).toEqual({ destroyed: 0, alerted: false });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("alerts a super-admin when a send failed", async () => {
    const r = await reportDestroyedMail(report({ failed: 2 }));
    expect(r).toEqual({ destroyed: 2, alerted: true });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0].to).toBe("owner@example.com");
  });

  // `skipped` is the class the first version of this alarm missed entirely. A
  // recipient with no usable address, or one a narrowed EMAIL_ALLOWLIST excludes,
  // is discharged WITHOUT AN ATTEMPT and never retried — destroyed just as surely
  // as a refused send. It COUNTS, so the loss is visible...
  it("counts skipped recipients, which are discharged without any attempt", async () => {
    const r = await reportDestroyedMail(report({ skipped: 4 }));
    expect(r.destroyed).toBe(4);
  });

  // ...but it does NOT wake anyone on its own. A member whose `email` is empty is
  // a permanent skipped producer, and layer 1 already decided this exact question
  // in the other direction it could have gone: `skipped` warns, it does not go
  // red. Mailing here would put a chronic data condition on the one channel that
  // is the whole mitigation, every single day, until it stopped being read.
  it("does not email on skipped alone — layer 1's threshold, deliberately", async () => {
    const r = await reportDestroyedMail(report({ skipped: 4 }));
    expect(r.alerted).toBe(false);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  // Same reasoning, the other half of layer 1's rule: red starts at two, because
  // one undeliverable address recurs on every sweep carrying a notice for them.
  it("does not email on a single failed send", async () => {
    const r = await reportDestroyedMail(report({ failed: 1 }));
    expect(r).toEqual({ destroyed: 1, alerted: false });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  // Not triggering is not the same as not reporting: once the mail goes out for a
  // reason that DID clear the bar, the skipped recipients ride along in it.
  it("reports skipped in the body when the mail goes out for another reason", async () => {
    await reportDestroyedMail(report({ failed: 2, skipped: 3 }));
    expect(htmlOf()).toContain("no tenían dirección utilizable");
  });

  it("sums all three destroyed classes", async () => {
    const r = await reportDestroyedMail(report({ failed: 1, lost: 3, skipped: 2 }));
    expect(r.destroyed).toBe(6);
  });

  // The three classes send you to different places, so the mail names each one
  // it actually saw and stays silent about the others.
  it("names only the classes it saw", async () => {
    await reportDestroyedMail(report({ failed: 2 }));
    expect(htmlOf()).toContain("no los aceptó");
    expect(htmlOf()).not.toContain("antes de intentarse");
    expect(htmlOf()).not.toContain("dirección utilizable");

    sendEmailMock.mockClear();
    await reportDestroyedMail(report({ failed: 1, lost: 1, skipped: 1 }));
    expect(htmlOf()).toContain("no los aceptó");
    expect(htmlOf()).toContain("dirección utilizable");
    expect(htmlOf()).toContain("antes de intentarse");
  });

  // Hobby keeps ~1 h of runtime logs and the API refuses older windows, which is
  // why the 2026-08-28 sweep could not be audited after the fact. The mail has to
  // say that, or it points the reader at evidence that will be gone.
  it("tells the reader the logs expire within the hour", async () => {
    await reportDestroyedMail(report({ failed: 2, skipped: 1 }));
    expect(htmlOf()).toContain("dentro de la hora siguiente");
    expect(htmlOf()).toContain("notify_sweep_recipient_skipped");
  });

  // The `lost` class has NO per-recipient log — the budget records counts, not
  // ids — so promising ids for it would send the reader hunting a one-hour
  // window for lines that were never written.
  it("does not promise member ids for a loss the logs cannot identify", async () => {
    await reportDestroyedMail(report({ lost: 3 }));
    expect(htmlOf()).toContain("no se pueden identificar");
    expect(htmlOf()).not.toContain("notify_sweep_send_failed");
  });

  // `alerted` follows the MAILBOX, not the attempt — the same rule the stale
  // alarm uses. A run that logged loudly and reached nobody has not alerted.
  it("reports alerted:false when every send fails", async () => {
    sendEmailMock.mockResolvedValue({ ok: false, error: "boom" });
    const r = await reportDestroyedMail(report({ failed: 3 }));
    expect(r).toEqual({ destroyed: 3, alerted: false });
  });

  it("reports alerted:false when there is no super-admin to reach", async () => {
    operationalFetch.mockResolvedValue([]);
    const r = await reportDestroyedMail(report({ failed: 3 }));
    expect(r).toEqual({ destroyed: 3, alerted: false });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  // The daily cron must never fail because its alarm could not run — and the
  // count it already measured survives the failure, because reporting "nothing
  // was destroyed" about a run that destroyed mail is worse than the failure.
  it("never throws, and keeps the count it had already measured", async () => {
    operationalFetch.mockRejectedValue(new Error("groq down"));
    await expect(reportDestroyedMail(report({ failed: 2 }))).resolves.toEqual({
      destroyed: 2,
      alerted: false,
    });
  });

  // The route passes `{error}` when the sweep threw. That is not destroyed mail,
  // and the `in` narrowing — not a cast — is what keeps it from being read as 0.
  it("treats a sweep that threw as nothing destroyed", async () => {
    const r = await reportDestroyedMail({ error: "sweep_failed" });
    expect(r).toEqual({ destroyed: 0, alerted: false });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

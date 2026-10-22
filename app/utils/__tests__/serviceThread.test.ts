import { describe, expect, it } from "vitest";

import { serviceThreadId, serviceThreadMessagesOf, SERVICE_THREAD_BY_ID_QUERY } from "../serviceThread";
import { THREAD_MESSAGES } from "../proposalMessageRead";

describe("serviceThreadId", () => {
  it("is the dotted, deterministic id of a canonical role", () => {
    expect(serviceThreadId("role-1")).toBe("serviceThread.role-1");
  });

  it("refuses a draft id, whitespace and non-strings", () => {
    expect(serviceThreadId("drafts.role-1")).toBeNull();
    expect(serviceThreadId("role 1")).toBeNull();
    expect(serviceThreadId("")).toBeNull();
    expect(serviceThreadId(undefined)).toBeNull();
  });
});

describe("the read fragments", () => {
  it("project the same row shape as the proposal's thread, keyed by role id", () => {
    const fragment = serviceThreadMessagesOf("^.service_ref._ref");
    expect(fragment).toBe(
      `*[_type == "serviceThread" && _id == "serviceThread." + ^.service_ref._ref][0].${THREAD_MESSAGES}`,
    );
    expect(SERVICE_THREAD_BY_ID_QUERY).toContain(THREAD_MESSAGES);
  });
});

// app/utils/__tests__/emailServiceLabel.test.ts
import { describe, expect, it } from "vitest";

import { formatServiceDate, serviceIdentity, serviceLabel } from "../emailServiceLabel";

describe("formatServiceDate", () => {
  it("renders the CDMX calendar day with its weekday, capitalized, no trailing dot", () => {
    expect(formatServiceDate("2026-10-03")).toBe("Sábado 3 oct");
    // A full timestamp is cut to its date: the day never flips on the UTC offset.
    expect(formatServiceDate("2026-10-04T05:30:00Z")).toBe("Domingo 4 oct");
  });
});

describe("serviceIdentity", () => {
  it("is empty for a weekend role, which has neither field", () => {
    expect(serviceIdentity({ _type: "sunday_role", week: "2026-10-04" } as Record<string, unknown>)).toEqual({});
  });

  it("is empty for a missing role", () => {
    expect(serviceIdentity(null)).toEqual({});
    expect(serviceIdentity(undefined)).toEqual({});
  });

  it("carries a special's name (trimmed) and a well-formed time", () => {
    expect(serviceIdentity({ service_name: "  CAMP - Set 2 ", time: "09:00" })).toEqual({
      serviceName: "CAMP - Set 2",
      serviceTime: "09:00",
    });
  });

  it("keeps a name on one line — it becomes a subject line", () => {
    expect(serviceIdentity({ service_name: "CAMP\n- Set 2\r\nBcc: x@y.z" }).serviceName).toBe("CAMP - Set 2 Bcc: x@y.z");
    expect(serviceLabel({ date: "2026-10-03", roleType: "special_role", serviceName: "A\nB" })).toBe("Sábado 3 oct · A B");
  });

  it("leaves out a blank name and a malformed time rather than passing them through", () => {
    const out = serviceIdentity({ service_name: "   ", time: "9:00" });
    expect(out).toEqual({});
    expect(out).not.toHaveProperty("serviceName");
    expect(out).not.toHaveProperty("serviceTime");
    expect(serviceIdentity({ service_name: 42, time: null })).toEqual({});
  });
});

describe("serviceLabel", () => {
  it("is only the date for a weekend service, whatever else it is handed", () => {
    expect(serviceLabel({ date: "2026-10-03", roleType: "saturday_role" })).toBe("Sábado 3 oct");
    expect(serviceLabel({ date: "2026-10-03", roleType: "saturday_role", serviceName: "x", serviceTime: "09:00" }))
      .toBe("Sábado 3 oct");
    expect(serviceLabel({ date: "2026-10-03", roleType: null })).toBe("Sábado 3 oct");
  });

  it("names a special and gives its time, date first", () => {
    expect(serviceLabel({ date: "2026-10-03", roleType: "special_role", serviceName: "CAMP - Set 2", serviceTime: "09:00" }))
      .toBe("Sábado 3 oct · CAMP - Set 2 · 09:00");
  });

  it("tells two same-day specials apart", () => {
    const a = serviceLabel({ date: "2026-10-03", roleType: "special_role", serviceName: "CAMP - Set 2", serviceTime: "09:00" });
    const b = serviceLabel({ date: "2026-10-03", roleType: "special_role", serviceName: "CAMP - Set 3", serviceTime: "12:30" });
    expect(a).not.toBe(b);
  });

  it("omits an absent or malformed time", () => {
    expect(serviceLabel({ date: "2026-10-03", roleType: "special_role", serviceName: "CAMP - Micro Set" }))
      .toBe("Sábado 3 oct · CAMP - Micro Set");
    expect(serviceLabel({ date: "2026-10-03", roleType: "special_role", serviceName: "CAMP - Micro Set", serviceTime: "25:00" }))
      .toBe("Sábado 3 oct · CAMP - Micro Set");
  });

  it("still says it is a special when the name cannot be read", () => {
    expect(serviceLabel({ date: "2026-10-03", roleType: "special_role" })).toBe("Sábado 3 oct · Servicio especial");
    expect(serviceLabel({ date: "2026-10-03", roleType: "special_role", serviceName: "  ", serviceTime: "18:30" }))
      .toBe("Sábado 3 oct · Servicio especial · 18:30");
  });

  it("returns plain text: an admin-typed name is not escaped here", () => {
    expect(serviceLabel({ date: "2026-10-03", roleType: "special_role", serviceName: "Set <1> & co" }))
      .toBe("Sábado 3 oct · Set <1> & co");
  });
});

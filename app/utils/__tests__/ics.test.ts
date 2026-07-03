import { describe, it, expect } from "vitest";
import { buildICS } from "../ics";

const line = (ics: string, prefix: string) =>
  ics.split("\r\n").find((l) => l.startsWith(prefix));

describe("buildICS", () => {
  it("wraps events in a VCALENDAR with CRLF line endings", () => {
    const ics = buildICS([]);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics.includes("\r\n")).toBe(true);
    // No events → no VEVENT
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("emits one VEVENT per event with all-day DTSTART/DTEND", () => {
    const ics = buildICS([{ uid: "a1", date: "2026-07-05", title: "Domingo" }]);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect(line(ics, "DTSTART")).toBe("DTSTART;VALUE=DATE:20260705");
    // DTEND is exclusive next day for an all-day event
    expect(line(ics, "DTEND")).toBe("DTEND;VALUE=DATE:20260706");
    expect(line(ics, "SUMMARY")).toBe("SUMMARY:Domingo");
    expect(line(ics, "UID")).toBe("UID:a1@owt");
  });

  it("rolls DTEND across month and year boundaries", () => {
    expect(line(buildICS([{ uid: "m", date: "2026-07-31", title: "x" }]), "DTEND"))
      .toBe("DTEND;VALUE=DATE:20260801");
    expect(line(buildICS([{ uid: "y", date: "2026-12-31", title: "x" }]), "DTEND"))
      .toBe("DTEND;VALUE=DATE:20270101");
  });

  it("includes DESCRIPTION only when provided", () => {
    const withDesc = buildICS([{ uid: "d", date: "2026-07-05", title: "t", description: "Lead" }]);
    expect(line(withDesc, "DESCRIPTION")).toBe("DESCRIPTION:Lead");
    const without = buildICS([{ uid: "d", date: "2026-07-05", title: "t" }]);
    expect(without).not.toContain("DESCRIPTION:");
  });

  it("escapes special characters in text per RFC 5545", () => {
    const ics = buildICS([{ uid: "e", date: "2026-07-05", title: "A, B; C\\D" }]);
    // comma, semicolon and backslash must be backslash-escaped
    expect(line(ics, "SUMMARY")).toBe("SUMMARY:A\\, B\\; C\\\\D");
  });

  it("uses the provided calendar name", () => {
    const ics = buildICS([], "Mis Servicios");
    expect(line(ics, "X-WR-CALNAME")).toBe("X-WR-CALNAME:Mis Servicios");
  });
});

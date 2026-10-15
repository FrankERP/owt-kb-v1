import { describe, it, expect } from "vitest";
import { buildICS, foldLine } from "../ics";

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

describe("buildICS — subscription feed additions", () => {
  const raw = (ics: string) => ics.split("\r\n");

  it("writes a timed event with TZID and a duration, plus one VTIMEZONE, from text alone", () => {
    const ics = buildICS([{ uid: "s", date: "2026-10-18", title: "Noche", time: "19:30" }]);
    expect(line(ics, "DTSTART;TZID")).toBe("DTSTART;TZID=America/Mexico_City:20261018T193000");
    expect(line(ics, "DURATION")).toBe("DURATION:PT2H");
    expect(ics).not.toContain("DTEND");
    expect((ics.match(/BEGIN:VTIMEZONE/g) ?? []).length).toBe(1);
    expect(ics).toContain("TZOFFSETTO:-0600");
  });

  it("emits no VTIMEZONE when every event is all-day (the download stays as it was)", () => {
    expect(buildICS([{ uid: "a", date: "2026-07-05", title: "Domingo" }])).not.toContain("VTIMEZONE");
  });

  it("honours a custom duration and UID domain", () => {
    const ics = buildICS([{ uid: "s", date: "2026-10-18", title: "x", time: "09:00", durationMinutes: 90 }], "c", { uidDomain: "owt-backstage" });
    expect(line(ics, "DURATION")).toBe("DURATION:PT1H30M");
    expect(line(ics, "UID")).toBe("UID:s@owt-backstage");
  });

  it("adds the refresh hints only when asked (a feed, not the download)", () => {
    expect(buildICS([])).not.toContain("REFRESH-INTERVAL");
    const ics = buildICS([], "c", { refreshMinutes: 180 });
    expect(line(ics, "REFRESH-INTERVAL")).toBe("REFRESH-INTERVAL;VALUE=DURATION:PT3H");
    expect(line(ics, "X-PUBLISHED-TTL")).toBe("X-PUBLISHED-TTL:PT3H");
    expect(line(ics, "X-WR-TIMEZONE")).toBe("X-WR-TIMEZONE:America/Mexico_City");
  });

  it("escapes CR and CRLF as \\n, so a description can never inject a property", () => {
    const ics = buildICS([{ uid: "d", date: "2026-07-05", title: "t", description: "a\r\nb\rc\nEND:VEVENT" }]);
    expect(line(ics, "DESCRIPTION")).toBe("DESCRIPTION:a\\nb\\nc\\nEND:VEVENT");
    expect((ics.match(/^END:VEVENT$/gm) ?? []).length).toBe(1);
  });

  it("folds every line at 75 octets without splitting a multi-byte character", () => {
    const title = "⭐ Noche de alabanza · Bajo eléctrico · " + "canción ".repeat(20);
    const ics = buildICS([{ uid: "f", date: "2026-07-05", title }]);
    const enc = new TextEncoder();
    for (const l of raw(ics)) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
    // Unfolding (CRLF + one space removed) restores the exact escaped text.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(line(unfolded, "SUMMARY")).toBe(`SUMMARY:${title}`);
    expect(unfolded).not.toContain("�");
  });

  it("leaves short lines untouched", () => {
    expect(foldLine("SUMMARY:Domingo")).toBe("SUMMARY:Domingo");
  });
});

// The month map and the date leaf of the Jóvenes screens (ADR-0086), as static markup: both are
// neutral components with no state, so what they print is the whole of what they do.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MINISTRIES } from "@/app/ministries";
import { MINISTRY_TONE, groupTone } from "@/app/utils/jovenesGroupStyle";
import MonthMap from "../MonthMap";
import DateTile from "../DateTile";

const [G1] = MINISTRIES.jovenes.groups;

describe("MonthMap", () => {
  const events = [
    { _id: "a", date: "2026-11-07", audience: { kind: "ministry" as const }, published: true },
    { _id: "b", date: "2026-11-07", audience: { kind: "groups" as const, groups: [G1.id] }, published: false },
    { _id: "c", date: "2026-12-05", audience: { kind: "ministry" as const }, published: true },
  ];
  const html = renderToStaticMarkup(<MonthMap month="2026-11" events={events} today="2026-11-12" />);

  it("is one image named by the month's own count — another month's meeting is not in it", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Mapa del mes: 2 reuniones"');
  });

  it("starts the grid on Monday: 1 November 2026 is a Sunday, so six blanks precede it", () => {
    const grid = html.slice(html.indexOf('role="img"'), html.indexOf("<ul"));
    const cells = grid.split("<span").filter((c) => c.startsWith("></span>"));
    expect(cells.length).toBe(6);
    expect(grid).toContain(">30</span>");
    expect(grid).not.toContain(">31</span>");
  });

  it("draws a solid dot for a published meeting and a hollow one, in the group's colour, for a draft", () => {
    expect(html).toContain(`h-1.5 w-1.5 rounded-full ${MINISTRY_TONE.solid}`);
    expect(html).toContain(`h-1.5 w-1.5 rounded-full border ${groupTone(G1.id).edge}`);
  });

  it("rings today and explains its colours, «Borrador» included only when there is a draft", () => {
    expect(html).toMatch(/ring-1 ring-accent[^>]*>12</);
    expect(html).toContain("Todo Jóvenes");
    expect(html).toContain(G1.name);
    expect(html).toContain("Borrador");
    const published = renderToStaticMarkup(<MonthMap month="2026-12" events={events} today="2026-11-12" />);
    expect(published).toContain('aria-label="Mapa del mes: 1 reunión"');
    expect(published).not.toContain("Borrador");
    expect(published).not.toContain("ring-1 ring-accent");
  });

  it("has no legend for an empty month", () => {
    const empty = renderToStaticMarkup(<MonthMap month="2027-02" events={events} today="2026-11-12" />);
    expect(empty).toContain('aria-label="Mapa del mes: 0 reuniones"');
    expect(empty).not.toContain("<ul");
    expect(empty).toContain(">28</span>");
    expect(empty).not.toContain(">29</span>");
  });
});

describe("DateTile", () => {
  it("is a <time> a screen reader hears whole, with the three drawn parts hidden from it", () => {
    const html = renderToStaticMarkup(<DateTile date="2026-11-14" tone={MINISTRY_TONE} />);
    expect(html).toContain('<time dateTime="2026-11-14"');
    expect(html).toContain('<span class="sr-only">Sábado 14 de noviembre</span>');
    expect(html.match(/aria-hidden="true"/g)?.length).toBe(3);
    expect(html).toContain(">14</span>");
    expect(html).toContain(">nov</span>");
    expect(html).toContain(MINISTRY_TONE.wash);
  });

  it("never slips a day: the date is read at UTC noon, the first and last of a month included", () => {
    expect(renderToStaticMarkup(<DateTile date="2026-12-01" tone={MINISTRY_TONE} />)).toMatch(/>1<\/span>.*>dic<\/span>/);
    expect(renderToStaticMarkup(<DateTile date="2026-12-31" tone={MINISTRY_TONE} />)).toMatch(/>31<\/span>.*>dic<\/span>/);
  });

  it("decorative: hidden whole from a screen reader, for a card whose heading says the date", () => {
    const html = renderToStaticMarkup(<DateTile date="2026-11-14" tone={MINISTRY_TONE} decorative />);
    expect(html).toMatch(/<time dateTime="2026-11-14" aria-hidden="true"/);
    expect(html).not.toContain("sr-only");
  });

  it("an empty day is an outline with no colour", () => {
    const html = renderToStaticMarkup(<DateTile date="2026-11-21" tone={groupTone(G1.id)} empty />);
    expect(html).toContain("border-dashed");
    expect(html).not.toContain(`group-${G1.id}`);
  });
});

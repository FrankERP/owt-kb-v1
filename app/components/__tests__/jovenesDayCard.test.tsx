// JovenesDayCard (PR D): the meeting in the Calendario's day sheet. Review finding: on a Saturday
// that holds both the worship service and the Jóvenes meeting, the sheet's own line carries no
// clock, so the card must show the meeting's time itself.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import JovenesDayCard from "../JovenesDayCard";
import type { JovenesDayEntry } from "../CalendarView";

const entry: JovenesDayEntry = {
  id: "ministryEvent.a",
  audience: "Todo Jóvenes",
  arrival: "17:30",
  place: "Oasis Tlalpan",
  seats: [{ key: "s1", label: "Encargado", name: "Ana", photo: null, mine: true }],
  program: [{ key: "l1", label: "Dinámica", name: null, photo: null, mine: false, note: "10 min" }],
  notes: "Traer Biblia",
};

describe("JovenesDayCard", () => {
  it("shows the time when it is given, then who it is for and the arrival", () => {
    const html = renderToStaticMarkup(<JovenesDayCard title="Sábado de Jóvenes" entry={entry} time="18:10" />);
    expect(html).toContain("18:10 · Todo Jóvenes · llegada 17:30 · Oasis Tlalpan");
  });
  it("leaves the clock to the sheet when it is the day's only entry", () => {
    const html = renderToStaticMarkup(<JovenesDayCard title="Sábado de Jóvenes" entry={entry} />);
    expect(html).toContain("Todo Jóvenes · llegada 17:30");
    expect(html).not.toContain("18:10");
  });
  it("marks the reader's seat, lists an unassigned program line with its note, and the notes", () => {
    const html = renderToStaticMarkup(<JovenesDayCard title="Sábado de Jóvenes" entry={entry} />);
    expect(html).toContain("Tú · Ana");
    expect(html).toContain("Dinámica");
    expect(html).toContain("10 min");
    expect(html).toContain("Traer Biblia");
    expect(html).toContain('href="/jovenes"');
  });
  it("draws a person's profile photo, and asks only the reader with none for one", () => {
    const withMine = renderToStaticMarkup(<JovenesDayCard title="Sábado de Jóvenes" entry={entry} />);
    expect(withMine).toContain('href="/me/ajustes"');
    expect(withMine).not.toContain("data-photo");
    const seats = [
      { key: "s1", label: "Encargado", name: "Ana", photo: "https://lh3.googleusercontent.com/a/ana", mine: true },
      { key: "s2", label: "Apoyo", name: "Beto", photo: null, mine: false },
    ];
    const program = [{ key: "l1", label: "Oración", name: "Beto", photo: "https://lh3.googleusercontent.com/a/beto", mine: false, note: null }];
    const html = renderToStaticMarkup(<JovenesDayCard title="Sábado de Jóvenes" entry={{ ...entry, seats, program }} />);
    expect(html).toContain("url(&quot;https://lh3.googleusercontent.com/a/ana&quot;)");
    // The program line's person gets a face too.
    expect(html).toContain("url(&quot;https://lh3.googleusercontent.com/a/beto&quot;)");
    // Ana has a photo and Beto is not the reader: nobody is asked.
    expect(html).not.toContain('href="/me/ajustes"');
  });
});

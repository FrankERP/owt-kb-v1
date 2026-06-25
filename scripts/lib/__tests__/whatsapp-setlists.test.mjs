import { describe, it, expect } from "vitest";
import { parseMessages, detectSetlists, splitSections, parseSongLine, serviceDateFor } from "../whatsapp-setlists.mjs";

const NNBSP = " ";
const sample =
  `5/1/2022, 3:06${NNBSP}p.${NNBSP}m. - Marki: amigos! canciones para este domingo!\n` +
  `Domingo 16 enero\n` +
  `Wake (D) - Hillsong Y&F\n` +
  `-No puedo callar (C)\n` +
  `Salmo 23 (C) Dirige Gaby\n` +
  `6/1/2022, 9:00${NNBSP}a.${NNBSP}m. - Ana: gracias!`;

describe("parseMessages", () => {
  it("parses U+202F timestamps, sender, multi-line body, continuation lines", () => {
    const m = parseMessages(sample);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ date: "2022-01-05", sender: "Marki" });
    expect(m[0].body.split("\n")).toHaveLength(5);
    expect(m[1]).toMatchObject({ date: "2022-01-06", sender: "Ana", body: "gracias!" });
  });
  it("does not parse ASCII-space lines as new messages (continuation safety)", () => {
    const m = parseMessages(`5/1/2022, 3:06${NNBSP}p.${NNBSP}m. - A: x\nplain continuation`);
    expect(m).toHaveLength(1);
    expect(m[0].body).toBe("x\nplain continuation");
  });
});

describe("detectSetlists", () => {
  it("keeps messages with >=3 key lines, drops the rest", () => {
    const got = detectSetlists(parseMessages(sample));
    expect(got).toHaveLength(1);
    expect(got[0].messageDate).toBe("2022-01-05");
  });
});

describe("splitSections", () => {
  it("splits a body with both Sábado and Domingo headings", () => {
    const body = `Sábado 13\nWake (D)\nNo puedo callar (C)\nDomingo 14\nSalmo 23 (C)\nDigno (A)`;
    const s = splitSections(body);
    expect(s.map(x => x.heading)).toEqual(["Sábado 13", "Domingo 14"]);
    expect(s[0].lines).toContain("Wake (D)");
    expect(s[1].lines).toContain("Salmo 23 (C)");
  });
  it("returns one headingless section when there is no day heading", () => {
    const s = splitSections(`Wake (D)\nNo puedo callar (C)\nSalmo 23 (C)`);
    expect(s).toHaveLength(1);
    expect(s[0].heading).toBeNull();
  });
});

describe("parseSongLine", () => {
  it("uses the LAST key paren and strips bullets/artist/director/tail", () => {
    expect(parseSongLine("Sólo tu amor (Need your love) - Y&F (C)")).toMatchObject({ rawName: "Sólo tu amor (Need your love)", key: "C" });
    expect(parseSongLine("-Wake (D) Dirige Gaby")).toMatchObject({ rawName: "Wake", key: "D" });
    expect(parseSongLine("Cordero y león (B) - Bethel Music 90 BPM")).toMatchObject({ rawName: "Cordero y león", key: "B" });
    expect(parseSongLine("Infinito Dios | eeyv (C)")).toMatchObject({ rawName: "Infinito Dios", key: "C" });
    expect(parseSongLine("10,000 Razones (C)")).toMatchObject({ rawName: "10,000 Razones", key: "C" });
    expect(parseSongLine("1.- Todo lo haces bien (A) - Gateway Worship")).toMatchObject({ rawName: "Todo lo haces bien", key: "A" });
    expect(parseSongLine("just some prose with no key")).toBeNull();
  });
});

describe("serviceDateFor", () => {
  it("explicit Spanish date wins; type from the weekday it lands on", () => {
    // 3 July 2022 is a Sunday
    expect(serviceDateFor("Domingo 3 de Julio", "2022-06-20")).toMatchObject({ serviceDate: "2022-07-03", type: "featuredSongs", confidence: "explicit" });
  });
  it("year rollover for a December message naming January", () => {
    expect(serviceDateFor("Domingo 2 enero", "2021-12-29").serviceDate).toBe("2022-01-02");
  });
  it("day word only -> next matching weekday on/after the message date", () => {
    // 2022-01-05 is a Wednesday; next Sunday is 2022-01-09
    expect(serviceDateFor("para este domingo", "2022-01-05")).toMatchObject({ serviceDate: "2022-01-09", type: "featuredSongs", confidence: "day-word" });
  });
  it("no date and no day word -> default Sunday, nearest on/after message date", () => {
    expect(serviceDateFor("para este fin", "2022-09-28")).toMatchObject({ type: "featuredSongs", confidence: "inferred" });
  });
  it("flags conflict when explicit date weekday contradicts the day word", () => {
    // 2022-07-03 is a Sunday, but heading says Sábado
    expect(serviceDateFor("Sábado 3 de Julio", "2022-06-20").confidence).toBe("conflict");
  });
  it("day-number: Domingo 3 where July 3 2022 is Sunday -> explicit confidence", () => {
    // July 3, 2022 is a Sunday; heading says Domingo -> match
    expect(serviceDateFor("Domingo 3", "2022-07-01")).toMatchObject({
      serviceDate: "2022-07-03",
      type: "featuredSongs",
      confidence: "explicit"
    });
  });
  it("day-number: Sábado 3 where July 3 2022 is Sunday -> conflict confidence", () => {
    // July 3, 2022 is a Sunday; heading says Sábado -> conflict
    expect(serviceDateFor("Sábado 3", "2022-07-01")).toMatchObject({
      serviceDate: "2022-07-03",
      type: "saturdarSongs",
      confidence: "conflict"
    });
  });
});

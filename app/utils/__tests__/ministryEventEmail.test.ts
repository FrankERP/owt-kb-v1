import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/sanity/lib/serverClient", () => ({ serverClient: { fetch: vi.fn() }, writeClient: {} }));

import { buildAssignedEmail, buildMusicEmail, joinNames, meetingPath, roleWords, type EmailMeeting } from "../ministryEventEmail";
import { PART_ASK } from "../ministryParts";

const MEETING: EmailMeeting = {
  id: "ministryEvent.00000000-0000-4000-8000-000000000001",
  date: "2026-11-21",
  time: "18:10",
  arrival: "17:30",
  place: "Oasis Tlalpan",
  title: null,
  kind: "saturday",
};
const LINK = "https://app.example/jovenes/reunion/00000000-0000-4000-8000-000000000001";
const SETTINGS = "https://app.example/me/ajustes";

describe("meetingPath", () => {
  it("is the meeting's page, by the token after the dot", () => {
    expect(meetingPath(MEETING.id)).toBe("/jovenes/reunion/00000000-0000-4000-8000-000000000001");
  });
});

describe("roleWords", () => {
  it("names a seat and says what its holder does", () => {
    expect(roleWords({ kind: "seat", id: "encargado", label: "encargado" })).toMatchObject({ label: "Encargado", fills: false });
    expect(roleWords({ kind: "seat", id: "apoyo", label: "apoyo" }).label).toBe("Apoyo");
    // Whoever shares IS the talk: they are asked for their topic and the music.
    expect(roleWords({ kind: "seat", id: "comparte", label: "comparte" })).toEqual({ label: "Plática", ask: PART_ASK.platica, fills: true });
  });

  it("an unknown seat keeps its own word, by own key only", () => {
    expect(roleWords({ kind: "seat", id: "toString", label: "toString" })).toEqual({ label: "toString", ask: null, fills: false });
  });

  it("a part asks for what the form asks", () => {
    expect(roleWords({ kind: "part", id: "dinamica1", label: "Dinámica 1" })).toEqual({ label: "Dinámica 1", ask: PART_ASK.dinamica1, fills: true });
    expect(roleWords({ kind: "part", id: "oracion", label: "x" }).label).toBe("Oración");
  });

  it("a free line is named by its label and asks for nothing", () => {
    expect(roleWords({ kind: "line", id: "k1", label: "Anuncios" })).toEqual({ label: "Anuncios", ask: null, fills: false });
  });
});

describe("buildAssignedEmail", () => {
  const one = () =>
    buildAssignedEmail({
      name: "Jacob Pérez",
      meeting: MEETING,
      roles: [{ kind: "part", id: "dinamica1", label: "Dinámica 1", partnerNames: ["Andy"] }],
      moved: false,
      link: LINK,
      settingsLink: SETTINGS,
    });

  it("says what, when and where, and links the meeting's page", () => {
    const { subject, html } = one();
    expect(subject).toBe("Te toca: Dinámica 1 — sábado 21 de noviembre");
    expect(html).toContain("Hola, Jacob.");
    expect(html).toContain("18:10 · llegada 17:30 · Oasis Tlalpan");
    expect(html).toContain("junto con Andy");
    expect(html).toContain(PART_ASK.dinamica1);
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain("Llenar mi parte →");
  });

  it("speaks as Jóvenes, not as the worship team", () => {
    const { html } = one();
    expect(html).toContain("JÓVENES · OASIS");
    expect(html).toContain("Recibes esto porque sirves en Jóvenes de Oasis.");
    expect(html).not.toContain("OASIS WORSHIP TEAM");
    expect(html).not.toContain("equipo de alabanza de Oasis");
    expect(html).toContain(`href="${SETTINGS}"`);
  });

  it("lists every role the write gave, in one email", () => {
    const { subject, html } = buildAssignedEmail({
      name: "",
      meeting: { ...MEETING, time: null, arrival: null, place: null },
      roles: [
        { kind: "seat", id: "encargado", label: "encargado", partnerNames: [] },
        { kind: "part", id: "oracion", label: "Oración", partnerNames: [] },
      ],
      moved: false,
      link: LINK,
      settingsLink: SETTINGS,
    });
    expect(subject).toBe("Te toca: Encargado y Oración — sábado 21 de noviembre");
    expect(html).toContain("Hola.");
    expect(html).toContain("ENCARGADO");
    expect(html).toContain("ORACIÓN");
  });

  it("typed text never reaches the subject: a free line is «Programa» there, and named in the body", () => {
    const { subject, html } = buildAssignedEmail({
      name: "Goma",
      meeting: MEETING,
      roles: [
        { kind: "line", id: "k1", label: "Rifa <b>sorpresa</b>", partnerNames: [] },
        { kind: "line", id: "k2", label: "Anuncios", partnerNames: [] },
        { kind: "part", id: "oracion", label: "Oración", partnerNames: [] },
      ],
      moved: false,
      link: LINK,
      settingsLink: SETTINGS,
    });
    expect(subject).toBe("Te toca: Programa y Oración — sábado 21 de noviembre");
    expect(html).toContain("Rifa &lt;b&gt;sorpresa&lt;/b&gt;");
    expect(html).not.toContain("<b>sorpresa</b>");
  });

  it("a role with nothing to fill gets «Ver la reunión»", () => {
    const { html } = buildAssignedEmail({
      name: "Goma",
      meeting: MEETING,
      roles: [{ kind: "seat", id: "apoyo", label: "apoyo", partnerNames: [] }],
      moved: false,
      link: LINK,
      settingsLink: SETTINGS,
    });
    expect(html).toContain("Ver la reunión →");
    expect(html).not.toContain("Llenar mi parte");
  });

  it("says the date moved", () => {
    const { subject, html } = buildAssignedEmail({ ...{ name: "Ana", meeting: MEETING, link: LINK, settingsLink: SETTINGS }, roles: [{ kind: "seat", id: "comparte", label: "comparte", partnerNames: [] }], moved: true });
    expect(subject).toBe("Cambió de fecha: Plática — sábado 21 de noviembre");
    expect(html).toContain("La reunión cambió de fecha");
  });

  it("escapes every stored word", () => {
    const { html } = buildAssignedEmail({
      name: "<b>Eve</b>",
      meeting: { ...MEETING, title: `Posada "<script>"`, place: "Casa & jardín" },
      roles: [{ kind: "line", id: "k", label: "<img src=x>", partnerNames: ["<i>Mal</i>"] }],
      moved: false,
      link: LINK,
      settingsLink: SETTINGS,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<b>Eve</b>");
    expect(html).not.toContain("<i>Mal</i>");
    expect(html).toContain("Casa &amp; jardín");
  });
});

describe("buildMusicEmail", () => {
  it("the prayer's request names who asks and carries the note", () => {
    const { subject, html } = buildMusicEmail({ meeting: MEETING, part: "oracion", asks: true, note: "Algo suave", who: ["Jacob"], link: LINK, settingsLink: SETTINGS });
    expect(subject).toBe("Piden música de alabanza — Oración, sábado 21 de noviembre");
    expect(html).toContain("Jacob");
    expect(html).toContain("pide que alguien de alabanza toque durante la");
    expect(html).toContain("(18:10)");
    expect(html).toContain("Algo suave");
    expect(html).toContain("No dice quién");
  });

  it("the talk's request is a song with the band", () => {
    const { html } = buildMusicEmail({ meeting: MEETING, part: "platica", asks: true, note: null, who: ["Ana", "Pastor invitado"], link: LINK, settingsLink: SETTINGS });
    expect(html).toContain("Ana y Pastor invitado");
    expect(html).toContain("pide una canción con el grupo de alabanza al final de la");
    expect(html).not.toContain("SU NOTA");
  });

  it("a withdrawal says it is no longer needed and repeats no note", () => {
    const { subject, html } = buildMusicEmail({ meeting: MEETING, part: "oracion", asks: false, note: "vieja", who: ["Jacob"], link: LINK, settingsLink: SETTINGS });
    expect(subject).toBe("Ya no piden música de alabanza — Oración, sábado 21 de noviembre");
    expect(html).toContain("ya no pide a alguien de alabanza.");
    expect(html).not.toContain("vieja");
  });

  it("still reads when nobody is named, and escapes the note", () => {
    const { html } = buildMusicEmail({ meeting: MEETING, part: "oracion", asks: true, note: "<b>x</b>", who: [], link: LINK, settingsLink: SETTINGS });
    expect(html).toContain("Quien tiene esta parte");
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("joinNames", () => {
  it("joins the Spanish way", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["Pau"])).toBe("Pau");
    expect(joinNames(["Pau", "Mkz"])).toBe("Pau y Mkz");
    expect(joinNames(["Pau", "Mkz", "Lali"])).toBe("Pau, Mkz y Lali");
  });
});

import { describe, expect, it } from "vitest";
import { groupMembersByLetter } from "../MembersPanel";

const m = (member_name: string, alias?: string) => ({ member_name, alias });

describe("groupMembersByLetter — Miembros' letter sections", () => {
  it("letters by the SHOWN name (the alias when there is one), accents folded, in the caller's order", () => {
    const rows = [m("Andrea Pérez", "Andy"), m("Álvaro Ruiz"), m("Gabriela", "Gaby"), m("Ñandú Test"), m("Frank Rochas")];
    expect(groupMembersByLetter(rows, "asc")).toEqual([
      { letter: "A", rows: [rows[0], rows[1]] },
      { letter: "F", rows: [rows[4]] },
      { letter: "G", rows: [rows[2]] },
      { letter: "N", rows: [rows[3]] },
    ]);
  });

  it("follows the sort direction for the letters and keeps «#» last either way", () => {
    const rows = [m("Zoe"), m("123 Bot"), m("Ana")];
    expect(groupMembersByLetter(rows, "desc").map((g) => g.letter)).toEqual(["Z", "A", "#"]);
    expect(groupMembersByLetter(rows, "asc").map((g) => g.letter)).toEqual(["A", "Z", "#"]);
  });

  it("is empty for no rows", () => {
    expect(groupMembersByLetter([], "asc")).toEqual([]);
  });
});

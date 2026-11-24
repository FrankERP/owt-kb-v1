import { describe, expect, it } from "vitest";
import { splitSongTitle } from "../songTitle";

describe("splitSongTitle", () => {
  it("moves a closing parenthetical to the original name", () => {
    expect(splitSongTitle("Cordero y León (Lion and The Lamb)")).toEqual({ main: "Cordero y León", original: "Lion and The Lamb" });
    expect(splitSongTitle("  Así Eres Tú  (Way Maker) ")).toEqual({ main: "Así Eres Tú", original: "Way Maker" });
  });

  it("keeps a title whole when the parenthetical does not close it, or is all there is", () => {
    expect(splitSongTitle("Así Eres Tú (Way Maker) [acústica]")).toEqual({ main: "Así Eres Tú (Way Maker) [acústica]", original: null });
    expect(splitSongTitle("(Live)")).toEqual({ main: "(Live)", original: null });
    expect(splitSongTitle("Nadie")).toEqual({ main: "Nadie", original: null });
    expect(splitSongTitle("Vacío ()")).toEqual({ main: "Vacío ()", original: null });
  });

  it("tolerates a missing title", () => {
    expect(splitSongTitle(null)).toEqual({ main: "", original: null });
    expect(splitSongTitle(undefined)).toEqual({ main: "", original: null });
  });
});

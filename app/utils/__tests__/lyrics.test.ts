import { describe, it, expect } from "vitest";
import { textToBody, bodyToLyrics, groupBySections } from "../lyrics";

// The lyrics editor loads bodyToLyrics(post.body) into a textarea and saves
// textToBody(text). These round-trip tests guard against corrupting an admin's
// lyrics on edit.
const roundTrip = (text: string) => bodyToLyrics(textToBody(text));

describe("lyrics text -> body -> text round-trip", () => {
  it("preserves plain multi-line lyrics", () => {
    const t = "Verso uno\nVerso dos\nVerso tres";
    expect(roundTrip(t)).toBe(t);
  });

  it("preserves blank lines (stanza separators)", () => {
    const t = "Línea uno\n\nLínea dos";
    expect(roundTrip(t)).toBe(t);
  });

  it("preserves an h3 section header", () => {
    const t = "# Coro\nCristo vive";
    expect(roundTrip(t)).toBe(t);
  });

  it("preserves bold and italic inline marks", () => {
    const t = "**Cristo** es *Rey*";
    expect(roundTrip(t)).toBe(t);
  });

  it("preserves a realistic full song shape", () => {
    const t = "# Verso 1\nSublime gracia\ndel Señor\n\n# Coro\n**Grande** es tu fidelidad";
    expect(roundTrip(t)).toBe(t);
  });

  it("leaves markup inside a heading as literal text", () => {
    const t = "# **Coro**";
    expect(roundTrip(t)).toBe(t);
  });

  it("round-trips empty input as empty", () => {
    expect(roundTrip("")).toBe("");
    expect(textToBody("")).toEqual([]);
    expect(bodyToLyrics([])).toBe("");
    expect(bodyToLyrics(undefined)).toBe("");
  });
});

describe("textToBody structure", () => {
  it("marks a '# ' line as an h3 block", () => {
    const [block] = textToBody("# Puente");
    expect(block.style).toBe("h3");
    expect(block.children[0].text).toBe("Puente");
  });

  it("gives strong/em marks to bold/italic spans", () => {
    const [block] = textToBody("a **b** *c*");
    const marks = block.children.map((s: any) => s.marks);
    expect(marks).toContainEqual(["strong"]);
    expect(marks).toContainEqual(["em"]);
  });

  it("does not treat '#' without a space as a heading", () => {
    const [block] = textToBody("#nothashtag");
    expect(block.style).toBe("normal");
  });
});

describe("groupBySections", () => {
  const h = (style: string) => ({ _type: "block", style });
  const p = () => ({ _type: "block", style: "normal" });

  it("returns [] for empty input", () => {
    expect(groupBySections([])).toEqual([]);
    expect(groupBySections(undefined as any)).toEqual([]);
  });

  it("starts a new group at each heading", () => {
    const blocks = [h("h3"), p(), p(), h("h3"), p()];
    const groups = groupBySections(blocks);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(3); // heading + 2 lines
    expect(groups[1]).toHaveLength(2);
  });

  it("keeps leading non-heading blocks in the first group", () => {
    const blocks = [p(), p(), h("h3"), p()];
    const groups = groupBySections(blocks);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2);
  });
});

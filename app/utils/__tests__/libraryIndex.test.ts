import { describe, it, expect } from "vitest";
import {
  parseLibraryParams, serializeLibraryParams, applyLibraryFilters, groupByLetter, libraryKeys, TIPO_SLUGS,
  searchPosts, makeLibraryFuse,
} from "../libraryIndex";
import type { Post } from "../interface";

const tag = (slug: string) => ({ _id: `t-${slug}`, name: slug, slug: { current: slug } });
const post = (title: string, extra: Partial<Post> = {}): Post =>
  ({ _id: title, title, author: "", slug: { current: title }, key: "", bpm: "", timeSig: "", tags: [], ...extra } as unknown as Post);

const POSTS = [
  post("Ánclame", { author: "Marco", key: "G", tags: [tag("up-beat"), tag("amor")] }),
  post("Alaba", { author: "Elevation", key: "A", tags: [tag("down-beat")] }),
  post("10,000 razones", { author: "Redman", key: "G", tags: [tag("gratitud")], authors: [{ _id: "a1", name: "Redman", slug: { current: "redman" } }] }),
  post("Bueno es", { author: "Hillsong", key: "D", tags: [tag("up-beat"), tag("amor")] }),
];

describe("parseLibraryParams / serializeLibraryParams", () => {
  it("reads q, tag (comma list), author, key; ignores unknown keys", () => {
    expect(parseLibraryParams({ q: "ala", tag: "up-beat,amor", author: "redman", key: "G", x: "1" }))
      .toEqual({ q: "ala", tags: ["up-beat", "amor"], author: "redman", key: "G" });
  });
  it("round-trips and omits empty fields", () => {
    expect(serializeLibraryParams({ q: "", tags: ["amor"], author: "", key: "" })).toBe("tag=amor");
    expect(serializeLibraryParams({ q: "a b", tags: [], author: "", key: "" })).toBe("q=a+b");
    expect(serializeLibraryParams(parseLibraryParams({}))).toBe("");
  });
});

describe("applyLibraryFilters", () => {
  it("no filters → every post, A–Z by folded title", () => {
    expect(applyLibraryFilters(POSTS, parseLibraryParams({})).map((p) => p.title))
      .toEqual(["10,000 razones", "Alaba", "Ánclame", "Bueno es"]);
  });
  it("tags are AND-ed", () => {
    expect(applyLibraryFilters(POSTS, parseLibraryParams({ tag: "up-beat,amor" })).map((p) => p.title))
      .toEqual(["Ánclame", "Bueno es"]);
  });
  it("author matches the reference slug OR the legacy author string, accent-insensitive", () => {
    expect(applyLibraryFilters(POSTS, parseLibraryParams({ author: "redman" }))).toHaveLength(1);
    expect(applyLibraryFilters(POSTS, parseLibraryParams({ author: "Elevation" }))).toHaveLength(1);
  });
  it("key is exact", () => {
    expect(applyLibraryFilters(POSTS, parseLibraryParams({ key: "G" }))).toHaveLength(2);
  });
  it("short queries are accent-insensitive prefix-first substring matches", () => {
    expect(applyLibraryFilters(POSTS, parseLibraryParams({ q: "an" })).map((p) => p.title)).toEqual(["Ánclame"]);
  });
  it("3+ char queries are fuzzy and keep prefix matches first", () => {
    const titles = applyLibraryFilters(POSTS, parseLibraryParams({ q: "alab" })).map((p) => p.title);
    expect(titles[0]).toBe("Alaba");
  });
  it("a query runs first over the whole catalogue; tag/author/key then narrow that order without re-sorting", () => {
    const fuse = makeLibraryFuse(POSTS);
    const expected = searchPosts(POSTS, "e", fuse).filter((p) => (p.tags ?? []).some((t) => t.slug?.current === "up-beat"));
    expect(applyLibraryFilters(POSTS, parseLibraryParams({ tag: "up-beat", q: "e" }), fuse)).toEqual(expected);
  });
});

describe("groupByLetter", () => {
  it("groups by folded first letter, digits under #, sections in A–Z order with # last", () => {
    const groups = groupByLetter(applyLibraryFilters(POSTS, parseLibraryParams({})));
    expect(groups.map((g) => g.letter)).toEqual(["A", "B", "#"]);
    expect(groups[0].posts.map((p) => p.title)).toEqual(["Alaba", "Ánclame"]);
  });
});

describe("libraryKeys / TIPO_SLUGS", () => {
  it("lists distinct keys sorted, blanks dropped", () => {
    expect(libraryKeys(POSTS)).toEqual(["A", "D", "G"]);
  });
  it("pins the three Tipo slugs", () => {
    expect(TIPO_SLUGS).toEqual(["up-beat", "down-beat", "transition"]);
  });
});

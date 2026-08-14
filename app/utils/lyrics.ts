// Shared utilities for converting between plain-text lyrics format and Sanity PortableText.
//
// Plain-text format:
//   # Coro        → h3 block
//   **text**      → strong mark
//   *text*        → em mark
//   blank line    → empty block (stanza separator)

// `PortableTextBlock` comes from `@portabletext/react` — a direct dependency
// that re-exports it — rather than from the transitive `@portabletext/types`.
import type { PortableTextBlock } from "@portabletext/react";

// What these functions READ: a stored body, whose entries are not all blocks and
// whose block children are not all spans. Both functions below have always
// handled that; the type now says so instead of making every caller cast.
import type { PortableTextBody } from "./interface";

// The subset of Portable Text this converter WRITES. Deliberately narrower than
// `PortableTextBlock`: the editor round-trips lines of lyrics, so everything it
// emits is a `block` of `span`s and nothing else. Reads stay wide — see the
// `PortableTextBody` parameters below, which accept whatever Sanity holds.
interface LyricSpan {
  _type: "span";
  _key: string;
  text: string;
  marks: string[];
}

interface LyricBlock {
  _type: "block";
  _key: string;
  style: "normal" | "h3";
  markDefs: never[];
  children: LyricSpan[];
}

function rng() { return Math.random().toString(36).slice(2, 9); }

// Split a line into PortableText span children, respecting **bold** and *italic*.
function parseSpans(line: string): LyricSpan[] {
  if (line === "") return [{ _type: "span", _key: rng(), text: "", marks: [] }];

  // Regex: capture **bold** or *italic* (non-greedy, no * inside)
  const segments = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/);
  const spans: LyricSpan[] = [];

  for (const seg of segments) {
    if (!seg) continue;
    if (seg.startsWith("**") && seg.endsWith("**")) {
      spans.push({ _type: "span", _key: rng(), text: seg.slice(2, -2), marks: ["strong"] });
    } else if (seg.startsWith("*") && seg.endsWith("*")) {
      spans.push({ _type: "span", _key: rng(), text: seg.slice(1, -1), marks: ["em"] });
    } else {
      spans.push({ _type: "span", _key: rng(), text: seg, marks: [] });
    }
  }

  return spans.length > 0 ? spans : [{ _type: "span", _key: rng(), text: line, marks: [] }];
}

export function textToBody(text: string): LyricBlock[] {
  if (!text) return [];
  return text.split("\n").map((line) => {
    if (line.startsWith("# ")) {
      return {
        _type: "block", _key: rng(), style: "h3", markDefs: [],
        children: [{ _type: "span", _key: rng(), text: line.slice(2), marks: [] }],
      };
    }
    return {
      _type: "block", _key: rng(), style: "normal", markDefs: [],
      children: parseSpans(line),
    };
  });
}

export function bodyToLyrics(body: PortableTextBody | undefined): string {
  if (!body?.length) return "";
  return body
    .filter(isBlock)
    .map((b) => {
      const lineText = (b.children ?? [])
        // Anything that is not a span (an inline object, say) has no text to
        // round-trip, so it contributes "" — exactly what `c.text ?? ""` did
        // before the narrowing made the distinction visible.
        .map((c) => {
          if (!isSpan(c)) return "";
          const t = c.text ?? "";
          const marks: string[] = c.marks ?? [];
          if (marks.includes("strong")) return `**${t}**`;
          if (marks.includes("em"))     return `*${t}*`;
          return t;
        })
        .join("");
      return b.style === "h3" || b.style === "h2" ? `# ${lineText}` : lineText;
    })
    .join("\n");
}

/** A span as READ back: `_key` and `marks` are optional in stored Portable Text. */
type StoredSpan = { _type: "span"; text?: string; marks?: string[] };

function isBlock(entry: PortableTextBody[number]): entry is PortableTextBlock {
  return entry?._type === "block";
}

function isSpan(child: { _type?: string }): child is StoredSpan {
  return child?._type === "span";
}

export function groupBySections(blocks: PortableTextBody | undefined): PortableTextBody[] {
  if (!blocks?.length) return [];
  const groups: PortableTextBody[] = [];
  let current: PortableTextBody = [];
  for (const block of blocks) {
    const isHeading = ["h1", "h2", "h3", "h4"].includes(isBlock(block) ? block.style ?? "" : "");
    if (isHeading && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

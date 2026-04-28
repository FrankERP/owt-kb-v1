// Shared utilities for converting between plain-text lyrics format and Sanity PortableText.
//
// Plain-text format:
//   # Coro        → h3 block
//   **text**      → strong mark
//   *text*        → em mark
//   blank line    → empty block (stanza separator)

function rng() { return Math.random().toString(36).slice(2, 9); }

// Split a line into PortableText span children, respecting **bold** and *italic*.
function parseSpans(line: string): any[] {
  if (line === "") return [{ _type: "span", _key: rng(), text: "", marks: [] }];

  // Regex: capture **bold** or *italic* (non-greedy, no * inside)
  const segments = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/);
  const spans: any[] = [];

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

export function textToBody(text: string): any[] {
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

export function bodyToLyrics(body: any[] | undefined): string {
  if (!body?.length) return "";
  return body
    .filter((b) => b._type === "block")
    .map((b) => {
      const lineText = (b.children ?? [])
        .map((c: any) => {
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

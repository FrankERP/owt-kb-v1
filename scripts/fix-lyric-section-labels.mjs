// One-off: lyric section labels stored as PLAIN LINES become `h3` blocks.
//
// The song page (R6) renders `h1`–`h4` lyric blocks as rail eyebrows and groups the
// stanzas under them (`groupBySections`). A label typed as an ordinary line — «Verso 1»,
// «Coro», «Puente» — renders as lyrics instead. This script finds every `normal` block
// whose WHOLE text is a section label in the catalogue's own vocabulary (the heading
// strings that already exist across the catalogue) and sets its `style` to `h3`. Nothing
// else about the block changes — same `_key`, same children — so the conversion is
// reversible from Sanity's document history.
//
// Dry run by default; writes only with `--apply`. Run from the repo root:
//
//   node --env-file=.env.local scripts/fix-lyric-section-labels.mjs            # report
//   node --env-file=.env.local scripts/fix-lyric-section-labels.mjs --apply    # write
//
// Idempotent: a second `--apply` finds nothing to change. Songs with NO labels at all
// (stanzas separated by blank lines) are listed but never touched — inventing labels is
// content authoring, not a fix.

import { createClient } from "next-sanity";

const APPLY = process.argv.includes("--apply");

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-01-01",
  useCdn: false,
  perspective: "published",
  token: process.env.SANITY_WRITE_TOKEN,
});

// The catalogue's heading vocabulary (measured 2026-09-18 over every h1–h4 lyric block):
// coro 377 · verso 324 · puente 138 · pre-coro 99 · tag 56 · post-coro 12 · refrain 5 ·
// vamp · instrumental. A label may carry a number («Verso 2») and/or a repeat note
// («Coro (x2)», «Coro 3 x»). The whole line must be the label — a lyric that merely
// starts with «Coro…» is not one.
const LABEL =
  /^\s*(verso|coro|pre[\s-]?coro|post[\s-]?coro|puente|tag|refrain|refr[aá]n|estribillo|intro|outro|final|interludio|instrumental|vamp)(\s+\d+)?(\s*\(?x?\s*\d+\s*(x|veces)?\)?)?\s*$/i;

const text = (block) =>
  (block?.children ?? [])
    .filter((c) => c?._type === "span")
    .map((c) => c.text ?? "")
    .join("");

const docs = await client.fetch(
  `*[_type == "post" && count(body) > 0 && count(body[style in ["h1","h2","h3","h4"]]) == 0]{
    _id, title, "slug": slug.current, body
  }`,
);

let patched = 0;
const unlabelled = [];
for (const doc of docs) {
  const hits = (doc.body ?? []).filter(
    (b) => b?._type === "block" && (b.style ?? "normal") === "normal" && LABEL.test(text(b)),
  );
  if (hits.length === 0) {
    unlabelled.push(`${doc.title} (${doc.slug}) — ${doc.body.length} blocks, no label lines`);
    continue;
  }
  console.log(`\n${doc.title} (${doc._id})`);
  for (const b of hits) console.log(`  normal → h3  "${text(b)}"  [${b._key}]`);
  if (APPLY) {
    let p = client.patch(doc._id);
    for (const b of hits) p = p.set({ [`body[_key=="${b._key}"].style`]: "h3" });
    await p.commit();
    patched += 1;
    console.log(`  written`);
  }
}

if (unlabelled.length) {
  console.log(`\nLeft alone (no section labels to convert):`);
  for (const u of unlabelled) console.log(`  ${u}`);
}
console.log(
  APPLY
    ? `\nApplied to ${patched} document(s).`
    : `\nDRY RUN — nada escrito. Re-ejecuta con --apply para aplicar.`,
);

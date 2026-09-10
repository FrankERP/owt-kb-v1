// scripts/retag-songs.mjs
//
// One-off catalogue re-tag (2026-09-05). Reads every `post`, replaces its THEMATIC
// tags with the curated set below (derived from the stored lyrics), keeps the tempo
// tags (Up Beat / Down Beat / Transition) untouched unless TEMPO_OVERRIDES says
// otherwise, strips every ARTIST tag from `tags` (artists live in `authors` since the
// 2026-06-24 migration), folds near-duplicate theme tags into their canonical name,
// creates the new theme tags, and finally deletes the tag documents that are left
// unreferenced (artist tags, folded duplicates, junk).
//
// Dry-run by default — prints the full diff and exits. Nothing is written without
// `--apply`. Run from the repo root:
//
//   node --env-file=.env.local scripts/retag-songs.mjs            # dry-run
//   node --env-file=.env.local scripts/retag-songs.mjs --apply    # write
//
// Idempotent: a second --apply run finds nothing to change.
//
// STATE: APPLIED 2026-09-06 (see docs/SOLVER_AND_INFRA.md). Kept runnable as the record of
// what was decided — but THEMES is authoritative and the post patch is a full-array
// replace, so a later --apply RE-IMPOSES this table over any tag edit made in Studio
// after 2026-09-06. Read the dry-run diff before any re-run; "idempotent" only means the
// dataset matched this table on the day it was applied.

import { createClient } from "next-sanity";
import { slugifyAuthor as slugify } from "../app/utils/slugifyAuthor.mjs";

const APPLY = process.argv.includes("--apply");

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-07-23",
  useCdn: false,
  token: process.env.SANITY_WRITE_TOKEN,
});

// ── Vocabulary ─────────────────────────────────────────────────────────────────

/** Functional tags the app pins in TagSearchList — never touched by the theme pass. */
const TEMPO_TAGS = new Set(["Up Beat", "Down Beat", "Transition"]);

/** Artist / band tags that must leave `tags` (they are `authors` now). Deleted at the end. */
const ARTIST_TAGS = new Set([
  "Charity Gayle", "Chris Tomlin", "Conquistando Fronteras", "Cory Asbury",
  "Darlene Zschech", "Elevation Worship", "En Espíritu y En Verdad", "Gateway Worship",
  "Hillsong United", "Hillsong Worship", "Hillsong Young & Free", "Marco Barrientos",
  "Marcos Vidal", "Marcos Witt", "Maverick City", "Miel San Marcos",
  "North Point Worship", "Passion", "Planetshakers", "UPPERROOM", "Un Corazón",
]);

/** Near-duplicate theme tags folded into their canonical name. Deleted at the end. */
const FOLD = {
  "Amor de Dios": "Amor",
  "Gracia de Dios": "Gracia",
  "Grandeza de Dios": "Grandeza",
  "Fidelidad de Dios": "Fidelidad",
  "Dios Santo": "Santidad",
  "Nombre de Jesús": "Su Nombre",
  "Estar cerca de Dios": "Presencia",
  "Entrega a Dios": "Rendición",
  "Rendir Cargas": "Consuelo",
  "Necesitar a Dios": "Anhelo",
  "Poder/Fuego": "Espíritu Santo",
};

/** Junk — zero references, not a theme. Deleted at the end. */
const JUNK_TAGS = new Set(["JavaScript"]);

/** Theme tags that do not exist yet. Created (with a proper accent-stripped slug) before patching. */
const NEW_TAGS = [
  "Adoración", "Anhelo", "Espíritu Santo", "Gozo", "Gratitud",
  "Libertad", "Perdón", "Sanidad", "Victoria",
];

/** Existing tag slugs that were minted by the accent-dropping slugifier and read badly in URLs. */
const SLUG_FIXES = {
  "Hijo Pródigo": "hijo-prodigo",       // was hijo-prdigo
  "Restauración": "restauracion",       // was restauracin
};

/**
 * Tempo overrides — songs that had no tempo tag at all. Only set where the
 * arrangement the team uses is unambiguous. Everything else keeps what it has.
 */
const TEMPO_OVERRIDES = {
  "El Que Resucitó (Resurrecting)": ["Down Beat"],
  "Lo Único Que Quiero": ["Down Beat"],
  "Porque Él Vive (Because He Lives)": ["Down Beat"],
  "Todo Debo A Él (Jesus Paid It All)": ["Down Beat"],
  "Tu Amor Es Fiel (One Thing Remains)": ["Down Beat"],
};

// ── Theme assignment ───────────────────────────────────────────────────────────
//
// Keyed by trimmed post title. A song absent from this map keeps its current theme
// tags (only artist tags are stripped and folds applied) — that is the case for the
// seven songs with no lyrics in the catalogue whose content could not be verified.

const THEMES = {
  "10,000 Razones (10,000 Reasons [Bless The Lord])": ["Adoración", "Fidelidad", "Grandeza", "Gratitud"],
  "A Ti Me Rindo (I Surrender)": ["Rendición", "Anhelo", "Presencia"],
  "Al Que Está Sentado En El Trono (To The One Who Is Seated On The Throne)": ["Adoración", "Señorío", "Presencia", "Anhelo", "Santidad"],
  "Alaba (Praise)": ["Adoración", "Gozo", "Confianza"],
  "Alabaré Al Señor (O Praise The Name [Anástasis])": ["Resurrección", "Crucifixión", "Sacrificio", "Segunda Venida", "Adoración"],
  "Amor Sin Condición": ["Crucifixión", "Amor", "Gratitud", "Redención", "Sacrificio"],
  "Amor Sin Condición (Reckless Love)": ["Amor", "Gracia", "Redención"],
  "Anclado (Anchor)": ["Confianza", "Esperanza", "Fidelidad"],
  "Aquí Estamos Para Ti (Here For You)": ["Presencia", "Espíritu Santo", "Pentecostés", "Adoración"],
  "Aquí Estoy (The Stand)": ["Rendición", "Crucifixión", "Sacrificio"],
  "Así Eres Tú (Way Maker)": ["Fidelidad", "Poder", "Promesas", "Presencia", "Sanidad"],
  "Avivamiento (Lord Send Revival)": ["Espíritu Santo", "Pentecostés", "Presencia", "Poder", "Santidad"],
  "Cielo Abierto (Open Heaven)": ["Espíritu Santo", "Pentecostés", "Presencia", "Restauración", "Rendición"],
  "Cielo Y Tierra": ["Su Nombre", "Adoración", "Grandeza"],
  "Clamo A Cristo (I Speak Jesus)": ["Su Nombre", "Poder", "Libertad", "Sanidad"],
  "Como El Sol": ["Esperanza", "Segunda Venida", "Comunidad", "Identidad en Cristo", "Fidelidad", "Amor"],
  "Como En El Cielo (Here As In Heaven)": ["Espíritu Santo", "Pentecostés", "Presencia", "Poder", "Amor"],
  "Con Todo (With Everything)": ["Adoración", "Rendición", "Grandeza"],
  "Conectado (In Sync)": ["Gracia", "Amor", "Rendición"],
  "Cordero Y León (Lion and The Lamb)": ["Señorío", "Domingo de Ramos", "Cordero de Dios", "Poder", "Segunda Venida"],
  "Cristo Es El Centro": ["Señorío", "Confianza", "Rendición", "Gozo"],
  "Cuán Grande Es Él (How Great Is Our God)": ["Grandeza", "Adoración", "Su Nombre"],
  "Desde Mi Interior (From The Inside Out)": ["Rendición", "Gracia", "Fidelidad", "Anhelo"],
  "Digno": ["Digno", "Grandeza", "Rendición", "Perdón", "Presencia"],
  "Digno Eres Señor (Worthy Is The Lamb)": ["Digno", "Crucifixión", "Sacrificio", "Gratitud", "Señorío", "Redención"],
  "Digno Es El Señor (Worthy Is The Lamb)": ["Digno", "Cordero de Dios", "Señorío", "Adoración", "Santidad"],
  "Dios De Imposibles": ["Confianza", "Poder", "Dirección", "Fe"],
  "Dios De Pactos": ["Promesas", "Fidelidad", "Confianza", "Presencia"],
  "Dios Es Amor": ["Amor", "Rendición", "Redención"],
  "Dios Es Amor (Our God Is Love)": ["Amor", "Redención", "Resurrección"],
  "Dios Está Aquí": ["Presencia", "Amor"],
  "Dios Incomparable": ["Grandeza", "Adoración", "Amor"],
  "Donde Tú Estás (Where You Are)": ["Presencia", "Anhelo", "Santidad", "Amor"],
  "Eco (Echo)": ["Amor", "Esperanza", "Identidad en Cristo", "Fidelidad", "Promesas"],
  "El Gran Yo Soy (The Great I Am)": ["Grandeza", "Santidad", "Poder", "Su Nombre"],
  "El Nombre": ["Su Nombre", "Señorío", "Poder", "Libertad", "Sanidad"],
  "El Que Resucitó (Resurrecting)": ["Resurrección", "Crucifixión", "Redención", "Señorío", "Su Nombre"],
  "En Aquella Cruz (Man Of Sorrows)": ["Crucifixión", "Sacrificio", "Redención", "Resurrección", "Cordero de Dios"],
  "En Cristo Puedo": ["Confianza", "Fidelidad", "Poder", "Fe", "Identidad en Cristo", "Esperanza"],
  "En El Monte Calvario (The Old Rugged Cross)": ["Crucifixión", "Sacrificio", "Himnario", "Cordero de Dios", "Redención"],
  "En Lo Profundo": ["Rendición", "Anhelo", "Dirección"],
  "En Pos De Ti": ["Presencia", "Anhelo"],
  "Entre Las Llamas (Another In The Fire)": ["Fidelidad", "Poder", "Promesas", "Confianza", "Libertad"],
  "Es Navidad": ["Navidad", "Gozo", "Adoración"],
  "Gloriosa Cruz (The Wonderful Cross)": ["Crucifixión", "Sacrificio", "Rendición", "Himnario"],
  "Glorioso Día": ["Redención", "Resurrección", "Libertad", "Perdón"],
  "Gracia Sin Fin (Scandal Of Grace)": ["Gracia", "Crucifixión", "Redención", "Rendición", "Sacrificio"],
  "Gracia Sublime Es (This Is Amazing Grace)": ["Gracia", "Redención", "Crucifixión", "Cordero de Dios", "Digno", "Libertad"],
  "Gracias Dios (I Thank God)": ["Gratitud", "Redención", "Restauración", "Libertad", "Hijo Pródigo"],
  "Guíame A Ti (Pursue)": ["Rendición", "Anhelo", "Presencia"],
  "Ha Nacido": ["Navidad", "Adoración", "Señorío", "Gozo"],
  "Habitación": ["Presencia", "Comunidad", "Grandeza"],
  "Hay Una Nube (There Is A Cloud)": ["Espíritu Santo", "Promesas", "Esperanza", "Pentecostés", "Restauración"],
  "Hermoso Nombre (What A Beautiful Name)": ["Su Nombre", "Resurrección", "Señorío", "Redención"],
  "Imagina": ["Comunidad", "Señorío", "Segunda Venida", "Gracia"],
  "Increíble": ["Grandeza", "Poder", "Victoria", "Adoración"],
  "Infinito Dios": ["Grandeza", "Fidelidad", "Esperanza", "Consuelo"],
  "Jesucristo Basta": ["Amor", "Gracia", "Redención", "Esperanza"],
  "Jesús En El Centro (Jesus At The Center)": ["Señorío", "Rendición", "Su Nombre"],
  "Jesús, El Mesías (Jesus Messiah)": ["Crucifixión", "Redención", "Sacrificio", "Su Nombre", "Cordero de Dios"],
  "Jesús, Hijo De Dios": ["Crucifixión", "Redención", "Resurrección", "Sacrificio", "Amor"],
  "La Casa (The House)": ["Comunidad", "Gozo", "Gratitud"],
  "León (Lion)": ["Poder", "Señorío", "Cordero de Dios", "Grandeza"],
  "Libre Soy (Let Go)": ["Libertad", "Rendición", "Identidad en Cristo", "Redención"],
  "Lo Creeré (Believe For It)": ["Fe", "Confianza", "Poder", "Promesas", "Esperanza", "Su Nombre"],
  "Lo Harás Otra Vez (Do It Again)": ["Confianza", "Fidelidad", "Promesas", "Fe", "Poder"],
  "Lo Único Que Quiero": ["Anhelo", "Adoración", "Rendición", "Redención"],
  "Me Amaste Así (Whole Heart)": ["Gracia", "Amor", "Rendición", "Redención", "Perdón", "Libertad"],
  "Mi Deseo (One Thing)": ["Anhelo", "Rendición", "Presencia"],
  "Mi Roca (Cornerstone)": ["Esperanza", "Confianza", "Segunda Venida", "Señorío"],
  "Mi Sanador": ["Sanidad", "Crucifixión", "Redención", "Confianza", "Victoria", "Restauración"],
  "Mil Y Un Aleluyas (A Thousand Hallelujahs)": ["Adoración", "Grandeza", "Cordero de Dios", "Resurrección"],
  "Mirad (Behold)": ["Navidad", "Adoración", "Digno", "Señorío"],
  "Mirad/Te Canto Hoy (Behold/Then Sings My Soul)": ["Navidad", "Adoración", "Grandeza"],
  "Mismo Dios (Same God)": ["Fidelidad", "Promesas", "Confianza", "Anhelo", "Poder"],
  "Mover Tu Corazón (Move Your Heart)": ["Rendición", "Anhelo", "Presencia", "Adoración"],
  "Muestra Tu Gloria (Show Me Your Glory)": ["Grandeza", "Santidad", "Presencia", "Anhelo", "Poder"],
  "Más Grande (Greater Than)": ["Grandeza", "Poder", "Confianza", "Fidelidad"],
  "Nace El Rey (Born Is The King)": ["Navidad", "Gozo", "Adoración"],
  "Nada Es Imposible (Nothing Is Impossible)": ["Fe", "Confianza", "Poder", "Libertad"],
  "Nadie (No One)": ["Grandeza", "Santidad", "Su Nombre", "Adoración", "Poder"],
  "No Hay Lugar Más Alto": ["Rendición", "Presencia", "Perdón", "Adoración"],
  "No Hay Otro Nombre (No Other Name)": ["Su Nombre", "Resurrección", "Señorío", "Grandeza", "Poder", "Santidad"],
  "No Puedo Callar": ["Gozo", "Libertad", "Restauración", "Redención", "Identidad en Cristo"],
  "Noche De Paz (Silent Night)": ["Navidad", "Himnario"],
  "Nunca Me Has Fallado (Never Fail)": ["Confianza", "Fidelidad", "Promesas", "Rendición", "Consuelo"],
  "Océanos (Oceans)": ["Confianza", "Dirección", "Fe", "Fidelidad", "Espíritu Santo"],
  "Ojos De Amor": ["Hijo Pródigo", "Perdón", "Amor", "Restauración", "Identidad en Cristo"],
  "Orgullo De Un Padre (Pride Of A Father)": ["Amor", "Hijo Pródigo", "Identidad en Cristo", "Gracia", "Perdón"],
  "Pasión (Passion)": ["Crucifixión", "Sacrificio", "Amor", "Perdón"],
  "Por La Cruz (For The Cross)": ["Crucifixión", "Redención", "Gratitud", "Sacrificio", "Perdón"],
  "Por Siempre Cantaré (Only Wanna Sing)": ["Adoración", "Rendición"],
  "Por Siempre Te Alabaré (Endless Praise)": ["Adoración", "Grandeza", "Señorío"],
  "Por Ti (Go)": ["Rendición", "Libertad", "Identidad en Cristo", "Comunidad"],
  "Porque Él Vive (Because He Lives)": ["Resurrección", "Esperanza", "Confianza", "Himnario"],
  "Quien Dices Que Soy (Who You Say I Am)": ["Identidad en Cristo", "Libertad", "Gracia", "Redención", "Perdón"],
  "Quién Más (Who Else)": ["Digno", "Cordero de Dios", "Señorío", "Adoración", "Santidad"],
  "Resplandeció!": ["Libertad", "Redención", "Victoria", "Poder", "Esperanza"],
  "Ruinas Gloriosas": ["Restauración", "Confianza", "Poder", "Promesas", "Esperanza"],
  "Salmo 23": ["Confianza", "Consuelo", "Dirección", "Amor", "Presencia"],
  "Santa La Noche (O Holy Night)": ["Navidad", "Himnario", "Adoración", "Esperanza"],
  "Santo Por Siempre (Holy Forever)": ["Santidad", "Su Nombre", "Adoración", "Cordero de Dios", "Señorío"],
  "Santo Por Siempre - Navidad (Holy Forever)": ["Navidad", "Santidad", "Su Nombre", "Adoración", "Señorío"],
  "Sendas Dios Hará": ["Promesas", "Poder", "Dirección", "Confianza"],
  "Siempre YHWH (Forever YHWH)": ["Grandeza", "Su Nombre", "Digno", "Adoración"],
  "Sobrenatural (Supernatural Love)": ["Amor", "Gracia", "Restauración", "Poder"],
  "Socorro": ["Confianza", "Esperanza", "Consuelo", "Fidelidad"],
  "Solo Dios Puede Salvar (Mighty To Save)": ["Poder", "Redención", "Resurrección", "Rendición"],
  "Somos Iglesia": ["Comunidad", "Identidad en Cristo", "Resurrección", "Victoria"],
  "Somos Libres": ["Libertad", "Redención", "Identidad en Cristo", "Resurrección", "Comunidad"],
  "Son En Alta Esfera (Hark)": ["Navidad", "Himnario", "Adoración"],
  "Sopla Espíritu (Spirit Move)": ["Espíritu Santo", "Presencia", "Pentecostés", "Anhelo"],
  "Sube Más Alto": ["Adoración", "Gozo", "Anhelo"],
  "Sublime Gracia": ["Gracia", "Himnario", "Redención"],
  "Sólo En Jesús (In Jesus Name)": ["Su Nombre", "Victoria", "Libertad", "Sanidad", "Poder"],
  "Sólo Tu Amor (Need Your Love)": ["Amor", "Anhelo"],
  "Tal Como Soy (As You Find Me)": ["Amor", "Gracia", "Perdón", "Rendición"],
  "Te Amo, Señor": ["Amor", "Gracia", "Identidad en Cristo", "Redención", "Perdón"],
  "Tocar El Cielo (Touch The Sky)": ["Rendición", "Anhelo"],
  "Todo Cambia": ["Señorío", "Poder", "Restauración", "Esperanza", "Amor"],
  "Todo Debo A Él (Jesus Paid It All)": ["Crucifixión", "Redención", "Gracia", "Himnario", "Sacrificio", "Gratitud"],
  "Todo Lo Haces Bien (Something Good)": ["Confianza", "Promesas", "Fidelidad", "Consuelo", "Poder"],
  "Tomaste Mi Lugar": ["Crucifixión", "Redención", "Sacrificio", "Gratitud", "Perdón", "Gracia"],
  "Tu Amor Es Fiel (One Thing Remains)": ["Amor", "Fidelidad", "Confianza"],
  "Tu Corazón (Heart Of God)": ["Gracia", "Perdón", "Hijo Pródigo", "Rendición", "Identidad en Cristo", "Fidelidad"],
  "Tumbas A Jardines (Graves Into Gardens)": ["Restauración", "Poder", "Gracia", "Amor", "Fidelidad"],
  "Tómalo (Take It All)": ["Rendición", "Redención", "Crucifixión", "Libertad"],
  "Tú (You)": ["Rendición", "Gracia", "Amor", "Libertad", "Identidad en Cristo"],
  "Vamos A Cantar (Sing Sing Sing)": ["Adoración", "Gozo", "Su Nombre", "Libertad"],
  "Ven Ante Su Trono (Oh Come To The Altar)": ["Consuelo", "Perdón", "Redención", "Rendición", "Resurrección"],
  "Vida Tú Me Das (This Is Living)": ["Identidad en Cristo", "Libertad", "Amor", "Restauración"],
  "Viene Un Rey": ["Domingo de Ramos", "Señorío", "Su Nombre", "Grandeza"],
  "Vives En Mí (Wake)": ["Confianza", "Identidad en Cristo", "Amor", "Fidelidad"],
  "Vivo Estás (Alive)": ["Identidad en Cristo", "Libertad", "Redención", "Resurrección", "Amor"],
  "Él Venció (Victory)": ["Redención", "Resurrección", "Victoria", "Crucifixión", "Libertad"],
};

/**
 * Songs deliberately left alone: no lyrics stored and the content could not be
 * verified beyond doubt. They keep their current theme tags (none today).
 */
const UNVERIFIED = [
  "Canta Otra Vez (Sing It Again)",
  "En Tu Presencia",
  "Fiel",
  "Generación Que Danza",
  "Heme Aquí",
  "Más Allá De Tu Ventana (World Outside Your Window)",
  "Tú Mereces (You Deserve)",
];

/**
 * Artist tags that named a band the post's `authors` does NOT list. Surfaced for a
 * human decision; this script never edits `authors`.
 */
const COAUTHOR_QUESTIONS = [
  { title: "Gracias Dios (I Thank God)", tag: "UPPERROOM" },
  { title: "Gracia Sublime Es (This Is Amazing Grace)", tag: "En Espíritu y En Verdad" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

const key = () => Math.random().toString(36).slice(2, 10);
const norm = (s) => (s ?? "").trim();

function canonicalName(name) {
  return FOLD[name] ?? name;
}

function assertVocabulary(tagNames) {
  const known = new Set([...tagNames, ...NEW_TAGS]);
  const bad = [];
  for (const [title, list] of Object.entries(THEMES)) {
    for (const t of list) {
      if (!known.has(t)) bad.push(`${title}: "${t}"`);
      if (TEMPO_TAGS.has(t) || ARTIST_TAGS.has(t) || FOLD[t]) bad.push(`${title}: "${t}" is not a theme`);
    }
    if (new Set(list).size !== list.length) bad.push(`${title}: duplicate tag`);
  }
  if (bad.length) {
    console.error("Vocabulary errors:\n  " + bad.join("\n  "));
    process.exit(1);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const [tags, posts] = await Promise.all([
    client.fetch(`*[_type=="tag"]{_id, name, "slug": slug.current}`),
    client.fetch(`*[_type=="post"] | order(title) {_id, title, "authors": authors[]->name, tags[]{_key, _ref}}`),
  ]);
  const drafts = posts.filter((p) => p._id.startsWith("drafts."));
  if (drafts.length) {
    console.error(`Refusing: ${drafts.length} draft post(s) exist; publish or discard them first.`);
    process.exit(1);
  }

  const tagById = new Map(tags.map((t) => [t._id, t]));
  const idByName = new Map(tags.map((t) => [t.name, t._id]));
  assertVocabulary(tags.map((t) => t.name));

  // Title → post, guarding against duplicates.
  const postByTitle = new Map();
  for (const p of posts) {
    const t = norm(p.title);
    if (postByTitle.has(t)) { console.error(`Duplicate title: "${t}"`); process.exit(1); }
    postByTitle.set(t, p);
  }
  for (const t of [...Object.keys(THEMES), ...Object.keys(TEMPO_OVERRIDES), ...UNVERIFIED]) {
    if (!postByTitle.has(t)) { console.error(`Title not found in Sanity: "${t}"`); process.exit(1); }
  }
  for (const p of posts) {
    const t = norm(p.title);
    if (!THEMES[t] && !UNVERIFIED.includes(t)) { console.error(`Untreated post: "${t}"`); process.exit(1); }
  }

  // 1. New tag docs (placeholder IDs in dry-run).
  const creates = [];
  for (const name of NEW_TAGS) {
    if (idByName.has(name)) continue;
    const slug = slugify(name);
    if (tags.some((t) => t.slug === slug)) { console.error(`Slug collision for new tag "${name}": ${slug}`); process.exit(1); }
    const _id = APPLY ? undefined : `NEW:${slug}`;
    creates.push({ _id, _type: "tag", name, slug: { _type: "slug", current: slug } });
  }

  // 2. Slug fixes.
  const slugPatches = [];
  for (const [name, slug] of Object.entries(SLUG_FIXES)) {
    const id = idByName.get(name);
    if (id && tagById.get(id).slug !== slug) slugPatches.push({ id, name, from: tagById.get(id).slug, to: slug });
  }

  // 3. Per-post tag arrays.
  const plans = [];
  for (const p of posts) {
    const title = norm(p.title);
    const current = (p.tags ?? []).map((r) => tagById.get(r._ref)).filter(Boolean);
    const currentNames = current.map((t) => t.name);

    const tempo = TEMPO_OVERRIDES[title] ?? currentNames.filter((n) => TEMPO_TAGS.has(n));
    let themes;
    if (THEMES[title]) {
      themes = THEMES[title];
    } else {
      // Unverified: keep existing themes, fold duplicates, drop artists/junk.
      themes = [...new Set(
        currentNames.filter((n) => !TEMPO_TAGS.has(n) && !ARTIST_TAGS.has(n) && !JUNK_TAGS.has(n)).map(canonicalName),
      )];
    }
    const target = [...tempo, ...themes];
    const changed = target.join("|") !== currentNames.join("|");
    plans.push({ post: p, title, currentNames, target, changed, unverified: !THEMES[title] });
  }

  // 4. Deletions: every artist / folded / junk tag, once unreferenced.
  const toDelete = tags.filter((t) => ARTIST_TAGS.has(t.name) || FOLD[t.name] || JUNK_TAGS.has(t.name));

  // ── Report ──

  console.log(`\n=== NEW TAGS (${creates.length}) ===`);
  for (const c of creates) console.log(`  + ${c.name}  (slug ${c.slug.current})`);

  console.log(`\n=== SLUG FIXES (${slugPatches.length}) ===`);
  for (const s of slugPatches) console.log(`  ${s.name}: ${s.from} -> ${s.to}`);

  const changedPlans = plans.filter((p) => p.changed);
  console.log(`\n=== POSTS (${changedPlans.length} of ${plans.length} change) ===`);
  for (const p of plans) {
    const add = p.target.filter((n) => !p.currentNames.includes(n));
    const rem = p.currentNames.filter((n) => !p.target.includes(n));
    const flag = p.unverified ? " [sin verificar — solo limpieza]" : "";
    if (!p.changed) { console.log(`  = ${p.title}${flag}`); continue; }
    console.log(`  ~ ${p.title}${flag}`);
    console.log(`      ahora : ${p.currentNames.join(", ") || "(ninguno)"}`);
    console.log(`      queda : ${p.target.join(", ")}`);
    if (add.length) console.log(`      +     : ${add.join(", ")}`);
    if (rem.length) console.log(`      -     : ${rem.join(", ")}`);
  }

  console.log(`\n=== TAG DOCS TO DELETE (${toDelete.length}) ===`);
  for (const t of toDelete) {
    const kind = ARTIST_TAGS.has(t.name) ? "artista" : FOLD[t.name] ? `duplicado -> ${FOLD[t.name]}` : "basura";
    console.log(`  - ${t.name}  (${kind})`);
  }

  console.log(`\n=== PREGUNTAS ABIERTAS (no se tocan \`authors\`) ===`);
  for (const q of COAUTHOR_QUESTIONS) {
    const p = postByTitle.get(q.title);
    console.log(`  ? "${q.title}" tenía el tag "${q.tag}" pero authors = [${(p.authors ?? []).join(", ")}]. ¿Agregar como coautor?`);
  }
  console.log(`  ? Sin letra y sin verificar (quedan con sus tags actuales): ${UNVERIFIED.join("; ")}`);

  // Tag usage after the change (sanity check that nothing ends up orphaned by accident).
  const usage = new Map();
  for (const p of plans) for (const n of p.target) usage.set(n, (usage.get(n) ?? 0) + 1);
  const survivors = [...new Set([...tags.map((t) => t.name), ...NEW_TAGS])].filter((n) => !toDelete.some((t) => t.name === n));
  const orphans = survivors.filter((n) => !usage.get(n));
  console.log(`\n=== USO FINAL POR TAG (${survivors.length} tags) ===`);
  for (const n of survivors.sort((a, b) => (usage.get(b) ?? 0) - (usage.get(a) ?? 0) || a.localeCompare(b))) {
    console.log(`  ${String(usage.get(n) ?? 0).padStart(3)}  ${n}`);
  }
  if (orphans.length) console.log(`\n  ⚠ tags que quedarían sin uso: ${orphans.join(", ")}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — nada escrito. Re-ejecuta con --apply para aplicar.`);
    return;
  }

  // ── Apply ──
  // a) create new tags, learn their IDs
  for (const c of creates) {
    const doc = await client.create({ _type: c._type, name: c.name, slug: c.slug });
    idByName.set(c.name, doc._id);
    console.log(`created tag ${c.name} -> ${doc._id}`);
  }
  // b) slug fixes
  for (const s of slugPatches) {
    await client.patch(s.id).set({ slug: { _type: "slug", current: s.to } }).commit();
    console.log(`slug ${s.name}: ${s.from} -> ${s.to}`);
  }
  // c) post patches, in transactions of 25
  const batches = [];
  for (let i = 0; i < changedPlans.length; i += 25) batches.push(changedPlans.slice(i, i + 25));
  for (const batch of batches) {
    let tx = client.transaction();
    for (const p of batch) {
      const refs = p.target.map((n) => {
        const _ref = idByName.get(n);
        if (!_ref) throw new Error(`no id for tag "${n}"`);
        // keep the existing _key where the ref already existed, mint one otherwise
        const prev = (p.post.tags ?? []).find((r) => r._ref === _ref);
        return { _type: "reference", _ref, _key: prev?._key ?? key() };
      });
      tx = tx.patch(p.post._id, (q) => q.set({ tags: refs }));
    }
    await tx.commit();
    console.log(`patched ${batch.length} posts`);
  }
  // d) delete unreferenced tag docs — verify each one really has zero references first
  for (const t of toDelete) {
    const refs = await client.fetch(`count(*[references($id)])`, { id: t._id });
    if (refs > 0) { console.warn(`SKIP delete ${t.name}: still referenced by ${refs} doc(s)`); continue; }
    await client.delete(t._id);
    console.log(`deleted tag ${t.name}`);
  }
  console.log("\nDONE. /biblioteca and / revalidate within 60 s; /posts/[slug] within 1 h.");
}

main().catch((e) => { console.error(e); process.exit(1); });

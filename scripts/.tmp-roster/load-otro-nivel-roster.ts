// One-off (2026-11-12): load Otro Nivel's «El Caos Dentro de Mi» roster from Frank's sheet into
// «Clases del grupo». Every row goes through the app's ONE writer, `createMinistryEvent`, as Frank
// (fresh access, group checks, W5 people check, token-keyed create), exactly as «Nuevo libro» does.
// Dry run by default; `--apply` writes. Fixed tokens make a re-run safe: a row already created
// answers 409 «ya estaba creada» and is counted as done.
//
// Run from the repo root (main pulled), with .env.local:
//   npx tsx --env-file=.env.local --require ./scripts/.tmp-roster/preload.cjs scripts/.tmp-roster/load-otro-nivel-roster.ts [--apply]

import { createMinistryEvent } from "../../app/utils/ministryEventCommit";
import { fetchMemberAccessFresh } from "../../app/utils/memberAccess";
import { readMinistryEvents } from "../../app/utils/ministryEventReads";
import { bookForm, bookRows, classBody } from "../../app/utils/jovenesClassesModel";

const FRANK = "7e910c94-9134-4bbf-9227-d2f3a8e87ea7";
const P = {
  andy: "x3RPPL4u1m5KVl4VAMlhnN",
  jacob: "c4305c57-eed7-46ab-81e4-f415b3e31353", // «Jakey» in the app
  marianne: "6fc84005-1b30-49a9-8a5c-dc4171401bf2",
  frank: FRANK,
  rebe: "bn5fI15u1dDaoAFilvcSdJ", // «Becca» in the app
  rachel: "9dc82163-2ef6-4261-9bb0-000169844980",
};
const m = (member: string) => ({ member, name: null });
// Sheet order, Cap 1 → Cap 10.
const ROTATION = [m(P.andy), m(P.jacob), m(P.marianne), m(P.frank), m(P.rebe), m(P.rachel), m(P.jacob), m(P.frank), m(P.marianne), { member: null, name: "Todos" }];
const DONE_UP_TO = 4; // Cap 1–4 marked «Hecho» in the sheet.
const NOTES: Record<number, string> = { 10: "Cierre libro" };
const TOKENS = [
  "9609b000-9a7c-4538-96f1-72f940a55ada", "05f6bfd1-c784-4345-b46f-f33611f02764", "a9f9db1e-ce19-46de-8f0a-d718342cebf2",
  "883aac96-799c-4f77-8d61-fb65898b8e2a", "135cb100-2a95-4e18-ba29-8fbb62618f35", "9250607c-76cf-4b56-b55e-ebfd9593a188",
  "7bb652e3-6fb0-4f91-9d34-034200f62ec9", "9bb9ad86-7f24-4ceb-8fb2-4c1fbc034fe8", "2b132be8-13be-4d22-825b-86bcb0de48bb",
  "6be07c76-9ec4-4281-aa52-82411d4d7574",
];

async function main() {
  const apply = process.argv.includes("--apply");
  const form = { ...bookForm("otro-nivel", "2026-10-18"), series: "El Caos Dentro de Mi", firstChapter: 1, count: 10, everyDays: 7, rotation: ROTATION, published: true };
  const rows = bookRows(form).map((r, i) => ({ ...r, done: i < DONE_UP_TO, notes: NOTES[i + 1] ?? "" }));

  const access = await fetchMemberAccessFresh(FRANK);
  if (!access.active || access.role !== "super-admin") throw new Error("Frank's account did not read as an active super-admin; stopping.");
  const existing = await readMinistryEvents(access, { me: FRANK, ministry: "jovenes", from: "2026-10-01", to: "9999-12-31", mode: "editor" });
  const already = existing.filter((e) => e.lesson?.series === "El Caos Dentro de Mi" && e.audience?.kind === "groups" && e.audience.groups.includes("otro-nivel"));
  console.log(`Otro Nivel already holds ${already.length} class(es) of «El Caos Dentro de Mi».`);

  for (const [i, r] of rows.entries()) {
    const who = r.responsable.member ? Object.entries(P).find(([, id]) => id === r.responsable.member)?.[0] : r.responsable.name;
    console.log(`${r.title.padEnd(7)} ${r.date} ${r.time} ${r.place} · ${who}${r.done ? " · Hecho" : ""}${r.notes ? ` · ${r.notes}` : ""}`);
    if (!apply) continue;
    const out = await createMinistryEvent(FRANK, "jovenes", { ...classBody(r), token: TOKENS[i] });
    const body = out.body as { error?: string };
    if (out.status === 200) console.log("   created");
    else if (out.status === 409 && body.error === "already_created") console.log("   already there");
    else throw new Error(`   refused ${out.status} ${JSON.stringify(out.body)} — stopping (re-run continues safely).`);
  }
  console.log(apply ? "Done." : "Dry run only. Add --apply to write.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

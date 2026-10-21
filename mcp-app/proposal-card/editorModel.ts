// The proposal card's EDITOR model (S4 of docs/superpowers/plans/2026-10-21-owt-mcp-proposal-editor.md):
// what the screen keeps between server answers, and how it reads them. Pure, so it is tested
// without a browser or a host.
//
// E1: the screen holds a LIST OF EDITS, never a board it trusts. Every gesture appends an edit and
// sends the whole list to `check_proposal_edits`; the board shown is the server's answer. A refused
// edit is dropped from the list (the board shown is then the one before it), except a C4, which
// asks «¿Asignar de todos modos?» and is re-sent with `force` (Q1-A). Saving sends the same list
// to `save_proposal_edits` with the keys the last check showed (`confirms`, A5), and the saved
// revision becomes the new base with an empty list. «Cargar» hands the newest revision to the chat
// (E10) with every waiver's wording verbatim, so Claude's `apply_schedule` call can repeat them (Q1).

export interface PersonView {
  token: string;
  name: string;
  unavailable?: boolean;
}

export interface SeatView {
  row: string;
  label: string;
  target: number | null;
  members: PersonView[];
}

export interface ServiceView {
  service: string;
  label: string;
  date: string;
  type: string;
  editable: boolean;
  seats: SeatView[];
}

/** A finding key as the server sends it (members as tokens) — what `confirms` takes back. */
export interface KeyView {
  kind: string;
  rule: string;
  service: string;
  row: string | null;
  members: string[];
}

export interface Candidate {
  token: string;
  name: string;
  available: boolean;
  blocked: string | null;
  rule: string | null;
}

export interface WaiverItem {
  service: string;
  members: string[];
  rule: string;
}

export type TokenEdit =
  | { op: "place"; service: string; row: string; member: string; force?: boolean }
  | { op: "clear"; service: string; row: string; member: string }
  | { op: "exchange"; a: { service: string; row: string; member: string }; b: { service: string; row: string; member: string }; force?: boolean };

/** What one check answered, read defensively: anything missing is empty, never invented. */
export interface CheckView {
  ok: boolean;
  board: ServiceView[];
  /** The server's text lines (rules, the month check, «todo cuadra»). */
  lines: string[];
  /** The keys a save must confirm (`rules.diff`). */
  diff: KeyView[];
  refusal: { index: number; code: string; sentence: string } | null;
  /** For a C4 on the last edit: the keys forcing it would confirm, with where and why. */
  prompt: Array<KeyView & { where: string; sentence: string; names: string[] }> | null;
  candidates: Candidate[] | null;
  /** The waivers this board keeps, as `apply_schedule` asks for them (`where`, names, sentence). */
  waivers: WaiverItem[];
}

export interface SaveView {
  ok: boolean;
  proposal: string | null;
  revision: number | null;
  checked: boolean;
  waivers: WaiverItem[];
  board: ServiceView[];
  lines: string[];
  /** `needs_confirmation` / `stale_check`: the diff to confirm again, with where and why. */
  detail: string | null;
  diff: Array<KeyView & { where: string; sentence: string }>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const objects = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

export function textLines(content: unknown): string[] {
  return objects(content)
    .filter((c) => c.type === "text")
    .flatMap((c) => str(c.text).split("\n"))
    .filter((l) => l.trim() !== "");
}

export function boardOf(v: unknown): ServiceView[] {
  return objects(v).map((s) => ({
    service: str(s.service),
    label: str(s.label),
    date: str(s.date),
    type: str(s.type),
    editable: s.editable === true,
    seats: objects(s.seats).map((seat) => ({
      row: str(seat.row),
      label: str(seat.label),
      target: typeof seat.target === "number" ? seat.target : null,
      members: objects(seat.members).map((m) => ({ token: str(m.token), name: str(m.name), unavailable: m.unavailable === true })),
    })),
  }));
}

function keyOf(k: Obj): KeyView {
  return { kind: str(k.kind), rule: str(k.rule), service: str(k.service), row: typeof k.row === "string" ? k.row : null, members: strings(k.members) };
}

export function checkViewOf(result: { content?: unknown; structuredContent?: unknown; isError?: boolean } | undefined): CheckView {
  const s = isObj(result?.structuredContent) ? result!.structuredContent as Obj : {};
  const rules = isObj(s.rules) ? s.rules : {};
  const refusal = isObj(s.refusal) ? { index: Number(s.refusal.index), code: str(s.refusal.code), sentence: str(s.refusal.sentence) } : null;
  const prompt = isObj(s.prompt)
    ? objects(s.prompt.diff).map((d) => ({ ...keyOf(d), where: str(d.where), sentence: str(d.sentence), names: strings(d.names) }))
    : null;
  return {
    ok: !result?.isError && s.ok === true,
    board: boardOf(s.board),
    lines: textLines(result?.content),
    diff: objects(rules.diff).map(keyOf),
    refusal,
    prompt,
    candidates: Array.isArray(s.candidates)
      ? objects(s.candidates).map((c) => ({
          token: str(c.token),
          name: str(c.name),
          available: c.available !== false,
          blocked: typeof c.blocked === "string" ? c.blocked : null,
          rule: typeof c.rule === "string" ? c.rule : null,
        }))
      : null,
    waivers: objects(rules.waivers).map((w) => ({ service: str(w.where), members: strings(w.names), rule: str(w.sentence) })),
  };
}

export function saveViewOf(result: { content?: unknown; structuredContent?: unknown; isError?: boolean } | undefined): SaveView {
  const s = isObj(result?.structuredContent) ? result!.structuredContent as Obj : {};
  return {
    ok: !result?.isError && s.ok === true,
    proposal: typeof s.proposal === "string" ? s.proposal : null,
    revision: typeof s.revision === "number" ? s.revision : null,
    checked: s.checked !== false,
    waivers: objects(s.waivers).map((w) => ({ service: str(w.service), members: strings(w.members), rule: str(w.rule) })),
    board: boardOf(s.board),
    lines: textLines(result?.content),
    detail: typeof s.detail === "string" ? s.detail : null,
    diff: objects(s.diff).map((d) => ({ ...keyOf(d), where: str(d.where), sentence: str(d.sentence) })),
  };
}

/** The keys a save confirms: exactly the last check's diff, as the server sent them (A5). */
export const confirmsOf = (check: CheckView): KeyView[] => check.diff.map(({ kind, rule, service, row, members }) => ({ kind, rule, service, row, members }));

/** The list after the server refused its LAST edit: a C4 is offered to force; anything else is dropped. */
export function afterRefusal(edits: readonly TokenEdit[], check: CheckView): { edits: TokenEdit[]; askForce: boolean } {
  if (!check.refusal) return { edits: [...edits], askForce: false };
  const last = check.refusal.index === edits.length - 1;
  if (check.refusal.code === "hard_rule" && last) return { edits: [...edits], askForce: true };
  return { edits: edits.filter((_, i) => i !== check.refusal!.index), askForce: false };
}

/** The last edit forced («Asignar de todos modos»). */
export function forceLast(edits: readonly TokenEdit[]): TokenEdit[] {
  const out = [...edits];
  const last = out[out.length - 1];
  if (last && last.op !== "clear") out[out.length - 1] = { ...last, force: true };
  return out;
}

/** A fresh id for one save attempt, reused on a retry after a lost answer. */
export function newSaveId(random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "card-";
  for (let i = 0; i < 16; i++) id += alphabet[Math.floor(random() * alphabet.length)];
  return id;
}

/**
 * «Cargar» (E10): the message the card puts in the chat. The handle, the revision and every
 * waiver VERBATIM, as JSON, so the model can pass them to `apply_schedule` unchanged.
 */
export function loadMessage(proposal: string, revision: number, waivers: readonly WaiverItem[]): string {
  const head = revision > 1
    ? `Carga la versión ${revision} de la propuesta ${proposal} con apply_schedule.`
    : `Carga la propuesta ${proposal} con apply_schedule.`;
  if (waivers.length === 0) return head;
  const list = waivers.map((w) => `- ${w.service} · ${w.members.join(" y ")} · ${w.rule}`).join("\n");
  return [
    head,
    `Asigné ${waivers.length === 1 ? "un lugar" : `${waivers.length} lugares`} de todos modos contra una regla:`,
    list,
    "Pasa waivers exactamente así:",
    JSON.stringify(waivers),
  ].join("\n");
}

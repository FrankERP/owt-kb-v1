// The admin assistant's shared contract (ADR-0060): who may use it, what a request may carry,
// what one answer costs, and the line-delimited events the route streams back. NEUTRAL — no
// `server-only`, no Sanity, no SDK import — because the /admin panel parses the same events the
// route writes, and the route and its tests validate the same request shape.
//
// The money rules live here so one place says what a question costs. Every answer's cost is
// computed from the API's own `usage` (every attempt in it, `responseCostMicroUsd`) and summed per
// admin per CDMX month
// (`adminChatUsage.<memberId>.<YYYY-MM>`); an admin at the cap is refused before any API call.

/** The one model the assistant runs (Frank, 2026-10-20: «Sí, con Opus 5.5»). */
export const ADMIN_CHAT_MODEL = "claude-opus-5-5";

/** Each admin's monthly spend cap, in USD. The Console workspace limit is the hard cap above it. */
export const ADMIN_CHAT_MONTHLY_BUDGET_USD = 15;

/**
 * Request limits: a conversation is resent whole on every turn, so these bound one call's input.
 * A question is typed, so it is short; an answer the panel resends can be long (a chord chart
 * copied out), so it has its own, larger bound — one long answer must not refuse every later turn.
 */
export const ADMIN_CHAT_LIMITS = {
  maxMessages: 40,
  maxQuestionChars: 4_000,
  maxAnswerChars: 40_000,
  maxTotalChars: 100_000,
} as const;

export type AdminChatRole = "user" | "assistant";
export interface AdminChatMessage {
  role: AdminChatRole;
  text: string;
  /** User turns only: what was on screen when it was asked (`parsePageContext`), or absent. */
  page?: AdminChatPage | null;
}

/**
 * Who may open the assistant: an `admin` or `super-admin` of the worship ministry. A super-admin
 * spans every ministry; a plain `admin` must belong to worship (absent `ministries` already
 * normalizes to worship upstream). `content-editor` is deliberately out (Frank: «solo los admins»).
 */
export function canUseAdminChat(access: { role: string | null | undefined; ministries: readonly string[] }): boolean {
  if (access.role === "super-admin") return true;
  return access.role === "admin" && access.ministries.includes("worship");
}

export type ChatRequestParse =
  | { ok: true; messages: AdminChatMessage[] }
  | { ok: false; error: string };

/**
 * What the admin is looking at when they ask (the bubble sends it with every question): the
 * page's path, a short label, and up to a few references the tools can follow (a song id, a
 * service date, a month). Ids and labels only — never the screen's text — so the context costs a
 * line, not a page, and nothing written on the page (a lyric, a note) reaches the model as if the
 * admin had typed it.
 */
export type AdminChatRefKind = "song" | "service" | "month";
export interface AdminChatPageRef {
  kind: AdminChatRefKind;
  id: string;
  label: string;
}
export interface AdminChatPage {
  path: string;
  label: string;
  refs: AdminChatPageRef[];
}

export const ADMIN_CHAT_PAGE_LIMITS = { pathChars: 200, labelChars: 160, refs: 4, refIdChars: 100 } as const;

const REF_KINDS: readonly AdminChatRefKind[] = ["song", "service", "month"];
const REF_ID = /^[A-Za-z0-9._:-]+$/;
/** A pathname: no query, no whitespace, nothing that could break out of the note's one line. */
const PATH = /^\/[\p{L}\p{N}._~%\/-]*$/u;

// The note's own delimiters are taken out of a label: a song title is written by editors, and one
// must not be able to close the bracketed note and continue as if the admin were speaking.
const cleanLabel = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/[«»[\]]/g, "").replace(/\s+/g, " ").trim();
  return text && text.length <= ADMIN_CHAT_PAGE_LIMITS.labelChars ? text : null;
};

/**
 * The page context, or null when absent or malformed. It is advisory: a bad one is dropped, never
 * a reason to refuse the question.
 */
export function parsePageContext(raw: unknown): AdminChatPage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { path, label, refs } = raw as { path?: unknown; label?: unknown; refs?: unknown };
  if (typeof path !== "string" || !PATH.test(path) || path.length > ADMIN_CHAT_PAGE_LIMITS.pathChars) return null;
  const pageLabel = cleanLabel(label);
  if (!pageLabel) return null;
  const list = refs === undefined ? [] : refs;
  if (!Array.isArray(list) || list.length > ADMIN_CHAT_PAGE_LIMITS.refs) return null;
  const parsedRefs: AdminChatPageRef[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) return null;
    const { kind, id, label: refLabel } = item as { kind?: unknown; id?: unknown; label?: unknown };
    const refName = cleanLabel(refLabel);
    if (!REF_KINDS.includes(kind as AdminChatRefKind) || typeof id !== "string" || !refName) return null;
    if (id.length === 0 || id.length > ADMIN_CHAT_PAGE_LIMITS.refIdChars || !REF_ID.test(id)) return null;
    parsedRefs.push({ kind: kind as AdminChatRefKind, id, label: refName });
  }
  return { path, label: pageLabel, refs: parsedRefs };
}

const REF_NOUN: Record<AdminChatRefKind, { noun: string; key: string }> = {
  song: { noun: "canción", key: "songId" },
  service: { noun: "servicio", key: "fecha" },
  month: { noun: "mes", key: "mes" },
};

/**
 * The line the route puts before a question: what was on the admin's screen, framed as reference
 * data. It goes in that user turn, not the system prompt, so the cached prefix (system prompt,
 * tools, earlier turns with their own notes) stays the same however the admin moves around the app.
 */
export function pageContextNote(page: AdminChatPage): string {
  const refs = page.refs.map((r) => `${REF_NOUN[r.kind].noun} «${r.label}» (${REF_NOUN[r.kind].key}: ${r.id})`);
  return (
    `[Contexto de la app, no es parte de la pregunta: estoy viendo «${page.label}» (${page.path})` +
    (refs.length ? `; en pantalla: ${refs.join("; ")}` : "") +
    ". Tómalo en cuenta solo si la pregunta se refiere a lo que estoy viendo.]"
  );
}

/**
 * The request body is `{ messages: [{ role, text, page? }] }`: the conversation so far, oldest
 * first, alternating, starting and ending with the user. A user turn may carry the page it was asked
 * from (`parsePageContext`) — every turn keeps its own, so a resent conversation is byte-identical
 * to the last one and the prompt cache holds. Only text crosses the wire — the route never accepts
 * tool results, system text or any block a client could forge.
 */
export function parseChatRequest(body: unknown): ChatRequestParse {
  if (typeof body !== "object" || body === null || !Array.isArray((body as { messages?: unknown }).messages)) {
    return { ok: false, error: "Falta la conversación." };
  }
  const raw = (body as { messages: unknown[] }).messages;
  if (raw.length === 0) return { ok: false, error: "Falta la pregunta." };
  if (raw.length > ADMIN_CHAT_LIMITS.maxMessages) {
    return { ok: false, error: "La conversación es demasiado larga. Empieza una nueva." };
  }
  const messages: AdminChatMessage[] = [];
  let total = 0;
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const expected: AdminChatRole = i % 2 === 0 ? "user" : "assistant";
    if (typeof item !== "object" || item === null) return { ok: false, error: "Mensaje inválido." };
    const { role, text, page } = item as { role?: unknown; text?: unknown; page?: unknown };
    if (role !== expected || typeof text !== "string") return { ok: false, error: "Mensaje inválido." };
    const trimmed = text.trim();
    if (trimmed.length === 0) return { ok: false, error: "Hay un mensaje vacío." };
    if (expected === "user" && trimmed.length > ADMIN_CHAT_LIMITS.maxQuestionChars) {
      return { ok: false, error: `Cada pregunta puede tener hasta ${ADMIN_CHAT_LIMITS.maxQuestionChars} caracteres.` };
    }
    if (expected === "assistant" && trimmed.length > ADMIN_CHAT_LIMITS.maxAnswerChars) {
      return { ok: false, error: "La conversación es demasiado larga. Empieza una nueva." };
    }
    total += trimmed.length;
    messages.push(expected === "user" ? { role: expected, text: trimmed, page: parsePageContext(page) } : { role: expected, text: trimmed });
  }
  if (messages[messages.length - 1]!.role !== "user") return { ok: false, error: "Falta la pregunta." };
  if (total > ADMIN_CHAT_LIMITS.maxTotalChars) {
    return { ok: false, error: "La conversación es demasiado larga. Empieza una nueva." };
  }
  return { ok: true, messages };
}

/** USD per million tokens. Cache writes are the 5-minute kind (1.25 × input). */
interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const OPUS_5_PRICE: ModelPrice = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": OPUS_5_PRICE,
  "claude-opus-4-8": OPUS_5_PRICE,
};

export interface ChatUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** One sampling attempt inside a response (`usage.iterations`): the served one, or a declined one. */
export interface ChatIterationUsage extends ChatUsage {
  type: string;
  model?: string | null;
}

export interface ChatResponseUsage extends ChatUsage {
  iterations?: ChatIterationUsage[] | null;
}

const count = (n: number | null | undefined): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * What one API response cost, in micro-USD (USD × 10⁶), rounded up. A token at P USD per million
 * costs exactly P micro-USD, so the sum stays an integer the usage document can `inc`. A model
 * this table does not know — a refusal fallback the API chose — is charged at Opus 5's rates, the
 * dearest a default fallback can land on, so an unknown model never undercounts.
 */
export function costMicroUsd(model: string, usage: ChatUsage): number {
  const price = MODEL_PRICES[model] ?? OPUS_5_PRICE;
  const micro =
    count(usage.input_tokens) * price.input +
    count(usage.output_tokens) * price.output +
    count(usage.cache_read_input_tokens) * price.cacheRead +
    count(usage.cache_creation_input_tokens) * price.cacheWrite;
  return Math.ceil(micro);
}

/**
 * What one whole response cost. With a server-side fallback the top-level `usage` covers only the
 * attempt that served the answer, while a declined attempt that had started writing is billed
 * too; each attempt is its own `message` / `fallback_message` entry in `usage.iterations`, priced
 * by its own model (a `message` entry without one ran on the response's model). Without
 * iterations, the top-level `usage` is the whole response.
 */
export function responseCostMicroUsd(model: string, usage: ChatResponseUsage): number {
  const attempts = (usage.iterations ?? []).filter((it) => it.type === "message" || it.type === "fallback_message");
  if (attempts.length === 0) return costMicroUsd(model, usage);
  return attempts.reduce((sum, it) => sum + costMicroUsd(it.model || model, it), 0);
}

export const MICRO_PER_USD = 1_000_000;

export function budgetMicroUsd(): number {
  return ADMIN_CHAT_MONTHLY_BUDGET_USD * MICRO_PER_USD;
}

/** The CDMX calendar month a spend belongs to, `YYYY-MM`. */
export function chatMonthKey(now: Date = new Date()): string {
  return now.toLocaleDateString("sv", { timeZone: "America/Mexico_City" }).slice(0, 7);
}

/** Dotted, so an untokened read never serves it. */
export function adminChatUsageDocId(memberId: string, month: string): string {
  return `adminChatUsage.${memberId}.${month}`;
}

/** A stored micro-USD counter, or null when it is not a non-negative integer. */
export function parseStoredMicroUsd(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** The status the panel shows before any question: is it set up, and how much is left. */
export interface AdminChatStatus {
  configured: boolean;
  spentUsd: number;
  budgetUsd: number;
}

/** One line of the streamed answer. */
export type AdminChatEvent =
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  | { type: "done"; spentUsd: number; budgetUsd: number }
  | { type: "error"; message: string };

export function encodeChatEvent(event: AdminChatEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Splits a buffered chunk of the stream into whole events and the unfinished tail. A line that is
 * not a known event is skipped rather than thrown on: the panel must never die on one bad line.
 */
export function decodeChatEvents(buffer: string): { events: AdminChatEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: AdminChatEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { type?: unknown };
      if (parsed && (parsed.type === "status" || parsed.type === "text" || parsed.type === "done" || parsed.type === "error")) {
        events.push(parsed as AdminChatEvent);
      }
    } catch {
      // A malformed line is dropped; the next one still parses.
    }
  }
  return { events, rest };
}

/** USD with two decimals, for the panel's «cupo» line. */
export function roundUsd(micro: number): number {
  return Math.round(micro / 10_000) / 100;
}

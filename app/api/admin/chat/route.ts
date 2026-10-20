import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import { serviceTodayIso } from "@/app/components/admin/serviceReadiness";
import {
  ADMIN_CHAT_MODEL,
  ADMIN_CHAT_MONTHLY_BUDGET_USD,
  budgetMicroUsd,
  canUseAdminChat,
  chatMonthKey,
  costMicroUsd,
  encodeChatEvent,
  pageContextNote,
  responseCostMicroUsd,
  parseChatRequest,
  roundUsd,
  type AdminChatEvent,
  type AdminChatStatus,
} from "@/app/utils/adminChat";
import {
  ADMIN_CHAT_TOOLS,
  adminChatSystemPrompt,
  readMonthSpend,
  recordSpend,
  runAdminChatTool,
  toolStatus,
  usageStoreConfigured,
} from "@/app/utils/adminChatServer";
import { requireActiveSession } from "@/app/utils/authGuards";
import { getMemberAccess } from "@/app/utils/memberAccess";

/**
 * /api/admin/chat — the admin assistant (ADR-0060).
 *
 * GET answers the panel's status line (set up? how much of this month's cap is used?).
 * POST takes the conversation so far and streams the answer as newline-delimited JSON events
 * (`AdminChatEvent`): text deltas, a status line while a tool runs, then `done` with the month's
 * spend — or `error`.
 *
 * Access: an active `admin`/`super-admin` of worship (`canUseAdminChat`), checked live on every
 * request, and never while impersonating — a super-admin viewing the app as someone else must not
 * spend that person's cap. Spend: each admin's month is capped at `ADMIN_CHAT_MONTHLY_BUDGET_USD`,
 * checked BEFORE any API call; the answer's real cost (from the API's own `usage`) is added after.
 * The cap is a soft one (two questions sent at the same moment both pass the check); the hard cap
 * is the Console workspace's spend limit and the credit balance itself.
 *
 * Time: the project runs on Vercel Hobby without Fluid compute, so a function gets 60 s at most.
 * The route stops itself at `ANSWER_DEADLINE_MS` — aborting a call still in flight and charging it
 * conservatively — so its `finally` always runs and records the spend before the platform would
 * kill it. A client that goes away does NOT abort the call in flight (the API bills it all the
 * same, and an abort would leave it uncharged); the route just starts no further call.
 *
 * No `revalidate*`: nothing here is rendered by an ISR page.
 */
export const maxDuration = 60;

/** Model calls one question may make: each tool round is one more. */
const MAX_MODEL_CALLS = 6;

/** Output bound per call (thinking included); a cut-off answer says so. */
const MAX_TOKENS = 8_000;

/** The route's own deadline, under `maxDuration`, leaving room to record the spend. */
const ANSWER_DEADLINE_MS = 50_000;

/** No new call starts with less time than this left: it would only be cut off. */
const MIN_CALL_MS = 10_000;

/**
 * What a call aborted at the deadline is charged: its input as far as the stream reported it (or an
 * estimate from the prompt's length, ~3 characters a token, when nothing arrived), and the whole
 * `MAX_TOKENS` of output — the most it could have produced, so a cut never undercounts.
 */
function abortedCallCostMicroUsd(snapshot: Anthropic.Beta.BetaMessage | undefined, promptChars: number): number {
  if (snapshot) return costMicroUsd(snapshot.model, { ...snapshot.usage, output_tokens: MAX_TOKENS });
  return costMicroUsd(ADMIN_CHAT_MODEL, { input_tokens: Math.ceil(promptChars / 3), output_tokens: MAX_TOKENS });
}

/**
 * The assistant turn to echo back. After a mid-answer fallback the declined attempt's partial stays
 * in `content` before the last `fallback` block; of it only text may be echoed — thinking and
 * tool calls from before the boundary must be left out (the API's echo rule).
 */
function echoableContent(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlock[] {
  const boundary = content.findLastIndex((b) => b.type === "fallback");
  if (boundary < 0) return content;
  return content.filter((b, i) => i >= boundary || b.type === "text");
}

/** `work`, or `fallback` once `ms` have passed. */
function withinMs<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

type Authorized = { ok: true; memberId: string } | { ok: false; response: NextResponse };

async function authorize(): Promise<Authorized> {
  const session = await requireActiveSession();
  if (!session) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (session.user.isImpersonating) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "El asistente no está disponible mientras ves la app como otra persona." },
        { status: 403 },
      ),
    };
  }
  const memberId = session.user.sanityId;
  const access = await getMemberAccess(memberId);
  if (!canUseAdminChat(access)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "El asistente es solo para los admins del equipo de alabanza." }, { status: 403 }),
    };
  }
  return { ok: true, memberId };
}

const NOT_CONFIGURED = "El asistente todavía no está configurado.";
const SPEND_UNREADABLE = "No se pudo revisar tu cupo del mes. Intenta de nuevo en un momento.";

function apiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const configured = !!apiKey() && usageStoreConfigured();
  let spent = 0;
  if (configured) {
    try {
      spent = await readMonthSpend(auth.memberId, chatMonthKey());
    } catch {
      return NextResponse.json({ error: SPEND_UNREADABLE }, { status: 503 });
    }
  }
  const status: AdminChatStatus = { configured, spentUsd: roundUsd(spent), budgetUsd: ADMIN_CHAT_MONTHLY_BUDGET_USD };
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}

/** The panel's message for an API failure. Never the API's own text. */
function apiErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return "La llave del asistente no es válida. Avísale a Frank.";
  }
  if (err instanceof Anthropic.RateLimitError) return "Hay mucha demanda en este momento. Intenta de nuevo en un minuto.";
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
    return "Se acabó el saldo de este mes de la cuenta de Claude. Se renueva con el siguiente ciclo del plan.";
  }
  return "No se pudo completar la respuesta. Intenta de nuevo en un momento.";
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const key = apiKey();
  if (!key || !usageStoreConfigured()) return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Mensaje inválido." }, { status: 400 });
  }
  const parsed = parseChatRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const month = chatMonthKey();
  let spentBefore: number;
  try {
    spentBefore = await readMonthSpend(auth.memberId, month);
  } catch {
    return NextResponse.json({ error: SPEND_UNREADABLE }, { status: 503 });
  }
  if (spentBefore >= budgetMicroUsd()) {
    return NextResponse.json(
      { error: `Ya usaste tu cupo de este mes (${ADMIN_CHAT_MONTHLY_BUDGET_USD} USD). Se renueva el día 1.` },
      { status: 429 },
    );
  }

  const memberId = auth.memberId;
  const client = new Anthropic({ apiKey: key, maxRetries: 1 });
  const system = adminChatSystemPrompt(serviceTodayIso());
  // Each question goes with the page it was asked from, as its own text block before it. Every turn
  // keeps its own note, so the conversation resent next turn is byte-identical up to the new
  // question and the cached prefix survives moving around the app.
  const messages: Anthropic.Beta.BetaMessageParam[] = parsed.messages.map((m) =>
    m.role === "user" && m.page
      ? {
          role: "user",
          content: [
            { type: "text", text: pageContextNote(m.page) },
            { type: "text", text: m.text },
          ],
        }
      : { role: m.role, content: m.text },
  );
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: AdminChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(encodeChatEvent(event)));
        } catch {
          open = false; // the panel went away; keep going only to record what was spent
        }
      };

      let spent = 0;
      let calls = 0;
      let answer = "";
      const deadline = startedAt + ANSWER_DEADLINE_MS;
      try {
        while (calls < MAX_MODEL_CALLS) {
          // The panel went away: finish nothing new. The call already answered is recorded below.
          if (calls > 0 && req.signal.aborted) break;
          const remaining = deadline - Date.now();
          if (calls > 0 && remaining < MIN_CALL_MS) {
            send({ type: "text", text: "\n\n(Se acabó el tiempo para esta pregunta. Intenta hacerla más concreta.)" });
            break;
          }
          calls += 1;
          const timer = new AbortController();
          const timeout = setTimeout(() => timer.abort(), Math.max(remaining, 1));
          let separated = false;
          const call = client.beta.messages.stream(
            {
              model: ADMIN_CHAT_MODEL,
              max_tokens: MAX_TOKENS,
              // Server-side refusal fallback: a safety classifier's decline is re-run on the model
              // Anthropic recommends for that category instead of reaching the admin as a refusal.
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
              output_config: { effort: "medium" },
              cache_control: { type: "ephemeral" },
              system,
              tools: ADMIN_CHAT_TOOLS,
              messages,
            },
            { signal: timer.signal },
          );
          call.on("text", (delta) => {
            if (answer && !separated) {
              answer += "\n\n";
              send({ type: "text", text: "\n\n" });
            }
            separated = true;
            answer += delta;
            send({ type: "text", text: delta });
          });
          let message: Anthropic.Beta.BetaMessage;
          try {
            message = await call.finalMessage();
          } catch (err) {
            // A call that failed after it started streaming was billed for what it wrote: charge it
            // like an aborted one. One that never started (no snapshot) cost nothing.
            if (!timer.signal.aborted) {
              if (call.currentMessage) spent += abortedCallCostMicroUsd(call.currentMessage, 0);
              throw err;
            }
            spent += abortedCallCostMicroUsd(call.currentMessage, system.length + JSON.stringify(messages).length);
            send({ type: "error", message: "La respuesta tardó demasiado. Intenta con una pregunta más concreta." });
            break;
          } finally {
            clearTimeout(timeout);
          }
          spent += responseCostMicroUsd(message.model, message.usage);

          if (message.stop_reason === "refusal") {
            send({ type: "error", message: "No puedo ayudar con esa pregunta." });
            break;
          }
          if (message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded") {
            // Never run a tool call cut off here: its input may be truncated.
            send({ type: "text", text: "\n\n(Respuesta recortada: era demasiado larga.)" });
            break;
          }
          // After a mid-answer fallback only what follows the last `fallback` block is the answering
          // model's: a tool call the declined model started is neither run nor echoed.
          const content = echoableContent(message.content);
          const toolUses = content.slice(content.findLastIndex((b) => b.type === "fallback") + 1).filter(
            (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
          );
          if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;
          if (calls === MAX_MODEL_CALLS) {
            send({ type: "text", text: "\n\n(Esta pregunta necesitó demasiadas consultas. Intenta hacerla más concreta.)" });
            break;
          }

          messages.push({ role: "assistant", content });
          // The reads share the answer's deadline: a hung read must not outlive the function and
          // take the spend record with it.
          const toolBudget = Math.max(deadline - Date.now(), 1);
          const results = await Promise.all(
            toolUses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
              send({ type: "status", text: toolStatus(use.name) });
              const out = await withinMs(runAdminChatTool(use.name, use.input), toolBudget, {
                text: "La consulta tardó demasiado.",
                isError: true,
              });
              return { type: "tool_result", tool_use_id: use.id, content: out.text, is_error: out.isError };
            }),
          );
          messages.push({ role: "user", content: results });
        }
      } catch (err) {
        console.error("[admin-chat] answer failed:", err instanceof Anthropic.APIError ? err.status : "unknown");
        send({ type: "error", message: apiErrorMessage(err) });
      } finally {
        if (spent > 0) {
          // One retry: a lost write makes the answer free, so it is worth a second try. Still
          // failing, the cap undercounts by this answer (logged); the workspace limit stays hard.
          let recorded = false;
          for (let attempt = 0; attempt < 2 && !recorded; attempt++) {
            try {
              await recordSpend(memberId, month, spent);
              recorded = true;
            } catch {
              console.error(`[admin-chat] spend not recorded (attempt ${attempt + 1})`);
            }
          }
        }
        console.log(`[admin-chat] calls=${calls} microUsd=${spent}`);
        send({ type: "done", spentUsd: roundUsd(spentBefore + spent), budgetUsd: ADMIN_CHAT_MONTHLY_BUDGET_USD });
        if (open) {
          try {
            controller.close();
          } catch {
            // already closed by a cancelled reader
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

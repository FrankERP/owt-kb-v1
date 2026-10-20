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
 * /api/admin/chat — the admin assistant (ADR-0059).
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
 * No `revalidate*`: nothing here is rendered by an ISR page.
 */
export const maxDuration = 120;

/** Model calls one question may make: each tool round is one more. */
const MAX_MODEL_CALLS = 6;

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
  const messages: Anthropic.Beta.BetaMessageParam[] = parsed.messages.map((m) => ({ role: m.role, content: m.text }));
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
      let wroteText = false;
      try {
        while (calls < MAX_MODEL_CALLS) {
          calls += 1;
          let separated = false;
          const call = client.beta.messages.stream(
            {
              model: ADMIN_CHAT_MODEL,
              max_tokens: 16_000,
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
            { signal: req.signal },
          );
          call.on("text", (delta) => {
            if (wroteText && !separated) send({ type: "text", text: "\n\n" });
            separated = true;
            wroteText = true;
            send({ type: "text", text: delta });
          });
          const message = await call.finalMessage();
          spent += costMicroUsd(message.model, message.usage);

          if (message.stop_reason === "refusal") {
            send({ type: "error", message: "No puedo ayudar con esa pregunta." });
            break;
          }
          const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
          // A tool call cut off at max_tokens may carry a truncated input: never run it.
          if (message.stop_reason !== "tool_use" || toolUses.length === 0) break;
          if (calls === MAX_MODEL_CALLS) {
            send({ type: "text", text: "\n\n(Esta pregunta necesitó demasiadas consultas. Intenta hacerla más concreta.)" });
            break;
          }

          messages.push({ role: "assistant", content: message.content });
          const results = await Promise.all(
            toolUses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
              send({ type: "status", text: toolStatus(use.name) });
              const out = await runAdminChatTool(use.name, use.input);
              return { type: "tool_result", tool_use_id: use.id, content: out.text, is_error: out.isError };
            }),
          );
          messages.push({ role: "user", content: results });
        }
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("[admin-chat] answer failed:", err instanceof Anthropic.APIError ? err.status : "unknown");
          send({ type: "error", message: apiErrorMessage(err) });
        }
      } finally {
        if (spent > 0) {
          try {
            await recordSpend(memberId, month, spent);
          } catch {
            console.error("[admin-chat] spend not recorded");
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

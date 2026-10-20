"use client";

// The admin assistant's panel (ADR-0059): a conversation with Claude about the team's songs,
// lyrics, the Bible and music. The conversation lives only in this component — nothing is
// stored — and is sent whole on every question, as text; the route adds the tools and the
// instructions. The answer streams in as `AdminChatEvent` lines (`app/utils/adminChat.ts`).

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Button from "@/app/components/ui/Button";
import Skeleton, { SkeletonGroup } from "@/app/components/ui/Skeleton";
import {
  ADMIN_CHAT_LIMITS,
  decodeChatEvents,
  type AdminChatMessage,
  type AdminChatStatus,
} from "@/app/utils/adminChat";

const SUGGESTIONS = [
  "¿Qué significa Isaías 40:31 y qué canción nuestra encaja con ese pasaje?",
  "¿Qué vamos a cantar el próximo domingo y en qué tonos?",
  "Explícame por qué funciona la progresión I–V–vi–IV.",
];

type Turn = AdminChatMessage & { failed?: boolean };

type StatusResult = { ok: true; status: AdminChatStatus } | { ok: false; error: string };

async function fetchStatus(): Promise<StatusResult> {
  try {
    const res = await fetch("/api/admin/chat", { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as (AdminChatStatus & { error?: string }) | null;
    if (!res.ok || !body || typeof body.configured !== "boolean") {
      const fallback =
        res.status === 403 ? "El asistente es solo para los admins del equipo de alabanza." : "No se pudo cargar el asistente.";
      return { ok: false, error: body?.error ?? fallback };
    }
    return { ok: true, status: body };
  } catch {
    return { ok: false, error: "No se pudo cargar el asistente." };
  }
}

const inputCls =
  "w-full resize-none rounded-lg border border-accent/20 bg-transparent px-3 py-2 font-body text-[16px] sm:text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-placeholder";

export default function AssistantPanel() {
  const [status, setStatus] = useState<AdminChatStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // The fetch is a plain function and the state lands in its `.then`, so the mount effect never
  // sets state synchronously (react-hooks/set-state-in-effect).
  const applyStatus = useCallback((result: StatusResult) => {
    if (result.ok) {
      setStatusError(null);
      setStatus(result.status);
    } else {
      setStatusError(result.error);
    }
  }, []);

  const loadStatus = useCallback(() => {
    void fetchStatus().then(applyStatus);
  }, [applyStatus]);

  useEffect(() => {
    void fetchStatus().then(applyStatus);
    return () => abortRef.current?.abort();
  }, [applyStatus]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [turns, working]);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || sending) return;
      // Only the turns that got an answer go back: a failed question is dropped with its error.
      const history: AdminChatMessage[] = turns.filter((t) => !t.failed).map(({ role, text: t }) => ({ role, text: t }));
      const messages: AdminChatMessage[] = [...history, { role: "user", text }];
      setTurns([...history, { role: "user", text }, { role: "assistant", text: "" }]);
      setDraft("");
      setError(null);
      setSending(true);
      setWorking("Pensando…");
      const controller = new AbortController();
      abortRef.current = controller;

      let answer = "";
      let failure: string | null = null;
      try {
        const res = await fetch("/api/admin/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          failure = body?.error ?? "No se pudo enviar la pregunta.";
        } else {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const { events, rest } = decodeChatEvents(buffer);
            buffer = rest;
            for (const event of events) {
              if (event.type === "text") {
                answer += event.text;
                setWorking(null);
                const current = answer;
                setTurns((prev) => [...prev.slice(0, -1), { role: "assistant", text: current }]);
              } else if (event.type === "rewind") {
                answer = event.text;
                const current = answer;
                setTurns((prev) => [...prev.slice(0, -1), { role: "assistant", text: current }]);
              } else if (event.type === "status") {
                setWorking(event.text);
              } else if (event.type === "error") {
                failure = event.message;
              } else {
                setStatus((prev) => (prev ? { ...prev, spentUsd: event.spentUsd, budgetUsd: event.budgetUsd } : prev));
              }
            }
          }
          if (!failure && !answer.trim()) failure = "No llegó ninguna respuesta. Intenta de nuevo.";
        }
      } catch {
        if (!controller.signal.aborted) failure = "Se perdió la conexión. Intenta de nuevo.";
      } finally {
        if (failure) {
          // The question stays visible, marked failed, so it can be copied back; it is not resent.
          setTurns((prev) => [...prev.slice(0, -2), { role: "user", text, failed: true }]);
          setError(failure);
          setDraft(text);
        }
        setWorking(null);
        setSending(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [sending, turns],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setTurns([]);
    setError(null);
    setDraft("");
  };

  if (statusError) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-negative-surface bg-negative-surface-deep/20 px-4 py-3 text-sm text-negative-fg">
        <span>{statusError}</span>
        <Button variant="ghost" size="sm" onClick={loadStatus}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (!status) {
    return (
      <SkeletonGroup label="Cargando el asistente" className="space-y-3">
        <Skeleton className="h-16 w-full" rounded="lg" />
        <Skeleton className="h-32 w-full" rounded="lg" />
      </SkeletonGroup>
    );
  }

  const exhausted = status.spentUsd >= status.budgetUsd;
  const blocked = !status.configured || exhausted;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-edge-accent-subtle bg-accent/5 px-4 py-3">
        <div className="min-w-0">
          <p className="font-body text-sm font-semibold text-ink">Pregúntale a Claude</p>
          <p className="font-body text-sm text-mono-500">
            Canciones, letras, la Biblia, teoría musical y los servicios del equipo. No cambia nada en la app.
          </p>
        </div>
        <p className="font-label text-[11px] uppercase tracking-widest text-mono-500">
          Cupo del mes: {status.spentUsd.toFixed(2)} de {status.budgetUsd} USD
        </p>
      </div>

      {!status.configured && (
        <p className="rounded-xl border border-edge-accent-subtle px-4 py-3 font-body text-sm text-mono-500">
          El asistente todavía no está configurado.
        </p>
      )}
      {status.configured && exhausted && (
        <p className="rounded-xl border border-edge-accent-subtle px-4 py-3 font-body text-sm text-mono-500">
          Ya usaste tu cupo de este mes. Se renueva el día 1.
        </p>
      )}

      {turns.length === 0 && !blocked && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <Button key={s} variant="pill" size="sm" className="normal-case tracking-normal" onClick={() => void send(s)}>
              {s}
            </Button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        <div className="space-y-3" aria-live="polite">
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-accent/10 px-4 py-2 font-body text-sm text-ink ${
                    turn.failed ? "opacity-60" : ""
                  }`}
                >
                  {turn.text}
                </p>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[92%] rounded-xl border border-edge-accent-subtle px-4 py-3">
                  {turn.text ? (
                    <p className="whitespace-pre-wrap break-words font-body text-sm text-ink">{turn.text}</p>
                  ) : (
                    <p className="font-body text-sm text-mono-500">{working ?? "Pensando…"}</p>
                  )}
                  {turn.text && working && i === turns.length - 1 && (
                    <p className="mt-2 font-body text-xs text-mono-500">{working}</p>
                  )}
                </div>
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-negative-surface bg-negative-surface-deep/20 px-4 py-3 text-sm text-negative-fg">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <textarea
          aria-label="Tu pregunta"
          className={inputCls}
          rows={3}
          maxLength={ADMIN_CHAT_LIMITS.maxQuestionChars}
          placeholder="Escribe tu pregunta… (Enter para enviar, Shift+Enter para otra línea)"
          value={draft}
          disabled={blocked}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={reset} disabled={turns.length === 0 && !error}>
            Nueva conversación
          </Button>
          <Button
            variant="primary"
            size="md"
            busy={sending}
            busyLabel="Respondiendo…"
            disabled={blocked || !draft.trim()}
            onClick={() => void send(draft)}
          >
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}

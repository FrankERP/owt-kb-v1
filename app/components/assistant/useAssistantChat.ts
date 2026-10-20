"use client";

// The assistant's conversation (ADR-0060): status, turns and the streamed answer. It lives in the
// bubble, which the client layout mounts once, so the conversation survives moving between pages.
// Nothing is stored anywhere else — a reload starts a new conversation. The answer streams in as
// `AdminChatEvent` lines (`app/utils/adminChat.ts`).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeChatEvents,
  type AdminChatMessage,
  type AdminChatPage,
  type AdminChatStatus,
} from "@/app/utils/adminChat";

export type Turn = AdminChatMessage & { failed?: boolean };

type StatusResult = { ok: true; status: AdminChatStatus } | { ok: false; error: string };

export const ACCESS_REFUSED = "El asistente es solo para los admins del equipo de alabanza.";

async function fetchStatus(): Promise<StatusResult> {
  try {
    const res = await fetch("/api/admin/chat", { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as (AdminChatStatus & { error?: string }) | null;
    if (!res.ok || !body || typeof body.configured !== "boolean") {
      const fallback = res.status === 403 ? ACCESS_REFUSED : "No se pudo cargar el asistente.";
      return { ok: false, error: body?.error ?? fallback };
    }
    return { ok: true, status: body };
  } catch {
    return { ok: false, error: "No se pudo cargar el asistente." };
  }
}

export interface AssistantChat {
  status: AdminChatStatus | null;
  statusError: string | null;
  turns: Turn[];
  sending: boolean;
  /** The line shown while the answer is being prepared («Leyendo la letra…»), or null. */
  working: string | null;
  error: string | null;
  loadStatus: () => void;
  /** Resolves false when the question failed, so the caller can put it back in the input. */
  send: (question: string, page: AdminChatPage | null) => Promise<boolean>;
  reset: () => void;
}

/**
 * `active` is false until the admin first opens the bubble: the status read (one Sanity read of the
 * month's spend) waits for that, so an admin who never opens it costs no request on any page.
 */
export function useAssistantChat(active: boolean): AssistantChat {
  const [status, setStatus] = useState<AdminChatStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The fetch is a plain function and the state lands in its `.then`, so the effect never sets
  // state synchronously (react-hooks/set-state-in-effect).
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

  const loaded = status !== null;
  useEffect(() => {
    if (!active || loaded) return;
    void fetchStatus().then(applyStatus);
  }, [active, loaded, applyStatus]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (question: string, page: AdminChatPage | null) => {
      const text = question.trim();
      if (!text || sending) return true;
      // Only the turns that got an answer go back: a failed question is dropped with its error. Each
      // question keeps the page it was asked from, so the resent conversation never changes.
      const history: AdminChatMessage[] = turns.filter((t) => !t.failed).map(({ failed: _failed, ...m }) => m);
      const asked: AdminChatMessage = page ? { role: "user", text, page } : { role: "user", text };
      const messages: AdminChatMessage[] = [...history, asked];
      setTurns([...history, asked, { role: "assistant", text: "" }]);
      setError(null);
      setSending(true);
      setWorking("Pensando…");
      const controller = new AbortController();
      abortRef.current = controller;

      let answer = "";
      let failure: string | null = null;
      const showAnswer = () => {
        const current = answer;
        setTurns((prev) => [...prev.slice(0, -1), { role: "assistant", text: current }]);
      };
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
                showAnswer();
              } else if (event.type === "rewind") {
                answer = event.text;
                showAnswer();
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
          // The question stays visible, marked failed, and is not resent; the caller puts it back in the input.
          setTurns((prev) => [...prev.slice(0, -2), { ...asked, failed: true }]);
          setError(failure);
        }
        setWorking(null);
        setSending(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
      return !failure;
    },
    [sending, turns],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setError(null);
  }, []);

  return { status, statusError, turns, sending, working, error, loadStatus, send, reset };
}

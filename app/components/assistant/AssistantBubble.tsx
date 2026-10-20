"use client";

// The assistant bubble (ADR-0060): a floating button on every page for the admins who may use the
// assistant, opening a chat that knows which page is on screen. A docked card at `sm+` — the page
// stays visible and usable beside it, so the admin can ask about what they see — and the whole
// screen on a phone. Mounted once by the client layout, so the conversation survives navigation.
//
// Visibility here is COSMETIC: `/api/admin/chat` checks the live access record on every request.
// The bubble shows for a super-admin or an admin of worship (`canUseAdminChat`, from the session),
// never while impersonating, never on the sign-in, Studio or OAuth pages.
//
// Fixed-bottom like the toasts and the song FAB, it clears the phone tab bar (`--bottom-nav-h`)
// and the audio transport (`--audio-player-h`), and publishes its own width as
// `--assistant-fab-w` so the song FAB steps aside instead of hiding under it
// (`bottomNavOffsetSync.test.ts`).

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import Button from "@/app/components/ui/Button";
import Equalizer from "@/app/components/ui/Equalizer";
import Presence from "@/app/components/ui/Presence";
import { ADMIN_CHAT_LIMITS, canUseAdminChat } from "@/app/utils/adminChat";
import { currentPage, suggestionsFor, usePageOverride } from "./assistantPage";
import { useAssistantChat } from "./useAssistantChat";

export const ASSISTANT_FAB_VAR = "--assistant-fab-w";
/** The bubble (3.5rem) plus the gap the song FAB keeps from it. */
const FAB_FOOTPRINT = "4.25rem";

const HIDDEN_ROUTES = /^\/(auth|studio|oauth)(\/|$)/;

export default function AssistantBubble() {
  const { data: session } = useSession();
  const pathname = usePathname() ?? "/";
  const user = session?.user;
  const eligible =
    !!user &&
    !user.isImpersonating &&
    !HIDDEN_ROUTES.test(pathname) &&
    canUseAdminChat({ role: user.role, ministries: user.ministries ?? ["worship"] });
  if (!eligible) return null;
  return <AssistantDock pathname={pathname} />;
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z" strokeLinejoin="round" />
      <path d="M8.5 8.5h7M8.5 11.5h4.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 12l16-8-6 16-2.5-6.5z" strokeLinejoin="round" />
    </svg>
  );
}

const BOTTOM = "calc(1.5rem + var(--bottom-nav-h, 0px) + var(--audio-player-h, 0px))";

function AssistantDock({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [draft, setDraft] = useState("");
  const chat = useAssistantChat(everOpened);
  const own = usePageOverride();
  const page = currentPage(pathname, own);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bubbleRef = useRef<HTMLButtonElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // The song FAB steps aside for the bubble while it is on screen.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(ASSISTANT_FAB_VAR, FAB_FOOTPRINT);
    return () => {
      root.style.removeProperty(ASSISTANT_FAB_VAR);
    };
  }, []);

  // Focus moves on the OPEN edge only (ADR-0034): never on a re-render while typing.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView?.({ block: "end" });
  }, [open, chat.turns, chat.working]);

  const toggle = () => {
    setEverOpened(true);
    setOpen((v) => !v);
  };
  const close = () => {
    setOpen(false);
    bubbleRef.current?.focus({ preventScroll: true });
  };

  const ask = async (question: string) => {
    if (!question.trim() || chat.sending) return;
    setDraft("");
    const ok = await chat.send(question, page);
    if (!ok) setDraft(question);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(draft);
    }
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };

  const status = chat.status;
  const exhausted = !!status && status.spentUsd >= status.budgetUsd;
  const blocked = !status || !status.configured || exhausted;
  const lastIndex = chat.turns.length - 1;

  return (
    <>
      <Button
        ref={bubbleRef}
        variant="primary"
        onClick={toggle}
        aria-label={open ? "Cerrar el asistente" : "Abrir el asistente"}
        aria-expanded={open}
        className={`fixed right-4 sm:right-6 z-[70] h-14 w-14 !rounded-full p-0 shadow-lg ${open ? "max-sm:hidden" : ""}`}
        style={{ bottom: BOTTOM }}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </Button>

      <Presence
        show={open}
        as="aside"
        variant="rise"
        aria-label="Asistente"
        onKeyDown={onPanelKeyDown}
        className={
          "fixed inset-0 z-[70] flex flex-col bg-surface-raised-alt " +
          "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] " +
          "sm:inset-auto sm:right-6 sm:w-[min(26rem,calc(100vw-3rem))] sm:h-[min(42rem,calc(100dvh-12rem))] " +
          "sm:rounded-2xl sm:border sm:border-edge-accent-subtle sm:shadow-2xl sm:overflow-hidden sm:pt-0 sm:pb-0 " +
          "sm:bottom-[calc(1.5rem+4.25rem+var(--bottom-nav-h,0px)+var(--audio-player-h,0px))]"
        }
      >
        <header className="flex items-start gap-2 border-b border-edge-accent-subtle px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg leading-tight text-ink">Asistente</p>
            <p className="truncate font-body text-xs text-mono-500" title={page.label}>
              Viendo: {page.label}
            </p>
          </div>
          <Button
            variant="icon"
            onClick={chat.reset}
            disabled={chat.turns.length === 0 && !chat.error}
            aria-label="Nueva conversación"
            title="Nueva conversación"
          >
            <NewChatIcon />
          </Button>
          <Button variant="icon" onClick={close} aria-label="Cerrar el asistente" title="Cerrar">
            <CloseIcon />
          </Button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
          {chat.statusError ? (
            <div className="space-y-2 rounded-xl border border-negative-surface px-3 py-2 text-sm text-negative-fg">
              <p>{chat.statusError}</p>
              <Button variant="ghost" size="sm" onClick={chat.loadStatus}>
                Reintentar
              </Button>
            </div>
          ) : !status ? (
            <p className="flex items-center gap-2 font-body text-sm text-mono-500">
              <Equalizer playing /> Cargando…
            </p>
          ) : !status.configured ? (
            <p className="font-body text-sm text-mono-500">El asistente todavía no está configurado.</p>
          ) : exhausted ? (
            <p className="font-body text-sm text-mono-500">Ya usaste tu cupo de este mes. Se renueva el día 1.</p>
          ) : chat.turns.length === 0 ? (
            <div className="space-y-3">
              <p className="font-body text-sm text-ink">
                Pregúntame sobre canciones, letras, la Biblia, teoría musical o los servicios del equipo. Sé qué página
                tienes abierta. Solo leo: no cambio nada en la app.
              </p>
              <div className="flex flex-col items-start gap-2">
                {suggestionsFor(page).map((s) => (
                  <Button
                    key={s}
                    variant="pill"
                    size="sm"
                    className="h-auto py-1.5 text-left normal-case tracking-normal"
                    onClick={() => void ask(s)}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {chat.turns.map((turn, i) =>
            turn.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent/15 px-3.5 py-2 font-body text-sm text-ink ${
                    turn.failed ? "opacity-60" : ""
                  }`}
                >
                  {turn.text}
                </p>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-edge-accent-subtle px-3.5 py-2.5">
                  {turn.text ? (
                    <p className="whitespace-pre-wrap break-words font-body text-sm leading-relaxed text-ink">{turn.text}</p>
                  ) : (
                    <p className="flex items-center gap-2 font-body text-sm text-mono-500">
                      <Equalizer playing /> {chat.working ?? "Pensando…"}
                    </p>
                  )}
                  {turn.text && chat.working && i === lastIndex && (
                    <p className="mt-2 flex items-center gap-2 font-body text-xs text-mono-500">
                      <Equalizer playing /> {chat.working}
                    </p>
                  )}
                </div>
              </div>
            ),
          )}

          {chat.error && (
            <p role="alert" className="rounded-xl border border-negative-surface px-3 py-2 text-sm text-negative-fg">
              {chat.error}
            </p>
          )}
          <div ref={endRef} />
        </div>

        <footer className="border-t border-edge-accent-subtle px-3 pb-3 pt-2">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              aria-label="Tu pregunta"
              className="max-h-40 min-h-[2.75rem] flex-1 resize-none [field-sizing:content] rounded-xl border border-edge-control bg-transparent px-3 py-2.5 font-body text-[16px] sm:text-sm text-ink placeholder:text-placeholder focus:border-accent focus:outline-none"
              rows={1}
              maxLength={ADMIN_CHAT_LIMITS.maxQuestionChars}
              placeholder="Escribe tu pregunta…"
              value={draft}
              disabled={blocked}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onInputKeyDown}
            />
            <Button
              variant="primary"
              size="md"
              busy={chat.sending}
              busyLabel="Respondiendo…"
              disabled={blocked || !draft.trim()}
              onClick={() => void ask(draft)}
              aria-label="Enviar"
              className="h-11"
            >
              <SendIcon />
            </Button>
          </div>
          {status?.configured && (
            <p className="mt-1.5 px-1 font-label text-[10px] uppercase tracking-widest text-mono-500">
              Cupo del mes: {status.spentUsd.toFixed(2)} de {status.budgetUsd} USD
            </p>
          )}
        </footer>
      </Presence>
    </>
  );
}

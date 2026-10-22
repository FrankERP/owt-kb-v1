"use client";

import { useId, useRef, useState } from "react";
import Button from "./ui/Button";
import Collapse from "./ui/Collapse";
import CueDialog from "./ui/CueDialog";
import SegmentedControl from "./ui/SegmentedControl";
import { useToast } from "./ui/Toast";
import { ArrowRightIcon, ChevronDownIcon, CopyIcon } from "./ui/icons";
import { feedLinks, type CalendarFeedState, type FeedScope, type FeedUrls } from "@/app/utils/calendarFeed";

/**
 * «Calendario» in `/me/ajustes`: the member's private calendar subscription (spec D7, ADR-0057).
 *
 * The URLs arrive as strings from the Server Component, which signs them; this component never
 * sees the secret. «Generar un enlace nuevo» revokes every earlier URL, so it sits behind a
 * confirmation and, on success, swaps in the URLs the server returned.
 *
 * Design pass D (2026-10-22): ONE row of buttons under a «Todos / Solo los míos» switch, where
 * there were two rows of the same three buttons — six buttons for one decision. The switch is the
 * decision (radio semantics, the house `SegmentedControl`); the row acts on it. The how-it-works
 * paragraph folds behind «¿Cómo funciona?» so the three actions are what the block leads with;
 * only the dev warning stays in the open, because it says a button will NOT work here. The
 * one-shot `.ics` download is a row on `/me` («Tu cuenta»): this page reads no assignments
 * (it is ministry-neutral), so the link SENDS the member there — drawn as a way on (the
 * trailing arrow «Ver Oasis Kids» uses), never with a download glyph that promises a file.
 */

const SCOPE_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "mine", label: "Solo los míos" },
] as const satisfies ReadonlyArray<{ value: FeedScope; label: string }>;

export default function CalendarFeedPanel({ initial }: { initial: CalendarFeedState }) {
  const [state, setState] = useState<CalendarFeedState>(initial);
  const [scope, setScope] = useState<FeedScope>("all");
  const [howOpen, setHowOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const rotateRef = useRef<HTMLButtonElement>(null);
  const howId = useId();
  const { toast } = useToast();

  if (state.kind === "unavailable") {
    return <p className="font-body text-sm text-mono-500">{state.message}</p>;
  }
  const links = feedLinks(state.urls, scope);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast({ message: "Enlace copiado", tone: "ok", duration: 2500 });
    } catch {
      toast({ message: "No se pudo copiar. Mantén presionado el enlace para copiarlo.", tone: "error", duration: 3500 });
    }
  }

  async function rotate() {
    setRotating(true);
    try {
      const res = await fetch("/api/me/calendar-feed", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { urls?: FeedUrls };
      if (!body?.urls?.all) throw new Error("respuesta sin enlace");
      setState((prev) => ({ kind: "ready", urls: body.urls!, preview: prev.kind === "ready" ? prev.preview : undefined }));
      setConfirmOpen(false);
      toast({ message: "Listo. Suscríbete otra vez con el enlace nuevo.", tone: "ok", duration: 4000 });
    } catch {
      // Stay open: the old link still works when the change did not happen.
      toast({ message: "No se pudo generar el enlace nuevo. Intenta otra vez.", tone: "error", duration: 4000 });
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="font-body text-sm text-mono-500">
        Agrega tus servicios a tu calendario. Se actualiza solo cuando cambian el equipo o el setlist.
        Los servicios donde te toca servir llevan una ⭐.
      </p>

      {/* The joined bar, the card's full width: `filled` options are `shrink-0`
          by design (a five-filter bar scrolls rather than wraps), so the two
          halves grow through the child selector instead. */}
      <SegmentedControl
        label="Qué servicios incluir"
        value={scope}
        onChange={setScope}
        options={SCOPE_OPTIONS}
        tone="filled"
        size="sm"
        className="w-full [&>button]:flex-1"
      />

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" href={links.google} target="_blank" rel="noopener noreferrer">
          Google Calendar
        </Button>
        <Button variant="secondary" size="sm" href={links.webcal}>
          iPhone / Mac
        </Button>
        <Button variant="ghost" size="sm" onClick={() => copy(links.https)}>
          <CopyIcon size={13} />
          Copiar enlace
        </Button>
      </div>

      {state.preview && (
        <p className="font-body text-xs text-warning-fg">
          Estás en dev: Google y Apple no pueden suscribirse a este enlace (dev está protegido). Solo
          sirve «Copiar enlace» para probarlo. Ojo: dev y producción comparten datos, así que
          «Generar un enlace nuevo» aquí también cambia tu enlace de producción.
        </p>
      )}

      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          aria-expanded={howOpen}
          aria-controls={howId}
          onClick={() => setHowOpen((v) => !v)}
        >
          ¿Cómo funciona?
          <ChevronDownIcon size={13} className={`transition-transform duration-fast ease-out-brand${howOpen ? " rotate-180" : ""}`} />
        </Button>
        <Collapse open={howOpen} id={howId}>
          <p className="pt-2 font-body text-xs text-mono-500">
            Google Calendar se agrega desde una computadora (calendar.google.com); después aparece
            también en tu celular. Google revisa los cambios cada varias horas; el iPhone, más seguido.
            «Solo los míos» trae únicamente los servicios donde te toca servir. El enlace es personal:
            no lo compartas. Si antes descargaste tus servicios, borra esos eventos para no verlos dos
            veces.
          </p>
        </Collapse>
      </div>

      {/* `-ml-3` = the ghost's own padding, so these two start where the text
          column (and «¿Cómo funciona?» above) starts rather than a pad inside it. */}
      <div className="-ml-3 flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" href="/me#tu-cuenta">
          Descargar una sola vez (.ics)
          <ArrowRightIcon size={12} />
        </Button>
        <Button ref={rotateRef} variant="ghost" size="sm" onClick={() => setConfirmOpen(true)}>
          Generar un enlace nuevo
        </Button>
      </div>

      <CueDialog
        open={confirmOpen}
        title="¿Generar un enlace nuevo?"
        label="Generar un enlace nuevo"
        restoreFocusRef={rotateRef}
        size="sm"
        onDismiss={() => {
          if (!rotating) setConfirmOpen(false);
        }}
      >
        <div className="px-6 py-6 space-y-4">
          <p className="font-body text-sm">
            El enlace actual dejará de funcionar y tu calendario dejará de actualizarse hasta que te
            suscribas con el nuevo. Úsalo si compartiste el enlace por error.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)} disabled={rotating}>
              Cancelar
            </Button>
            <Button variant="danger" size="sm" onClick={rotate} busy={rotating} busyLabel="Generando…">
              Generar enlace nuevo
            </Button>
          </div>
        </div>
      </CueDialog>
    </div>
  );
}

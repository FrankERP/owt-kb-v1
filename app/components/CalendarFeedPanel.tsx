"use client";

import { useRef, useState } from "react";
import Button from "./ui/Button";
import CueDialog from "./ui/CueDialog";
import { useToast } from "./ui/Toast";
import type { CalendarFeedState, FeedUrls } from "@/app/utils/calendarFeed";

/**
 * «Calendario» in `/me/ajustes`: the member's private calendar subscription (spec D7, ADR-0057).
 *
 * The URLs arrive as strings from the Server Component, which signs them; this component never
 * sees the secret. «Generar un enlace nuevo» revokes every earlier URL, so it sits behind a
 * confirmation and, on success, swaps in the URLs the server returned.
 */
export default function CalendarFeedPanel({ initial }: { initial: CalendarFeedState }) {
  const [state, setState] = useState<CalendarFeedState>(initial);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const rotateRef = useRef<HTMLButtonElement>(null);
  const { toast } = useToast();

  if (state.kind === "unavailable") {
    return <p className="font-body text-sm text-mono-500">{state.message}</p>;
  }
  const { urls } = state;

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

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" href={urls.googleAll} target="_blank" rel="noopener noreferrer">
          Google Calendar
        </Button>
        <Button variant="secondary" size="sm" href={urls.webcalAll}>
          iPhone / Mac
        </Button>
        <Button variant="ghost" size="sm" onClick={() => copy(urls.all)}>
          Copiar enlace
        </Button>
      </div>

      <div>
        <p className="font-label text-[10px] uppercase tracking-widest text-mono-500 mb-2">Solo mis servicios</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" href={urls.googleMine} target="_blank" rel="noopener noreferrer">
            Google Calendar
          </Button>
          <Button variant="secondary" size="sm" href={urls.webcalMine}>
            iPhone / Mac
          </Button>
          <Button variant="ghost" size="sm" onClick={() => copy(urls.mine)}>
            Copiar enlace
          </Button>
        </div>
      </div>

      <p className="font-body text-xs text-mono-500">
        Google Calendar se agrega desde una computadora (calendar.google.com); después aparece
        también en tu celular. Google revisa los cambios cada varias horas; el iPhone, más seguido. El enlace es
        personal: no lo compartas. Si antes descargaste tus servicios con «Agregar al calendario»,
        borra esos eventos para no verlos dos veces.
      </p>
      {state.preview && (
        <p className="font-body text-xs text-warning-fg">
          Estás en dev: Google y Apple no pueden suscribirse a este enlace (dev está protegido). Solo
          sirve «Copiar enlace» para probarlo. Ojo: dev y producción comparten datos, así que
          «Generar un enlace nuevo» aquí también cambia tu enlace de producción.
        </p>
      )}

      <Button ref={rotateRef} variant="ghost" size="sm" onClick={() => setConfirmOpen(true)}>
        Generar un enlace nuevo
      </Button>

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

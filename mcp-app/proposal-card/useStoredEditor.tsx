// The card's controller over a SAVED month (admin parity phase 1, S4; ADR-0066): the edit list,
// every `check_service_edits_app` call and what the screen shows between them. «Guardar» never
// writes: it sends the checked change sets to the chat (`app.sendMessage`), where Claude calls the
// destructive `save_service_edits` and the Claude app asks first (F3) — as «Cargar» does for a
// proposal. A transport failure never closes anything as done: the screen keeps the list and says so.

import { useCallback, useRef, useState } from "react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { EditorProps, SeatRef } from "./Editor";
import type { PersonView } from "./editorModel";
import {
  afterStoredRefusal,
  forceStoredLast,
  monthName,
  contextOf,
  focusedServices,
  joinWords,
  saveMessage,
  saveParts,
  saveRequest,
  storedCheckViewOf,
  type Focus,
  type StoredCheckView,
  type StoredEdit,
} from "./storedModel";

const LOST = "No pude hablar con el servidor; vuelve a intentarlo. Tus cambios siguen aquí.";

/** The seat an edit lands on: where its «¿Asignar de todos modos?» is shown. */
export function storedSeatOf(edit: StoredEdit | undefined): SeatRef | null {
  if (!edit || edit.op === "header") return null;
  if (edit.op === "exchange") return { service: edit.b.service, row: edit.b.row };
  if (edit.op === "move") return edit.to;
  return { service: edit.service, row: edit.row };
}

export interface StoredEditorState {
  open: boolean;
  props: EditorProps | null;
  opening: { notice: string | null; onClose: () => void };
  start: (month: string, edits: StoredEdit[], focus: Focus | null) => void;
}

export function useStoredEditor(app: App | null): StoredEditorState {
  const [month, setMonth] = useState<string | null>(null);
  const [edits, setEdits] = useState<StoredEdit[]>([]);
  const [check, setCheck] = useState<StoredCheckView | null>(null);
  /** The days the chat asked to show; «Ver mes completo» clears it. */
  const [focus, setFocus] = useState<Focus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<EditorProps["sheet"]>(null);
  const [ask, setAsk] = useState<{ at: SeatRef | null; sentence: string; items: Array<{ where: string; sentence: string }> } | null>(null);
  const [exchanging, setExchanging] = useState<EditorProps["exchanging"]>(null);
  /** The parts already handed to the chat for the CURRENT list. */
  const [sent, setSent] = useState<number[]>([]);
  const seatRequest = useRef(0);
  /** The context lines of the parts handed over for the CURRENT list (the host keeps only the last update). */
  const contextLines = useRef(new Map<number, string>());

  const call = useCallback(
    async (args: Record<string, unknown>) => {
      if (!app) throw new Error("no host");
      return app.callServerTool({ name: "check_service_edits_app", arguments: args });
    },
    [app],
  );

  const runCheck = useCallback(
    async (at: string, next: StoredEdit[]) => {
      setBusy(true);
      setSent([]);
      contextLines.current = new Map();
      try {
        const view = storedCheckViewOf(await call({ month: at, edits: next }));
        if (!view.ok && !view.refusal) {
          setNotice(view.lines.join(" ") || LOST);
          return;
        }
        if (view.ok) setCheck(view);
        const after = afterStoredRefusal(next, view);
        setEdits(after.edits);
        if (after.askForce && view.refusal) {
          setAsk({ at: storedSeatOf(next[next.length - 1]), sentence: view.refusal.sentence, items: view.prompt ?? [] });
          setNotice(null);
        } else if (view.refusal) {
          setNotice(view.refusal.sentence);
          // The refused edit is gone; judge what is left so the board and the change sets match it.
          const again = storedCheckViewOf(await call({ month: at, edits: after.edits }));
          if (again.ok) setCheck(again);
        } else {
          setNotice(null);
        }
      } catch {
        setNotice(LOST);
      } finally {
        setBusy(false);
      }
    },
    [call],
  );

  const start = useCallback(
    (m: string, initial: StoredEdit[], days: Focus | null) => {
      setMonth(m);
      setFocus(days);
      setEdits([]);
      setCheck(null);
      setNotice(null);
      void runCheck(m, initial);
    },
    [runCheck],
  );

  const close = useCallback(() => {
    seatRequest.current++;
    setMonth(null);
    setCheck(null);
    setAsk(null);
    setSheet(null);
    setExchanging(null);
  }, []);

  const push = (edit: StoredEdit) => {
    if (!month) return;
    void runCheck(month, [...edits, edit]);
  };

  const send = (index: number) => {
    if (!app || !month || !check) return;
    const parts = saveParts(check.changes, check.maxGroup);
    const part = parts[index];
    if (!part) return;
    setBusy(true);
    const say = (text: string) => app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    const full = () => say(saveMessage(month, part, index, parts.length));
    // The arguments go to the model's context and the chat shows only the words and a key; a host
    // without text context updates (or one that refuses this one) gets the full message instead.
    const request = saveRequest(month, part, index, parts.length);
    const withPart = new Map(contextLines.current).set(index, request.contextLine);
    const delivery = app.getHostCapabilities()?.updateModelContext?.text
      ? app.updateModelContext({ content: [{ type: "text", text: contextOf(withPart) }] }).then(
          () => {
            contextLines.current = withPart;
            return say(request.message);
          },
          full,
        )
      : full();
    delivery
      .then((r) => (r.isError ? setNotice("El chat no aceptó el mensaje; pídele a Claude que guarde los cambios.") : setSent((s) => [...s, index])))
      .catch(() => setNotice(LOST))
      .finally(() => setBusy(false));
  };

  let props: EditorProps | null = null;
  if (month && check) {
    const parts = saveParts(check.changes, check.maxGroup);
    const locked = busy || ask !== null;
    const shown = focusedServices(check.board, focus, check.changes.map((c) => c.service));
    const footer = (
      <>
        {check.maxGroup !== null && parts.length > 1 && (
          <p className="unfilled" role="status">
            Estos cambios ligan más servicios de los que se guardan juntos ({check.maxGroup}). Se mandan en {parts.length} partes; si una falla, lo de las otras ya habrá quedado.
          </p>
        )}
        {check.needsCard && (
          <p className="unfilled" role="status">
            Un cambio rompe una regla que no se puede forzar desde aquí; quita ese cambio o hazlo en /admin.
          </p>
        )}
        <div className="actions">
          {parts.map((_, i) => (
            // Sending again is safe (what already saved answers «ya estaba») and is the way back when
            // the arguments did not reach Claude.
            <button key={i} type="button" className={sent.includes(i) ? undefined : "primary"} onClick={() => send(i)} disabled={locked || check.needsCard}>
              {sent.includes(i) ? (parts.length > 1 ? `Parte ${i + 1} enviada · enviar de nuevo` : "Enviado · enviar de nuevo") : parts.length > 1 ? `Guardar parte ${i + 1} de ${parts.length}` : "Guardar"}
            </button>
          ))}
          <button type="button" onClick={() => void runCheck(month, [])} disabled={locked || edits.length === 0}>
            Descartar cambios
          </button>
        </div>
        <p className="foot muted">«Guardar» manda los cambios al chat; Claude los guarda y la app te pide permiso antes.</p>
      </>
    );
    props = {
      mode: "stored",
      heading: `Servicios de ${monthName(month)}`,
      subtitle: check.changes.length ? `${check.changes.length} ${check.changes.length === 1 ? "servicio cambia" : "servicios cambian"}` : "Sin cambios",
      footer,
      board: shown ?? check.board,
      ...(shown ? { narrowed: { shown: joinWords(shown.map((s) => s.label)), onWiden: () => setFocus(null) } } : {}),
      lines: check.lines,
      pending: edits.length,
      busy,
      notice,
      sheet,
      ask,
      exchanging,
      onOpenSeat: (seat: SeatRef, label: string) => {
        const mine = ++seatRequest.current;
        setSheet({ seat, label, candidates: null });
        call({ month, edits, seat })
          .then((r) => {
            if (mine !== seatRequest.current) return;
            const view = storedCheckViewOf(r);
            if (!view.ok || !view.candidates) {
              setSheet(null);
              setNotice(view.lines.join(" ") || LOST);
            } else setSheet({ seat, label, candidates: view.candidates });
          })
          .catch(() => {
            if (mine !== seatRequest.current) return;
            setSheet(null);
            setNotice(LOST);
          });
      },
      onPick: (token: string) => {
        const at = sheet?.seat;
        seatRequest.current++;
        setSheet(null);
        if (at) push({ op: "place", service: at.service, row: at.row, member: token });
      },
      onCloseSheet: () => {
        seatRequest.current++;
        setSheet(null);
      },
      onClear: (seat: SeatRef, member: string) => push({ op: "clear", service: seat.service, row: seat.row, member }),
      onExchange: (seat: SeatRef, person: PersonView) => {
        if (!exchanging) return setExchanging({ ...seat, member: person.token, name: person.name });
        const same = exchanging.member === person.token && exchanging.service === seat.service && exchanging.row === seat.row;
        setExchanging(null);
        if (!same) {
          push({
            op: "exchange",
            a: { service: exchanging.service, row: exchanging.row, member: exchanging.member },
            b: { service: seat.service, row: seat.row, member: person.token },
          });
        }
      },
      onForce: (yes: boolean) => {
        setAsk(null);
        void runCheck(month, yes ? forceStoredLast(edits) : edits.slice(0, -1));
      },
      onDiscard: () => void runCheck(month, []),
      onClose: close,
    };
  }

  return { open: month !== null, props, opening: { notice, onClose: close }, start };
}

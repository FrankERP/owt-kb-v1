// The card's controller over a SAVED month (admin parity phase 1, S4; ADR-0066): the edit list,
// every `check_service_edits_app` call and what the screen shows between them. «Guardar» asks in the
// card, then saves through the app-only `save_service_edits_app` — the chat's own save, which re-checks
// every change set (ADR-0066 addendum, 2026-10-23). «Mandar al chat» keeps the old way: the change sets
// go to the chat, Claude calls `save_service_edits` and the Claude app asks first. A transport failure
// never closes anything as done: the screen keeps the list and says so.
//
// One rule once a save starts (plan 2026-10-23, S2.3): the edit list is never replayed. An attempt can
// write some services without the card knowing which, and a replayed edit the month already holds is
// refused, so the list is either kept FROZEN for a repeat of the same part or thrown away by a check
// from the empty list, which reads what is stored whatever happened.
//
// Deleting (admin parity phase 2, T5): «Borrar servicios…» and «Borrar este servicio» run only with no
// unsaved edits and no save started, ask `check_service_deletes`, show its lines in the card's own
// confirmation, and «Sí, borrar» sends that list and token untouched to `delete_services_app`. The
// same rule as a save: an unknown outcome keeps the SAME list for «Borrar de nuevo» (one repeat for a
// contention, then a re-read), anything else reads the month again from the empty list.

import { useCallback, useRef, useState, type ReactNode } from "react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { EditorProps, SeatRef } from "./Editor";
import type { PersonView } from "./editorModel";
import {
  CARD_DELETE,
  CARD_SAVE,
  afterStoredRefusal,
  deleteCheckViewOf,
  deleteMessage,
  deleteResultViewOf,
  deletedContext,
  forceStoredLast,
  monthName,
  contextOf,
  focusedServices,
  joinWords,
  saveMessage,
  saveParts,
  saveRequest,
  savedContext,
  storedCheckViewOf,
  storedSaveViewOf,
  type DeleteCheckView,
  type Focus,
  type StoredCheckView,
  type StoredEdit,
} from "./storedModel";

const LOST = "No pude hablar con el servidor; vuelve a intentarlo. Tus cambios siguen aquí.";

/** Above the route's 60 s `maxDuration`, so the client's default 60 s never cuts a save that is finishing. */
const SAVE_TIMEOUT_MS = 70_000;

/** Where the card's delete is: choosing the scope, checking, asking, deleting, or holding an unknown outcome. */
type DeleteFlow =
  | { stage: "choose" }
  | { stage: "checking"; service: string | null }
  | { stage: "confirm"; service: string | null; view: DeleteCheckView }
  | { stage: "running"; service: string | null; view: DeleteCheckView }
  | { stage: "unsure"; service: string | null; view: DeleteCheckView; contentions: number; sent: boolean };

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
  /** The parts handed to the chat («Mandar al chat») for the CURRENT list. */
  const [sent, setSent] = useState<number[]>([]);
  /** The part whose confirmation is open. */
  const [confirming, setConfirming] = useState<number | null>(null);
  /** A save started for the current list: no gesture may extend it (S2.3). */
  const [frozen, setFrozen] = useState(false);
  /** Parts the card saved (`ok: true`) for the current list. */
  const [saved, setSaved] = useState<number[]>([]);
  /** Parts whose last attempt may have written part of them: «Guardar de nuevo» and «Mandar al chat». */
  const [retry, setRetry] = useState<number[]>([]);
  /** The last save's lines: kept as the notice by a later check from the empty list. */
  const lastSaveLines = useRef<string[] | null>(null);
  /** The saved parts' lines for the current list: what Claude is told is saved (the host keeps one update). */
  const savedReport = useRef<string[]>([]);
  /** The month a save started in: reopening it from the chat's edits would replay them. */
  const wroteMonth = useRef<string | null>(null);
  const seatRequest = useRef(0);
  /** The context lines of the parts handed over for the CURRENT list (the host keeps only the last update). */
  const contextLines = useRef(new Map<number, string>());
  /** The card's delete, when one is open. */
  const [deleting, setDeleting] = useState<DeleteFlow | null>(null);

  const call = useCallback(
    async (args: Record<string, unknown>) => {
      if (!app) throw new Error("no host");
      return app.callServerTool({ name: "check_service_edits_app", arguments: args });
    },
    [app],
  );

  /**
   * Judges `next` on a fresh read. `keep`: the notice to show instead of clearing it (a save's report);
   * a check from the empty list that succeeds ends a frozen list. Answers whether the check succeeded.
   */
  const runCheck = useCallback(
    async (at: string, next: StoredEdit[], keep?: string[]): Promise<boolean> => {
      setBusy(true);
      setSent([]);
      contextLines.current = new Map();
      const kept = (extra?: string | null) => [...(keep ?? []), ...(extra ? [extra] : [])].join(" ") || null;
      try {
        const view = storedCheckViewOf(await call({ month: at, edits: next }));
        if (!view.ok && !view.refusal) {
          setNotice(kept(view.lines.join(" ") || LOST));
          return false;
        }
        if (view.ok) setCheck(view);
        const after = afterStoredRefusal(next, view);
        setEdits(after.edits);
        if (after.askForce && view.refusal) {
          setAsk({ at: storedSeatOf(next[next.length - 1]), sentence: view.refusal.sentence, items: view.prompt ?? [] });
          setNotice(kept());
        } else if (view.refusal) {
          setNotice(kept(view.refusal.sentence));
          // The refused edit is gone; judge what is left so the board and the change sets match it.
          const again = storedCheckViewOf(await call({ month: at, edits: after.edits }));
          if (again.ok) setCheck(again);
        } else {
          setNotice(kept());
        }
        if (next.length === 0 && view.ok) {
          // A new list starts: an older list's report is not this one's (`keep` is already on screen).
          lastSaveLines.current = null;
          savedReport.current = [];
          setFrozen(false);
          setSaved([]);
          setRetry([]);
          setConfirming(null);
        }
        return view.ok;
      } catch {
        setNotice(kept(LOST));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [call],
  );

  /** Reads the month as stored, keeping `keep` as the notice; a failed read keeps the list frozen and says so. */
  const reread = useCallback(
    async (at: string, keep: string[]) => {
      if (!(await runCheck(at, [], keep))) setNotice([...keep, CARD_SAVE.rereadFailed].join(" "));
    },
    [runCheck],
  );

  const start = useCallback(
    (m: string, initial: StoredEdit[], days: Focus | null) => {
      setMonth(m);
      setFocus(days);
      setEdits([]);
      setCheck(null);
      setNotice(null);
      setFrozen(false);
      setSaved([]);
      setRetry([]);
      setConfirming(null);
      setDeleting(null);
      lastSaveLines.current = null;
      savedReport.current = [];
      // After a save in this month, the chat's edits may already be in it: open what is stored instead.
      void runCheck(m, wroteMonth.current === m ? [] : initial);
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
    setConfirming(null);
    setDeleting(null);
  }, []);

  const push = (edit: StoredEdit) => {
    if (!month || frozen) return;
    void runCheck(month, [...edits, edit]);
  };

  /** «Mandar al chat»: the change sets go to the chat, where Claude saves and the Claude app asks first. */
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

  /** «Guardar»: the confirmation for one part; it holds the board like «¿Asignar de todos modos?». */
  const confirm = (index: number) => {
    seatRequest.current++;
    setSheet(null);
    setExchanging(null);
    setConfirming(index);
  };

  /** «Sí, guardar»: the part, untouched, to the card's save (S2.2–S2.5). */
  const save = async (index: number) => {
    if (!app || !month || !check) return;
    const at = month;
    const parts = saveParts(check.changes, check.maxGroup);
    const part = parts[index];
    if (!part) return;
    setConfirming(null);
    setBusy(true);
    setFrozen(true);
    wroteMonth.current = at;
    // Nothing handed to the chat earlier for this list stays in what a later «Mandar al chat» sends.
    contextLines.current = new Map();
    // The host keeps only the last update, so it carries every part saved for this list, then this answer.
    const tellClaude = (ok: boolean, lines: string[]) => {
      if (ok) savedReport.current = [...savedReport.current, ...lines];
      if (!app.getHostCapabilities()?.updateModelContext?.text) return;
      const text = [
        ...(savedReport.current.length ? [savedContext(at, true, savedReport.current)] : []),
        ...(ok ? [] : [savedContext(at, false, lines)]),
      ].join("\n");
      app.updateModelContext({ content: [{ type: "text", text }] }).catch(() => {});
    };
    const toRetry = (lines: string[]) => {
      setRetry((r) => (r.includes(index) ? r : [...r, index]));
      setNotice(lines.join(" "));
    };
    try {
      const view = storedSaveViewOf(
        await app.callServerTool({ name: "save_service_edits_app", arguments: { month: at, changes: part } }, { timeout: SAVE_TIMEOUT_MS }),
      );
      if (!view.structured) {
        toRetry([...view.lines, CARD_SAVE.repeat]);
        return;
      }
      lastSaveLines.current = view.lines;
      tellClaude(view.ok, view.lines);
      if (view.ok) {
        const done = [...saved.filter((i) => i !== index), index];
        setSaved(done);
        setRetry((r) => r.filter((i) => i !== index));
        setNotice(view.lines.join(" "));
        if (parts.every((_, i) => done.includes(i))) {
          setBusy(false);
          await reread(at, view.lines);
        }
        return;
      }
      if (view.next === "repeat_same_call") {
        toRetry([...view.lines, CARD_SAVE.repeat]);
        return;
      }
      // A refusal, or a save that stopped with something left: read the month as stored, never replay the list.
      setBusy(false);
      await reread(at, [...view.lines, CARD_SAVE.reread]);
    } catch {
      toRetry([CARD_SAVE.unknown]);
    } finally {
      setBusy(false);
    }
  };

  // ── Deleting ───────────────────────────────────────────────────────────────

  /** The delete needs a clean card: no unsaved edits, no save started, nothing else open. */
  const canDelete = edits.length === 0 && !frozen && confirming === null && ask === null && deleting === null;

  /** `check_service_deletes`, the chat's own read-only check: the whole month, or one service. */
  const checkDeletes = async (args: { include?: "drafts" | "all"; services?: string[] }, service: string | null) => {
    if (!app || !month) return;
    seatRequest.current++;
    setSheet(null);
    setExchanging(null);
    setDeleting({ stage: "checking", service });
    setBusy(true);
    try {
      const view = deleteCheckViewOf(await app.callServerTool({ name: "check_service_deletes", arguments: { month, ...args } }));
      if (!view.ok) {
        setDeleting(null);
        setNotice(view.lines.join(" ") || LOST);
        return;
      }
      setDeleting({ stage: "confirm", service, view });
    } catch {
      setDeleting(null);
      setNotice(LOST);
    } finally {
      setBusy(false);
    }
  };

  const openDelete = (service: string | null) => {
    if (!canDelete) return;
    if (service === null) {
      seatRequest.current++;
      setSheet(null);
      setExchanging(null);
      setDeleting({ stage: "choose" });
    } else void checkDeletes({ services: [service] }, service);
  };

  /** Reads the month after a delete; a failed read keeps the board locked and says so. */
  const rereadAfterDelete = async (at: string, keep: string[]) => {
    if (!(await runCheck(at, [], keep))) setNotice([...keep, CARD_DELETE.rereadFailed].join(" "));
  };

  /** «Sí, borrar» (and «Borrar de nuevo»): the check's list and token, untouched, to the card's delete. */
  const runDelete = async (service: string | null, view: DeleteCheckView, contentions: number) => {
    if (!app || !month || !view.token || view.deletes.length === 0) return;
    const at = month;
    setDeleting({ stage: "running", service, view });
    setBusy(true);
    setFrozen(true);
    wroteMonth.current = at;
    const tellClaude = (ok: boolean, lines: string[]) => {
      if (!app.getHostCapabilities()?.updateModelContext?.text) return;
      app.updateModelContext({ content: [{ type: "text", text: deletedContext(at, ok, lines) }] }).catch(() => {});
    };
    const unsure = (lines: string[], seen: number) => {
      setDeleting({ stage: "unsure", service, view, contentions: seen, sent: false });
      setNotice(lines.join(" "));
    };
    try {
      const r = deleteResultViewOf(
        await app.callServerTool({ name: "delete_services_app", arguments: { month: at, deletes: view.deletes, token: view.token } }, { timeout: SAVE_TIMEOUT_MS }),
      );
      if (!r.structured) {
        unsure([CARD_DELETE.unknown], contentions);
        return;
      }
      tellClaude(r.ok, r.lines);
      const seen = contentions + (r.contention ? 1 : 0);
      // A contention is repeated once; an unknown outcome as often as it takes. Anything else: read the month.
      if (r.next === "repeat_same_call" && (r.unsure || seen <= 1)) {
        unsure([...r.lines, CARD_DELETE.repeat], seen);
        return;
      }
      setDeleting(null);
      setBusy(false);
      await rereadAfterDelete(at, r.ok ? r.lines : [...r.lines, CARD_DELETE.reread]);
    } catch {
      unsure([CARD_DELETE.unknown], contentions);
    } finally {
      setBusy(false);
    }
  };

  /** «Mandar al chat» after an unknown outcome: Claude calls `delete_services`, the Claude app asks first. */
  const sendDelete = (flow: Extract<DeleteFlow, { stage: "unsure" }>) => {
    if (!app || !month || !flow.view.token) return;
    setBusy(true);
    app
      .sendMessage({ role: "user", content: [{ type: "text", text: deleteMessage(month, flow.view.deletes, flow.view.token) }] })
      .then((r) => (r.isError ? setNotice("El chat no aceptó el mensaje; pídele a Claude que borre los servicios.") : setDeleting({ ...flow, sent: true })))
      .catch(() => setNotice(LOST))
      .finally(() => setBusy(false));
  };

  const deletePanel = (flow: DeleteFlow | null, at: string): ReactNode => {
    if (!flow || !month) return null;
    if (flow.stage === "choose") {
      return (
        <div className="picker ask" role="alertdialog" aria-label={CARD_DELETE.sheetHead(at)}>
          <h2>{CARD_DELETE.sheetHead(at)}</h2>
          {focus && <p className="muted">{CARD_DELETE.sheetFocus}</p>}
          <p className="muted">{CARD_DELETE.allNote}</p>
          <div className="actions">
            <button type="button" className="primary" onClick={() => void checkDeletes({ include: "drafts" }, null)} disabled={busy}>
              {CARD_DELETE.drafts}
            </button>
            <button type="button" onClick={() => void checkDeletes({ include: "all" }, null)} disabled={busy}>
              {CARD_DELETE.all}
            </button>
            <button type="button" onClick={() => setDeleting(null)} disabled={busy}>
              {CARD_DELETE.no}
            </button>
          </div>
        </div>
      );
    }
    if (flow.stage === "checking") return <p className="muted" role="status">{CARD_DELETE.checking}</p>;
    const v = flow.view;
    if (flow.stage === "unsure") {
      return (
        <div className="actions">
          <button type="button" className="primary" onClick={() => void runDelete(flow.service, v, flow.contentions)} disabled={busy}>
            {CARD_DELETE.again}
          </button>
          <button type="button" onClick={() => sendDelete(flow)} disabled={busy}>
            {flow.sent ? "Enviado al chat · enviar de nuevo" : CARD_DELETE.toChat}
          </button>
        </div>
      );
    }
    const can = v.deletes.length > 0 && v.token !== null;
    return (
      <div className="picker ask" role="alertdialog" aria-label={can ? CARD_DELETE.confirmHead : CARD_DELETE.nothing}>
        <h2>{can ? CARD_DELETE.confirmHead : CARD_DELETE.nothing}</h2>
        {can && (
          <ul className="notices">
            {v.deletes.map((d) => (
              <li key={d.service}>{d.line}</li>
            ))}
          </ul>
        )}
        {v.kept.length > 0 && (
          <>
            <p className="muted">{CARD_DELETE.keptHead}</p>
            <ul className="notices">
              {v.kept.map((k, i) => (
                <li key={i}>
                  {k.label}: {k.reason}
                </li>
              ))}
            </ul>
          </>
        )}
        {v.publishedSkipped > 0 && <p className="muted">{CARD_DELETE.publishedSkipped(v.publishedSkipped)}</p>}
        {v.overflow > 0 && <p className="muted">{CARD_DELETE.overflow(v.overflow)}</p>}
        {can && <p className="muted">{CARD_DELETE.irreversible}</p>}
        <div className="actions">
          {can && (
            <button type="button" className="primary" onClick={() => void runDelete(flow.service, v, 0)} disabled={busy || flow.stage === "running"}>
              {CARD_DELETE.yes}
            </button>
          )}
          <button type="button" onClick={() => setDeleting(null)} disabled={busy || flow.stage === "running"}>
            {can ? CARD_DELETE.no : CARD_DELETE.close}
          </button>
        </div>
      </div>
    );
  };

  let props: EditorProps | null = null;
  if (month && check) {
    const parts = saveParts(check.changes, check.maxGroup);
    const locked = busy || ask !== null || confirming !== null || deleting !== null;
    const deleteService = deleting && deleting.stage !== "choose" ? deleting.service : null;
    const shown = focusedServices(check.board, focus, check.changes.map((c) => c.service));
    const label = (i: number) => {
      if (saved.includes(i)) return parts.length > 1 ? `Parte ${i + 1} guardada` : "Guardado";
      if (retry.includes(i)) return parts.length > 1 ? `${CARD_SAVE.again} (parte ${i + 1})` : CARD_SAVE.again;
      return parts.length > 1 ? `Guardar parte ${i + 1} de ${parts.length}` : "Guardar";
    };
    const part = confirming !== null ? parts[confirming] : undefined;
    const footer = (
      <>
        {check.maxGroup !== null && parts.length > 1 && (
          <p className="unfilled" role="status">
            Estos cambios ligan más servicios de los que se guardan juntos ({check.maxGroup}). Se guardan en {parts.length} partes; si una falla, lo de las otras ya habrá quedado.
          </p>
        )}
        {check.needsCard && (
          <p className="unfilled" role="status">
            Un cambio rompe una regla que no se puede forzar desde aquí; quita ese cambio o hazlo en /admin.
          </p>
        )}
        {part && confirming !== null && (
          <div className="picker ask" role="alertdialog" aria-label={CARD_SAVE.confirmHead}>
            <h2>{CARD_SAVE.confirmHead}</h2>
            <ul className="notices">
              {part.flatMap((c) => c.lines).map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
            <p className="muted">{CARD_SAVE.confirmNote}</p>
            <div className="actions">
              <button type="button" className="primary" onClick={() => void save(confirming)} disabled={busy}>
                {CARD_SAVE.yes}
              </button>
              <button type="button" onClick={() => setConfirming(null)} disabled={busy}>
                {CARD_SAVE.no}
              </button>
            </div>
          </div>
        )}
        {deleting && deleteService === null && deletePanel(deleting, month)}
        <div className="actions">
          {parts.map((_, i) => (
            // A repeat is safe (what already saved answers «ya estaba»); a saved part has nothing left to do.
            <button key={i} type="button" className={saved.includes(i) ? undefined : "primary"} onClick={() => confirm(i)} disabled={locked || check.needsCard || saved.includes(i)}>
              {label(i)}
            </button>
          ))}
          {parts.map((_, i) =>
            retry.includes(i) ? (
              // The old way, for a host that does not let the card save: Claude saves, the app asks first.
              <button key={`chat-${i}`} type="button" onClick={() => send(i)} disabled={locked}>
                {sent.includes(i) ? "Enviado al chat · enviar de nuevo" : parts.length > 1 ? `${CARD_SAVE.toChat} (parte ${i + 1})` : CARD_SAVE.toChat}
              </button>
            ) : null,
          )}
          <button
            type="button"
            onClick={() => void (frozen ? reread(month, lastSaveLines.current ?? []) : runCheck(month, []))}
            disabled={locked || edits.length === 0}
          >
            Descartar cambios
          </button>
          {frozen && edits.length === 0 && !deleting && (
            // After a delete whose re-read failed: the only way on is to read the month again.
            <button type="button" onClick={() => void rereadAfterDelete(month, [])} disabled={busy}>
              {CARD_DELETE.rereadButton}
            </button>
          )}
          <button type="button" onClick={() => openDelete(null)} disabled={locked || !canDelete}>
            {CARD_DELETE.month}
          </button>
        </div>
        {edits.length > 0 && <p className="muted small">{CARD_DELETE.editsFirst}</p>}
        <p className="foot muted">{CARD_SAVE.foot}</p>
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
      frozen: frozen || confirming !== null || deleting !== null,
      onDeleteService: (service: string) => openDelete(service),
      deleteDisabled: locked || !canDelete,
      servicePanel: deleting && deleteService !== null ? { service: deleteService, node: deletePanel(deleting, month) } : null,
      notice,
      sheet,
      ask,
      exchanging,
      onOpenSeat: (seat: SeatRef, label: string) => {
        if (frozen) return;
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
        if (frozen) return;
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
        if (frozen) return;
        void runCheck(month, yes ? forceStoredLast(edits) : edits.slice(0, -1));
      },
      onDiscard: () => void (frozen ? reread(month, lastSaveLines.current ?? []) : runCheck(month, [])),
      onClose: close,
    };
  }

  return { open: month !== null, props, opening: { notice, onClose: close }, start };
}

// The proposal card's editing controller (S4): the edit list, every server call and what the
// screen shows between them. The host connection (`App`) is the only transport: each gesture is a
// `check_proposal_edits`, «Revisar y guardar» a `save_proposal_edits`, «Cargar» a chat message.
// A transport failure never closes anything as done (the repo's mutation-handler rule): the screen
// keeps the list and says so; a save whose answer was lost (or that the server could not confirm)
// is retried with the SAME `saveId` for the SAME list, so the server recognises its own child
// instead of making a second one or calling the base replaced.
//
// Opening always lands on the newest version: a base the server says was replaced is followed to
// its successor (only with no pending edits), so «Editar» on a card whose proposal was edited
// since — here, or in another chat — opens what would actually be loaded.

import { useCallback, useRef, useState } from "react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { EditorProps, SeatRef } from "./Editor";
import {
  afterRefusal,
  checkViewOf,
  confirmsOf,
  forceLast,
  loadMessage,
  newSaveId,
  saveViewOf,
  type CheckView,
  type KeyView,
  type PersonView,
  type TokenEdit,
  type WaiverItem,
} from "./editorModel";

const LOST = "No pude hablar con el servidor; vuelve a intentarlo. Tus cambios siguen aquí.";
const SAVED_BOARD_LOST = "Se guardó, pero no pude volver a cargar la propuesta; ciérrala y vuelve a abrirla.";
/** A lineage holds at most 30 versions; following more replacements than that is a loop. */
const MAX_FOLLOW = 30;

type Ask =
  | { kind: "force"; at: SeatRef | null; sentence: string; items: Array<{ where: string; sentence: string }> }
  | { kind: "save"; sentence: string; items: Array<{ where: string; sentence: string }>; keys: KeyView[] };

/** The seat an edit lands on: where its «¿Asignar de todos modos?» is shown. */
function seatOf(edit: TokenEdit | undefined): SeatRef | null {
  if (!edit) return null;
  if (edit.op === "exchange") return { service: edit.b.service, row: edit.b.row };
  return { service: edit.service, row: edit.row };
}

export interface EditorState {
  open: boolean;
  props: EditorProps | null;
  /** Before the first board arrives: what went wrong, if anything (the screen offers to close). */
  opening: { notice: string | null; onClose: () => void };
  /** The newest version saved from this card, kept after the editor closes. */
  lastSaved: { proposal: string; revision: number } | null;
  start: (proposal: string, revision: number) => void;
}

export function useEditor(app: App | null): EditorState {
  const [base, setBase] = useState<{ proposal: string; revision: number } | null>(null);
  const [edits, setEdits] = useState<TokenEdit[]>([]);
  const [check, setCheck] = useState<CheckView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<EditorProps["sheet"]>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [exchanging, setExchanging] = useState<EditorProps["exchanging"]>(null);
  const [saved, setSaved] = useState<{ revision: number; waivers: WaiverItem[] } | null>(null);
  const [lastSaved, setLastSaved] = useState<{ proposal: string; revision: number } | null>(null);
  const [loadSent, setLoadSent] = useState(false);
  /** The save id and the exact edit list it was minted for. */
  const pendingSave = useRef<{ id: string; edits: string } | null>(null);
  /** Bumped by every seat tap and every close: a candidates answer for an older one is dropped. */
  const seatRequest = useRef(0);

  const call = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      if (!app) throw new Error("no host");
      return app.callServerTool({ name, arguments: args });
    },
    [app],
  );

  /** Sends `next` for judgement; the screen shows the server's board for whatever it accepted. */
  const runCheck = useCallback(
    async (proposal: string, next: TokenEdit[]) => {
      setBusy(true);
      try {
        let at = proposal;
        let view = checkViewOf(await call("check_proposal_edits", { proposal: at, edits: next }));
        for (let hops = 0; !view.ok && view.successor && next.length === 0 && hops < MAX_FOLLOW; hops++) {
          at = view.successor;
          view = checkViewOf(await call("check_proposal_edits", { proposal: at, edits: [] }));
        }
        if (!view.ok) {
          setNotice(view.lines.join(" ") || LOST);
          return;
        }
        if (view.proposal && view.revision !== null) setBase({ proposal: view.proposal, revision: view.revision });
        setCheck(view);
        const after = afterRefusal(next, view);
        setEdits(after.edits);
        if (after.askForce && view.refusal) {
          setAsk({ kind: "force", at: seatOf(next[next.length - 1]), sentence: view.refusal.sentence, items: (view.prompt ?? []).map((x) => ({ where: x.where, sentence: x.sentence })) });
          setNotice(null);
        } else if (view.refusal) {
          setNotice(view.refusal.sentence);
          // The refused edit is gone; judge the list that is left so the warnings match it.
          const again = checkViewOf(await call("check_proposal_edits", { proposal: at, edits: after.edits }));
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
    (proposal: string, revision: number) => {
      setBase({ proposal, revision });
      setEdits([]);
      setCheck(null);
      setSaved(null);
      setLoadSent(false);
      setNotice(null);
      pendingSave.current = null;
      void runCheck(proposal, []);
    },
    [runCheck],
  );

  const push = (edit: TokenEdit) => {
    if (!base) return;
    setLoadSent(false);
    void runCheck(base.proposal, [...edits, edit]);
  };

  const save = useCallback(
    async (confirms: KeyView[]) => {
      if (!base) return;
      setBusy(true);
      const list = JSON.stringify(edits);
      if (pendingSave.current?.edits !== list) pendingSave.current = { id: newSaveId(), edits: list };
      let stored = false;
      try {
        const view = saveViewOf(await call("save_proposal_edits", { proposal: base.proposal, edits, confirms, saveId: pendingSave.current.id }));
        if (view.ok && view.proposal && view.revision !== null) {
          stored = true;
          pendingSave.current = null;
          setBase({ proposal: view.proposal, revision: view.revision });
          setLastSaved({ proposal: view.proposal, revision: view.revision });
          setEdits([]);
          setSaved({ revision: view.revision, waivers: view.waivers });
          setNotice(view.checked ? null : view.lines.find((l) => l.includes("sin revisar")) ?? null);
          // The new base, judged with no edits: its board, its warnings, its kept waivers. A
          // replayed save (its first answer was lost) carries no waivers; this check does.
          const fresh = checkViewOf(await call("check_proposal_edits", { proposal: view.proposal, edits: [] }));
          if (fresh.ok) {
            setCheck(fresh);
            setSaved({ revision: view.revision, waivers: fresh.waivers });
          } else {
            setNotice(SAVED_BOARD_LOST);
          }
          return;
        }
        // A definitive answer makes the next attempt a new save; «try again» keeps the id.
        if (!view.retry) pendingSave.current = null;
        if (view.detail === "stale_check" || view.detail === "needs_confirmation") {
          setAsk({
            kind: "save",
            sentence: view.lines[0] ?? "",
            items: view.diff.map((x) => ({ where: x.where, sentence: x.sentence })),
            keys: view.diff.map(({ kind, rule, service, row, members }) => ({ kind, rule, service, row, members })),
          });
        } else {
          setNotice(view.lines.join(" ") || LOST);
        }
      } catch {
        // Before the save answered, it may be lost: keep the id, so a retry finds the child.
        // After it answered, only the follow-up check failed: the version is stored.
        setNotice(stored ? SAVED_BOARD_LOST : LOST);
      } finally {
        setBusy(false);
      }
    },
    [base, call, edits],
  );

  const close = useCallback(() => {
    seatRequest.current++;
    setBase(null);
    setCheck(null);
    setAsk(null);
    setSheet(null);
    setExchanging(null);
  }, []);

  const props: EditorProps | null = base && check
    ? {
        revision: base.revision,
        board: check.board,
        lines: check.lines,
        pending: edits.length,
        busy,
        notice,
        sheet,
        ask: ask ? { at: ask.kind === "force" ? ask.at : null, sentence: ask.sentence, items: ask.items } : null,
        exchanging,
        saved,
        loadSent,
        onOpenSeat: (seat: SeatRef, label: string) => {
          const mine = ++seatRequest.current;
          setSheet({ seat, label, candidates: null });
          call("check_proposal_edits", { proposal: base.proposal, edits, seat })
            .then((r) => {
              if (mine !== seatRequest.current) return;
              const view = checkViewOf(r);
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
          const current = ask;
          setAsk(null);
          if (!current) return;
          if (current.kind === "save") {
            if (yes) void save(current.keys);
            return;
          }
          void runCheck(base.proposal, yes ? forceLast(edits) : edits.slice(0, -1));
        },
        onSave: () => void save(confirmsOf(check)),
        onDiscard: () => void runCheck(base.proposal, []),
        onLoad: () => {
          if (!app) return;
          setBusy(true);
          app
            .sendMessage({ role: "user", content: [{ type: "text", text: loadMessage(base.proposal, base.revision, check.waivers) }] })
            .then((r) => (r.isError ? setNotice("El chat no aceptó el mensaje; pídele a Claude que cargue la propuesta.") : setLoadSent(true)))
            .catch(() => setNotice(LOST))
            .finally(() => setBusy(false));
        },
        onClose: close,
      }
    : null;

  return { open: base !== null, props, opening: { notice, onClose: close }, lastSaved, start };
}

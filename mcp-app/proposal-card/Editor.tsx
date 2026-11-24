// The proposal card's editing screen (S4), presentational: the server's board in, gestures out. The
// same screen edits a SAVED month (`mode: "stored"`, admin parity S4) with its own heading and actions.
// `main.tsx` owns the host, the edit list and every server call; nothing here judges a rule or
// keeps a board of its own (E1).
//
// The candidate list and «¿Asignar de todos modos?» open INLINE, under the seat that was tapped —
// never as a fixed overlay. The host sizes the card's frame to its content, so a `position: fixed`
// panel sits at the bottom of the WHOLE month, screens away from the seat (Frank, 2026-10-21).

import type { ReactNode } from "react";
import type { Candidate, PersonView, ServiceView, WaiverItem } from "./editorModel";
import { CARD_DELETE } from "./storedModel";

export interface SeatRef {
  service: string;
  row: string;
}

interface BoardProps {
  board: ServiceView[];
  /** The server's lines for the current edit list (rules, the month check). */
  lines: string[];
  pending: number;
  busy: boolean;
  /**
   * The saved-month card after a save started (ADR-0066 addendum): the edit list may already be partly in
   * the month, so no gesture may extend it until the card re-reads the month from an empty list.
   */
  frozen?: boolean;
  /** The last refusal or failure, in the server's words. */
  notice: string | null;
  sheet: { seat: SeatRef; label: string; candidates: Candidate[] | null } | null;
  /** `at`: the seat the asked edit touches (shown under it); null = under the actions (a save). */
  ask: { at: SeatRef | null; sentence: string; items: Array<{ where: string; sentence: string }> } | null;
  exchanging: (SeatRef & { member: string; name: string }) | null;
  onOpenSeat: (seat: SeatRef, label: string) => void;
  onPick: (token: string) => void;
  onCloseSheet: () => void;
  onClear: (seat: SeatRef, member: string) => void;
  onExchange: (seat: SeatRef, member: PersonView) => void;
  onForce: (yes: boolean) => void;
  onDiscard: () => void;
  onClose: () => void;
}

/** The proposal editor (ADR-0062): saves versions, «Cargar» hands one to the chat. */
export interface ProposalEditorProps extends BoardProps {
  mode?: "proposal";
  revision: number;
  saved: { revision: number; waivers: WaiverItem[] } | null;
  loadSent: boolean;
  onSave: () => void;
  onLoad: () => void;
}

/** A SAVED month (ADR-0066): the same board; its own heading and actions (`footer`). */
export interface StoredEditorProps extends BoardProps {
  mode: "stored";
  heading: string;
  subtitle: string;
  footer: ReactNode;
  /** The chat asked for some days only (`focus`): which, and the way back to the whole month. */
  narrowed?: { shown: string; onWiden: () => void };
  /** «Borrar este servicio» on each editable service (admin parity phase 2). */
  onDeleteService?: (service: string) => void;
  deleteDisabled?: boolean;
  /** The delete's panel, shown INLINE under the service it is about. */
  servicePanel?: { service: string; node: ReactNode } | null;
}

export type EditorProps = ProposalEditorProps | StoredEditorProps;

function Chip({ person, selected, onClear, onExchange, disabled }: {
  person: PersonView;
  selected: boolean;
  onClear: () => void;
  onExchange: () => void;
  disabled: boolean;
}) {
  return (
    <span className={selected ? "chip selected" : "chip"}>
      <button type="button" className="chip-name" onClick={onExchange} disabled={disabled} aria-pressed={selected} title="Intercambiar">
        {person.name}
        {person.unavailable && <span className="badge">No disp.</span>}
      </button>
      <button type="button" className="chip-x" onClick={onClear} disabled={disabled} aria-label={`Quitar a ${person.name}`}>
        ×
      </button>
    </span>
  );
}

const sameSeat = (a: SeatRef | null | undefined, service: string, row: string) => a?.service === service && a.row === row;

/**
 * An open question holds the board: the overlay it replaced blocked every other tap, and «Cancelar»
 * or «Asignar de todos modos» act on the LAST edit, so a tap elsewhere before answering would make
 * the answer drop or force a different edit than the one asked about. Only the question's own
 * buttons (and «Cerrar») stay live. A frozen saved-month list holds it the same way.
 */
const locked = (p: BoardProps) => p.busy || p.ask !== null || p.frozen === true;

function Picker({ p }: { p: EditorProps }) {
  if (!p.sheet) return null;
  return (
    <div className="picker" role="group" aria-label={p.sheet.label}>
      <h2>{p.sheet.label}</h2>
      {p.sheet.candidates === null ? (
        <p className="muted">Buscando…</p>
      ) : p.sheet.candidates.length === 0 ? (
        <p className="muted">No hay nadie con el Tipo de este lugar.</p>
      ) : (
        <ul className="candidates">
          {p.sheet.candidates.map((c) => (
            <li key={c.token}>
              <button type="button" onClick={() => p.onPick(c.token)} disabled={locked(p) || c.blocked !== null}>
                <span>{c.name}</span>
                {!c.available && <span className="badge">No disp.</span>}
                {(c.blocked ?? c.rule) && <span className="muted small">{c.blocked ?? c.rule}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" onClick={p.onCloseSheet}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Ask({ p }: { p: EditorProps }) {
  if (!p.ask) return null;
  return (
    <div className="picker ask" role="alertdialog" aria-label="Regla">
      <h2>{p.ask.sentence}</h2>
      <p>¿Asignar de todos modos?</p>
      {p.ask.items.length > 0 && (
        <ul className="notices">
          {p.ask.items.map((x, i) => (
            <li key={i}>
              {x.where}: {x.sentence}
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" className="primary" onClick={() => p.onForce(true)} disabled={p.busy}>
          Asignar de todos modos
        </button>
        <button type="button" onClick={() => p.onForce(false)} disabled={p.busy}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function Editor(p: EditorProps) {
  const editable = p.board.filter((s) => s.editable);
  const fixed = p.board.filter((s) => !s.editable);
  return (
    <main className="card editor" aria-busy={p.busy}>
      <header className="head">
        <div>
          <h1>{p.mode === "stored" ? p.heading : "Editar la propuesta"}</h1>
          <p className="muted">
            {p.mode === "stored" ? p.subtitle : `Versión ${p.revision}`}
            {p.pending > 0 ? ` · ${p.pending} ${p.pending === 1 ? "cambio sin guardar" : "cambios sin guardar"}` : ""}
          </p>
        </div>
        <button type="button" className="expand" onClick={p.onClose} disabled={p.busy}>
          Cerrar
        </button>
      </header>

      {p.notice && <p className="unfilled" role="status">{p.notice}</p>}
      {p.exchanging && (
        <p className="hint" role="status">
          Toca a la persona con quien intercambiar a {p.exchanging.name}, o tócala otra vez para cancelar.
        </p>
      )}

      {p.mode === "stored" && p.narrowed && (
        <p className="hint">
          Solo {p.narrowed.shown}.{" "}
          <button type="button" className="link" onClick={p.narrowed.onWiden} disabled={p.busy}>
            Ver mes completo
          </button>
        </p>
      )}

      <section aria-label="Servicios">
        {editable.map((s) => (
          <details className="service" open key={s.service}>
            <summary>
              <span className="service-label">{s.label}</span>
            </summary>
            <dl className="seats">
              {s.seats.map((seat) => {
                const ref = { service: s.service, row: seat.row };
                return (
                  <div className="seat-row" key={seat.row}>
                    <dt>{seat.label}</dt>
                    <dd className="chips">
                      {seat.members.map((m) => (
                        <Chip
                          key={m.token}
                          person={m}
                          disabled={locked(p)}
                          selected={p.exchanging?.member === m.token && p.exchanging.service === s.service && p.exchanging.row === seat.row}
                          onClear={() => p.onClear(ref, m.token)}
                          onExchange={() => p.onExchange(ref, m)}
                        />
                      ))}
                      <button type="button" className="add" onClick={() => p.onOpenSeat(ref, `${s.label} · ${seat.label}`)} disabled={locked(p)} aria-label={`Agregar en ${seat.label}`}>
                        +
                      </button>
                    </dd>
                    {(sameSeat(p.sheet?.seat, s.service, seat.row) || sameSeat(p.ask?.at, s.service, seat.row)) && (
                      <dd className="seat-panel">
                        {sameSeat(p.sheet?.seat, s.service, seat.row) && <Picker p={p} />}
                        {sameSeat(p.ask?.at, s.service, seat.row) && <Ask p={p} />}
                      </dd>
                    )}
                  </div>
                );
              })}
            </dl>
            {p.mode === "stored" && p.onDeleteService && (
              <div className="actions">
                <button type="button" onClick={() => p.onDeleteService!(s.service)} disabled={p.deleteDisabled === true}>
                  {CARD_DELETE.one}
                </button>
              </div>
            )}
            {p.mode === "stored" && p.servicePanel?.service === s.service && p.servicePanel.node}
          </details>
        ))}
        {fixed.map((s) => (
          <details className="service" key={s.service}>
            <summary>
              <span className="service-label">{s.label}</span>
              <span className="tag">{p.mode === "stored" ? "Solo en /admin" : "No se creará"}</span>
            </summary>
          </details>
        ))}
      </section>

      {p.lines.length > 0 && (
        <section className="warnings" aria-label="Revisión">
          <h2>Revisión</h2>
          <ul className="notices">
            {p.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      )}

      {p.mode !== "stored" && p.saved && (
        <section className="saved" aria-label="Guardada">
          <p>Versión {p.saved.revision} guardada.</p>
          {p.saved.waivers.length > 0 && (
            <>
              <p className="muted">Asignado de todos modos (aparecerá en el permiso al cargar):</p>
              <ul className="notices">
                {p.saved.waivers.map((w, i) => (
                  <li key={i}>
                    {w.service} · {w.members.join(" y ")} · {w.rule}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {p.ask && !p.board.some((s) => s.editable && s.seats.some((seat) => sameSeat(p.ask?.at, s.service, seat.row))) && <Ask p={p} />}

      {p.mode === "stored" ? (
        p.footer
      ) : (
        <div className="actions">
          <button type="button" className="primary" onClick={p.onSave} disabled={locked(p) || p.pending === 0}>
            Revisar y guardar
          </button>
          <button type="button" onClick={p.onDiscard} disabled={locked(p) || p.pending === 0}>
            Descartar cambios
          </button>
          <button type="button" onClick={p.onLoad} disabled={locked(p) || p.pending > 0 || p.loadSent}>
            {p.loadSent ? "Enviado al chat" : "Cargar"}
          </button>
        </div>
      )}
    </main>
  );
}

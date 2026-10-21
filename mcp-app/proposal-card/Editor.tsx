// The proposal card's editing screen (S4), presentational: the server's board in, gestures out.
// `main.tsx` owns the host, the edit list and every server call; nothing here judges a rule or
// keeps a board of its own (E1).
//
// The candidate list and «¿Asignar de todos modos?» open INLINE, under the seat that was tapped —
// never as a fixed overlay. The host sizes the card's frame to its content, so a `position: fixed`
// panel sits at the bottom of the WHOLE month, screens away from the seat (Frank, 2026-10-21).

import type { Candidate, PersonView, ServiceView, WaiverItem } from "./editorModel";

export interface SeatRef {
  service: string;
  row: string;
}

export interface EditorProps {
  revision: number;
  board: ServiceView[];
  /** The server's lines for the current edit list (rules, the month check). */
  lines: string[];
  pending: number;
  busy: boolean;
  /** The last refusal or failure, in the server's words. */
  notice: string | null;
  sheet: { seat: SeatRef; label: string; candidates: Candidate[] | null } | null;
  /** `at`: the seat the asked edit touches (shown under it); null = under the actions (a save). */
  ask: { at: SeatRef | null; sentence: string; items: Array<{ where: string; sentence: string }> } | null;
  exchanging: (SeatRef & { member: string; name: string }) | null;
  saved: { revision: number; waivers: WaiverItem[] } | null;
  loadSent: boolean;
  onOpenSeat: (seat: SeatRef, label: string) => void;
  onPick: (token: string) => void;
  onCloseSheet: () => void;
  onClear: (seat: SeatRef, member: string) => void;
  onExchange: (seat: SeatRef, member: PersonView) => void;
  onForce: (yes: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  onLoad: () => void;
  onClose: () => void;
}

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
              <button type="button" onClick={() => p.onPick(c.token)} disabled={p.busy || c.blocked !== null}>
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
          <h1>Editar la propuesta</h1>
          <p className="muted">
            Versión {p.revision}
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
                          disabled={p.busy}
                          selected={p.exchanging?.member === m.token && p.exchanging.service === s.service && p.exchanging.row === seat.row}
                          onClear={() => p.onClear(ref, m.token)}
                          onExchange={() => p.onExchange(ref, m)}
                        />
                      ))}
                      <button type="button" className="add" onClick={() => p.onOpenSeat(ref, `${s.label} · ${seat.label}`)} disabled={p.busy} aria-label={`Agregar en ${seat.label}`}>
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
          </details>
        ))}
        {fixed.map((s) => (
          <details className="service" key={s.service}>
            <summary>
              <span className="service-label">{s.label}</span>
              <span className="tag">No se creará</span>
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

      {p.saved && (
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

      <div className="actions">
        <button type="button" className="primary" onClick={p.onSave} disabled={p.busy || p.pending === 0}>
          Revisar y guardar
        </button>
        <button type="button" onClick={p.onDiscard} disabled={p.busy || p.pending === 0}>
          Descartar cambios
        </button>
        <button type="button" onClick={p.onLoad} disabled={p.busy || p.pending > 0 || p.loadSent}>
          {p.loadSent ? "Enviado al chat" : "Cargar"}
        </button>
      </div>
    </main>
  );
}

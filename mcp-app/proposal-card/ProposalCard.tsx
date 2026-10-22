// The proposal card's presentational half (S1): one `CardView` in, markup out. No host, no
// network, no state of its own beyond what a native <details> keeps — `main.tsx` owns the
// connection and hands this the view. «Editar» opens the editing screen (`Editor.tsx`, S4).

import type { CardService, CardView } from "./model";

export interface ProposalCardProps {
  view: CardView;
  /** The host offers fullscreen and the card is not already in it. */
  canExpand: boolean;
  onExpand: () => void;
  /** Opens the editor on this proposal; absent when the host cannot call tools. */
  onEdit?: () => void;
  /** A newer version saved from this card: the card below still shows the version it was handed. */
  note?: string;
  /** A saved month the chat asked to show only some days of: «Ver mes completo» was pressed. */
  wide?: boolean;
  onWiden?: () => void;
}

function ServiceBlock({ service, fixedTag = "No se creará" }: { service: CardService; fixedTag?: string }) {
  return (
    <details className="service" open={service.planned}>
      <summary>
        <span className="service-label">{service.label}</span>
        {!service.planned && <span className="tag">{fixedTag}</span>}
      </summary>
      {service.rows.length === 0 ? (
        <p className="muted">Sin asignaciones.</p>
      ) : (
        <dl className="seats">
          {service.rows.map((row) => (
            <div className="seat-row" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.names.join(", ")}</dd>
            </div>
          ))}
        </dl>
      )}
    </details>
  );
}

export function ProposalCard({ view, canExpand, onExpand, onEdit, note, wide = false, onWiden }: ProposalCardProps) {
  if (view.kind === "waiting") {
    return (
      <main className="card" aria-busy="true">
        <p className="muted">Esperando la propuesta…</p>
      </main>
    );
  }

  if (view.kind === "storedMonth") {
    const focused = view.focused && !wide ? view.focused : null;
    return (
      <main className="card">
        <header className="head">
          <div>
            <h1>{view.title}</h1>
            <p className="muted">{view.changed ? `${view.changed} ${view.changed === 1 ? "servicio cambia" : "servicios cambian"} (sin guardar)` : "Así está guardado"}</p>
          </div>
          {canExpand && (
            <button type="button" className="expand" onClick={onExpand}>
              Ver en grande
            </button>
          )}
        </header>
        {note && (
          <p className="hint" role="status">
            {note}
          </p>
        )}
        {view.lines.length > 0 && (
          <ul className="notices">
            {view.lines.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
        {focused && (
          <p className="hint">
            Solo {focused.shown}.{" "}
            {onWiden && (
              <button type="button" className="link" onClick={onWiden}>
                Ver mes completo
              </button>
            )}
          </p>
        )}
        <section aria-label="Servicios">
          {(focused?.services ?? view.services).map((s, i) => (
            <ServiceBlock key={`${s.label}-${i}`} service={s} fixedTag="Solo en /admin" />
          ))}
        </section>
        {onEdit ? (
          <div className="actions">
            <button type="button" className="primary" onClick={onEdit}>
              Editar
            </button>
          </div>
        ) : null}
        <p className="foot muted">
          {onEdit ? "Edita los lugares aquí, o pídeselo a Claude en el chat. Nada se guarda sin que lo confirmes en el chat." : "Para cambiar o guardar algo, díselo a Claude en el chat."}
        </p>
      </main>
    );
  }

  if (view.kind === "refused" || view.kind === "unreadable") {
    return (
      <main className="card">
        <h1>{view.kind === "refused" ? "No hay propuesta" : "Propuesta del mes"}</h1>
        {view.lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </main>
    );
  }

  return (
    <main className="card">
      <header className="head">
        <div>
          <h1>{view.title}</h1>
          <p className={view.stored || !view.services.some((x) => x.planned) ? "muted" : "warning"}>{view.status}</p>
        </div>
        {canExpand && (
          <button type="button" className="expand" onClick={onExpand}>
            Ver en grande
          </button>
        )}
      </header>

      {note && (
        <p className="hint" role="status">
          {note}
        </p>
      )}

      {view.stages.length + view.notices.length > 0 && (
        <ul className="notices">
          {[...view.stages, ...view.notices].map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {view.unfilled.length > 0 && (
        <section className="unfilled" aria-label="Lugares sin cubrir">
          <h2>Lugares sin cubrir</h2>
          <ul>
            {view.unfilled.map((u, i) => (
              <li key={i}>
                {u.service}: {u.seat}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.leftOut.length > 0 && (
        <section className="unfilled" aria-label="No se planearon">
          <h2>No se planearon</h2>
          <ul>
            {view.leftOut.map((l, i) => (
              <li key={i}>
                {l.service}: {l.reasons.join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.refusedSpecials.length > 0 && (
        <section className="unfilled" aria-label="Especiales no agregados">
          <h2>Especiales no agregados</h2>
          <ul>
            {view.refusedSpecials.map((r, i) => (
              <li key={i}>
                {r.name} ({r.day}): {r.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.unavailability.length > 0 && (
        <section aria-label="No disponibles">
          <h2>No disponibles</h2>
          <ul className="notices">
            {view.unavailability.map((u, i) => (
              <li key={i}>
                {u.name}: {u.service} {u.day}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Servicios">
        {view.services.map((s, i) => (
          <ServiceBlock key={`${s.label}-${i}`} service={s} />
        ))}
      </section>

      {view.fairness.length > 0 && (
        <details className="fairness">
          <summary>Equidad</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col">Pestaña</th>
                <th scope="col">En este plan</th>
                <th scope="col">Queda</th>
              </tr>
            </thead>
            <tbody>
              {view.fairness.flatMap((p, i) =>
                p.tabs.map((t, j) => (
                  <tr key={`${i}-${j}`}>
                    {j === 0 && (
                      <th scope="row" rowSpan={p.tabs.length}>
                        {p.name}
                      </th>
                    )}
                    <td>{t.tab}</td>
                    <td className="num">{t.enEstePlan}</td>
                    <td>{t.queda}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </details>
      )}

      {onEdit && view.handle && view.services.some((x) => x.planned) ? (
        <div className="actions">
          <button type="button" className="primary" onClick={onEdit}>
            Editar
          </button>
        </div>
      ) : null}
      <p className="foot muted">
        {onEdit && view.handle ? "Edita los lugares aquí, o pídeselo a Claude en el chat. Para cargarla, díselo a Claude." : "Para cambiar algo o cargarla, díselo a Claude en el chat."}
      </p>
    </main>
  );
}

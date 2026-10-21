// The proposal card's presentational half (S1): one `CardView` in, markup out. No host, no
// network, no state of its own beyond what a native <details> keeps — `main.tsx` owns the
// connection and hands this the view. Read-only on purpose: every change still goes through
// the chat until the editing slice (S4) lands.

import type { CardService, CardView } from "./model";

export interface ProposalCardProps {
  view: CardView;
  /** The host offers fullscreen and the card is not already in it. */
  canExpand: boolean;
  onExpand: () => void;
}

function ServiceBlock({ service }: { service: CardService }) {
  return (
    <details className="service" open={service.planned}>
      <summary>
        <span className="service-label">{service.label}</span>
        {!service.planned && <span className="tag">No se creará</span>}
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

export function ProposalCard({ view, canExpand, onExpand }: ProposalCardProps) {
  if (view.kind === "waiting") {
    return (
      <main className="card" aria-busy="true">
        <p className="muted">Esperando la propuesta…</p>
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

      <p className="foot muted">Para cambiar algo o cargarla, díselo a Claude en el chat.</p>
    </main>
  );
}

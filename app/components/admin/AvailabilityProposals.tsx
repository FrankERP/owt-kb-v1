"use client";

// «Disponibilidad › Conflictos»: the availability proposals (ADR-0079). Someone marked a day they
// already serve on; the server proposes who takes each of their seats and NEVER changes the service
// by itself. A person applies it here: «Aplicar» (the proposal), «Elegir otro» (an alternative),
// «Mantener» (a deliberate keep, silenced while that conflict lasts) and «Deshacer» on a kept one.
//
// The server judges, this card only shows: every option comes from `GET
// /api/admin/availability-conflicts`, recomputed on that read, and «Aplicar» re-judges on a fresh
// read before it writes through `/admin`'s own edit writer. A 409 means the service moved under the
// screen: reload and say so, never retry the stale option.
//
// When this read fails or cannot judge, the parent's own client-side list (`fallback`) still shows
// who is in conflict: a failure here never reads as «sin conflictos».

import { useCallback, useEffect, useState, type ReactNode } from "react";

import Button from "@/app/components/ui/Button";
import Menu, { MenuHeader, MenuItem, MenuSeparator } from "@/app/components/ui/Menu";
import Skeleton, { SkeletonGroup } from "@/app/components/ui/Skeleton";
import { SHEET_TITLE } from "@/app/utils/homeHero";
import type { BlockedReason, PanelConflict, PanelRead } from "@/app/utils/availabilityFixCommit";
import type { NoneReason } from "@/app/utils/availabilityConflicts";

const ENDPOINT = "/api/admin/availability-conflicts";

const NONE_COPY: Record<NoneReason, string> = {
  no_candidate: "Nadie disponible pasa las reglas. Reasígnalo a mano en Servicios.",
  song_lead: "Dirige canciones en la noche de alabanza: cámbialo a mano en Servicios.",
  unchecked: "No se pudo revisar este servicio (falta el registro de equidad del mes, o el servicio no se puede editar).",
};

const BLOCKED_COPY: Record<BlockedReason, string> = {
  no_token: "El servidor no puede leer los registros privados.",
  sources: "No se pudieron leer los servicios o las reglas.",
  incoherent: "Algún mes tiene servicios duplicados o incompletos; revísalo en Servicios.",
  engine: "El planificador no está en solver v3.",
};

const CONFLICT_COPY = "El servicio cambió; vuelve a revisar.";

type Load =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; read: PanelRead };

function isPanelRead(v: unknown): v is PanelRead {
  const r = v as Partial<PanelRead> | null;
  return !!r && r.ok === true && Array.isArray(r.open) && Array.isArray(r.applied) && Array.isArray(r.kept);
}

const state = (published: boolean) => (published ? "publicado" : "borrador");

const seatRun = (seats: Array<{ seat: string; toName: string }>) =>
  seats.map((s) => `${s.seat} → ${s.toName}`).join(", ");

export default function AvailabilityProposals({ fallback, onChanged }: {
  /** The parent's client-side conflict list, shown whenever this read cannot answer. */
  fallback: ReactNode;
  /** The parent reloads its own rows after a write. */
  onChanged: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  /** The row (or «sweep») whose request is in flight; every button waits on it. */
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      if (!res.ok) throw new Error("read failed");
      const body: unknown = await res.json();
      if (!isPanelRead(body)) throw new Error("bad shape");
      setLoad({ state: "ready", read: body });
    } catch {
      setLoad({ state: "failed" });
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /** One POST; `ok` reports success, a 409 reloads with the «cambió» copy. */
  const post = useCallback(async (key: string, url: string, body: unknown, done: string) => {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        setMessage({ tone: "error", text: CONFLICT_COPY });
      } else if (!res.ok) {
        setMessage({ tone: "error", text: "No se pudo guardar. Intenta de nuevo." });
      } else {
        setMessage({ tone: "ok", text: done });
        onChanged();
      }
    } catch {
      setMessage({ tone: "error", text: "No se pudo guardar. Revisa tu conexión." });
    } finally {
      setBusy(null);
      await reload();
    }
  }, [onChanged, reload]);

  const sweep = useCallback(async () => {
    setBusy("sweep");
    setMessage(null);
    try {
      const res = await fetch(`${ENDPOINT}/sweep`, { method: "POST" });
      const report = (await res.json().catch(() => null)) as { ok?: boolean; mode?: string; reason?: BlockedReason } | null;
      if (!res.ok || !report?.ok) {
        setMessage({ tone: "error", text: report?.reason ? `No se pudo revisar: ${BLOCKED_COPY[report.reason]}` : "No se pudo revisar. Intenta de nuevo." });
      } else {
        setMessage({
          tone: "ok",
          text: report.mode === "dry"
            ? "Revisado. Fuera de producción no se guarda ni se envía correo."
            : "Revisado.",
        });
      }
    } catch {
      setMessage({ tone: "error", text: "No se pudo revisar. Revisa tu conexión." });
    } finally {
      setBusy(null);
      await reload();
    }
  }, [reload]);

  const apply = (c: PanelConflict, option: PanelConflict["options"][number]) =>
    post(
      c.recordId,
      `${ENDPOINT}/apply`,
      { roleId: c.roleId, rev: c.roleRev, memberId: c.memberId, replacements: option.seats.map((s) => ({ rowId: s.rowId, to: s.to })) },
      `Aplicado: ${seatRun(option.seats)} el ${c.service}.`,
    );

  const keep = (c: { recordId: string; roleId: string; memberId: string; date: string; serviceKind: PanelConflict["serviceKind"]; published: boolean; recordRev: string | null }, kept: boolean) =>
    post(
      c.recordId,
      `${ENDPOINT}/keep`,
      { roleId: c.roleId, memberId: c.memberId, date: c.date, serviceKind: c.serviceKind, published: c.published, kept, ...(c.recordRev ? { rev: c.recordRev } : {}) },
      kept ? "Se queda así; no te lo vuelvo a proponer." : "Listo: la próxima revisión lo vuelve a juzgar.",
    );

  const header = (
    <div className="flex items-center justify-between gap-3">
      <h2 className={SHEET_TITLE}>Propuestas de reemplazo</h2>
      <Button variant="secondary" size="sm" onClick={() => { void sweep(); }} disabled={busy !== null}>
        {busy === "sweep" ? "Revisando…" : "Revisar ahora"}
      </Button>
    </div>
  );

  const status = message && (
    <p role="status" className={`font-body text-[15px] ${message.tone === "error" ? "text-negative-fg" : "text-positive-strong"}`}>
      {message.text}
    </p>
  );

  if (load.state === "loading") {
    return (
      <div className="space-y-3">
        {header}
        <SkeletonGroup label="Cargando propuestas">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </SkeletonGroup>
      </div>
    );
  }

  if (load.state === "failed" || load.read.blocked) {
    const why = load.state === "ready" && load.read.blocked ? BLOCKED_COPY[load.read.blocked] : "No se pudieron leer las propuestas.";
    return (
      <div className="space-y-3">
        {header}
        {status}
        <p role="alert" className="font-body text-[15px] text-negative-fg">
          {`No se pudo revisar: ${why} Estos son los conflictos sin propuesta:`}
        </p>
        {fallback}
      </div>
    );
  }

  const { open, kept, applied } = load.read;
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        {header}
        {status}
        {open.length === 0 ? (
          <p className="font-body text-[15px] text-ink-dim">
            Nadie asignado tiene marcada una fecha en la que le toca servir.
          </p>
        ) : (
          <>
            <p className="font-body text-[15px] text-ink-dim">
              No cambio ningún servicio por mi cuenta: tú decides. «Aplicar» guarda el cambio como si lo hicieras en Servicios.
            </p>
            <ul className="border-t border-ink/[0.10]">
              {open.map((c) => {
                const [best, ...others] = c.options;
                const disabled = busy !== null;
                return (
                  <li
                    key={c.recordId}
                    data-availability-proposal=""
                    className="flex min-h-[64px] flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink/[0.10] py-3 sm:flex-nowrap"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="font-body text-[17px] font-semibold text-ink [overflow-wrap:anywhere]">
                        {c.person}
                        <span className="font-normal text-ink-muted">{` no puede el ${c.service}`}</span>
                        <span className="ml-2 font-body text-sm font-normal text-ink-dim">{state(c.published)}</span>
                      </p>
                      <p className="font-body text-[15px] text-ink-muted [overflow-wrap:anywhere]">
                        {best
                          ? <>{"Propuesta: "}<span className="font-semibold text-ink">{seatRun(best.seats)}</span></>
                          : <>
                              {c.none?.seats.length ? `${c.none.seats.map((s) => s.seat).join(", ")}: ` : ""}
                              <span className="text-negative-fg">{NONE_COPY[c.none?.reason ?? "no_candidate"]}</span>
                            </>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {best && (
                        <Button variant="primary" size="sm" disabled={disabled} onClick={() => { void apply(c, best); }}>
                          {busy === c.recordId ? "Guardando…" : "Aplicar"}
                        </Button>
                      )}
                      <Menu
                        label={`Más opciones para ${c.person}`}
                        align="end"
                        trigger={
                          <Button variant="icon" size="lg" aria-label={`Más opciones para ${c.person}`} disabled={disabled}>
                            <span aria-hidden="true" className="text-base leading-none">⋯</span>
                          </Button>
                        }
                      >
                        {others.length > 0 && <MenuHeader>Elegir otro</MenuHeader>}
                        {others.map((o, i) => (
                          <MenuItem key={i} onSelect={() => { void apply(c, o); }}>
                            {seatRun(o.seats)}
                          </MenuItem>
                        ))}
                        {others.length > 0 && <MenuSeparator />}
                        <MenuItem onSelect={() => { void keep(c, true); }}>Mantener así</MenuItem>
                      </Menu>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {kept.length > 0 && (
        <div className="space-y-3">
          <h2 className={SHEET_TITLE}>Se quedan así</h2>
          <ul className="border-t border-ink/[0.10]">
            {kept.map((k) => (
              <li key={k.recordId} data-availability-kept="" className="flex min-h-[56px] items-center gap-4 border-b border-ink/[0.10] py-2.5">
                <span className="min-w-0 flex-1 font-body text-[15px] text-ink-muted [overflow-wrap:anywhere]">
                  <span className="font-semibold text-ink">{k.person}</span>{` sirve el ${k.service} aunque lo marcó como no disponible.`}
                </span>
                <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => { void keep(k, false); }}>
                  {busy === k.recordId ? "Guardando…" : "Deshacer"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {applied.length > 0 && (
        <div className="space-y-3">
          <h2 className={SHEET_TITLE}>Aplicados (últimos 30 días)</h2>
          <ul className="border-t border-ink/[0.10]">
            {applied.map((a) => (
              <li key={a.recordId} data-availability-applied="" className="flex min-h-[48px] items-center border-b border-ink/[0.10] py-2 font-body text-[15px] text-ink-muted [overflow-wrap:anywhere]">
                <span>
                  <span className="font-semibold text-ink">{a.service}</span>
                  {`: ${a.seats.map((s) => `${s.seat}, ${s.from} → ${s.to}`).join("; ")}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

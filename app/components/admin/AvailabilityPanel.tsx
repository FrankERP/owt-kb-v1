"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Member {
  _id: string;
  member_name: string;
  alias?: string;
  unavailableDates?: string[];
  unavailabilityNotes?: { date: string; note: string }[];
}

interface ServiceRole {
  _id: string;
  _type: "sunday_role" | "saturday_role" | "special_role";
  date: string;
  service_name?: string;
  leads:       { _id: string }[];
  bgvs:        { _id: string }[];
  chorus:      { _id: string }[];
  instruments: { person: { _id: string } | null }[];
  foh:         { person: { _id: string } | null }[];
}

type CellStatus =
  | "unavailable"  // marked unavailable, not assigned
  | "conflict"     // assigned AND unavailable
  | "assigned"     // assigned and available
  | "empty";       // not assigned, no info

const SERVICE_LABEL: Record<string, string> = {
  sunday_role: "Dom", saturday_role: "Sáb", special_role: "Esp",
};
const SERVICE_COLOR: Record<string, string> = {
  sunday_role:   "bg-surface-sunken text-ink-muted",
  saturday_role: "bg-warning-surface-deep text-ink-muted",
  special_role:  "bg-info-surface-deep text-ink-muted",
};

const dn = (m: { member_name: string; alias?: string }) => m.alias?.trim() || m.member_name;

function fmtDate(iso: string) {
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function getAssignedIds(role: ServiceRole): string[] {
  return [
    ...(role.leads      ?? []).map(m => m._id),
    ...(role.bgvs       ?? []).map(m => m._id),
    ...(role.chorus     ?? []).map(m => m._id),
    ...(role.instruments ?? []).map(s => s.person?._id).filter((x): x is string => !!x),
    ...(role.foh         ?? []).map(s => s.person?._id).filter((x): x is string => !!x),
  ];
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AvailabilityPanel() {
  const [members, setMembers]   = useState<Member[]>([]);
  const [roles, setRoles]       = useState<ServiceRole[]>([]);
  const [loading, setLoading]   = useState(true);
  const [viewMode, setViewMode] = useState<"matrix" | "conflicts">("conflicts");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [rm, rr] = await Promise.all([fetch("/api/admin/members"), fetch("/api/admin/roles")]);
    if (rm.ok) setMembers(await rm.json());
    if (rr.ok) setRoles(await rr.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  const upcoming = roles
    .filter(r => r.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 14); // next 14 services

  // Members with any upcoming unavailability
  const membersWithUnavail = members.filter(m =>
    m.unavailableDates?.some(d => d >= today)
  );

  // Compute conflicts: assigned member is unavailable on service date
  const conflicts: { role: ServiceRole; member: Member }[] = [];
  for (const role of upcoming) {
    const assignedIds = new Set(getAssignedIds(role));
    for (const m of members) {
      if (assignedIds.has(m._id) && m.unavailableDates?.includes(role.date)) {
        conflicts.push({ role, member: m });
      }
    }
  }

  // Build matrix: rows = members with any upcoming presence or unavail, cols = upcoming services
  const involvedMemberIds = new Set<string>();
  for (const role of upcoming) {
    getAssignedIds(role).forEach(id => involvedMemberIds.add(id));
  }
  membersWithUnavail.forEach(m => involvedMemberIds.add(m._id));

  const matrixMembers = members
    .filter(m => involvedMemberIds.has(m._id))
    .sort((a, b) => dn(a).localeCompare(dn(b), "es"));

  function cellStatus(member: Member, role: ServiceRole): CellStatus {
    const assigned = getAssignedIds(role).includes(member._id);
    const unavail  = member.unavailableDates?.includes(role.date) ?? false;
    if (assigned && unavail) return "conflict";
    if (assigned)            return "assigned";
    if (unavail)             return "unavailable";
    return "empty";
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-surface-accent-wash animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Header + view toggle */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">Disponibilidad</h1>
          <p className="font-label text-xs uppercase tracking-widest text-mono-500 mt-0.5">
            {conflicts.length > 0
              ? `${conflicts.length} conflicto${conflicts.length !== 1 ? "s" : ""} detectado${conflicts.length !== 1 ? "s" : ""}`
              : "Sin conflictos en próximos servicios"}
          </p>
        </div>
        <div className="flex rounded-lg border border-accent/20 overflow-hidden shrink-0">
          {(["conflicts", "matrix"] as const).map(v => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={`px-3 py-2 font-label text-xs uppercase tracking-widest transition-colors ${
                viewMode === v
                  ? "bg-surface-accent-solid text-accent"
                  : "text-mono-500 hover:text-accent"
              }`}
            >
              {v === "conflicts" ? "Conflictos" : "Matriz"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Conflicts view ── */}
      {viewMode === "conflicts" && (
        <div className="space-y-4">
          {conflicts.length === 0 ? (
            <div className="rounded-xl border border-green-500/25 bg-green-500/5 px-5 py-8 text-center">
              <p className="font-display text-lg uppercase text-green-400">Todo bien</p>
              <p className="font-body text-sm text-mono-500 mt-1">
                Ningún miembro asignado tiene fechas marcadas como no disponible.
              </p>
            </div>
          ) : (
            <>
              <p className="font-body text-sm text-mono-500">
                Los siguientes miembros están asignados a servicios en fechas que marcaron como no disponibles.
                Puedes ignorarlo o usar el panel de Servicios para reasignarlos.
              </p>
              <div className="space-y-2">
                {conflicts.map(({ role, member }, i) => {
                  const note = member.unavailabilityNotes?.find(n => n.date === role.date)?.note;
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-3 px-4 py-3 rounded-xl border border-negative-strong/25 bg-negative-strong/5"
                    >
                      <span className="w-2 h-2 rounded-full bg-negative-strong shrink-0 mt-1.5" />
                      <div className="flex-1 min-w-0">
                        <div>
                          <span className="font-body text-sm font-semibold">{dn(member)}</span>
                          <span className="font-body text-sm text-mono-400"> marcó </span>
                          <span className="font-label text-xs uppercase tracking-widest text-negative-fg">
                            {fmtDate(role.date)}
                          </span>
                          <span className="font-body text-sm text-mono-400"> como no disponible</span>
                        </div>
                        {note && (
                          <p className="font-body text-xs italic text-mono-500 mt-0.5">&quot;{note}&quot;</p>
                        )}
                      </div>
                      <span className={`font-label text-[11px] uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${SERVICE_COLOR[role._type]}`}>
                        {role.service_name || SERVICE_LABEL[role._type]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Upcoming unavailabilities (not necessarily conflicting) */}
          {membersWithUnavail.length > 0 && (
            <div className="space-y-3 pt-2">
              <h2 className="font-label text-xs uppercase tracking-widest text-mono-500">
                No disponible en próximas fechas
              </h2>
              <div className="space-y-1.5">
                {membersWithUnavail.map(m => {
                  const futureDates = (m.unavailableDates ?? [])
                    .filter(d => d >= today)
                    .sort()
                    .slice(0, 6);
                  const noteMap = new Map((m.unavailabilityNotes ?? []).map(n => [n.date, n.note]));
                  const datesWithNotes = futureDates.filter(d => noteMap.get(d)?.trim());
                  return (
                    <div key={m._id} className="flex flex-col gap-1.5 px-4 py-2.5 rounded-xl border border-warning-fg/20 bg-warning-fg/5">
                      <div className="flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full bg-warning-fg shrink-0" />
                        <span className="font-body text-sm font-semibold min-w-[100px]">{dn(m)}</span>
                        <div className="flex flex-wrap gap-1.5">
                          {futureDates.map(d => {
                            const note = noteMap.get(d);
                            const isConflict = conflicts.some(c => c.member._id === m._id && c.role.date === d);
                            return (
                              <span
                                key={d}
                                className={`font-label text-[11px] uppercase tracking-widest px-2 py-0.5 rounded-full ${
                                  isConflict
                                    ? "bg-negative-strong/20 text-negative-fg border border-negative-strong/30"
                                    : "bg-warning-fg/15 text-warning-strong border border-warning-fg/25"
                                }`}
                              >
                                {fmtDate(d)}{note ? " ✎" : ""}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      {datesWithNotes.length > 0 && (
                        <div className="pl-5 space-y-0.5">
                          {datesWithNotes.map(d => (
                            <p key={d} className="font-body text-xs italic text-mono-500 leading-snug">
                              <span className="not-italic font-label uppercase tracking-widest text-warning-strong/80">{fmtDate(d)}:</span>{" "}
                              &quot;{noteMap.get(d)}&quot;
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Matrix view ── */}
      {viewMode === "matrix" && (
        <div className="overflow-x-auto -mx-1 px-1">
          {matrixMembers.length === 0 ? (
            <p className="font-body text-sm text-mono-500 text-center py-12">Sin datos para mostrar.</p>
          ) : (
            <table className="w-full text-left border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface-base pr-3 pb-2 font-label text-[11px] uppercase tracking-widest text-mono-500 min-w-[100px]">
                    Miembro
                  </th>
                  {upcoming.map(role => (
                    <th key={role._id} className="pb-2 px-1 text-center min-w-[52px]">
                      <div className={`rounded-md px-1 py-1 font-label text-[10px] uppercase tracking-widest ${SERVICE_COLOR[role._type]}`}>
                        {SERVICE_LABEL[role._type]}
                      </div>
                      <div className="font-label text-[10px] uppercase tracking-widest text-mono-500 mt-0.5">
                        {fmtDate(role.date)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixMembers.map(member => (
                  <tr key={member._id} className="border-t border-accent/10">
                    <td className="sticky left-0 z-10 bg-surface-base pr-3 py-1.5 font-body text-sm">
                      {dn(member)}
                    </td>
                    {upcoming.map(role => {
                      const status = cellStatus(member, role);
                      const note = (status === "conflict" || status === "unavailable")
                        ? member.unavailabilityNotes?.find(n => n.date === role.date)?.note
                        : undefined;
                      return (
                        <td key={role._id} className="px-1 py-1.5 text-center">
                          <MatrixCell status={status} note={note} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 flex-wrap">
            {([
              ["conflict",   "bg-negative-strong",    "Asignado + No disponible"],
              ["assigned",   "bg-accent/70","Asignado"],
              ["unavailable","bg-warning-fg",   "No disponible (no asignado)"],
              ["empty",      "bg-mono-700",    "Sin datos"],
            ] as const).map(([, color, label]) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded-sm ${color}`} />
                <span className="font-label text-[11px] uppercase tracking-widest text-mono-500">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MatrixCell({ status, note }: { status: CellStatus; note?: string }) {
  if (status === "conflict") {
    const t = note ? `Asignado y no disponible — "${note}"` : "Asignado y no disponible";
    return (
      <span title={t} className="inline-flex items-center justify-center w-6 h-6 rounded-sm bg-negative-strong/20 border border-negative-strong/50">
        <span className="text-negative-fg font-bold text-xs leading-none">!</span>
      </span>
    );
  }
  if (status === "assigned") {
    return (
      <span title="Asignado" className="inline-flex items-center justify-center w-6 h-6 rounded-sm bg-accent/15 border border-accent/30">
        <span className="text-accent text-xs leading-none">✓</span>
      </span>
    );
  }
  if (status === "unavailable") {
    const t = note ? `No disponible — "${note}"` : "Marcó no disponible";
    return (
      <span title={t} className="inline-flex items-center justify-center w-6 h-6 rounded-sm bg-warning-fg/15 border border-warning-fg/30">
        <span className="text-warning-strong text-xs leading-none">×</span>
      </span>
    );
  }
  return <span className="inline-block w-6 h-6 rounded-sm bg-mono-800/30 border border-mono-700/30" />;
}

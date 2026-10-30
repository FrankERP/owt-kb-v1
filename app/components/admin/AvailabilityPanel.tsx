"use client";

import { PAGE_LEDE, PAGE_TITLE, SHEET_TITLE } from "@/app/utils/homeHero";
import { useState, useEffect, useCallback, useRef } from "react";

import Button from "@/app/components/ui/Button";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import { NoteIcon } from "@/app/components/ui/icons";
import { dateRunParts } from "./adminRowCopy";
import Skeleton, { SkeletonGroup } from "@/app/components/ui/Skeleton";
import AvailabilityProposals from "./AvailabilityProposals";

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
  const [error, setError]       = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"matrix" | "conflicts">("conflicts");
  // The matrix's first column is `position: sticky`, and a sticky column that has
  // detached from the left edge is indistinguishable from one that has not — the
  // dates simply slide under a name with nothing between them. A 1px sentinel
  // pinned at the scroller's left edge, observed against the scroller itself, is
  // the only honest signal: it stops intersecting exactly when the column starts
  // overlapping content, at any zoom and with no scroll listener.
  const [scrolled, setScrolled] = useState(false);
  const scrollRef   = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // This panel answers "is anyone assigned on a day they said they cannot
  // serve?", and the answer it gives on an empty list is the reassuring one.
  // So a failed load MUST NOT reach the render: `if (res.ok)` alone left
  // `members` empty, which made `conflicts` empty by construction and painted
  // "Todo bien" over a request that never returned. A rejected fetch skipped
  // `setLoading(false)` entirely and left the skeleton spinning forever.
  // `serviceReadiness.ts` states the rule this panel has to honour: a failure
  // never means clear.
  // `quiet`: a refresh after a write from the proposals keeps the panel mounted (no skeleton).
  const fetchData = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    setError(null);
    try {
      const [rm, rr] = await Promise.all([fetch("/api/admin/members"), fetch("/api/admin/roles")]);
      if (!rm.ok || !rr.ok) throw new Error("fetch failed");
      const [nextMembers, nextRoles] = await Promise.all([rm.json(), rr.json()]);
      if (!Array.isArray(nextMembers) || !Array.isArray(nextRoles)) throw new Error("bad shape");
      setMembers(nextMembers);
      setRoles(nextRoles);
    } catch {
      setMembers([]);
      setRoles([]);
      setError("No se pudo cargar la disponibilidad. No podemos confirmar si hay conflictos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  const refreshQuietly = useCallback(() => { void fetchData({ quiet: true }); }, [fetchData]);

  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });
  const currentYear = Number(today.slice(0, 4));
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

  // Rooted on the scroll box, so it fires on the BOX's scroll rather than the
  // page's. Re-runs when the matrix mounts (`viewMode`); disconnects on unmount.
  useEffect(() => {
    if (viewMode !== "matrix") { setScrolled(false); return; }
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setScrolled(!entry.isIntersecting);
      },
      { root, threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [viewMode]);

  if (loading) {
    return (
      <SkeletonGroup label="Cargando disponibilidad" className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" rounded="lg" />
        ))}
      </SkeletonGroup>
    );
  }

  // The failure state replaces the whole panel rather than sitting above it:
  // every view below reads from empty arrays and would otherwise render its own
  // reassuring emptiness beside the error.
  if (error) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className={PAGE_TITLE}>Disponibilidad</h1>
        </div>
        <div role="alert" className="rounded-xl border border-negative-strong/30 bg-negative-surface-deepest/35 px-5 py-8 text-center">
          <p className="font-display text-lg uppercase text-negative-fg">Sin datos</p>
          <p className="font-body text-sm text-mono-500 mt-1">{error}</p>
          <Button variant="primary" size="lg" onClick={() => { void fetchData(); }} className="mt-4">
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Header + view toggle */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className={PAGE_TITLE}>Disponibilidad</h1>
          <p className={`mt-2 ${PAGE_LEDE}`}>
            {conflicts.length > 0
              ? <><span className="text-negative-fg">{`${conflicts.length} conflicto${conflicts.length !== 1 ? "s" : ""}`}</span>{" en los próximos servicios"}</>
              : <><span className="text-positive-strong">Sin conflictos</span>{" en los próximos servicios"}</>}
          </p>
        </div>
        <SegmentedControl
          label="Vista"
          tone="filled"
          className="shrink-0"
          value={viewMode}
          onChange={setViewMode}
          options={[
            { value: "conflicts", label: "Conflictos" },
            { value: "matrix", label: "Matriz" },
          ]}
        />
      </div>

      {/* ── Conflicts view: hairline rows (ADR-0070, the Admin pass PR B) ── */}
      {viewMode === "conflicts" && (
        <div className="space-y-8">
          {/* The proposals (ADR-0080) own this list. The client-side list below is their fallback:
              shown only when the proposals read fails or cannot judge, so a failure there never
              reads as «sin conflictos». */}
          <AvailabilityProposals
            onChanged={refreshQuietly}
            fallback={
              conflicts.length === 0 ? (
                <p className="font-body text-[15px] text-ink-dim">
                  Nadie asignado tiene marcada una fecha en la que le toca servir.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="font-body text-[15px] text-ink-dim">
                    Están asignados en fechas que marcaron como no disponibles. Reasígnalos desde Servicios, o déjalo así a propósito.
                  </p>
                  <ul className="border-t border-ink/[0.10]">
                    {conflicts.map(({ role, member }, i) => {
                      const note = member.unavailabilityNotes?.find(n => n.date === role.date)?.note?.trim();
                      return (
                        <li
                          key={i}
                          data-availability-conflict=""
                          className="flex min-h-[64px] flex-wrap items-center gap-x-4 gap-y-1 border-b border-ink/[0.10] py-2.5 sm:flex-nowrap"
                        >
                          <span className="w-full font-body text-[17px] font-semibold text-ink sm:w-[140px] sm:shrink-0 sm:truncate">{dn(member)}</span>
                          <span className="min-w-0 flex-1 font-body text-[15px] text-ink-muted [overflow-wrap:anywhere]">
                            {"marcó "}
                            <span className="font-semibold text-negative-fg">{fmtDate(role.date)}</span>
                            {" como no disponible"}
                            {note && (
                              <span className="ml-2.5 inline-flex items-center gap-1.5 text-ink-dim">
                                <NoteIcon size={14} className="shrink-0" />
                                {note}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 font-body text-sm text-ink-dim">
                            {role.service_name || SERVICE_LABEL[role._type]}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )
            }
          />

          {/* Upcoming unavailabilities (not necessarily conflicting): one row per
              member, the dates as one Spanish run («20, 21 y 22 de noviembre»),
              a conflicting date in red, each note after a glyph. */}
          {membersWithUnavail.length > 0 && (
            <div className="space-y-3">
              <h2 className={SHEET_TITLE}>
                No disponible en próximas fechas
              </h2>
              <ul className="border-t border-ink/[0.10]">
                {membersWithUnavail.map(m => {
                  const futureDates = (m.unavailableDates ?? [])
                    .filter(d => d >= today)
                    .sort()
                    .slice(0, 6);
                  const noteMap = new Map((m.unavailabilityNotes ?? []).map(n => [n.date, n.note]));
                  const notes = futureDates
                    .map(d => ({ date: d, note: noteMap.get(d)?.trim() ?? "" }))
                    .filter(n => n.note);
                  const conflicting = new Set(futureDates.filter(d => conflicts.some(c => c.member._id === m._id && c.role.date === d)));
                  return (
                    <li
                      key={m._id}
                      data-availability-row=""
                      className="flex min-h-[64px] flex-wrap items-center gap-x-4 gap-y-1 border-b border-ink/[0.10] py-2.5 sm:flex-nowrap"
                    >
                      <span className="w-full font-body text-[17px] font-semibold text-ink sm:w-[140px] sm:shrink-0 sm:truncate">{dn(m)}</span>
                      <span className="min-w-0 flex-1 font-body text-[15px] text-ink-muted [overflow-wrap:anywhere]">
                        {/* One run in date order; a conflicting day is red where it falls. */}
                        {dateRunParts(futureDates, currentYear).map((part, i) =>
                          part.iso && conflicting.has(part.iso)
                            ? <span key={i} className="font-semibold text-negative-fg">{part.text}</span>
                            : <span key={i}>{part.text}</span>,
                        )}
                        {notes.map(n => (
                          <span key={n.date} className="ml-2.5 inline-flex items-center gap-1.5 text-ink-dim">
                            <NoteIcon size={14} className="shrink-0" />
                            {notes.length > 1 ? `${fmtDate(n.date)}: ${n.note}` : n.note}
                          </span>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Matrix view ── */}
      {viewMode === "matrix" && (
        <div
          ref={scrollRef}
          data-scrolled={scrolled ? "" : undefined}
          className="availability-matrix relative overflow-x-auto -mx-1 px-1"
        >
          {/* The sentinel, not a scroll handler: 1px at the scroller's left edge. */}
          <div ref={sentinelRef} aria-hidden="true" className="absolute left-0 top-0 h-px w-px" />
          {matrixMembers.length === 0 ? (
            <p className="font-body text-sm text-mono-500 text-center py-12">Sin datos para mostrar.</p>
          ) : (
            <table className="w-full text-left border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky-col sticky left-0 z-10 bg-surface-base pr-3 pb-2 font-label text-[11px] uppercase tracking-widest text-mono-500 min-w-[100px]">
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
                    <td className="sticky-col sticky left-0 z-10 bg-surface-base pr-3 py-1.5 font-body text-sm">
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

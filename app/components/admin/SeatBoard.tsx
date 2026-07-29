"use client";

// The service team editor: seats left, the WHOLE eligible roster right, one
// scroll region between them.
//
// It replaces a sheet that stacked five nested scrollers and showed 4 of 16
// voices three times over. Nothing here ranks or blocks on its own — the seat
// vocabulary comes from `seatModel` and the ordering, availability, existing
// assignment and load all come from `rankCandidates`, so both are table-tested
// without a DOM.

import { useMemo, useState } from "react";

import {
  DEFAULT_FOH_SEATS,
  DEFAULT_INSTRUMENT_SEATS,
  VOICE_SEATS,
  fohSeatDef,
  instrumentSeatDef,
  normalizeSeatName,
  type SeatDef,
} from "./seatModel";
import { rankCandidates, type AssignedSeat, type RankedCandidate, type RankMember } from "./candidateRanking";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import {
  CARD_STYLE,
  SERVICE_BADGE,
  SERVICE_LABEL,
  type ServiceRole,
  type ServiceType,
} from "./serviceCardModel";

export interface SeatBoardProps {
  initial?: ServiceRole;
  members: RankMember[];
  windowRoles: ParticipantRole[];
  onSubmit: (data: unknown) => void;
  onClose: () => void;
  loading: boolean;
  dateLockedReason?: string | null;
  submitBlockedReason?: string | null;
}

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";
const selectCls =
  "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-[#0a1929] font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

export default function SeatBoard(props: SeatBoardProps) {
  const { initial, members, windowRoles, loading } = props;

  const [type, setType] = useState(initial?._type ?? "sunday_role");
  const [date, setDate] = useState(initial?.date?.slice(0, 10) ?? "");
  const [serviceName, setServiceName] = useState(initial?.service_name ?? "");

  // occupancy: seatId -> memberId[]
  const [occupancy, setOccupancy] = useState<Record<string, string[]>>(() =>
    seedOccupancy(initial),
  );
  const [instrumentSeats, setInstrumentSeats] = useState<string[]>(() =>
    seedSeatNames(initial?.instruments?.map((s) => s.instrument), DEFAULT_INSTRUMENT_SEATS),
  );
  const [fohSeats, setFohSeats] = useState<string[]>(() =>
    seedSeatNames(initial?.foh?.map((s) => s.role), DEFAULT_FOH_SEATS),
  );

  const seats: SeatDef[] = useMemo(
    () => [
      ...VOICE_SEATS,
      ...instrumentSeats.map(instrumentSeatDef),
      ...fohSeats.map(fohSeatDef),
    ],
    [instrumentSeats, fohSeats],
  );

  const [targetId, setTargetId] = useState(VOICE_SEATS[0].id);
  const target = seats.find((s) => s.id === targetId) ?? seats[0];

  const assigned: AssignedSeat[] = useMemo(
    () =>
      seats.flatMap((seat) =>
        (occupancy[seat.id] ?? []).map((memberId) => ({
          seatId: seat.id,
          category: seat.category,
          memberId,
        })),
      ),
    [seats, occupancy],
  );

  const candidates = useMemo(
    () => rankCandidates({ seat: target, date, members, windowRoles, assigned }),
    [target, date, members, windowRoles, assigned],
  );

  function toggle(memberId: string) {
    const current = occupancy[target.id] ?? [];
    const blocked = candidates.find((c) => c.id === memberId)?.blockedReason;
    if (blocked && !current.includes(memberId)) return; // refuse a same-category double
    const next = current.includes(memberId)
      ? current.filter((x) => x !== memberId)
      : target.max !== null && current.length >= target.max
        ? [...current.slice(1), memberId] // single-occupant seats replace
        : [...current, memberId];
    setOccupancy({ ...occupancy, [target.id]: next });
  }

  function removeFromSeat(seatId: string, memberId: string) {
    setOccupancy({
      ...occupancy,
      [seatId]: (occupancy[seatId] ?? []).filter((id) => id !== memberId),
    });
  }

  function addInstrumentSeat(raw: string) {
    const name = normalizeSeatName(raw);
    if (!name) return;
    setInstrumentSeats((prev) => (prev.includes(name) ? prev : [...prev, name]));
  }

  function addFohSeat(raw: string) {
    const name = normalizeSeatName(raw);
    if (!name) return;
    setFohSeats((prev) => (prev.includes(name) ? prev : [...prev, name]));
  }

  function buildData(published?: boolean) {
    const base = {
      _type: type,
      date,
      service_name: serviceName,
      leads: occupancy["lead"] ?? [],
      bgvs: occupancy["bgv"] ?? [],
      chorus: occupancy["coro"] ?? [],
      instruments: instrumentSeats.flatMap((label) => {
        const def = instrumentSeatDef(label);
        return (occupancy[def.id] ?? []).map((personId) => ({ instrument: def.label, personId }));
      }),
      foh: fohSeats.flatMap((label) => {
        const def = fohSeatDef(label);
        return (occupancy[def.id] ?? []).map((personId) => ({ role: def.label, personId }));
      }),
    };
    return !initial && published !== undefined ? { ...base, published } : base;
  }

  const membersById = useMemo(() => new Map(members.map((m) => [m._id, m])), [members]);
  function memberName(id: string): string {
    const m = membersById.get(id);
    if (!m) return id;
    return m.alias?.trim() || m.member_name;
  }

  const isEdit = !!initial;
  const [publishOnCreate, setPublishOnCreate] = useState(false);

  function handlePrimarySubmit() {
    props.onSubmit(isEdit ? buildData() : buildData(publishOnCreate));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Header: tipo / fecha / nombre — same fields ServiceForm exposed. */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="font-label text-xs uppercase tracking-widest text-gray-500">Tipo</label>
            {initial ? (
              <span
                className={`inline-flex rounded-full px-2 py-1 font-label text-xs uppercase tracking-widest ${SERVICE_BADGE[type]}`}
              >
                {SERVICE_LABEL[type]}
              </span>
            ) : (
              <select
                className={selectCls}
                value={type}
                onChange={(e) => setType(e.target.value as ServiceType)}
              >
                <option value="sunday_role">Domingo</option>
                <option value="saturday_role">Sábado</option>
                <option value="special_role">Especial</option>
              </select>
            )}
          </div>
          <div className="space-y-1">
            <label className="font-label text-xs uppercase tracking-widest text-gray-500">Fecha</label>
            <input
              type="date"
              className={`${inputCls} disabled:opacity-50`}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={!!props.dateLockedReason}
              title={props.dateLockedReason ?? undefined}
              required
            />
            {props.dateLockedReason && (
              <p className="font-body text-[11px] text-amber-400">
                No se puede mover la fecha: {props.dateLockedReason}
              </p>
            )}
          </div>
        </div>
        {type === "special_role" && (
          <div className="space-y-1">
            <label className="font-label text-xs uppercase tracking-widest text-gray-500">
              Nombre del servicio
            </label>
            <input
              className={inputCls}
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              placeholder="ej. Viernes Santo, Navidad..."
            />
          </div>
        )}
      </div>

      {/* Two panes, one scroll region: the seat pane never scrolls, the roster does. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2">
        <div className={`${CARD_STYLE.dialog} min-w-0`}>
          <SeatGroup
            title="Voces"
            seats={VOICE_SEATS}
            occupancy={occupancy}
            targetId={target.id}
            onSelectTarget={setTargetId}
            onRemove={removeFromSeat}
            memberName={memberName}
          />
          <SeatGroup
            title="Instrumentos"
            seats={instrumentSeats.map(instrumentSeatDef)}
            occupancy={occupancy}
            targetId={target.id}
            onSelectTarget={setTargetId}
            onRemove={removeFromSeat}
            memberName={memberName}
          />
          <AddSeatForm placeholder="Nuevo instrumento" onAdd={addInstrumentSeat} />
          <SeatGroup
            title="FOH / Técnicos"
            seats={fohSeats.map(fohSeatDef)}
            occupancy={occupancy}
            targetId={target.id}
            onSelectTarget={setTargetId}
            onRemove={removeFromSeat}
            memberName={memberName}
          />
          <AddSeatForm placeholder="Nuevo rol" onAdd={addFohSeat} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70">
              Candidatos para {target.label}
            </span>
            <span className="font-label text-[11px] text-gray-500">{candidates.length}</span>
          </div>
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {candidates.map((candidate) => (
              <RosterRow
                key={candidate.id}
                candidate={candidate}
                selected={(occupancy[target.id] ?? []).includes(candidate.id)}
                onToggle={toggle}
              />
            ))}
            {candidates.length === 0 && (
              <li className="font-body text-xs italic text-gray-600">
                Nadie elegible para este puesto.
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Footer: sticky, never scrolls with the roster. */}
      <div className="flex items-center gap-3 border-t border-[#00bfff]/10 pt-3">
        {!isEdit && (
          <label className="flex min-h-[44px] items-center gap-2 font-label text-[11px] uppercase tracking-widest text-[#C8D8EB]/70">
            <input
              type="checkbox"
              checked={publishOnCreate}
              onChange={(e) => setPublishOnCreate(e.target.checked)}
              className="h-4 w-4 accent-[#00bfff]"
            />
            Publicar al crear
          </label>
        )}
        <div className="ml-auto flex gap-3">
          <button
            type="button"
            onClick={props.onClose}
            className="min-h-[44px] rounded-lg border border-[#003572]/30 px-4 font-label text-xs uppercase tracking-widest transition-colors hover:border-[#00bfff] dark:border-[#00bfff]/20"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handlePrimarySubmit}
            disabled={loading || !!props.submitBlockedReason}
            title={props.submitBlockedReason ?? undefined}
            className="min-h-[44px] rounded-lg bg-[#003572] px-4 font-label text-xs uppercase tracking-widest transition-colors hover:bg-[#003572]/80 disabled:opacity-50 dark:bg-[#00bfff]/20 dark:hover:bg-[#00bfff]/30"
          >
            {loading ? "Guardando..." : isEdit ? "Guardar" : publishOnCreate ? "Crear y publicar" : "Crear"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Existing assignments -> seatId -> memberId[]. */
function seedOccupancy(initial?: ServiceRole): Record<string, string[]> {
  if (!initial) return {};
  const out: Record<string, string[]> = {
    lead: (initial.leads ?? []).map((m) => m._id),
    bgv: (initial.bgvs ?? []).map((m) => m._id),
    coro: (initial.chorus ?? []).map((m) => m._id),
  };
  for (const slot of initial.instruments ?? []) {
    if (!slot.person) continue;
    const def = instrumentSeatDef(slot.instrument);
    out[def.id] = [...(out[def.id] ?? []), slot.person._id];
  }
  for (const slot of initial.foh ?? []) {
    if (!slot.person) continue;
    const def = fohSeatDef(slot.role);
    out[def.id] = [...(out[def.id] ?? []), slot.person._id];
  }
  return out;
}

/** The service's own seat names, normalised, unioned with the defaults. */
function seedSeatNames(existing: (string | undefined)[] | undefined, defaults: string[]): string[] {
  const names = (existing ?? []).map((n) => instrumentSeatDef(n ?? "").label).filter(Boolean);
  return [...new Set([...defaults, ...names])];
}

// ── Seat pane ────────────────────────────────────────────────────────────────

function SeatGroup({
  title,
  seats,
  occupancy,
  targetId,
  onSelectTarget,
  onRemove,
  memberName,
}: {
  title: string;
  seats: SeatDef[];
  occupancy: Record<string, string[]>;
  targetId: string;
  onSelectTarget: (id: string) => void;
  onRemove: (seatId: string, memberId: string) => void;
  memberName: (id: string) => string;
}) {
  if (seats.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <p className="font-label text-[11px] uppercase tracking-widest text-[#C8D8EB]/50">{title}</p>
      <div className="space-y-1.5">
        {seats.map((seat) => (
          <SeatRow
            key={seat.id}
            seat={seat}
            occupantIds={occupancy[seat.id] ?? []}
            isTarget={seat.id === targetId}
            onSelectTarget={onSelectTarget}
            onRemove={onRemove}
            memberName={memberName}
          />
        ))}
      </div>
    </section>
  );
}

function SeatRow({
  seat,
  occupantIds,
  isTarget,
  onSelectTarget,
  onRemove,
  memberName,
}: {
  seat: SeatDef;
  occupantIds: string[];
  isTarget: boolean;
  onSelectTarget: (id: string) => void;
  onRemove: (seatId: string, memberId: string) => void;
  memberName: (id: string) => string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelectTarget(seat.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectTarget(seat.id);
        }
      }}
      className={`min-h-[44px] w-full min-w-0 rounded-lg border px-3 py-2 text-left transition-colors ${
        isTarget ? "border-[#00bfff] bg-[#00bfff]/10" : "border-[#00bfff]/15 hover:border-[#00bfff]/40"
      }`}
    >
      <span className="font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70">{seat.label}</span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {occupantIds.length === 0 ? (
          <span className="font-body text-xs italic text-gray-600">Sin asignar</span>
        ) : (
          occupantIds.map((id) => (
            <span
              key={id}
              className={`inline-flex items-center gap-1 rounded-full border border-[#00bfff]/25 bg-[#00bfff]/10 px-2 py-0.5 font-label text-[11px] text-[#C8D8EB] ${CARD_STYLE.longText}`}
            >
              <span>{memberName(id)}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(seat.id, id);
                }}
                aria-label={`Quitar a ${memberName(id)} de ${seat.label}`}
                className="leading-none text-[#C8D8EB]/60 hover:text-white"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function AddSeatForm({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(value);
        setValue("");
      }}
      className="flex gap-1.5"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className={`${inputCls} flex-1 !py-1.5 text-xs`}
      />
      <button
        type="submit"
        className="min-h-[36px] shrink-0 rounded-lg border border-[#00bfff]/20 px-3 font-label text-xs uppercase tracking-widest text-[#C8D8EB]/70 transition-colors hover:border-[#00bfff]"
      >
        Añadir
      </button>
    </form>
  );
}

// ── Roster pane ──────────────────────────────────────────────────────────────

function RosterRow({
  candidate,
  selected,
  onToggle,
}: {
  candidate: RankedCandidate;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const blocked = !!candidate.blockedReason;
  return (
    <li
      role="button"
      tabIndex={blocked ? -1 : 0}
      aria-disabled={blocked ? "true" : undefined}
      title={candidate.blockedReason ?? undefined}
      onClick={() => {
        if (!blocked) onToggle(candidate.id);
      }}
      onKeyDown={(e) => {
        if (blocked) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle(candidate.id);
        }
      }}
      className={`min-h-[44px] min-w-0 rounded-lg border px-3 py-2 transition-colors ${
        blocked
          ? "cursor-not-allowed border-red-500/20 bg-red-500/5 opacity-60"
          : selected
            ? "cursor-pointer border-[#00bfff] bg-[#00bfff]/10"
            : "cursor-pointer border-[#00bfff]/15 hover:border-[#00bfff]/40"
      }`}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className={`font-body text-sm ${CARD_STYLE.longText}`}>{candidate.name}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {!candidate.available && <Badge tone="warn">No disp.</Badge>}
          {candidate.alreadyAssigned && <Badge tone="neutral">Ya asignado</Badge>}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="flex gap-0.5" aria-hidden="true">
          {candidate.recent.map((served, i) => (
            <span key={i} className={`h-1.5 w-3 rounded-sm ${served ? "bg-[#00bfff]/70" : "bg-gray-700"}`} />
          ))}
        </div>
        <span className="font-label text-[10px] text-gray-500">{candidate.load}</span>
      </div>
      {blocked && <p className="mt-1 font-body text-[11px] text-red-400">{candidate.blockedReason}</p>}
    </li>
  );
}

function Badge({ tone, children }: { tone: "warn" | "neutral"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
      : "border-gray-500/40 bg-gray-500/10 text-gray-300";
  return (
    <span className={`rounded-full border px-1.5 py-0.5 font-label text-[10px] uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

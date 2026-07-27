"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { newCreationRequestId } from "@/app/utils/monthDraftCreate";
import MonthGenerator from "./MonthGenerator";
import { applyRefreshedRole, refreshedRoleFromResponse } from "./applyRefreshedRole";
import {
  SERVICE_SOURCE_KEYS,
  selectServiceCapabilities,
  serviceTodayIso,
  type ServiceCapabilities,
  type ServiceControl,
  type ServiceSourceKey,
} from "./serviceReadiness";
import {
  SOURCE_ENDPOINTS,
  canFilterMonths,
  captureActiveMode,
  checkActiveMode,
  editModalControl,
  guardControl,
  initialSourceRecords,
  isValidSourcePayload,
  latchInvalidation,
  movesServiceDate,
  mutationOutcomeMessage,
  reduceSourceRecords,
  retryTargets,
  rolesView,
  sourceStates,
  unreadyMessage,
  type ActiveMode,
  type ActiveModeInvalidation,
  type ActiveModeSnapshot,
  type ServiceSourceRecords,
} from "./serviceSourceState";
import {
  INTEGRITY_QUEUE_TITLE,
  buildIntegrityQueue,
  integrityQueueSummary,
  integrityQueueTone,
} from "./serviceIntegrityQueue";
import {
  CARD_STYLE,
  SECTION_LABEL,
  SERVICE_BADGE,
  SERVICE_LABEL,
  TONE_CLASS,
  buildPublishConfirmation,
  buildServiceCards,
  commandSummaryCounters,
  commandSummarySegments,
  describeAcknowledgedBlockers,
  dn,
  formatServiceDate,
  integrityTargetForCard,
  monthTargetPreflight,
  primaryActionRoute,
  proposalHandoffInput,
  serviceCardLabel,
  serviceCardRefs,
  type CardSourceSummaries,
  type MemberOption,
  type PublishConfirmationPlan,
  type ServiceCardModel,
  type ServiceRole,
  type ServiceType,
  type SwapSource,
} from "./serviceCardModel";
import ServiceReadinessCard, {
  type CardGate,
  type CardGates,
} from "./ServiceReadinessCard";
import { overrideAcknowledgement, type PublishWorkflowBlocker } from "./publishSelection";
import { buildProposalHandoff } from "./proposalHandoff";
import { useServiceHandoff } from "./serviceHandoffContext";
import type {
  ProposalDomainSummary,
  RoleDomainSummary,
  SetlistDomainSummary,
} from "@/app/utils/serviceReadSummary";
import { ParticipationSidebar } from "@/app/components/admin/ParticipationSidebar";
import type { ParticipantRole } from "@/app/utils/computeParticipation";
import CueDialog from "../ui/CueDialog";
import CueDialogStatus from "../ui/CueDialogStatus";

// ─── Types ────────────────────────────────────────────────────────────────────
//
// The card/member shapes, identity colours and every presentational decision live
// in `serviceCardModel`; this file keeps the modal and mutation flows.

interface InstrumentSlot { id: string; instrument: string; personId: string; }
interface FohSlot         { id: string; role: string; personId: string; }

// ─── Setlist types ────────────────────────────────────────────────────────────

import { SetlistEditor, SongResult, SetlistEntry } from "./SetlistEditor";

// ─── Swap types ───────────────────────────────────────────────────────────────

type SwapConfirm =
  | { kind: "card"; roleA: ServiceRole; roleB: ServiceRole }
  | { kind: "member"; source: Exclude<SwapSource, { kind: "card" }>; target: Exclude<SwapSource, { kind: "card" }>; sourceRole: ServiceRole; targetRole: ServiceRole };

/** Client section name → the stored seat path the swap writer accepts. */
const SEAT_PATH: Record<"leads" | "bgvs" | "chorus" | "instruments" | "foh", string> = {
  leads: "Lead", bgvs: "BGVs", chorus: "Chorus", instruments: "instruments", foh: "foh_team",
};

// ─── Constants ────────────────────────────────────────────────────────────────

const inputCls  = "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";
const selectCls = "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-[#0a1929] font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

/** Long Spanish date, parsed at local noon (never a bare `new Date(iso)`). */
const formatDate = (iso: string) => formatServiceDate(iso, "es-MX");

// Spanish message for a rejected mutation. A 409 always means "your view is
// stale": the modal/mode stays open and the operator is told to reload.
async function describeMutationError(res: Response, fallback: string): Promise<string> {
  let code: string | undefined;
  let dependencies: { type?: string }[] | undefined;
  try {
    const body = await res.json();
    code = typeof body?.error === "string" ? body.error : undefined;
    dependencies = body?.details?.dependencies;
  } catch {
    code = undefined;
  }
  switch (code) {
    case "idempotency_mismatch":
      return "Este intento ya se envió con otros datos. Cierra y crea el servicio de nuevo.";
    case "idempotency_key_retired":
      return "Este servicio fue eliminado. Cierra y créalo de nuevo.";
    case "bootstrap_completed_reload":
      return "Se repararon datos internos, pero tu cambio no se aplicó. Recarga e intenta de nuevo.";
    case "target_has_orphaned_dependencies":
    case "role_date_has_dependencies":
    case "role_has_dependencies":
      return `Hay ${dependencies?.length ?? 0} registro(s) dependientes (setlist o propuestas) en esa fecha. No se modificó nada.`;
    case "stale_revision":
      return "Alguien más cambió este servicio. Recarga e intenta de nuevo.";
    case "ambiguous_target":
      return "Ya existe un servicio en esa fecha (o hay duplicados). Recarga y revisa.";
    case "integrity_conflict":
      return "Los datos guardados no pasaron una revisión de integridad. No se modificó nada.";
    case "invalid_request":
      return "La solicitud fue rechazada antes de guardar. Revisa los datos.";
    case "not_found":
      return "Este servicio ya no existe. Recarga la lista.";
    default:
      return res.status === 409 ? "Alguien más cambió este servicio. Recarga e intenta de nuevo." : fallback;
  }
}

// Swaps are computed and committed by the server from the currently stored roles
// (`POST /api/admin/roles/swap`), so this panel no longer builds a replacement
// team payload of its own — it only sends the two selections it observed.

// ─── Member multi-select (searchable, type-filtered) ─────────────────────────

function MemberMultiSelect({ label, members, selected, onChange, filterType }: {
  label: string; members: MemberOption[]; selected: string[];
  onChange: (ids: string[]) => void; filterType?: string;
}) {
  const [q, setQ] = useState("");
  const pool = filterType
    ? members.filter(m => m.memberType?.includes(filterType))
    : members;
  const visible = q.trim()
    ? pool.filter(m => dn(m).toLowerCase().includes(q.toLowerCase()))
    : pool;
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  return (
    <div className="space-y-1.5">
      <label className="font-label text-xs uppercase tracking-widest text-gray-500">{label}</label>
      <input
        className="w-full px-2 py-1 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-xs focus:outline-none focus:border-[#00bfff] transition-colors placeholder-gray-600"
        placeholder="Buscar..."
        value={q}
        onChange={e => setQ(e.target.value)}
      />
      <div className="max-h-36 overflow-y-auto rounded-lg border border-[#00bfff]/20 divide-y divide-[#00bfff]/10">
        {visible.length === 0 && (
          <p className="px-3 py-2 font-body text-xs text-gray-600 italic">Sin resultados</p>
        )}
        {visible.map(m => (
          <label key={m._id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${selected.includes(m._id) ? "bg-[#00bfff]/10" : "hover:bg-[#00bfff]/5"}`}>
            <input type="checkbox" checked={selected.includes(m._id)} onChange={() => toggle(m._id)} className="accent-[#00bfff]" />
            <span className="font-body text-sm">{dn(m)}</span>
          </label>
        ))}
      </div>
      {selected.length > 0 && <p className="font-label text-[11px] uppercase tracking-widest text-[#00bfff]">{selected.length} seleccionado{selected.length > 1 ? "s" : ""}</p>}
    </div>
  );
}

// ─── Slot editor (instruments / FOH) with search ─────────────────────────────

function SlotEditor({ label, fieldLabel, slots, members, onChange, filterType }: {
  label: string; fieldLabel: string;
  slots: { id: string; role?: string; instrument?: string; personId: string }[];
  members: MemberOption[]; onChange: (s: any[]) => void; filterType?: string;
}) {
  const [q, setQ] = useState("");
  const nameKey = fieldLabel === "Instrumento" ? "instrument" : "role";
  const pool = filterType ? members.filter(m => m.memberType?.includes(filterType)) : members;
  const filtered = q.trim() ? pool.filter(m => dn(m).toLowerCase().includes(q.toLowerCase())) : pool;
  return (
    <div className="space-y-1.5">
      <label className="font-label text-xs uppercase tracking-widest text-gray-500">{label}</label>
      {pool.length > 5 && (
        <input
          className="w-full px-2 py-1 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-xs focus:outline-none focus:border-[#00bfff] transition-colors placeholder-gray-600"
          placeholder="Buscar persona..."
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      )}
      <div className="space-y-2">
        {slots.map(slot => (
          <div key={slot.id} className="flex gap-2 items-center">
            <input className={`${inputCls} flex-1`} placeholder={fieldLabel} value={(slot as any)[nameKey] ?? ""} onChange={e => onChange(slots.map(s => s.id === slot.id ? { ...s, [nameKey]: e.target.value } : s))} />
            <select className={`${selectCls} flex-1`} value={slot.personId} onChange={e => onChange(slots.map(s => s.id === slot.id ? { ...s, personId: e.target.value } : s))}>
              <option value="">— Persona —</option>
              {filtered.map(m => <option key={m._id} value={m._id}>{dn(m)}</option>)}
            </select>
            <button type="button" onClick={() => onChange(slots.filter(s => s.id !== slot.id))} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"><TrashIcon /></button>
          </div>
        ))}
        {slots.length === 0 && <p className="font-body text-xs text-gray-600 italic">Sin entradas</p>}
        <button type="button" onClick={() => onChange([...slots, { id: uid(), [nameKey]: "", personId: "" }])} className="flex items-center gap-1.5 font-label text-xs uppercase tracking-widest text-[#00bfff]/60 hover:text-[#00bfff] transition-colors">
          <span className="text-base leading-none">+</span> Agregar {fieldLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Create / Edit form ───────────────────────────────────────────────────────

function ServiceForm({ initial, members, onSubmit, onClose, loading, dateLockedReason, submitBlockedReason }: {
  initial?: ServiceRole; members: MemberOption[];
  onSubmit: (d: any) => void; onClose: () => void; loading: boolean;
  /**
   * Why the date may not be moved right now (the `changeServiceDate` row of the
   * capability matrix needs all five sources). Null = editable.
   */
  dateLockedReason?: string | null;
  /** Why this form may not be submitted at all (source state or a stale snapshot). */
  submitBlockedReason?: string | null;
}) {
  const [type, setType]             = useState<ServiceType>(initial?._type ?? "sunday_role");
  const [date, setDate]             = useState(initial?.date?.slice(0, 10) ?? "");
  const [serviceName, setServiceName] = useState(initial?.service_name ?? "");
  const [leads, setLeads]           = useState<string[]>(initial?.leads?.map(m => m._id) ?? []);
  const [bgvs, setBgvs]             = useState<string[]>(initial?.bgvs?.map(m => m._id) ?? []);
  const [chorus, setChorus]         = useState<string[]>(initial?.chorus?.map(m => m._id) ?? []);
  const [instruments, setInstruments] = useState<InstrumentSlot[]>(
    initial?.instruments?.map(s => ({ id: uid(), instrument: s.instrument, personId: s.person?._id ?? "" })) ?? []
  );
  const [foh, setFoh] = useState<FohSlot[]>(
    initial?.foh?.map(s => ({ id: uid(), role: s.role, personId: s.person?._id ?? "" })) ?? []
  );
  const [pendingData, setPendingData] = useState<any>(null);
  const [unavailableNames, setUnavailableNames] = useState<string[]>([]);

  function buildData(published?: boolean) {
    const base = { _type: type, date, service_name: serviceName, leads, bgvs, chorus,
      instruments: instruments.filter(s => s.instrument && s.personId),
      foh: foh.filter(s => s.role && s.personId) };
    // Only include published on create (no initial), not on edit/PATCH
    if (!initial && published !== undefined) return { ...base, published };
    return base;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // This path is used for edit (Guardar button). For create, use submit(published).
    const data = buildData();
    if (!date) return onSubmit(data);
    const allIds = [
      ...leads, ...bgvs, ...chorus,
      ...instruments.filter(s => s.personId).map(s => s.personId),
      ...foh.filter(s => s.personId).map(s => s.personId),
    ];
    const conflicts = allIds
      .map(id => members.find(m => m._id === id))
      .filter((m): m is MemberOption => !!(m?.unavailableDates?.includes(date)))
      .map(m => m.alias?.trim() || m.member_name);
    if (conflicts.length > 0) {
      setUnavailableNames(conflicts);
      setPendingData(data);
      return;
    }
    onSubmit(data);
  }

  function submit(published: boolean) {
    const data = buildData(published);
    if (!date) return onSubmit(data);
    const allIds = [
      ...leads, ...bgvs, ...chorus,
      ...instruments.filter(s => s.personId).map(s => s.personId),
      ...foh.filter(s => s.personId).map(s => s.personId),
    ];
    const conflicts = allIds
      .map(id => members.find(m => m._id === id))
      .filter((m): m is MemberOption => !!(m?.unavailableDates?.includes(date)))
      .map(m => m.alias?.trim() || m.member_name);
    if (conflicts.length > 0) {
      setUnavailableNames(conflicts);
      setPendingData(data);
      return;
    }
    onSubmit(data);
  }

  const fmtServiceDate = date
    ? new Date(date + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    : "";

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Tipo</label>
          {initial ? (
            <span className={`inline-flex font-label text-xs uppercase tracking-widest px-2 py-1 rounded-full ${SERVICE_BADGE[type]}`}>{SERVICE_LABEL[type]}</span>
          ) : (
            <select className={selectCls} value={type} onChange={e => setType(e.target.value as ServiceType)}>
              <option value="sunday_role">Domingo</option>
              <option value="saturday_role">Sábado</option>
              <option value="special_role">Especial</option>
            </select>
          )}
        </div>
        <div className="space-y-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Fecha</label>
          <input
            className={`${inputCls} disabled:opacity-50`}
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            disabled={!!dateLockedReason}
            title={dateLockedReason ?? undefined}
            required
          />
          {dateLockedReason && (
            <p className="font-body text-[11px] text-amber-400">No se puede mover la fecha: {dateLockedReason}</p>
          )}
        </div>
      </div>
      {type === "special_role" && (
        <div className="space-y-1">
          <label className="font-label text-xs uppercase tracking-widest text-gray-500">Nombre del servicio</label>
          <input className={inputCls} value={serviceName} onChange={e => setServiceName(e.target.value)} placeholder="ej. Viernes Santo, Navidad..." />
        </div>
      )}
      <div className="border-t border-[#00bfff]/10 pt-4 space-y-4">
        <MemberMultiSelect label="Líderes"  members={members} selected={leads}  onChange={setLeads}  filterType="voz" />
        <MemberMultiSelect label="BGVs"     members={members} selected={bgvs}   onChange={setBgvs}   filterType="voz" />
        <MemberMultiSelect label="Coro"     members={members} selected={chorus} onChange={setChorus} filterType="voz" />
        <SlotEditor label="Instrumentos"    fieldLabel="Instrumento" slots={instruments} members={members} onChange={s => setInstruments(s as InstrumentSlot[])} filterType="instrumento" />
        <SlotEditor label="FOH / Técnicos"  fieldLabel="Rol"         slots={foh}         members={members} onChange={s => setFoh(s as FohSlot[])} filterType="foh" />
      </div>

      {/* Availability warning — replaces action buttons when conflicts are found */}
      {pendingData ? (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-3 space-y-3 sticky bottom-0 bg-[#C8D8EB] dark:bg-[#0a1929]">
          <p className="font-label text-[11px] uppercase tracking-widest text-orange-400">No disponibles el {fmtServiceDate}</p>
          <p className="font-body text-sm text-gray-300">
            <span className="text-orange-300">{unavailableNames.join(", ")}</span>
            {unavailableNames.length === 1 ? " ha" : " han"} marcado este día como no disponible.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setPendingData(null); setUnavailableNames([]); }}
              className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
              Revisar
            </button>
            <button type="button" onClick={() => onSubmit(pendingData)} disabled={loading || !!submitBlockedReason}
              title={submitBlockedReason ?? undefined}
              className="flex-1 py-2 rounded-lg bg-orange-600/70 hover:bg-orange-600 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
              {loading ? "Guardando..." : "Confirmar de todos modos"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 pt-1 sticky bottom-0 bg-[#C8D8EB] dark:bg-[#0a1929] py-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">Cancelar</button>
          {!initial ? (
            <>
              <button type="button" onClick={() => submit(false)} disabled={loading || !!submitBlockedReason} title={submitBlockedReason ?? undefined} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 hover:border-[#00bfff] font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">{loading ? "Guardando..." : "Crear"}</button>
              <button type="button" onClick={() => submit(true)} disabled={loading || !!submitBlockedReason} title={submitBlockedReason ?? undefined} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">{loading ? "Guardando..." : "Crear y publicar"}</button>
            </>
          ) : (
            <button type="submit" disabled={loading || !!submitBlockedReason} title={submitBlockedReason ?? undefined} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">{loading ? "Guardando..." : "Guardar"}</button>
          )}
        </div>
      )}
    </form>
  );
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  wide,
  status,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  status?: string | null;
  children: React.ReactNode;
}) {
  return (
    <CueDialog open title={title} label={title} mode="sheet" size={wide ? "lg" : "sm"} onDismiss={onClose}>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
        {status && <CueDialogStatus tone="error">{status}</CueDialogStatus>}
        {children}
      </div>
    </CueDialog>
  );
}


// ─── Swap confirm modal ───────────────────────────────────────────────────────

function AvailabilityWarning({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2.5 space-y-1">
      <p className="font-label text-[11px] uppercase tracking-widest text-orange-400">No disponibles</p>
      {lines.map((l, i) => <p key={i} className="font-body text-xs text-gray-400">{l}</p>)}
    </div>
  );
}

/**
 * Footer of the swap confirmation. A rejected swap keeps this modal open and
 * shows why; a stale view (409) offers a reload instead of a retry, because
 * retrying with the same observed revisions can only be rejected again.
 */
function SwapFooter({ onClose, onConfirm, onReload, loading, warn, error, confirmLabel }: {
  onClose: () => void; onConfirm: () => void; onReload: () => void;
  loading: boolean; warn: boolean; error: string | null; confirmLabel: string;
}) {
  return (
    <>
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5">
          <p className="font-body text-xs text-red-300">{error}</p>
        </div>
      )}
      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">Cancelar</button>
        {error ? (
          <button type="button" onClick={onReload} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors">Recargar</button>
        ) : (
          <button type="button" onClick={onConfirm} disabled={loading} className={`flex-1 py-2 rounded-lg font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50 ${warn ? "bg-orange-600/70 hover:bg-orange-600" : "bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30"}`}>{loading ? "Intercambiando..." : confirmLabel}</button>
        )}
      </div>
    </>
  );
}

function SwapConfirmModal({ confirm, onConfirm, onClose, onReload, loading, members, error }: {
  confirm: SwapConfirm; onConfirm: () => void; onClose: () => void; onReload: () => void;
  loading: boolean; members: MemberOption[]; error: string | null;
}) {
  function lookup(id: string | undefined) {
    return id ? members.find(m => m._id === id) : undefined;
  }
  function unavailableOn(ids: (string | undefined)[], date: string): string[] {
    return ids
      .map(id => lookup(id))
      .filter((m): m is MemberOption => !!(m?.unavailableDates?.includes(date)))
      .map(m => m.alias?.trim() || m.member_name);
  }
  function fmtD(iso: string) {
    return new Date(iso.slice(0,10) + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  }

  if (confirm.kind === "card") {
    const { roleA, roleB } = confirm;
    const dateA = roleA.date.slice(0,10);
    const dateB = roleB.date.slice(0,10);
    const allAIds = [...(roleA.leads ?? []), ...(roleA.bgvs ?? []), ...(roleA.chorus ?? []),
      ...(roleA.instruments ?? []).filter(s => s.person).map(s => s.person!),
      ...(roleA.foh ?? []).filter(s => s.person).map(s => s.person!)].map(m => m._id);
    const allBIds = [...(roleB.leads ?? []), ...(roleB.bgvs ?? []), ...(roleB.chorus ?? []),
      ...(roleB.instruments ?? []).filter(s => s.person).map(s => s.person!),
      ...(roleB.foh ?? []).filter(s => s.person).map(s => s.person!)].map(m => m._id);
    const conflictsAtoB = unavailableOn(allAIds, dateB);
    const conflictsBtoA = unavailableOn(allBIds, dateA);
    const warnLines = [
      ...conflictsAtoB.map(n => `${n} no disponible el ${fmtD(dateB)}`),
      ...conflictsBtoA.map(n => `${n} no disponible el ${fmtD(dateA)}`),
    ];
    return (
      <Modal title="Intercambiar Equipos" onClose={onClose} wide>
        <p className="font-body text-sm text-gray-400">
          Los equipos completos serán intercambiados entre estas dos fechas. Las fechas no cambian, solo el personal asignado a cada una.
        </p>
        <div className="grid grid-cols-2 gap-4">
          {[roleA, roleB].map((role, idx) => (
            <div key={role._id} className="rounded-lg border border-[#00bfff]/20 p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={`font-label text-[11px] uppercase tracking-widest px-2 py-0.5 rounded-full ${SERVICE_BADGE[role._type]}`}>{SERVICE_LABEL[role._type]}</span>
                {idx === 0 && <span className="font-label text-[11px] text-[#00bfff]">→ Recibe equipo B</span>}
                {idx === 1 && <span className="font-label text-[11px] text-[#00bfff]">→ Recibe equipo A</span>}
              </div>
              <p className="font-body text-sm font-semibold">{formatDate(role.date)}</p>
              {(role.leads ?? []).length > 0 && <p className="font-body text-xs text-gray-500">Líder: {(role.leads ?? []).map(m => dn(m)).join(", ")}</p>}
              <div className="flex gap-1.5 flex-wrap">
                {(role.bgvs ?? []).length > 0 && <Pill>{(role.bgvs ?? []).length} BGV</Pill>}
                {(role.instruments ?? []).length > 0 && <Pill>{(role.instruments ?? []).length} instr.</Pill>}
                {(role.foh ?? []).length > 0 && <Pill>{(role.foh ?? []).length} FOH</Pill>}
              </div>
            </div>
          ))}
        </div>
        <AvailabilityWarning lines={warnLines} />
        <SwapFooter
          onClose={onClose} onConfirm={onConfirm} onReload={onReload}
          loading={loading} warn={warnLines.length > 0} error={error}
          confirmLabel="Confirmar intercambio"
        />
      </Modal>
    );
  }

  const { source, target, sourceRole, targetRole } = confirm;
  const srcName  = source.kind === "slot" ? (source.member ? dn(source.member) : "—") : dn(source.member);
  const tgtName  = target.kind === "slot" ? (target.member ? dn(target.member) : "—") : dn(target.member);
  const srcLabel = `${SECTION_LABEL[source.section]}${source.kind === "slot" ? ` · ${source.slotLabel}` : ""}`;
  const tgtLabel = `${SECTION_LABEL[target.section]}${target.kind === "slot" ? ` · ${target.slotLabel}` : ""}`;

  // source member moves to targetRole's date; target member moves to sourceRole's date
  const srcMemberId = source.kind === "member" ? source.member?._id : source.member?._id;
  const tgtMemberId = target.kind === "member" ? target.member?._id : target.member?._id;
  const srcDateConflicts = unavailableOn([srcMemberId], targetRole.date.slice(0,10));
  const tgtDateConflicts = unavailableOn([tgtMemberId], sourceRole.date.slice(0,10));
  const warnLines = [
    ...srcDateConflicts.map(n => `${n} no disponible el ${fmtD(targetRole.date)}`),
    ...tgtDateConflicts.map(n => `${n} no disponible el ${fmtD(sourceRole.date)}`),
  ];

  return (
    <Modal title="Intercambiar Miembros" onClose={onClose}>
      <div className="flex items-center gap-3">
        <div className="flex-1 text-center rounded-lg border border-[#00bfff]/20 p-3 space-y-1">
          <p className="font-body text-sm font-semibold">{srcName}</p>
          <p className="font-label text-[11px] uppercase tracking-widest text-[#00bfff]">{srcLabel}</p>
          <p className="font-label text-[11px] uppercase tracking-widest text-gray-500">{formatDate(sourceRole.date)}</p>
        </div>
        <span className="text-2xl text-gray-500 shrink-0">⇄</span>
        <div className="flex-1 text-center rounded-lg border border-[#00bfff]/20 p-3 space-y-1">
          <p className="font-body text-sm font-semibold">{tgtName}</p>
          <p className="font-label text-[11px] uppercase tracking-widest text-[#00bfff]">{tgtLabel}</p>
          <p className="font-label text-[11px] uppercase tracking-widest text-gray-500">{formatDate(targetRole.date)}</p>
        </div>
      </div>
      <AvailabilityWarning lines={warnLines} />
      <SwapFooter
        onClose={onClose} onConfirm={onConfirm} onReload={onReload}
        loading={loading} warn={warnLines.length > 0} error={error}
        confirmLabel="Confirmar"
      />
    </Modal>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ServicesPanel() {
  const [roles, setRoles]       = useState<ServiceRole[]>([]);
  const [members, setMembers]   = useState<MemberOption[]>([]);
  // The five read domains are tracked INDEPENDENTLY: a failure in one never
  // clears another's data and never reads as a clean value (Plan B item 5).
  const [sourceRecords, setSourceRecords] = useState<ServiceSourceRecords>(initialSourceRecords);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [showPastMonths, setShowPastMonths] = useState(false);
  const [toast, setToast]       = useState<string | null>(null);

  // Edit / delete modal
  type EditModal = { type: "add" } | { type: "edit"; role: ServiceRole } | { type: "delete"; role: ServiceRole } | null;
  const [editModal, setEditModal] = useState<EditModal>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Month generator
  const [showGenerator, setShowGenerator] = useState(false);

  // Setlist
  const [setlistRole, setSetlistRole] = useState<ServiceRole | null>(null);

  // Swap mode
  const [swapMode, setSwapMode]     = useState(false);
  const [swapSource, setSwapSource] = useState<SwapSource | null>(null);
  const [swapConfirm, setSwapConfirm] = useState<SwapConfirm | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);

  // Copy-instruments mode: pick a source card, then a target day to repeat its lineup.
  const [copySource, setCopySource] = useState<string | null>(null);
  const copyMode = copySource !== null;

  // The three A1 integrity summaries, kept beside the roles/members arrays. A
  // failed domain is `null` = unproven; it is NEVER an empty inventory.
  const [summaries, setSummaries] = useState<CardSourceSummaries>({
    roles: null, setlists: null, proposals: null,
  });

  // `Publicar listos` confirmation, the individual override, and safe unpublish —
  // three separate flows on purpose (a hide never routes through publish).
  const [publishPlan, setPublishPlan] = useState<PublishConfirmationPlan | null>(null);
  const [overrideCard, setOverrideCard] = useState<ServiceCardModel | null>(null);
  const [unpublishCard, setUnpublishCard] = useState<ServiceCardModel | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  /**
   * A lost/timed-out publish or unpublish response. Repeat submission is disabled
   * until the read-only `recover` mode says what actually committed.
   */
  const [pendingOutcome, setPendingOutcome] = useState<
    { kind: "publish" | "unpublish"; ids: string[]; published: boolean } | null
  >(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // Transient proposal / integrity handoff, owned by `AdminPanel`.
  const { openReviewTarget, openIntegrityIssue } = useServiceHandoff();

  // The in-flight add-modal logical create: `{ id, payloadKey }`, kept in a ref so
  // a retry of the same payload reuses the same idempotency key.
  const addRequest = useRef<{ id: string; payloadKey: string } | null>(null);

  // ── Independent source loading + per-control capability ───────────────────

  const sources = useMemo(() => sourceStates(sourceRecords), [sourceRecords]);
  const capabilities: ServiceCapabilities = useMemo(
    () => selectServiceCapabilities(sources),
    [sources],
  );
  /** Render-time gate for one control, with the Spanish "which source" copy. */
  const gate = useCallback(
    (control: ServiceControl): CardGate => {
      const capability = capabilities[control];
      return { enabled: capability.enabled, reason: unreadyMessage(capability.blockedBy) };
    },
    [capabilities],
  );
  const view = rolesView(sourceRecords);

  // Active edit/swap/copy snapshots, plus the LATCHED reason each became stale.
  // A stale mode is never submitted: it requires an explicit reload.
  const [snapshots, setSnapshots] = useState<Partial<Record<ActiveMode, ActiveModeSnapshot>>>({});
  const [staleModes, setStaleModes] = useState<Partial<Record<ActiveMode, ActiveModeInvalidation>>>({});

  const openSnapshot = (mode: ActiveMode, control: ServiceControl, observed: readonly ServiceRole[]) => {
    setSnapshots(prev => ({
      ...prev,
      [mode]: captureActiveMode({ mode, control, roles: observed, records: sourceRecords }),
    }));
    setStaleModes(prev => {
      if (!prev[mode]) return prev;
      const next = { ...prev };
      delete next[mode];
      return next;
    });
  };

  const clearSnapshot = (...modes: ActiveMode[]) => {
    setSnapshots(prev => {
      const next = { ...prev };
      let changed = false;
      for (const mode of modes) if (next[mode]) { delete next[mode]; changed = true; }
      return changed ? next : prev;
    });
    setStaleModes(prev => {
      const next = { ...prev };
      let changed = false;
      for (const mode of modes) if (next[mode]) { delete next[mode]; changed = true; }
      return changed ? next : prev;
    });
  };

  // A required source failing/reloading, a selected role disappearing, or an
  // observed revision changing invalidates the open mode — and stays latched.
  useEffect(() => {
    setStaleModes(prev => {
      let changed = false;
      const next = { ...prev };
      for (const mode of Object.keys(snapshots) as ActiveMode[]) {
        const snapshot = snapshots[mode];
        if (!snapshot) continue;
        const latched = latchInvalidation(
          prev[mode] ?? null,
          checkActiveMode(snapshot, { records: sourceRecords, roles }),
        );
        if (latched && latched !== prev[mode]) {
          next[mode] = latched;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [snapshots, sourceRecords, roles]);

  const openEditModal = (next: Exclude<EditModal, null>) => {
    const control = editModalControl(next.type);
    // Re-checked at handler entry, not only at render.
    const guard = guardControl(sources, control);
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    setEditError(null);
    if (next.type === "add") addRequest.current = null;
    if (next.type !== "add") openSnapshot(next.type, control, [next.role]);
    setEditModal(next);
  };

  const closeEditModal = () => {
    setEditError(null);
    addRequest.current = null;
    clearSnapshot("edit", "delete");
    setEditModal(null);
  };

  /**
   * Load the given sources independently. Each one reports its own success or
   * failure; a non-OK response or an unusable payload is an error, never an empty
   * array. Returns the sources that did NOT load, so a caller that just mutated
   * can be honest about an incomplete refresh.
   */
  const loadSources = useCallback(
    async (keys: readonly ServiceSourceKey[] = SERVICE_SOURCE_KEYS): Promise<ServiceSourceKey[]> => {
      setSourceRecords(prev => reduceSourceRecords(prev, { type: "load_start", sources: keys }));
      const results = await Promise.all(
        keys.map(async (key) => {
          try {
            const res = await fetch(SOURCE_ENDPOINTS[key]);
            if (!res.ok) return { key, ok: false, body: null as unknown };
            const body = (await res.json()) as unknown;
            return { key, ok: isValidSourcePayload(key, body), body };
          } catch {
            return { key, ok: false, body: null as unknown };
          }
        }),
      );
      for (const result of results) {
        if (result.key === "roles" && result.ok) setRoles(result.body as ServiceRole[]);
        if (result.key === "members" && result.ok) setMembers(result.body as MemberOption[]);
        // A failed integrity domain drops back to `null` (unproven) rather than
        // keeping a stale inventory that would read as proof.
        if (result.key === "roleTargets") {
          setSummaries(prev => ({ ...prev, roles: result.ok ? (result.body as RoleDomainSummary) : null }));
        }
        if (result.key === "setlistTargets") {
          setSummaries(prev => ({ ...prev, setlists: result.ok ? (result.body as SetlistDomainSummary) : null }));
        }
        if (result.key === "proposals") {
          setSummaries(prev => ({ ...prev, proposals: result.ok ? (result.body as ProposalDomainSummary) : null }));
        }
      }
      setSourceRecords(prev =>
        results.reduce(
          (acc, result) =>
            reduceSourceRecords(
              acc,
              result.ok ? { type: "load_ok", source: result.key } : { type: "load_error", source: result.key },
            ),
          prev,
        ),
      );
      return results.filter(r => !r.ok).map(r => r.key);
    },
    [],
  );

  const retryLoad = useCallback(() => {
    void loadSources(retryTargets(sourceRecords));
  }, [loadSources, sourceRecords]);

  useEffect(() => { void loadSources(); }, [loadSources]);

  // ── Create / Edit / Delete ────────────────────────────────────────────────

  const handleAdd = async (data: any) => {
    // Submit re-check: a source may have failed since the modal opened.
    const guard = guardControl(sources, "createService");
    if (!guard.ok) { setEditError(guard.message ?? "Datos incompletos."); return; }
    setSubmitting(true);
    // One creationRequestId per LOGICAL create: retained while this exact payload
    // stays retryable (network error, lost response), and replaced as soon as the
    // form changes — a changed payload is a new logical create, never the old key.
    const payloadKey = JSON.stringify(data);
    if (!addRequest.current || addRequest.current.payloadKey !== payloadKey) {
      addRequest.current = { id: newCreationRequestId(), payloadKey };
    }
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, creationRequestId: addRequest.current.id }),
      });
      if (res.ok) {
        addRequest.current = null;
        closeEditModal();
        // A failed refresh after a committed create is reported as such — never
        // as a fully refreshed success.
        showToast(mutationOutcomeMessage("Servicio creado.", await loadSources()));
      } else {
        setEditError(await describeMutationError(res, "Error al crear."));
        // A 409 keeps the modal open and refreshes so the operator can reload.
        if (res.status === 409) void loadSources();
      }
    } catch {
      setEditError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (data: any) => {
    if (editModal?.type !== "edit") return;
    // A stale snapshot is never submitted: reload first.
    const stale = staleModes.edit;
    if (stale) { setEditError(stale.message); return; }
    const guard = guardControl(sources, "editTeam");
    if (!guard.ok) { setEditError(guard.message ?? "Datos incompletos."); return; }
    // Moving the date is its own capability row (all five sources).
    if (movesServiceDate(editModal.role.date, data?.date)) {
      const dateGuard = guardControl(sources, "changeServiceDate");
      if (!dateGuard.ok) { setEditError(dateGuard.message ?? "Datos incompletos."); return; }
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/roles/${editModal.role._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // The revision this card was loaded with — the stale-view guard.
        body: JSON.stringify({ ...data, rev: editModal.role._rev }),
      });
      if (res.ok) {
        // Adopt the committed revision BEFORE reloading. If the reload then fails
        // we still hold the revision the server just wrote, so the next save is
        // not refused for a conflict we created ourselves. Parsing is best-effort:
        // an unreadable body leaves the reload to correct things.
        const refreshed = await res
          .json()
          .then(refreshedRoleFromResponse)
          .catch(() => null);
        if (refreshed) setRoles((current) => applyRefreshedRole(current, refreshed));
        closeEditModal();
        showToast(mutationOutcomeMessage("Actualizado.", await loadSources()));
      } else {
        setEditError(await describeMutationError(res, "Error al actualizar."));
        if (res.status === 409) void loadSources();
      }
    } catch {
      setEditError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (editModal?.type !== "delete") return;
    const stale = staleModes.delete;
    if (stale) { setEditError(stale.message); return; }
    const guard = guardControl(sources, "deleteService");
    if (!guard.ok) { setEditError(guard.message ?? "Datos incompletos."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/roles/${editModal.role._id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rev: editModal.role._rev }),
      });
      if (res.ok) {
        closeEditModal();
        showToast(
          mutationOutcomeMessage("Eliminado.", await loadSources(), "Eliminado, pero no se pudo actualizar"),
        );
      } else {
        setEditError(await describeMutationError(res, "Error al eliminar."));
        if (res.status === 409) void loadSources();
      }
    } catch {
      setEditError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Swap logic ────────────────────────────────────────────────────────────

  /** Swap selection AND confirmation both re-check the swap capability. */
  function guardSwap(): boolean {
    const guard = guardControl(sources, "swap");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return false; }
    return true;
  }

  function handleCardSwapSelect(roleId: string) {
    if (!guardSwap()) return;
    if (!swapSource) { setSwapSource({ kind: "card", roleId }); return; }
    if (swapSource.kind !== "card") return;
    if (swapSource.roleId === roleId) { setSwapSource(null); return; }
    const roleA = roles.find(r => r._id === swapSource.roleId);
    const roleB = roles.find(r => r._id === roleId);
    // A selected role that vanished from the refreshed list is never swapped.
    if (!roleA || !roleB) { setSwapSource(null); showToast("Este servicio ya no existe. Recarga la lista."); return; }
    openSnapshot("swap", "swap", [roleA, roleB]);
    setSwapConfirm({ kind: "card", roleA, roleB });
  }

  function handleMemberChipClick(src: Exclude<SwapSource, { kind: "card" }>) {
    if (!guardSwap()) return;
    if (!swapSource) { setSwapSource(src); return; }
    if (swapSource.kind === "card") return;
    // Deselect if same chip (identified by its stored seat key, not its index)
    if (swapSource.roleId === src.roleId && swapSource.section === src.section && swapSource.itemKey === src.itemKey) {
      setSwapSource(null); return;
    }
    const sourceRole = roles.find(r => r._id === swapSource.roleId);
    const targetRole = roles.find(r => r._id === src.roleId);
    if (!sourceRole || !targetRole) { setSwapSource(null); return; }
    openSnapshot("swap", "swap", [sourceRole, targetRole]);
    setSwapConfirm({ kind: "member", source: swapSource, target: src, sourceRole, targetRole });
  }

  // ONE atomic server transaction, never two independent PATCHes: the server
  // derives both sides from the currently stored roles and either applies the
  // whole swap or nothing at all. A rejection keeps this modal open and reports
  // honestly; a 409 means the view is stale and requires a reload.
  async function confirmSwap() {
    if (!swapConfirm) return;
    // Stale selection or a lost dependency: require a reload instead of sending
    // the snapshot the operator saw.
    const stale = staleModes.swap;
    if (stale) { setSwapError(stale.message); return; }
    const guard = guardControl(sources, "swap");
    if (!guard.ok) { setSwapError(guard.message ?? "Datos incompletos."); return; }
    setSubmitting(true);
    setSwapError(null);
    try {
      const body = swapConfirm.kind === "card"
        ? {
            kind: "team",
            roles: [
              { id: swapConfirm.roleA._id, rev: swapConfirm.roleA._rev },
              { id: swapConfirm.roleB._id, rev: swapConfirm.roleB._rev },
            ],
          }
        : {
            kind: "seat",
            source: {
              roleId: swapConfirm.source.roleId,
              rev: swapConfirm.sourceRole._rev,
              path: SEAT_PATH[swapConfirm.source.section],
              itemKey: swapConfirm.source.itemKey,
            },
            target: {
              roleId: swapConfirm.target.roleId,
              rev: swapConfirm.targetRole._rev,
              path: SEAT_PATH[swapConfirm.target.section],
              itemKey: swapConfirm.target.itemKey,
            },
          };
      const res = await fetch("/api/admin/roles/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSwapConfirm(null);
        setSwapSource(null);
        clearSnapshot("swap");
        showToast(mutationOutcomeMessage("Intercambio realizado.", await loadSources()));
      } else {
        setSwapError(await describeMutationError(res, "Error al intercambiar."));
      }
    } catch {
      setSwapError("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  }

  function exitSwapMode() {
    setSwapMode(false); setSwapSource(null); setSwapConfirm(null); setSwapError(null);
    clearSnapshot("swap");
  }

  // ── Copy instruments to another day ─────────────────────────────────────────

  function exitCopyMode() { setCopySource(null); clearSnapshot("copy"); }

  function startCopyInstruments(roleId: string) {
    const guard = guardControl(sources, "copyInstruments");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    const source = roles.find(r => r._id === roleId);
    if (!source) { showToast("Este servicio ya no existe. Recarga la lista."); return; }
    exitSwapMode();
    openSnapshot("copy", "copyInstruments", [source]);
    setCopySource(roleId);
  }

  async function copyInstrumentsTo(targetId: string) {
    if (!copySource || copySource === targetId) return;
    const stale = staleModes.copy;
    if (stale) { showToast(stale.message); return; }
    const guard = guardControl(sources, "copyInstruments");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    const source = roles.find(r => r._id === copySource);
    const target = roles.find(r => r._id === targetId);
    if (!source || !target) { showToast("Este servicio ya no existe. Recarga la lista."); return; }
    const count = (source.instruments ?? []).filter(s => s.person).length;
    const fmt = (r: ServiceRole) =>
      new Date(r.date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
    if (!confirm(`¿Copiar ${count} instrumento(s) de ${fmt(source)} a ${fmt(target)}? Reemplazará los instrumentos del destino.`)) return;
    setSubmitting(true);
    try {
      // Both observed revisions are sent; the server re-reads the source lineup
      // and patches only the target's instruments in one guarded transaction. On
      // failure copy mode stays open and nothing is claimed.
      const res = await fetch("/api/admin/roles/copy-instruments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: { id: source._id, rev: source._rev },
          target: { id: target._id, rev: target._rev },
        }),
      });
      if (res.ok) {
        exitCopyMode();
        showToast(mutationOutcomeMessage("Instrumentos copiados.", await loadSources()));
      } else {
        // Copy mode stays open; a 409 refresh invalidates the stale selection.
        showToast(await describeMutationError(res, "Error al copiar."));
        if (res.status === 409) void loadSources();
      }
    } catch {
      showToast("Error de conexión.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Publish (server-authoritative) ────────────────────────────────────────
  //
  // Three distinct flows, never collapsed into one:
  //   `ready`    — `Publicar listos`, and the card's rule-13 `Publicar`.
  //   `override` — an explicit individual acknowledgement of WORKFLOW blockers.
  //   unpublish  — the separate narrow safe-targeting capability (never publish).
  // Every one re-checks its own capability row at submit, keeps its dialog open on
  // failure, and refuses to repeat a submission whose outcome is unknown.

  /** POST a publish/unpublish request; returns the Spanish outcome, if any. */
  async function submitPublication(input: {
    url: string;
    body: unknown;
    /** For the unknown-outcome recovery: what we asked to become true. */
    outcome: { kind: "publish" | "unpublish"; ids: string[]; published: boolean };
    success: string;
    fallback: string;
    onDone: () => void;
  }): Promise<void> {
    if (pendingOutcome) {
      setPublishError("El resultado anterior es desconocido. Verifícalo antes de reintentar.");
      return;
    }
    setSubmitting(true);
    setPublishError(null);
    try {
      const res = await fetch(input.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.body),
      });
      if (res.ok) {
        input.onDone();
        showToast(mutationOutcomeMessage(input.success, await loadSources()));
      } else {
        // Never close as success. A 409 refreshes so the operator can reload.
        setPublishError(await describeMutationError(res, input.fallback));
        if (res.status === 409) void loadSources();
      }
    } catch {
      // Outcome unknown: do NOT infer failure and do NOT replay automatically.
      // Repeat submission is disabled until `recover` says what committed, and the
      // authoritative bundle is refetched so any retry uses a new observation.
      setPendingOutcome(input.outcome);
      setPublishError(
        "No se pudo confirmar el resultado. Verifica qué quedó guardado antes de reintentar.",
      );
      void loadSources();
    } finally {
      setSubmitting(false);
    }
  }

  /** Read-only outcome verification. An observed commit is recovered success. */
  async function verifyPendingOutcome() {
    const pending = pendingOutcome;
    if (!pending) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        pending.kind === "publish" ? "/api/admin/roles/publish-ready" : "/api/admin/roles/unpublish",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "recover",
            roles: pending.ids.map(id => ({ id })),
            ...(pending.kind === "publish" ? { published: pending.published } : {}),
          }),
        },
      );
      if (res.ok) {
        setPendingOutcome(null);
        setPublishError(null);
        setPublishPlan(null);
        setOverrideCard(null);
        setUnpublishCard(null);
        showToast(mutationOutcomeMessage("Cambio confirmado.", await loadSources()));
      } else {
        // Not in the requested state, or the refetch itself failed: stay unknown
        // and require an explicit retry over a wholly new observed bundle.
        setPublishError(
          await describeMutationError(
            res,
            "El resultado sigue sin confirmarse. Recarga y vuelve a intentar.",
          ),
        );
        if (res.status === 409) {
          setPendingOutcome(null);
          void loadSources();
        }
      }
    } catch {
      setPublishError("No se pudo verificar el resultado. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  /** `Publicar listos` (a batch) or a single rule-13 `Publicar` — always `ready`. */
  async function publishReady(entries: { id: string; rev: string }[]) {
    const guard = guardControl(sources, "publishReady");
    if (!guard.ok) { setPublishError(guard.message ?? "Datos incompletos."); return; }
    if (entries.length === 0) return;
    await submitPublication({
      url: "/api/admin/roles/publish-ready",
      body: { mode: "ready", roles: entries },
      outcome: { kind: "publish", ids: entries.map(e => e.id), published: true },
      success: entries.length === 1 ? "Servicio publicado." : `${entries.length} servicios publicados.`,
      fallback: "Error al publicar.",
      onDone: () => { setPublishPlan(null); setOverrideCard(null); },
    });
  }

  /** The explicit individual override: only WORKFLOW blockers, one service. */
  async function publishOverride(card: ServiceCardModel, blockers: readonly PublishWorkflowBlocker[]) {
    const guard = guardControl(sources, "publishReady");
    if (!guard.ok) { setPublishError(guard.message ?? "Datos incompletos."); return; }
    await submitPublication({
      url: "/api/admin/roles/publish-ready",
      body: {
        mode: "override",
        roles: [{ id: card.role._id, rev: card.role._rev, acknowledgedBlockers: [...blockers] }],
      },
      outcome: { kind: "publish", ids: [card.role._id], published: true },
      success: "Servicio publicado.",
      fallback: "Error al publicar.",
      onDone: () => { setOverrideCard(null); setPublishPlan(null); },
    });
  }

  /**
   * Hide a published service. Deliberately narrow: it needs only roles +
   * role-target integrity, so an unsafe/incomplete/unavailable member, setlist or
   * proposal source must NOT prevent it, and it never sends acknowledgements.
   */
  async function unpublishService(card: ServiceCardModel) {
    const guard = guardControl(sources, "unpublish");
    if (!guard.ok) { setPublishError(guard.message ?? "Datos incompletos."); return; }
    await submitPublication({
      url: "/api/admin/roles/unpublish",
      body: { roles: [{ id: card.role._id, rev: card.role._rev }] },
      outcome: { kind: "unpublish", ids: [card.role._id], published: false },
      success: "Servicio oculto.",
      fallback: "Error al ocultar.",
      onDone: () => setUnpublishCard(null),
    });
  }

  function openPublishPlan(cards: readonly ServiceCardModel[]) {
    const guard = guardControl(sources, "publishReady");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    setPublishError(null);
    setPendingOutcome(null);
    setPublishPlan(buildPublishConfirmation(cards));
  }

  function openOverride(card: ServiceCardModel) {
    const guard = guardControl(sources, "publishReady");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    setPublishError(null);
    setPendingOutcome(null);
    setOverrideCard(card);
  }

  function openUnpublish(card: ServiceCardModel) {
    // Re-checked here AND at confirmation.
    const guard = guardControl(sources, "unpublish");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    setPublishError(null);
    setPendingOutcome(null);
    setUnpublishCard(card);
  }

  // ── Setlist editor ────────────────────────────────────────────────────────

  function openSetlist(role: ServiceRole) {
    const guard = guardControl(sources, "editSetlist");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    setSetlistRole(role);
  }

  function openGenerator() {
    const guard = guardControl(sources, "generateMonth");
    if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
    setShowGenerator(true);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const today = serviceTodayIso();

  // Split months into current/future and past
  const currentYM   = today.slice(0, 7);
  const allMonths   = Array.from(new Set(roles.map(r => r.date.slice(0, 7)))).sort();
  const futureMonths = allMonths.filter(ym => ym >= currentYM);
  const pastMonths   = allMonths.filter(ym => ym < currentYM).reverse(); // most-recent first

  const toggleMonth = (ym: string) =>
    setSelectedMonths(prev => {
      const next = new Set(prev);
      next.has(ym) ? next.delete(ym) : next.add(ym);
      return next;
    });

  // ── Readiness models (one per card) ────────────────────────────────────────
  //
  // The global integrity queue is built from the SAME three summaries, over every
  // loaded card (not just the visible ones), so a month filter can never push an
  // owned issue into the global `Integridad de datos` list. Its `cardIssues`
  // (lock/legacy only) are what `deriveServiceReadiness` consumes.
  const queue = useMemo(
    () =>
      buildIntegrityQueue({
        sources,
        cards: serviceCardRefs(roles, summaries),
        roles: summaries.roles,
        setlists: summaries.setlists,
        proposals: summaries.proposals,
      }),
    [sources, roles, summaries],
  );

  const cards = useMemo(
    () => buildServiceCards({ roles, members, sources, summaries, todayIso: today, queue }),
    [roles, members, sources, summaries, today, queue],
  );

  // No filter selected → show upcoming only (default). Months selected → exactly those.
  const visibleCards = selectedMonths.size === 0
    ? cards.filter(c => !c.isPast)
    : cards.filter(c => selectedMonths.has(c.role.date.slice(0, 7)));

  const monthLabel =
    selectedMonths.size === 0 ? "Próximos"
    : selectedMonths.size === 1 ? fmtYM([...selectedMonths][0])
    : `${selectedMonths.size} meses`;

  const counters = commandSummaryCounters({ all: cards, visible: visibleCards });
  const summaryLine = commandSummarySegments(counters).join(" · ");
  const queueTone = integrityQueueTone(queue);

  // Availability conflicts across the visible, still-upcoming cards.
  const conflictNotices = visibleCards
    .filter(card => !card.isPast && card.readiness.availabilityStatus === "conflict")
    .flatMap(card =>
      card.readiness.conflicts.map(conflict => ({
        name: conflict.memberName,
        label: SERVICE_LABEL[card.role._type],
        date: card.day ?? card.role.date.slice(0, 10),
        note: conflict.note,
      })),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  /** Per-target month/create preflight over the currently observed bundle. */
  const preflightTarget = useCallback(
    (type: "sunday_role" | "saturday_role", date: string) =>
      monthTargetPreflight({ sources, summaries, queue, type, date }),
    [sources, summaries, queue],
  );

  /**
   * Run ONE card's primary action. The action itself is the shipped ladder's
   * result; this only opens the existing flow its route names, and re-checks that
   * flow's capability row at handler entry.
   */
  function runPrimaryAction(card: ServiceCardModel) {
    switch (primaryActionRoute(card.readiness)) {
      case "service_modal":
        openEditModal({ type: "edit", role: card.role });
        return;
      case "setlist_editor":
        // Unreachable for a non-editable target (the route falls back), but the
        // guard stays so a malformed setlist can never open the editor.
        if (!card.readiness.setlistEditable) { openIntegrityDetails(card); return; }
        openSetlist(card.role);
        return;
      case "publish":
        openPublishPlan([card]);
        return;
      case "proposal_handoff": {
        const guard = guardControl(sources, "proposalHandoff");
        if (!guard.ok) { showToast(guard.message ?? "Datos incompletos."); return; }
        const target = buildProposalHandoff(proposalHandoffInput(card));
        if (!target) { showToast("No hay una propuesta que abrir para este servicio."); return; }
        openReviewTarget(target);
        return;
      }
      case "integrity_details":
        openIntegrityDetails(card);
        return;
      case "retry_sources":
        retryLoad();
        return;
      default:
        return;
    }
  }

  /** Read-only integrity details, by explicit id — never an editable setlist. */
  function openIntegrityDetails(card: ServiceCardModel) {
    const target = integrityTargetForCard(card);
    if (!target) {
      showToast("No se pudo verificar este servicio. Reintenta la carga.");
      retryLoad();
      return;
    }
    openIntegrityIssue(target);
  }

  // ── Per-control gates (one snapshot, five individual source states) ─────────
  const swapGate          = gate("swap");
  const publishGate       = gate("publishReady");
  const generateGate      = gate("generateMonth");
  const createGate        = gate("createService");
  const participationGate = gate("participationSidebar");
  const cardGates: CardGates = {
    editTeam: gate("editTeam"),
    editSetlist: gate("editSetlist"),
    copyInstruments: gate("copyInstruments"),
    deleteService: gate("deleteService"),
    publish: publishGate,
    unpublish: gate("unpublish"),
    swap: swapGate,
    proposalHandoff: gate("proposalHandoff"),
  };

  // Honest banner: which sources are missing, and its retry. Availability/team
  // are explicitly "unverified" while members is unavailable — never "clear".
  const unreadySummary = unreadyMessage(
    SERVICE_SOURCE_KEYS.filter(key => sources[key] !== "ready").map(key => ({
      source: key,
      state: sources[key] as "loading" | "error",
    })),
  );
  const availabilityUnverified = sources.members !== "ready";

  return (
    <div className="space-y-5">

      {/* Command summary — replaces the plain count header */}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl uppercase tracking-wide">Servicios</h1>
          {view !== "loading" && (
            <>
              <p className={`mt-0.5 font-label text-xs uppercase tracking-widest text-gray-500 ${CARD_STYLE.longText}`}>
                {summaryLine}
              </p>
              {/* The global integrity entry: never a clean zero when an inventory failed. */}
              <p className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="font-label text-[11px] uppercase tracking-widest text-gray-500">
                  {INTEGRITY_QUEUE_TITLE}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 font-label text-[11px] uppercase tracking-widest ${
                    TONE_CLASS[
                      queueTone === "clean" ? "approved" : queueTone === "unknown" ? "unknown" : "error"
                    ]
                  }`}
                >
                  {integrityQueueSummary(queue)}
                </span>
              </p>
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* Swap mode toggle */}
          <button
            onClick={() => { if (swapMode) { exitSwapMode(); } else { exitCopyMode(); setSwapMode(true); } }}
            disabled={!swapGate.enabled && !swapMode}
            title={swapGate.reason ?? undefined}
            className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-40 ${
              swapMode ? "border-[#00bfff] bg-[#00bfff]/10 text-[#00bfff]" : "border-[#003572]/20 dark:border-[#00bfff]/15 text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff]/30"
            }`}
          >
            ⇄ {swapMode ? "Salir" : "Intercambiar"}
          </button>
          {visibleCards.some(c => c.readiness.publishState === "draft") && (
            <button type="button"
              disabled={!publishGate.enabled}
              title={publishGate.reason ?? undefined}
              onClick={() => openPublishPlan(visibleCards)}
              className="min-h-[44px] rounded-lg bg-[#003572] px-3 font-label text-xs uppercase tracking-widest transition-colors hover:bg-[#003572]/80 disabled:opacity-40 dark:bg-[#00bfff]/20">
              Publicar listos ({counters.readyToPublish})
            </button>
          )}
          <button onClick={openGenerator}
            disabled={!generateGate.enabled}
            title={generateGate.reason ?? undefined}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#003572]/20 dark:border-[#00bfff]/15 font-label text-xs uppercase tracking-widest text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff]/30 transition-colors disabled:opacity-40">
            📅 Generar mes
          </button>
          {!swapMode && !copyMode && (
            <button onClick={() => openEditModal({ type: "add" })}
              disabled={!createGate.enabled}
              title={createGate.reason ?? undefined}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-40">
              <span className="text-base leading-none">+</span> Nuevo
            </button>
          )}
        </div>
      </div>

      {/* Source state — names the missing source and offers its retry */}
      {view !== "loading" && unreadySummary && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="font-label text-xs uppercase tracking-widest text-amber-400">Datos incompletos</p>
            <p className="font-body text-xs text-gray-300 mt-0.5">{unreadySummary}</p>
            {availabilityUnverified && (
              <p className="font-body text-xs text-gray-400 mt-0.5">
                El equipo y la disponibilidad no se pudieron verificar.
              </p>
            )}
          </div>
          <button type="button" onClick={retryLoad}
            className="px-3 py-1.5 rounded-lg border border-amber-500/40 font-label text-[11px] uppercase tracking-widest text-amber-300 hover:bg-amber-500/15 transition-colors shrink-0">
            Reintentar carga
          </button>
        </div>
      )}

      {/* Month filter */}
      {canFilterMonths(sourceRecords) && allMonths.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-label text-[11px] uppercase tracking-widest text-gray-600 shrink-0">Mes:</span>
            <MonthPill label="Próximos" selected={selectedMonths.size === 0} onClick={() => setSelectedMonths(new Set())} />
            {futureMonths.map(ym => (
              <MonthPill key={ym} label={fmtYM(ym)} selected={selectedMonths.has(ym)} onClick={() => toggleMonth(ym)} />
            ))}
            {pastMonths.length > 0 && (
              <button
                type="button"
                onClick={() => setShowPastMonths(v => !v)}
                className="font-label text-[11px] uppercase tracking-widest px-2.5 py-1 rounded-full border border-[#00bfff]/10 text-gray-600 hover:border-[#00bfff]/25 hover:text-gray-400 transition-colors flex items-center gap-1"
              >
                Roles previos
                <span className={`transition-transform ${showPastMonths ? "rotate-180" : ""}`}>▾</span>
              </button>
            )}
          </div>
          {showPastMonths && pastMonths.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap pl-12">
              {pastMonths.map(ym => (
                <MonthPill key={ym} label={fmtYM(ym)} selected={selectedMonths.has(ym)} onClick={() => toggleMonth(ym)} past />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Availability conflict summary */}
      {view !== "loading" && conflictNotices.length > 0 && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3">
          <p className="font-label text-xs uppercase tracking-widest text-red-400 flex items-center gap-1.5">
            ⚠ {conflictNotices.length} conflicto{conflictNotices.length !== 1 ? "s" : ""} de disponibilidad
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {conflictNotices.map((c, i) => (
              <li key={i} className="font-body text-xs text-gray-300">
                <span className="text-red-300 font-semibold">{c.name}</span>
                {" · "}{c.label}{" "}
                {new Date(c.date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })}
                {c.note && (
                  <span className="text-gray-500 italic"> — "{c.note}"</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Swap mode banner */}
      {swapMode && (
        <div className="rounded-lg border border-[#00bfff]/30 bg-[#00bfff]/5 px-4 py-2.5 flex items-center justify-between">
          <div>
            <p className="font-label text-xs uppercase tracking-widest text-[#00bfff]">Modo intercambio activo</p>
            <p className="font-body text-xs text-gray-500 mt-0.5">
              {!swapSource ? "Haz clic en «⇄ Equipo» para intercambiar equipos completos, o selecciona un miembro de cualquier card." :
               swapSource.kind === "card" ? "Ahora selecciona otro equipo para intercambiar." :
               "Ahora selecciona el miembro con quien intercambiar."}
            </p>
          </div>
          {swapSource && (
            <button onClick={() => setSwapSource(null)} className="font-label text-[11px] uppercase tracking-widest text-gray-500 hover:text-red-400 transition-colors ml-4 shrink-0">
              Cancelar selección
            </button>
          )}
        </div>
      )}

      {/* Copy-instruments mode banner */}
      {copyMode && (() => {
        const src = roles.find(r => r._id === copySource);
        const srcLabel = src
          ? new Date(src.date.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })
          : "";
        return (
          <div className="rounded-lg border border-[#00bfff]/30 bg-[#00bfff]/5 px-4 py-2.5 flex items-center justify-between">
            <div>
              <p className="font-label text-xs uppercase tracking-widest text-[#00bfff]">Copiar instrumentos</p>
              <p className="font-body text-xs text-gray-500 mt-0.5">
                Copiando los instrumentos de <span className="text-gray-300 capitalize">{srcLabel}</span>. Haz clic en «Pegar aquí» en el día destino (reemplaza sus instrumentos).
              </p>
            </div>
            <button onClick={exitCopyMode} className="font-label text-[11px] uppercase tracking-widest text-gray-500 hover:text-red-400 transition-colors ml-4 shrink-0">
              Cancelar
            </button>
          </div>
        );
      })()}

      {/* An invalidated copy selection is never pasted: reload first. */}
      {copyMode && staleModes.copy && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <p className="font-body text-xs text-red-300">{staleModes.copy.message}</p>
          <button type="button" onClick={() => { exitCopyMode(); retryLoad(); }}
            className="px-3 py-1.5 rounded-lg border border-red-400/40 font-label text-[11px] uppercase tracking-widest text-red-200 hover:bg-red-500/15 transition-colors shrink-0">
            Recargar
          </button>
        </div>
      )}

      {/* Loading */}
      {view === "loading" && <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-[#003572]/10 dark:bg-[#00bfff]/5 animate-pulse" />)}</div>}

      {/* A roles failure prevents card rendering and shows retry instead */}
      {view === "error" && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-6 text-center space-y-3">
          <p className="font-label text-xs uppercase tracking-widest text-red-400">No se pudieron cargar los servicios</p>
          <p className="font-body text-sm text-gray-300">
            No se pueden mostrar los servicios sin esa fuente. Reintenta la carga.
          </p>
          <button type="button" onClick={retryLoad}
            className="px-4 py-2 rounded-lg border border-red-400/40 font-label text-xs uppercase tracking-widest text-red-200 hover:bg-red-500/15 transition-colors">
            Reintentar carga
          </button>
        </div>
      )}

      {/* Grid */}
      {view === "cards" && (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
          {participationGate.enabled ? (
            <ParticipationSidebar
              roles={visibleCards.map(c => c.role) as ParticipantRole[]}
              monthLabel={monthLabel}
            />
          ) : (
            // Never compute participation from partial membership.
            <aside className="rounded-xl border border-[#00bfff]/20 bg-[#C8D8EB]/40 dark:bg-[#010b17] p-3 space-y-2">
              <p className="font-label text-xs uppercase tracking-widest text-[#003572] dark:text-[#00bfff]">Participaciones</p>
              <p className="font-body text-xs text-gray-400">{participationGate.reason}</p>
              <button type="button" onClick={retryLoad}
                className="px-3 py-1.5 rounded-lg border border-[#00bfff]/30 font-label text-[11px] uppercase tracking-widest text-[#00bfff] hover:bg-[#00bfff]/10 transition-colors">
                Reintentar carga
              </button>
            </aside>
          )}
          <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {counters.upcoming === 0 && selectedMonths.size === 0 && (
            <p className="font-body text-sm text-gray-500 text-center py-12">No hay servicios próximos.</p>
          )}
          {visibleCards.map(card => (
            <ServiceReadinessCard
              key={card.cardId}
              card={card}
              sources={sources}
              todayIso={today}
              gates={cardGates}
              onPrimaryAction={() => runPrimaryAction(card)}
              onEdit={() => openEditModal({ type: "edit", role: card.role })}
              onDelete={() => openEditModal({ type: "delete", role: card.role })}
              onSetlist={() => openSetlist(card.role)}
              // The menu's `Publicar` is the explicit override path when workflow
              // blockers remain; a clean draft goes through the ready confirmation.
              onPublish={() =>
                card.readiness.isReadyToPublish ? openPublishPlan([card]) : openOverride(card)
              }
              onUnpublish={() => openUnpublish(card)}
              swapMode={swapMode}
              swapSource={swapSource}
              onCardSwapSelect={() => handleCardSwapSelect(card.role._id)}
              onMemberChipClick={handleMemberChipClick}
              copyMode={copyMode}
              isCopySource={copySource === card.role._id}
              onCopyStart={() => startCopyInstruments(card.role._id)}
              onCopyPick={() => copyInstrumentsTo(card.role._id)}
            />
          ))}
          </div>
        </div>
      )}


      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl bg-[#003572] dark:bg-[#0a1929] border border-[#00bfff]/30 font-label text-xs uppercase tracking-widest shadow-xl whitespace-nowrap">
          {toast}
        </div>
      )}

      {/* ── Modals ── */}
      {editModal?.type === "add" && (
        <Modal title="Nuevo servicio" onClose={closeEditModal} status={editError}>
          <ServiceForm members={members} onSubmit={handleAdd} onClose={closeEditModal} loading={submitting}
            submitBlockedReason={createGate.reason} />
        </Modal>
      )}
      {editModal?.type === "edit" && (
        <Modal title="Editar servicio" onClose={closeEditModal} status={editError ?? staleModes.edit?.message}>
          <ServiceForm initial={editModal.role} members={members} onSubmit={handleEdit} onClose={closeEditModal} loading={submitting}
            dateLockedReason={gate("changeServiceDate").reason}
            submitBlockedReason={staleModes.edit?.message ?? cardGates.editTeam.reason} />
          {staleModes.edit && (
            <button type="button" onClick={() => { closeEditModal(); retryLoad(); }}
              className="w-full py-2 rounded-lg border border-[#00bfff]/30 font-label text-xs uppercase tracking-widest text-[#00bfff] hover:bg-[#00bfff]/10 transition-colors">
              Recargar
            </button>
          )}
        </Modal>
      )}
      {editModal?.type === "delete" && (() => {
        // Dependency inventory must be complete (all five) and the observed
        // record still current, or this destructive confirmation is disabled.
        const blocked = staleModes.delete?.message ?? cardGates.deleteService.reason;
        return (
          <Modal title="Eliminar servicio" onClose={closeEditModal} status={editError ?? blocked}>
            <p className="font-body text-sm text-gray-400">¿Eliminar el servicio del <span className="text-red-400 font-semibold">{formatDate(editModal.role.date)}</span>? Esta acción no se puede deshacer.</p>
            <div className="flex gap-3">
              <button onClick={closeEditModal} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">Cancelar</button>
              {staleModes.delete ? (
                <button onClick={() => { closeEditModal(); retryLoad(); }} className="flex-1 py-2 rounded-lg border border-[#00bfff]/30 font-label text-xs uppercase tracking-widest text-[#00bfff] hover:bg-[#00bfff]/10 transition-colors">Recargar</button>
              ) : (
                <button onClick={handleDelete} disabled={submitting || !!blocked} title={blocked ?? undefined} className="flex-1 py-2 rounded-lg bg-red-800/60 hover:bg-red-700/60 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">{submitting ? "Eliminando..." : "Eliminar"}</button>
              )}
            </div>
          </Modal>
        );
      })()}
      {swapConfirm && (
        <SwapConfirmModal
          confirm={swapConfirm}
          onConfirm={confirmSwap}
          onClose={() => { setSwapConfirm(null); setSwapSource(null); setSwapError(null); clearSnapshot("swap"); }}
          onReload={() => { exitSwapMode(); retryLoad(); }}
          loading={submitting}
          members={members}
          // A stale/blocked selection shows its reason and offers reload.
          error={swapError ?? staleModes.swap?.message ?? swapGate.reason}
        />
      )}

      {/* `Publicar listos` — the readiness-aware bulk confirmation */}
      {publishPlan && (
        <Modal
          title="Publicar listos"
          onClose={() => { setPublishPlan(null); setPublishError(null); setPendingOutcome(null); }}
          status={publishError}
        >
          <div className={CARD_STYLE.dialog}>
            <p className="font-body text-sm text-gray-400">
              Solo se publican los servicios que pasaron toda la verificación. Los demás se
              muestran abajo con su motivo y no se envían.
            </p>
            <section>
              <p className="font-label text-[11px] uppercase tracking-widest text-[#00bfff]">
                Se publicarán ({publishPlan.selected.length})
              </p>
              {publishPlan.selected.length === 0 ? (
                <p className="font-body text-xs italic text-gray-500">
                  Ningún borrador visible está listo para publicar.
                </p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {publishPlan.selected.map(entry => (
                    <li key={entry.id} className={`font-body text-xs text-gray-300 ${CARD_STYLE.longText}`}>
                      {entry.label}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {publishPlan.skipped.length > 0 && (
              <section>
                <p className="font-label text-[11px] uppercase tracking-widest text-amber-400">
                  Se omiten ({publishPlan.skipped.length})
                </p>
                <ul className="mt-1 space-y-0.5">
                  {publishPlan.skipped.map(entry => (
                    <li key={entry.id} className={`font-body text-xs text-gray-400 ${CARD_STYLE.longText}`}>
                      <span className="text-gray-300">{entry.label}</span> — {entry.text}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <PublicationFooter
              onClose={() => { setPublishPlan(null); setPublishError(null); setPendingOutcome(null); }}
              onConfirm={() => publishReady(publishPlan.selected.map(({ id, rev }) => ({ id, rev })))}
              onVerify={verifyPendingOutcome}
              confirmLabel={`Publicar ${publishPlan.selected.length}`}
              loading={submitting}
              disabled={publishPlan.selected.length === 0 || !publishGate.enabled}
              unknownOutcome={!!pendingOutcome}
            />
          </div>
        </Modal>
      )}

      {/* Individual override: WORKFLOW blockers only, acknowledged explicitly */}
      {overrideCard && (() => {
        const acknowledgement = overrideAcknowledgement({
          id: overrideCard.role._id,
          rev: overrideCard.role._rev,
          readiness: overrideCard.readiness,
        });
        return (
          <Modal
            title="Publicar de todos modos"
            onClose={() => { setOverrideCard(null); setPublishError(null); setPendingOutcome(null); }}
            status={publishError}
          >
            <div className={CARD_STYLE.dialog}>
              <p className={`font-body text-sm text-gray-400 ${CARD_STYLE.longText}`}>
                {serviceCardLabel(overrideCard.role)}
              </p>
              {acknowledgement ? (
                <>
                  <p className="font-label text-[11px] uppercase tracking-widest text-amber-400">
                    Vas a publicar aunque:
                  </p>
                  <ul className="space-y-0.5">
                    {describeAcknowledgedBlockers(acknowledgement.acknowledgedBlockers).map(text => (
                      <li key={text} className="font-body text-xs text-amber-200/90">• {text}</li>
                    ))}
                  </ul>
                  <p className="font-body text-xs text-gray-500">
                    El servidor vuelve a calcular estos puntos y rechaza la publicación si
                    cambiaron.
                  </p>
                </>
              ) : (
                <p className="font-body text-xs text-red-300">
                  Este servicio tiene problemas de integridad: no se puede publicar con una
                  confirmación. Usa «Revisar datos».
                </p>
              )}
              <PublicationFooter
                onClose={() => { setOverrideCard(null); setPublishError(null); setPendingOutcome(null); }}
                onConfirm={() =>
                  acknowledgement && publishOverride(overrideCard, acknowledgement.acknowledgedBlockers)
                }
                onVerify={verifyPendingOutcome}
                confirmLabel="Publicar de todos modos"
                loading={submitting}
                disabled={!acknowledgement || !publishGate.enabled}
                unknownOutcome={!!pendingOutcome}
                danger
              />
            </div>
          </Modal>
        );
      })()}

      {/* Safe unpublish — never routed through publish readiness or override */}
      {unpublishCard && (
        <Modal
          title="Ocultar servicio"
          onClose={() => { setUnpublishCard(null); setPublishError(null); setPendingOutcome(null); }}
          status={publishError ?? cardGates.unpublish.reason}
        >
          <div className={CARD_STYLE.dialog}>
            <p className={`font-body text-sm text-gray-400 ${CARD_STYLE.longText}`}>
              ¿Ocultar <span className="font-semibold text-gray-200">{serviceCardLabel(unpublishCard.role)}</span> del
              equipo? Deja de ser visible para los miembros; no se borra nada.
            </p>
            <p className="font-body text-xs text-gray-500">
              Ocultar no depende de la verificación de publicación: se puede ocultar un servicio
              con datos incompletos o en conflicto.
            </p>
            <PublicationFooter
              onClose={() => { setUnpublishCard(null); setPublishError(null); setPendingOutcome(null); }}
              onConfirm={() => unpublishService(unpublishCard)}
              onVerify={verifyPendingOutcome}
              confirmLabel="Ocultar"
              loading={submitting}
              disabled={!cardGates.unpublish.enabled}
              unknownOutcome={!!pendingOutcome}
              danger
            />
          </div>
        </Modal>
      )}

      {showGenerator && (
        <Modal title="Generar mes" onClose={() => setShowGenerator(false)} wide>
          <MonthGenerator
            members={members}
            existingRoles={roles}
            // Re-checked at preview and at confirmation, not just at open.
            capability={{ enabled: generateGate.enabled, reason: generateGate.reason }}
            // Per-target A1/A2 preflight: only proven-`creatable` targets are posted.
            preflight={preflightTarget}
            onClose={() => setShowGenerator(false)}
            onCreated={async () => {
              showToast(mutationOutcomeMessage("Servicios generados.", await loadSources()));
            }}
          />
        </Modal>
      )}
      {setlistRole && (() => {
        const r = setlistRole;
        const type = r._type === "sunday_role" ? "sunday" : r._type === "saturday_role" ? "saturday" : "special";
        const week = r.date.slice(0, 10);
        const title = `Setlist — ${SERVICE_LABEL[r._type]} ${new Date(week + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })}`;
        return (
          <Modal title={title} onClose={() => setSetlistRole(null)} wide>
            <SetlistEditor
              week={week}
              type={type}
              roleId={type === "special" ? r._id : undefined}
              onClose={() => setSetlistRole(null)}
              onSaved={async () => {
                setSetlistRole(null);
                showToast(mutationOutcomeMessage("Setlist guardado.", await loadSources()));
              }}
            />
          </Modal>
        );
      })()}
    </div>
  );
}

/**
 * Footer of a publish / override / unpublish confirmation. When the outcome of a
 * submission is UNKNOWN (a lost or timed-out response) the confirm button is
 * replaced by a read-only verification: the panel never replays a mutation
 * automatically, and never closes as success.
 */
function PublicationFooter({
  onClose,
  onConfirm,
  onVerify,
  confirmLabel,
  loading,
  disabled,
  unknownOutcome,
  danger,
}: {
  onClose: () => void;
  onConfirm: () => void;
  onVerify: () => void;
  confirmLabel: string;
  loading: boolean;
  disabled?: boolean;
  unknownOutcome?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={onClose}
        className="min-h-[44px] flex-1 rounded-lg border border-[#003572]/30 px-3 font-label text-xs uppercase tracking-widest transition-colors hover:border-[#00bfff] dark:border-[#00bfff]/20"
      >
        Cancelar
      </button>
      {unknownOutcome ? (
        <button
          type="button"
          onClick={onVerify}
          disabled={loading}
          className="min-h-[44px] flex-1 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 font-label text-xs uppercase tracking-widest text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
        >
          {loading ? "Verificando..." : "Verificar resultado"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading || disabled}
          className={`min-h-[44px] flex-1 rounded-lg px-3 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50 ${
            danger
              ? "bg-orange-600/70 hover:bg-orange-600"
              : "bg-[#003572] hover:bg-[#003572]/80 dark:bg-[#00bfff]/20 dark:hover:bg-[#00bfff]/30"
          }`}
        >
          {loading ? "Guardando..." : confirmLabel}
        </button>
      )}
    </div>
  );
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="font-label text-[11px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#003572]/10 dark:bg-[#00bfff]/10 text-gray-500 whitespace-nowrap">{children}</span>;
}

function fmtYM(ym: string) {
  return new Date(ym + "-01T12:00:00").toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
}

function MonthPill({ label, selected, onClick, past }: { label: string; selected: boolean; onClick: () => void; past?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-label text-[11px] uppercase tracking-widest px-2.5 py-1 rounded-full border transition-colors ${
        selected
          ? "border-[#00bfff]/60 bg-[#00bfff]/15 text-[#00bfff]"
          : past
          ? "border-[#00bfff]/10 text-gray-600 hover:border-[#00bfff]/30 hover:text-gray-400"
          : "border-[#00bfff]/20 text-gray-400 hover:border-[#00bfff]/40 hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );
}

function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
}

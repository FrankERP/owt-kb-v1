"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import MonthGenerator from "./MonthGenerator";

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceType = "sunday_role" | "saturday_role" | "special_role";

interface MemberOption { _id: string; member_name: string; alias?: string; memberType?: string[]; unavailableDates?: string[]; }

const dn = (m: MemberOption) => m.alias?.trim() || m.member_name;

interface InstrumentSlot { id: string; instrument: string; personId: string; }
interface FohSlot         { id: string; role: string; personId: string; }

interface SetlistSong {
  play_key: string;
  song: { _id: string; title: string; author: string; key: string; slug: string };
}

interface ServiceRole {
  _id: string;
  _type: ServiceType;
  date: string;
  service_name?: string;
  leads:       MemberOption[];
  bgvs:        MemberOption[];
  chorus:      MemberOption[];
  instruments: { instrument: string; person: MemberOption | null }[];
  foh:         { role: string;       person: MemberOption | null }[];
  songs?: SetlistSong[];
}

// ─── Setlist types ────────────────────────────────────────────────────────────

import { SetlistEditor, SongResult, SetlistEntry } from "./SetlistEditor";

// ─── Swap types ───────────────────────────────────────────────────────────────

type SwapSource =
  | { kind: "card"; roleId: string }
  | { kind: "member"; roleId: string; section: "leads" | "bgvs" | "chorus"; index: number; member: MemberOption }
  | { kind: "slot";   roleId: string; section: "instruments" | "foh";        index: number; member: MemberOption | null; slotLabel: string };

type SwapConfirm =
  | { kind: "card"; roleA: ServiceRole; roleB: ServiceRole }
  | { kind: "member"; source: Exclude<SwapSource, { kind: "card" }>; target: Exclude<SwapSource, { kind: "card" }>; sourceRole: ServiceRole; targetRole: ServiceRole };

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_LABEL: Record<ServiceType, string> = {
  sunday_role: "Domingo", saturday_role: "Sábado", special_role: "Especial",
};
const SERVICE_BADGE: Record<ServiceType, string> = {
  sunday_role:   "bg-orange-500/15 text-orange-400 border border-orange-500/30",
  saturday_role: "bg-yellow-500/15 text-yellow-400 border border-yellow-400/30",
  special_role:  "bg-[#00bfff]/15 text-[#00bfff] border border-[#00bfff]/30",
};

const SECTION_LABEL: Record<string, string> = {
  leads: "Líder", bgvs: "BGV", chorus: "Coro", instruments: "Instrumento", foh: "FOH",
};

const inputCls  = "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-transparent font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";
const selectCls = "w-full px-3 py-2 rounded-lg border border-[#00bfff]/20 bg-[#0a1929] font-body text-sm focus:outline-none focus:border-[#00bfff] transition-colors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid    = () => Math.random().toString(36).slice(2, 9);
const isPast = (iso: string) => iso < new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });

function formatDate(iso: string) {
  return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function roleToPatchPayload(role: ServiceRole) {
  return {
    _type: role._type,
    date: role.date,
    service_name: role.service_name,
    leads:  (role.leads  ?? []).map(m => m._id),
    bgvs:   (role.bgvs   ?? []).map(m => m._id),
    chorus: (role.chorus ?? []).map(m => m._id),
    instruments: (role.instruments ?? []).filter(s => s.person).map(s => ({ instrument: s.instrument, personId: s.person!._id })),
    foh: (role.foh ?? []).filter(s => s.person).map(s => ({ role: s.role, personId: s.person!._id })),
  };
}

function swapCardTeams(a: ServiceRole, b: ServiceRole): [ServiceRole, ServiceRole] {
  return [
    { ...a, leads: b.leads ?? [], bgvs: b.bgvs ?? [], chorus: b.chorus ?? [], instruments: b.instruments ?? [], foh: b.foh ?? [] },
    { ...b, leads: a.leads ?? [], bgvs: a.bgvs ?? [], chorus: a.chorus ?? [], instruments: a.instruments ?? [], foh: a.foh ?? [] },
  ];
}

function getMemberAt(role: ServiceRole, src: Exclude<SwapSource, { kind: "card" }>): MemberOption | null {
  if (src.kind === "member") return (role[src.section] ?? [])[src.index] ?? null;
  return (role[src.section] ?? [])[src.index]?.person ?? null;
}

function setMemberAt(role: ServiceRole, src: Exclude<SwapSource, { kind: "card" }>, member: MemberOption | null): ServiceRole {
  if (src.kind === "member") {
    const arr = [...((role[src.section] as MemberOption[]) ?? [])];
    if (member) arr[src.index] = member; else arr.splice(src.index, 1);
    return { ...role, [src.section]: arr };
  }
  const arr = [...((role[src.section] as any[]) ?? [])];
  arr[src.index] = { ...arr[src.index], person: member };
  return { ...role, [src.section]: arr };
}

function computeMemberSwap(roles: ServiceRole[], source: Exclude<SwapSource, { kind: "card" }>, target: Exclude<SwapSource, { kind: "card" }>): ServiceRole[] {
  if (source.roleId === target.roleId) {
    let role = { ...(roles.find(r => r._id === source.roleId)!) };
    const mA = getMemberAt(role, source);
    const mB = getMemberAt(role, target);
    role = setMemberAt(role, source, mB);
    role = setMemberAt(role, target, mA);
    return roles.map(r => r._id === source.roleId ? role : r);
  }
  const srcRole = roles.find(r => r._id === source.roleId)!;
  const tgtRole = roles.find(r => r._id === target.roleId)!;
  const mA = getMemberAt(srcRole, source);
  const mB = getMemberAt(tgtRole, target);
  const newSrc = setMemberAt({ ...srcRole }, source, mB);
  const newTgt = setMemberAt({ ...tgtRole }, target, mA);
  return roles.map(r => {
    if (r._id === source.roleId) return newSrc;
    if (r._id === target.roleId) return newTgt;
    return r;
  });
}

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
      {selected.length > 0 && <p className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]">{selected.length} seleccionado{selected.length > 1 ? "s" : ""}</p>}
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

function ServiceForm({ initial, members, onSubmit, onClose, loading }: {
  initial?: ServiceRole; members: MemberOption[];
  onSubmit: (d: any) => void; onClose: () => void; loading: boolean;
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

  function buildData() {
    return { _type: type, date, service_name: serviceName, leads, bgvs, chorus,
      instruments: instruments.filter(s => s.instrument && s.personId),
      foh: foh.filter(s => s.role && s.personId) };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
          <input className={inputCls} type="date" value={date} onChange={e => setDate(e.target.value)} required />
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
          <p className="font-label text-[10px] uppercase tracking-widest text-orange-400">No disponibles el {fmtServiceDate}</p>
          <p className="font-body text-sm text-gray-300">
            <span className="text-orange-300">{unavailableNames.join(", ")}</span>
            {unavailableNames.length === 1 ? " ha" : " han"} marcado este día como no disponible.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setPendingData(null); setUnavailableNames([]); }}
              className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">
              Revisar
            </button>
            <button type="button" onClick={() => onSubmit(pendingData)} disabled={loading}
              className="flex-1 py-2 rounded-lg bg-orange-600/70 hover:bg-orange-600 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">
              {loading ? "Guardando..." : "Confirmar de todos modos"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 pt-1 sticky bottom-0 bg-[#C8D8EB] dark:bg-[#0a1929] py-2">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">Cancelar</button>
          <button type="submit" disabled={loading} className="flex-1 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">{loading ? "Guardando..." : "Guardar"}</button>
        </div>
      )}
    </form>
  );
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 w-full ${wide ? "max-w-2xl" : "max-w-lg"} bg-[#C8D8EB] dark:bg-[#0a1929] border border-[#003572]/20 dark:border-[#00bfff]/20 rounded-xl shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg uppercase tracking-wide">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-[#00bfff] transition-colors text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Member chip for swap mode ────────────────────────────────────────────────

function MemberChip({ name, isSource, isTarget, onClick }: {
  name: string; isSource: boolean; isTarget: boolean; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border transition-all ${
        isSource ? "bg-[#00bfff]/30 text-[#00bfff] border-[#00bfff] ring-1 ring-[#00bfff]/50 scale-105" :
        isTarget ? "bg-[#00bfff]/10 text-[#00bfff] border-[#00bfff]/50 animate-pulse" :
        onClick   ? "bg-[#003572]/10 dark:bg-[#00bfff]/10 text-gray-400 border-[#003572]/20 dark:border-[#00bfff]/20 hover:bg-[#00bfff]/20 hover:text-[#00bfff] hover:border-[#00bfff]/40 cursor-pointer" :
                    "bg-[#003572]/10 dark:bg-[#00bfff]/10 text-gray-400 border-[#003572]/20 dark:border-[#00bfff]/20"
      }`}
    >
      {name}
    </button>
  );
}

// ─── Setlist editor ───────────────────────────────────────────────────────────

// ─── DayCard-style service card ───────────────────────────────────────────────

const CARD_HEADER: Record<ServiceType, string> = {
  sunday_role:   "bg-[#003572] dark:bg-[#001f3f] border-[#002249] dark:border-[#00bfff]",
  saturday_role: "bg-[#78350f] dark:bg-[#1c0800] border-[#92400e] dark:border-[#f59e0b]",
  special_role:  "bg-[#4c1d95] dark:bg-[#1e0a3c] border-[#5b21b6] dark:border-[#a78bfa]",
};
const CARD_BORDER: Record<ServiceType, string> = {
  sunday_role:   "border-[#003572] dark:border-[#00bfff]",
  saturday_role: "border-[#78350f] dark:border-[#f59e0b]",
  special_role:  "border-[#4c1d95] dark:border-[#a78bfa]",
};
const CARD_ACCENT: Record<ServiceType, string> = {
  sunday_role:   "text-[#00bfff]",
  saturday_role: "text-[#f59e0b]",
  special_role:  "text-[#a78bfa]",
};
const CARD_ACCENT_MUTED: Record<ServiceType, string> = {
  sunday_role:   "text-[#00bfff]/70",
  saturday_role: "text-[#f59e0b]/70",
  special_role:  "text-[#a78bfa]/70",
};
const CARD_DIVIDER: Record<ServiceType, string> = {
  sunday_role:   "bg-[#00bfff]/20",
  saturday_role: "bg-[#f59e0b]/20",
  special_role:  "bg-[#a78bfa]/20",
};
const CARD_ACCENT_HEX: Record<ServiceType, string> = {
  sunday_role:   "#00bfff",
  saturday_role: "#f59e0b",
  special_role:  "#a78bfa",
};

function ServiceCard({ role, onEdit, onDelete, onSetlist, swapMode, swapSource, onCardSwapSelect, onMemberChipClick }: {
  role: ServiceRole; onEdit: () => void; onDelete: () => void; onSetlist: () => void;
  swapMode: boolean; swapSource: SwapSource | null;
  onCardSwapSelect: () => void;
  onMemberChipClick: (src: Exclude<SwapSource, { kind: "card" }>) => void;
}) {
  const past    = isPast(role.date);
  const leads   = role.leads       ?? [];
  const bgvs    = role.bgvs        ?? [];
  const chorus  = role.chorus      ?? [];
  const instrs  = role.instruments ?? [];
  const foh     = role.foh         ?? [];
  const songs   = role.songs       ?? [];

  const isCardSelected = swapSource?.kind === "card" && swapSource.roleId === role._id;
  const isChipSource   = (section: string, i: number) =>
    swapSource && swapSource.kind !== "card" && swapSource.roleId === role._id &&
    swapSource.section === section && swapSource.index === i;

  const hasTeam    = !!(leads.length || bgvs.length || chorus.length || instrs.filter(s => s.person).length || foh.filter(s => s.person).length);
  const hasSetlist = songs.length > 0;

  return (
    <div className={`rounded-xl border overflow-hidden transition-all shadow-md ${
      past && !swapMode
        ? `${CARD_BORDER[role._type]} opacity-50`
        : isCardSelected
          ? `${CARD_BORDER[role._type]} ring-2 ring-[#00bfff]/40`
          : CARD_BORDER[role._type]
    } group`}>

      {/* ── Colored header band ── */}
      <div className={`${CARD_HEADER[role._type]} border-b px-4 py-3 flex items-start justify-between gap-2`}>
        <div>
          <h3 className="font-display text-xl md:text-2xl uppercase font-bold text-[#C8D8EB]">
            {role.service_name || SERVICE_LABEL[role._type]}
          </h3>
          <p className="font-label text-xs text-[#C8D8EB]/60 capitalize mt-0.5">
            {new Date(role.date.slice(0,10) + "T12:00:00").toLocaleDateString("es-ES", {
              weekday: "long", day: "numeric", month: "long", year: "numeric",
            })}
          </p>
        </div>

        {/* Action buttons or swap button */}
        {swapMode ? (
          <button
            type="button"
            onClick={onCardSwapSelect}
            title="Intercambiar equipo completo"
            className={`mt-0.5 px-2.5 py-1.5 rounded-lg font-label text-xs transition-colors shrink-0 ${
              isCardSelected
                ? "bg-white/20 text-white border border-white/40"
                : "text-[#C8D8EB]/70 hover:text-white hover:bg-white/15 border border-transparent"
            }`}
          >
            ⇄ Equipo
          </button>
        ) : (
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
            <HeaderBtn title="Setlist" onClick={onSetlist}><MusicIcon /></HeaderBtn>
            <HeaderBtn title="Editar" onClick={onEdit}><PencilIcon /></HeaderBtn>
            <HeaderBtn title="Eliminar" onClick={onDelete} danger><TrashIcon /></HeaderBtn>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="p-4 space-y-4">

        {/* Setlist */}
        {hasSetlist && (
          <section>
            <SectionHead label="Setlist" accent={CARD_ACCENT_MUTED[role._type]} divider={CARD_DIVIDER[role._type]} />
            <ol className="space-y-2 mt-2">
              {songs.map((entry, i) => (
                <li key={entry.song._id} className="flex items-start gap-2">
                  <span className="text-gray-500 text-sm w-5 shrink-0 mt-0.5">{i + 1}.</span>
                  <div>
                    <span className="font-body text-sm font-semibold">{entry.song.title}</span>
                    <span className="text-gray-500 text-sm"> — {entry.song.author}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`font-label text-xs font-semibold ${CARD_ACCENT[role._type]}`}>
                        {entry.play_key || entry.song.key}
                      </span>
                      {entry.play_key && entry.song.key && entry.play_key !== entry.song.key && (
                        <span className="font-label text-[10px] px-1.5 py-0.5 rounded border border-gray-700 bg-gray-800/60 text-gray-500 leading-tight">
                          orig. {entry.song.key}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Team */}
        {hasTeam && !swapMode && (
          <section className={hasSetlist ? `border-t pt-4 border-gray-200 dark:border-gray-800` : ""}>
            <p className="font-label text-xs uppercase tracking-widest text-gray-500 text-center mb-1">Equipo</p>
            <div className="mt-2 space-y-3">
              {(leads.length || bgvs.length || chorus.length) ? (
                <div>
                  <SectionHead label="Líderes" accent={CARD_ACCENT_MUTED[role._type]} divider={CARD_DIVIDER[role._type]} />
                  <div className="grid grid-cols-3 gap-x-3 mt-2">
                    <VocalCol label="Lead" names={leads.map(m => dn(m))} />
                    <VocalCol label="BGVs" names={bgvs.map(m => dn(m))} />
                    <VocalCol label="Coro" names={chorus.map(m => dn(m))} />
                  </div>
                </div>
              ) : null}
              {instrs.filter(s => s.person).length > 0 && (
                <div>
                  <SectionHead label="Instrumentos" accent={CARD_ACCENT_MUTED[role._type]} divider={CARD_DIVIDER[role._type]} />
                  <div className="grid grid-cols-2 gap-x-2 gap-y-2 mt-2">
                    {instrs.filter(s => s.person).map((s, i) => (
                      <TeamRow key={i} label={s.instrument} value={dn(s.person!)} accentHex={CARD_ACCENT_HEX[role._type]} />
                    ))}
                  </div>
                </div>
              )}
              {foh.filter(s => s.person).length > 0 && (
                <div>
                  <SectionHead label="Front of House" accent={CARD_ACCENT_MUTED[role._type]} divider={CARD_DIVIDER[role._type]} />
                  <div className="grid grid-cols-2 gap-x-2 gap-y-2 mt-2">
                    {foh.filter(s => s.person).map((s, i) => (
                      <TeamRow key={i} label={s.role} value={dn(s.person!)} accentHex={CARD_ACCENT_HEX[role._type]} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Swap mode: member chips */}
        {swapMode && (
          <div className="space-y-2">
            {([ ["leads", leads, "Líderes"], ["bgvs", bgvs, "BGVs"], ["chorus", chorus, "Coro"] ] as const).map(([section, arr, lbl]) => (
              arr.length > 0 && (
                <div key={section} className="flex items-start gap-2 flex-wrap">
                  <span className="font-label text-[9px] uppercase tracking-widest text-gray-600 pt-0.5 shrink-0 w-12">{lbl}</span>
                  <div className="flex flex-wrap gap-1">
                    {arr.map((m, i) => (
                      <MemberChip
                        key={m._id}
                        name={dn(m)}
                        isSource={!!isChipSource(section, i)}
                        isTarget={false}
                        onClick={swapSource?.kind === "card" ? undefined : () => onMemberChipClick({ kind: "member", roleId: role._id, section, index: i, member: m })}
                      />
                    ))}
                  </div>
                </div>
              )
            ))}
            {([ ["instruments", instrs, "Instr."], ["foh", foh, "FOH"] ] as const).map(([section, arr, lbl]) => (
              arr.length > 0 && (
                <div key={section} className="flex items-start gap-2 flex-wrap">
                  <span className="font-label text-[9px] uppercase tracking-widest text-gray-600 pt-0.5 shrink-0 w-12">{lbl}</span>
                  <div className="flex flex-wrap gap-1">
                    {arr.map((s, i) => s.person && (
                      <MemberChip
                        key={i}
                        name={`${dn(s.person)}${section === "instruments" ? ` · ${(s as any).instrument}` : ` · ${(s as any).role}`}`}
                        isSource={!!isChipSource(section, i)}
                        isTarget={false}
                        onClick={swapSource?.kind === "card" ? undefined : () => onMemberChipClick({ kind: "slot", roleId: role._id, section, index: i, member: s.person, slotLabel: (s as any).instrument ?? (s as any).role })}
                      />
                    ))}
                  </div>
                </div>
              )
            ))}
            {!hasTeam && <p className="font-body text-xs text-gray-600 italic">Sin miembros asignados</p>}
          </div>
        )}

        {!hasTeam && !hasSetlist && (
          <p className="font-body text-xs text-gray-600 italic">Sin información todavía.</p>
        )}
      </div>
    </div>
  );
}

function SectionHead({ label, accent, divider }: { label: string; accent: string; divider: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`font-label text-xs uppercase tracking-wide ${accent} shrink-0`}>{label}</span>
      <div className={`flex-1 h-px ${divider}`} />
    </div>
  );
}

function VocalCol({ label, names }: { label: string; names: string[] }) {
  if (!names.length) return <div />;
  return (
    <div>
      <p className="font-label text-[10px] uppercase tracking-widest text-gray-400 mb-0.5">{label}</p>
      <p className="font-body text-sm leading-snug">{names.join(", ")}</p>
    </div>
  );
}

function TeamRow({ label, value, accentHex }: { label: string; value: string; accentHex: string }) {
  return (
    <div
      className="flex items-stretch rounded-lg overflow-hidden"
      style={{ border: `1px solid ${accentHex}40` }}
    >
      <span
        className="font-label text-xs uppercase tracking-wide px-2.5 flex items-center shrink-0 rounded-l-[7px]"
        style={{
          background: `${accentHex}18`,
          color: accentHex,
          borderRight: `1px solid ${accentHex}30`,
        }}
      >
        {label}
      </span>
      <span className="font-body text-sm px-3 py-1.5 flex flex-1 items-center justify-center leading-tight">
        {value}
      </span>
    </div>
  );
}

function HeaderBtn({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg transition-colors ${danger ? "hover:bg-red-500/25 hover:text-red-300 text-[#C8D8EB]/60" : "hover:bg-white/15 hover:text-white text-[#C8D8EB]/60"}`}
    >
      {children}
    </button>
  );
}

// ─── Swap confirm modal ───────────────────────────────────────────────────────

function AvailabilityWarning({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2.5 space-y-1">
      <p className="font-label text-[10px] uppercase tracking-widest text-orange-400">No disponibles</p>
      {lines.map((l, i) => <p key={i} className="font-body text-xs text-gray-400">{l}</p>)}
    </div>
  );
}

function SwapConfirmModal({ confirm, onConfirm, onClose, loading, members }: {
  confirm: SwapConfirm; onConfirm: () => void; onClose: () => void; loading: boolean; members: MemberOption[];
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
                <span className={`font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full ${SERVICE_BADGE[role._type]}`}>{SERVICE_LABEL[role._type]}</span>
                {idx === 0 && <span className="font-label text-[10px] text-[#00bfff]">→ Recibe equipo B</span>}
                {idx === 1 && <span className="font-label text-[10px] text-[#00bfff]">→ Recibe equipo A</span>}
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
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={loading} className={`flex-1 py-2 rounded-lg font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50 ${warnLines.length > 0 ? "bg-orange-600/70 hover:bg-orange-600" : "bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30"}`}>{loading ? "Intercambiando..." : "Confirmar intercambio"}</button>
        </div>
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
          <p className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]">{srcLabel}</p>
          <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">{formatDate(sourceRole.date)}</p>
        </div>
        <span className="text-2xl text-gray-500 shrink-0">⇄</span>
        <div className="flex-1 text-center rounded-lg border border-[#00bfff]/20 p-3 space-y-1">
          <p className="font-body text-sm font-semibold">{tgtName}</p>
          <p className="font-label text-[10px] uppercase tracking-widest text-[#00bfff]">{tgtLabel}</p>
          <p className="font-label text-[10px] uppercase tracking-widest text-gray-500">{formatDate(targetRole.date)}</p>
        </div>
      </div>
      <AvailabilityWarning lines={warnLines} />
      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">Cancelar</button>
        <button type="button" onClick={onConfirm} disabled={loading} className={`flex-1 py-2 rounded-lg font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50 ${warnLines.length > 0 ? "bg-orange-600/70 hover:bg-orange-600" : "bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30"}`}>{loading ? "Intercambiando..." : "Confirmar"}</button>
      </div>
    </Modal>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function ServicesPanel() {
  const [roles, setRoles]       = useState<ServiceRole[]>([]);
  const [members, setMembers]   = useState<MemberOption[]>([]);
  const [loading, setLoading]   = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [showPastMonths, setShowPastMonths] = useState(false);
  const [toast, setToast]       = useState<string | null>(null);

  // Edit / delete modal
  type EditModal = { type: "add" } | { type: "edit"; role: ServiceRole } | { type: "delete"; role: ServiceRole } | null;
  const [editModal, setEditModal] = useState<EditModal>(null);

  // Month generator
  const [showGenerator, setShowGenerator] = useState(false);

  // Setlist
  const [setlistRole, setSetlistRole] = useState<ServiceRole | null>(null);

  // Swap mode
  const [swapMode, setSwapMode]     = useState(false);
  const [swapSource, setSwapSource] = useState<SwapSource | null>(null);
  const [swapConfirm, setSwapConfirm] = useState<SwapConfirm | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [r, m] = await Promise.all([fetch("/api/admin/roles"), fetch("/api/admin/members")]);
    if (r.ok) setRoles(await r.json());
    if (m.ok) setMembers(await m.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Create / Edit / Delete ────────────────────────────────────────────────

  const handleAdd = async (data: any) => {
    setSubmitting(true);
    const res = await fetch("/api/admin/roles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    setSubmitting(false);
    if (res.ok) { setEditModal(null); fetchData(); showToast("Servicio creado."); }
    else showToast("Error al crear.");
  };

  const handleEdit = async (data: any) => {
    if (editModal?.type !== "edit") return;
    setSubmitting(true);
    const res = await fetch(`/api/admin/roles/${editModal.role._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    setSubmitting(false);
    if (res.ok) { setEditModal(null); fetchData(); showToast("Actualizado."); }
    else showToast("Error al actualizar.");
  };

  const handleDelete = async () => {
    if (editModal?.type !== "delete") return;
    setSubmitting(true);
    const res = await fetch(`/api/admin/roles/${editModal.role._id}`, { method: "DELETE" });
    setSubmitting(false);
    if (res.ok) { setEditModal(null); fetchData(); showToast("Eliminado."); }
    else showToast("Error al eliminar.");
  };

  // ── Swap logic ────────────────────────────────────────────────────────────

  function handleCardSwapSelect(roleId: string) {
    if (!swapSource) { setSwapSource({ kind: "card", roleId }); return; }
    if (swapSource.kind !== "card") return;
    if (swapSource.roleId === roleId) { setSwapSource(null); return; }
    const roleA = roles.find(r => r._id === swapSource.roleId)!;
    const roleB = roles.find(r => r._id === roleId)!;
    setSwapConfirm({ kind: "card", roleA, roleB });
  }

  function handleMemberChipClick(src: Exclude<SwapSource, { kind: "card" }>) {
    if (!swapSource) { setSwapSource(src); return; }
    if (swapSource.kind === "card") return;
    // Deselect if same chip
    if (swapSource.roleId === src.roleId && swapSource.section === src.section && swapSource.index === src.index) {
      setSwapSource(null); return;
    }
    const sourceRole = roles.find(r => r._id === swapSource.roleId)!;
    const targetRole = roles.find(r => r._id === src.roleId)!;
    setSwapConfirm({ kind: "member", source: swapSource as any, target: src, sourceRole, targetRole });
  }

  async function confirmSwap() {
    if (!swapConfirm) return;
    setSubmitting(true);
    if (swapConfirm.kind === "card") {
      const [newA, newB] = swapCardTeams(swapConfirm.roleA, swapConfirm.roleB);
      await Promise.all([
        fetch(`/api/admin/roles/${swapConfirm.roleA._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(roleToPatchPayload(newA)) }),
        fetch(`/api/admin/roles/${swapConfirm.roleB._id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(roleToPatchPayload(newB)) }),
      ]);
    } else {
      const newRoles = computeMemberSwap(roles, swapConfirm.source, swapConfirm.target);
      const ids = [...new Set([swapConfirm.source.roleId, swapConfirm.target.roleId])];
      await Promise.all(ids.map(id => {
        const role = newRoles.find(r => r._id === id)!;
        return fetch(`/api/admin/roles/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(roleToPatchPayload(role)) });
      }));
    }
    setSubmitting(false);
    setSwapConfirm(null);
    setSwapSource(null);
    fetchData();
    showToast("Intercambio realizado.");
  }

  function exitSwapMode() { setSwapMode(false); setSwapSource(null); setSwapConfirm(null); }

  // ── Render ────────────────────────────────────────────────────────────────

  const today = new Date().toLocaleDateString("sv", { timeZone: "America/Mexico_City" });

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

  // No filter selected → show upcoming only (default).  Months selected → show exactly those.
  const visible = selectedMonths.size === 0
    ? roles.filter(r => r.date >= today)
    : roles.filter(r => selectedMonths.has(r.date.slice(0, 7)));

  const upcoming = roles.filter(r => r.date >= today);
  const past     = roles.filter(r => r.date < today);

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">Servicios</h1>
          {!loading && (
            <p className="font-label text-xs uppercase tracking-widest text-gray-500 mt-0.5">
              {upcoming.length} próximo{upcoming.length !== 1 ? "s" : ""}
              {past.length > 0 && ` · ${past.length} pasado${past.length !== 1 ? "s" : ""}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Swap mode toggle */}
          <button
            onClick={() => swapMode ? exitSwapMode() : setSwapMode(true)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border font-label text-xs uppercase tracking-widest transition-colors ${
              swapMode ? "border-[#00bfff] bg-[#00bfff]/10 text-[#00bfff]" : "border-[#003572]/20 dark:border-[#00bfff]/15 text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff]/30"
            }`}
          >
            ⇄ {swapMode ? "Salir" : "Intercambiar"}
          </button>
          <button onClick={() => setShowGenerator(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#003572]/20 dark:border-[#00bfff]/15 font-label text-xs uppercase tracking-widest text-gray-500 hover:text-[#00bfff] hover:border-[#00bfff]/30 transition-colors">
            📅 Generar mes
          </button>
          {!swapMode && (
            <button onClick={() => setEditModal({ type: "add" })} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#003572] dark:bg-[#00bfff]/20 hover:bg-[#003572]/80 dark:hover:bg-[#00bfff]/30 font-label text-xs uppercase tracking-widest transition-colors">
              <span className="text-base leading-none">+</span> Nuevo
            </button>
          )}
        </div>
      </div>

      {/* Month filter */}
      {!loading && allMonths.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-label text-[10px] uppercase tracking-widest text-gray-600 shrink-0">Mes:</span>
            <MonthPill label="Próximos" selected={selectedMonths.size === 0} onClick={() => setSelectedMonths(new Set())} />
            {futureMonths.map(ym => (
              <MonthPill key={ym} label={fmtYM(ym)} selected={selectedMonths.has(ym)} onClick={() => toggleMonth(ym)} />
            ))}
            {pastMonths.length > 0 && (
              <button
                type="button"
                onClick={() => setShowPastMonths(v => !v)}
                className="font-label text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border border-[#00bfff]/10 text-gray-600 hover:border-[#00bfff]/25 hover:text-gray-400 transition-colors flex items-center gap-1"
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
            <button onClick={() => setSwapSource(null)} className="font-label text-[10px] uppercase tracking-widest text-gray-500 hover:text-red-400 transition-colors ml-4 shrink-0">
              Cancelar selección
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-[#003572]/10 dark:bg-[#00bfff]/5 animate-pulse" />)}</div>}

      {/* Grid */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 items-start">
          {upcoming.length === 0 && selectedMonths.size === 0 && (
            <p className="font-body text-sm text-gray-500 text-center py-12">No hay servicios próximos.</p>
          )}
          {visible.map(role => (
            <ServiceCard
              key={role._id}
              role={role}
              onEdit={() => setEditModal({ type: "edit", role })}
              onDelete={() => setEditModal({ type: "delete", role })}
              onSetlist={() => setSetlistRole(role)}
              swapMode={swapMode}
              swapSource={swapSource}
              onCardSwapSelect={() => handleCardSwapSelect(role._id)}
              onMemberChipClick={handleMemberChipClick}
            />
          ))}
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
        <Modal title="Nuevo servicio" onClose={() => setEditModal(null)}>
          <ServiceForm members={members} onSubmit={handleAdd} onClose={() => setEditModal(null)} loading={submitting} />
        </Modal>
      )}
      {editModal?.type === "edit" && (
        <Modal title="Editar servicio" onClose={() => setEditModal(null)}>
          <ServiceForm initial={editModal.role} members={members} onSubmit={handleEdit} onClose={() => setEditModal(null)} loading={submitting} />
        </Modal>
      )}
      {editModal?.type === "delete" && (
        <Modal title="Eliminar servicio" onClose={() => setEditModal(null)}>
          <p className="font-body text-sm text-gray-400">¿Eliminar el servicio del <span className="text-red-400 font-semibold">{formatDate(editModal.role.date)}</span>? Esta acción no se puede deshacer.</p>
          <div className="flex gap-3">
            <button onClick={() => setEditModal(null)} className="flex-1 py-2 rounded-lg border border-[#003572]/30 dark:border-[#00bfff]/20 font-label text-xs uppercase tracking-widest hover:border-[#00bfff] transition-colors">Cancelar</button>
            <button onClick={handleDelete} disabled={submitting} className="flex-1 py-2 rounded-lg bg-red-800/60 hover:bg-red-700/60 font-label text-xs uppercase tracking-widest transition-colors disabled:opacity-50">{submitting ? "Eliminando..." : "Eliminar"}</button>
          </div>
        </Modal>
      )}
      {swapConfirm && (
        <SwapConfirmModal confirm={swapConfirm} onConfirm={confirmSwap} onClose={() => { setSwapConfirm(null); setSwapSource(null); }} loading={submitting} members={members} />
      )}
      {showGenerator && (
        <Modal title="Generar mes" onClose={() => setShowGenerator(false)} wide>
          <MonthGenerator members={members} existingRoles={roles} onClose={() => setShowGenerator(false)} onCreated={() => { fetchData(); showToast("Servicios generados."); }} />
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
              onClose={() => { setSetlistRole(null); fetchData(); showToast("Setlist guardado."); }}
            />
          </Modal>
        );
      })()}
    </div>
  );
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="font-label text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#003572]/10 dark:bg-[#00bfff]/10 text-gray-500 whitespace-nowrap">{children}</span>;
}

function fmtYM(ym: string) {
  return new Date(ym + "-01T12:00:00").toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
}

function MonthPill({ label, selected, onClick, past }: { label: string; selected: boolean; onClick: () => void; past?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-label text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border transition-colors ${
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

function ActionBtn({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className={`p-1.5 rounded-lg transition-colors ${danger ? "hover:bg-red-500/20 hover:text-red-400 text-gray-500" : "hover:bg-[#00bfff]/10 hover:text-[#00bfff] text-gray-500"}`}>
      {children}
    </button>
  );
}

function PencilIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
}

function MusicIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>;
}

function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
}

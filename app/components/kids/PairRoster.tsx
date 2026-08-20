"use client";

import { useState } from "react";
import { KIDS_ROOMS, KIDS_SEAT_LABELS, type KidsRoom } from "@/app/utils/kidsTypes";
import { useTransientValue } from "@/app/utils/useTransientValue";

export interface RosterPair {
  id: string;
  name: string;
  room: KidsRoom;
  active: boolean;
  memberIds: string[];
}

export interface RosterMember {
  _id: string;
  member_name: string;
  alias?: string;
}

interface Props {
  initialPairs: RosterPair[];
  initialMembers: RosterMember[];
}

type Toast = { kind: "ok" | "error"; text: string } | null;

const errText = (err: unknown) => (err instanceof Error ? err.message : "error desconocido");

const displayName = (member: RosterMember) => member.alias?.trim() || member.member_name;

export default function PairRoster({ initialPairs, initialMembers }: Props) {
  const [pairs, setPairs] = useState<RosterPair[]>(initialPairs);
  // Kids members come from `/api/kids/members`, NEVER `/api/admin/members`:
  // that one is worship-admin gated and a Kids manager gets a 403 from it.
  const [members] = useState<RosterMember[]>(initialMembers);

  const [name, setName] = useState("");
  const [room, setRoom] = useState<KidsRoom>(KIDS_ROOMS[0]);
  const [memberA, setMemberA] = useState("");
  const [memberB, setMemberB] = useState("");

  const [creating, setCreating] = useState(false);
  const [busyPair, setBusyPair] = useState<string | null>(null);
  const [confirmRetire, setConfirmRetire] = useState<string | null>(null);
  const [toast, showToast] = useTransientValue<Toast>(null, 5000);

  const memberName = (id: string) => {
    const member = members.find((m) => m._id === id);
    return member ? displayName(member) : "—";
  };

  async function refreshPairs() {
    const res = await fetch("/api/kids/pairs");
    if (!res.ok) throw new Error(`respuesta ${res.status}`);
    setPairs((await res.json()) as RosterPair[]);
  }

  const canCreate =
    name.trim().length > 0 && !!memberA && !!memberB && memberA !== memberB && !creating;

  async function createPair() {
    setCreating(true);
    try {
      const res = await fetch("/api/kids/pairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), room, memberIds: [memberA, memberB] }),
      });
      if (!res.ok) throw new Error(`respuesta ${res.status}`);
      await refreshPairs();
      setName("");
      setMemberA("");
      setMemberB("");
      showToast({ kind: "ok", text: "Pareja creada." });
    } catch (err) {
      // The form keeps what was typed: a failed create that also empties the
      // fields makes the admin retype everything to find out it was a blip.
      showToast({ kind: "error", text: `No se pudo crear la pareja — ${errText(err)}` });
    } finally {
      setCreating(false);
    }
  }

  async function patchPair(id: string, body: Record<string, unknown>, okText: string) {
    setBusyPair(id);
    try {
      const res = await fetch(`/api/kids/pairs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`respuesta ${res.status}`);
      await refreshPairs();
      showToast({ kind: "ok", text: okText });
    } catch (err) {
      showToast({ kind: "error", text: `No se pudo actualizar la pareja — ${errText(err)}` });
    } finally {
      setBusyPair(null);
      setConfirmRetire(null);
    }
  }

  return (
    <div className="space-y-5">
      {toast && (
        <p
          role="status"
          className={`rounded-xl border px-4 py-2 font-body text-sm ${
            toast.kind === "ok"
              ? "border-positive-deep/25 bg-positive-deep/5 text-positive-strong"
              : "border-negative-strong/25 bg-negative-strong/5 text-negative-fg"
          }`}
        >
          {toast.text}
        </p>
      )}

      {/* Create */}
      <div className="space-y-3 rounded-xl border border-accent/15 bg-surface-accent-wash p-4">
        <h3 className="font-label text-xs uppercase tracking-widest text-mono-500">Nueva pareja</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor="kids-pair-name"
              className="block font-label text-[11px] uppercase tracking-widest text-mono-500"
            >
              Nombre
            </label>
            <input
              id="kids-pair-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ana y Luis"
              className="w-full rounded-lg border border-surface-accent-l40-d20 bg-surface-lift/5 px-3 py-2 font-body text-sm text-ink placeholder:text-placeholder focus:border-accent/50 focus:outline-none dark:focus:border-surface-accent-l40-d20"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="kids-pair-room"
              className="block font-label text-[11px] uppercase tracking-widest text-mono-500"
            >
              Sala
            </label>
            <select
              id="kids-pair-room"
              value={room}
              onChange={(e) => setRoom(e.target.value as KidsRoom)}
              className="w-full rounded-lg border border-surface-accent-l40-d20 bg-surface-lift/5 px-3 py-2 font-body text-sm text-ink focus:border-accent/50 focus:outline-none dark:focus:border-surface-accent-l40-d20"
            >
              {KIDS_ROOMS.map((r) => (
                <option key={r} value={r} className="bg-surface-base">
                  {KIDS_SEAT_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          {(
            [
              ["kids-pair-member-a", "Integrante 1", memberA, setMemberA, memberB],
              ["kids-pair-member-b", "Integrante 2", memberB, setMemberB, memberA],
            ] as const
          ).map(([id, label, value, setValue, other]) => (
            <div key={id} className="space-y-1">
              <label
                htmlFor={id}
                className="block font-label text-[11px] uppercase tracking-widest text-mono-500"
              >
                {label}
              </label>
              <select
                id={id}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full rounded-lg border border-surface-accent-l40-d20 bg-surface-lift/5 px-3 py-2 font-body text-sm text-ink focus:border-accent/50 focus:outline-none dark:focus:border-surface-accent-l40-d20"
              >
                <option value="" className="bg-surface-base">
                  — Elegir —
                </option>
                {members.map((member) => (
                  <option
                    key={member._id}
                    value={member._id}
                    disabled={member._id === other}
                    className="bg-surface-base"
                  >
                    {displayName(member)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={createPair}
          disabled={!canCreate}
          className="min-h-[44px] rounded-lg bg-surface-accent-solid px-4 font-label text-xs uppercase tracking-widest text-on-fill transition-colors disabled:opacity-40"
        >
          {creating ? "Creando…" : "Crear pareja"}
        </button>
        {members.length === 0 && (
          <p className="font-body text-xs text-warning-strong">
            Todavía no hay miembros de Oasis Kids. Asígnales el ministerio desde el panel de equipo
            antes de armar parejas.
          </p>
        )}
      </div>

      {/* Roster, grouped by room */}
      {KIDS_ROOMS.map((r) => {
        const roomPairs = pairs.filter((pair) => pair.room === r);
        return (
          <div key={r} className="space-y-2">
            <h3 className="font-label text-xs uppercase tracking-widest text-mono-500">
              {KIDS_SEAT_LABELS[r]} · {roomPairs.filter((p) => p.active).length} activa(s)
            </h3>
            {roomPairs.length === 0 ? (
              <p className="font-body text-sm text-mono-500">Sin parejas en esta sala.</p>
            ) : (
              <ul className="space-y-2">
                {roomPairs.map((pair) => (
                  <li
                    key={pair.id}
                    className={`space-y-2 rounded-xl border px-4 py-3 ${
                      pair.active
                        ? "border-accent/15 bg-surface-accent-wash"
                        : "border-mono-700/30 bg-surface-sunken"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-body text-sm font-semibold text-ink">
                          {pair.name}
                          {!pair.active && (
                            <span className="ml-2 font-label text-[11px] uppercase tracking-widest text-mono-500">
                              Retirada
                            </span>
                          )}
                        </p>
                        <p className="font-body text-xs text-mono-500">
                          {pair.memberIds.map(memberName).join(" · ")}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor={`kids-pair-room-${pair.id}`} className="sr-only">
                          Sala de {pair.name}
                        </label>
                        <select
                          id={`kids-pair-room-${pair.id}`}
                          value={pair.room}
                          onChange={(e) =>
                            patchPair(pair.id, { room: e.target.value }, "Sala actualizada.")
                          }
                          disabled={busyPair === pair.id}
                          className="rounded-lg border border-surface-accent-l40-d20 bg-surface-lift/5 px-3 py-2 font-body text-sm text-ink focus:border-accent/50 focus:outline-none disabled:opacity-40 dark:focus:border-surface-accent-l40-d20"
                        >
                          {KIDS_ROOMS.map((option) => (
                            <option key={option} value={option} className="bg-surface-base">
                              {KIDS_SEAT_LABELS[option]}
                            </option>
                          ))}
                        </select>
                        {pair.active ? (
                          <button
                            type="button"
                            onClick={() => setConfirmRetire(pair.id)}
                            disabled={busyPair === pair.id}
                            className="min-h-[44px] rounded-lg border border-negative-strong/25 px-3 font-label text-xs uppercase tracking-widest text-negative-fg/80 transition-colors hover:border-negative-strong/40 hover:text-negative-fg disabled:opacity-40"
                          >
                            Retirar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              patchPair(pair.id, { active: true }, "Pareja reactivada.")
                            }
                            disabled={busyPair === pair.id}
                            className="min-h-[44px] rounded-lg border border-accent/25 px-3 font-label text-xs uppercase tracking-widest text-accent transition-colors hover:border-accent disabled:opacity-40"
                          >
                            Reactivar
                          </button>
                        )}
                      </div>
                    </div>

                    {confirmRetire === pair.id && (
                      <div className="space-y-2 rounded-lg border border-warning-fg/30 bg-warning-fg/10 px-3 py-2">
                        <p className="font-body text-xs text-warning-soft">
                          {pair.name} saldrá de todas las rotaciones futuras. Su historial se
                          conserva y puedes reactivarla después.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              patchPair(pair.id, { active: false }, "Pareja retirada.")
                            }
                            disabled={busyPair === pair.id}
                            className="min-h-[44px] rounded-lg bg-surface-accent-solid px-3 font-label text-xs uppercase tracking-widest text-on-fill disabled:opacity-40"
                          >
                            {busyPair === pair.id ? "Retirando…" : "Confirmar"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRetire(null)}
                            className="min-h-[44px] rounded-lg border border-accent/20 px-3 font-label text-xs uppercase tracking-widest text-mono-500"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

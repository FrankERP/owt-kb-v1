"use client";

import { useState } from "react";
import { KIDS_ROOMS, KIDS_SEAT_LABELS, type KidsRoom } from "@/app/utils/kidsTypes";
import Select from "@/app/components/ui/Select";
import Button from "@/app/components/ui/Button";
import AnimatedList from "@/app/components/ui/AnimatedList";
import Presence from "@/app/components/ui/Presence";
import { useToast } from "@/app/components/ui/Toast";

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

const errText = (err: unknown) => (err instanceof Error ? err.message : "error desconocido");

const displayName = (member: RosterMember) => member.alias?.trim() || member.member_name;

interface PairRowProps {
  pair: RosterPair;
  memberName: (id: string) => string;
  busyPair: string | null;
  confirmRetire: string | null;
  setConfirmRetire: (id: string | null) => void;
  patchPair: (id: string, body: Record<string, unknown>, okText: string) => Promise<void>;
}

function PairRow({ pair, memberName, busyPair, confirmRetire, setConfirmRetire, patchPair }: PairRowProps) {
  return (
    <div
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
          <Select
            aria-label={`Sala de ${pair.name}`}
            value={pair.room}
            onChange={(e) => patchPair(pair.id, { room: e.target.value }, "Sala actualizada.")}
            disabled={busyPair === pair.id}
          >
            {KIDS_ROOMS.map((option) => (
              <option key={option} value={option} className="bg-surface-base">
                {KIDS_SEAT_LABELS[option]}
              </option>
            ))}
          </Select>
          {pair.active ? (
            <Button
              variant="danger"
              size="lg"
              onClick={() => setConfirmRetire(pair.id)}
              disabled={busyPair === pair.id}
            >
              Retirar
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="lg"
              onClick={() => patchPair(pair.id, { active: true }, "Pareja reactivada.")}
              disabled={busyPair === pair.id}
            >
              Reactivar
            </Button>
          )}
        </div>
      </div>

      <Presence
        show={confirmRetire === pair.id}
        variant="rise"
        className="space-y-2 rounded-lg border border-warning-fg/30 bg-warning-fg/10 px-3 py-2"
      >
        <p className="font-body text-xs text-warning-soft">
          {pair.name} saldrá de todas las rotaciones futuras. Su historial se conserva y puedes
          reactivarla después.
        </p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="lg"
            onClick={() => patchPair(pair.id, { active: false }, "Pareja retirada.")}
            disabled={busyPair === pair.id}
            busy={busyPair === pair.id}
            busyLabel="Retirando…"
          >
            Confirmar
          </Button>
          <Button variant="ghost" size="lg" onClick={() => setConfirmRetire(null)}>
            Cancelar
          </Button>
        </div>
      </Presence>
    </div>
  );
}

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
  const { toast } = useToast();

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
      toast({ message: "Pareja creada.", tone: "ok" });
    } catch (err) {
      // The form keeps what was typed: a failed create that also empties the
      // fields makes the admin retype everything to find out it was a blip.
      toast({ message: `No se pudo crear la pareja — ${errText(err)}`, tone: "error" });
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
      toast({ message: okText, tone: "ok" });
    } catch (err) {
      toast({ message: `No se pudo actualizar la pareja — ${errText(err)}`, tone: "error" });
    } finally {
      setBusyPair(null);
      setConfirmRetire(null);
    }
  }

  return (
    <div className="space-y-5">
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
            <Select
              id="kids-pair-room"
              label="Sala"
              value={room}
              onChange={(e) => setRoom(e.target.value as KidsRoom)}
            >
              {KIDS_ROOMS.map((r) => (
                <option key={r} value={r} className="bg-surface-base">
                  {KIDS_SEAT_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          {(
            [
              ["kids-pair-member-a", "Integrante 1", memberA, setMemberA, memberB],
              ["kids-pair-member-b", "Integrante 2", memberB, setMemberB, memberA],
            ] as const
          ).map(([id, label, value, setValue, other]) => (
            <div key={id} className="space-y-1">
              <Select id={id} label={label} value={value} onChange={(e) => setValue(e.target.value)}>
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
              </Select>
            </div>
          ))}
        </div>
        <Button variant="primary" size="lg" onClick={createPair} disabled={!canCreate} busy={creating} busyLabel="Creando…">
          Crear pareja
        </Button>
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
              <AnimatedList
                as="ul"
                className="space-y-2"
                items={roomPairs.map((pair) => ({
                  key: pair.id,
                  node: (
                    <PairRow
                      pair={pair}
                      memberName={memberName}
                      busyPair={busyPair}
                      confirmRetire={confirmRetire}
                      setConfirmRetire={setConfirmRetire}
                      patchPair={patchPair}
                    />
                  ),
                }))}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

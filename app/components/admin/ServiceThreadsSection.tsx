"use client";

// «Mensaje antes de la propuesta» — the admin's way to write about a service
// whose leads have not created its setlist proposal yet (ADR-0064). The typical
// message is what the pastor shared about that Sunday, which the leads want
// BEFORE they choose songs.
//
// Collapsed by default and LAZY: the list is fetched the first time it opens,
// so an ordinary visit to Propuestas costs no extra Sanity read, and the
// panel's own suites (which stub one list endpoint) see no second fetch.
//
// One picker plus one thread, not a card per service: the next two months hold
// some twenty services, and twenty composers would bury the proposals below.

import { useId, useState } from "react";
import Button from "@/app/components/ui/Button";
import Collapse from "@/app/components/ui/Collapse";
import Select from "@/app/components/ui/Select";
import Skeleton from "@/app/components/ui/Skeleton";
import ProposalThread, { type ThreadMessage } from "@/app/components/ProposalThread";

export interface ServiceThreadRow {
  _id: string;
  _type: "sunday_role" | "saturday_role" | "special_role";
  service_date: string;
  service_name?: string | null;
  published?: boolean | null;
  leads?: Array<{ id?: string | null; name?: string | null }> | null;
  messages?: ThreadMessage[] | null;
}

const TYPE_LABEL: Record<ServiceThreadRow["_type"], string> = {
  sunday_role: "Domingo",
  saturday_role: "Sábado",
  special_role: "Especial",
};

/** "Dom 26 oct" — the stored date rendered at local noon, never a bare `new Date(iso)`. */
function shortDate(iso: string): string {
  const day = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(day.getTime())) return iso;
  return day.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
}

/** The picker's line for one service. Exported for the unit test. */
export function serviceThreadOption(row: ServiceThreadRow): string {
  const name = row._type === "special_role" && row.service_name ? row.service_name : TYPE_LABEL[row._type];
  const count = row.messages?.length ?? 0;
  const parts = [`${name} · ${shortDate(row.service_date)}`];
  if (count > 0) parts.push(count === 1 ? "1 mensaje" : `${count} mensajes`);
  if (row.published === false) parts.push("sin publicar");
  return parts.join(" — ");
}

export default function ServiceThreadsSection({ viewerId = null }: { viewerId?: string | null }) {
  const bodyId = useId();
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ServiceThreadRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/admin/service-threads");
      if (!res.ok) throw new Error("load failed");
      const data: ServiceThreadRow[] = await res.json();
      const list = Array.isArray(data) ? data : [];
      setRows(list);
      setSelectedId((current) => (list.some((r) => r._id === current) ? current : (list[0]?._id ?? "")));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && rows === null && !loading) void load();
  }

  /**
   * Post, then patch THAT ONE ROW from the response — never a reload, which would
   * reset the picker. `messages: null` means the post landed but the read-back
   * did not: keep what is on screen. Rethrows so the composer keeps its text.
   */
  async function post(roleId: string, body: string) {
    const res = await fetch(`/api/admin/service-threads/${encodeURIComponent(roleId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error("post failed");
    const data: { messages?: ThreadMessage[] | null } = await res.json();
    setRows((current) =>
      (current ?? []).map((r) => (r._id === roleId ? { ...r, messages: data.messages ?? r.messages } : r)),
    );
  }

  const selected = rows?.find((r) => r._id === selectedId) ?? null;
  const leadNames = (selected?.leads ?? []).map((l) => l?.name).filter((n): n is string => !!n);

  return (
    <section className="rounded-lg border border-accent/15 bg-surface-raised-alt/40 p-1.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full justify-between"
      >
        Mensaje antes de la propuesta
        <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 transition-transform duration-fast ${open ? "rotate-180" : ""}`}>
          <path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>
      <Collapse id={bodyId} open={open} className="space-y-3 px-1.5 pb-1.5 pt-2">
        <p className="font-body text-sm text-mono-400">
          Para un servicio que aún no tiene propuesta, por ejemplo lo que compartió el pastor. Los
          líderes lo ven al abrir su propuesta, y sigue en la misma conversación cuando la creen.
        </p>

        {loading && <Skeleton className="h-24 w-full" rounded="lg" />}

        {error && !loading && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-body text-sm text-negative-fg">No se pudieron cargar los servicios.</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Reintentar
            </Button>
          </div>
        )}

        {!loading && !error && rows !== null && rows.length === 0 && (
          <p className="font-body text-sm text-mono-500">Todos los servicios próximos ya tienen propuesta.</p>
        )}

        {!loading && !error && rows !== null && rows.length > 0 && (
          <div className="space-y-3">
            <Select id={selectId} label="Servicio" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {rows.map((r) => (
                <option key={r._id} value={r._id}>
                  {serviceThreadOption(r)}
                </option>
              ))}
            </Select>

            {selected && (
              <div className="space-y-3 rounded-lg border border-edge-accent-subtle px-3 py-3">
                <p className="font-body text-sm text-mono-400">
                  {leadNames.length > 0 ? `Líderes: ${leadNames.join(", ")}` : "Este servicio aún no tiene líder."}
                </p>
                {selected.published === false && (
                  <p className="font-body text-xs text-mono-500">
                    Este servicio aún no está publicado: los líderes verán el mensaje cuando se publique.
                  </p>
                )}
                <ProposalThread
                  key={selected._id}
                  messages={selected.messages}
                  viewerId={viewerId}
                  viewerRole="admin"
                  title="Conversación con los líderes"
                  serviceDate={selected.service_date}
                  onPost={(body) => post(selected._id, body)}
                />
              </div>
            )}
          </div>
        )}
      </Collapse>
    </section>
  );
}

"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { PAGE_LEDE, PAGE_TITLE } from "@/app/utils/homeHero";
import { plural } from "@/app/utils/plural";
import Collapse from "@/app/components/ui/Collapse";
import Button from "@/app/components/ui/Button";
import NumberRoll from "@/app/components/ui/NumberRoll";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import Skeleton, { SkeletonGroup } from "@/app/components/ui/Skeleton";

interface LoginEvent {
  _id: string;
  timestamp: string;
  provider: string;
}

interface MemberActivity {
  _id: string;
  member_name: string;
  alias?: string;
  photoUrl?: string | null;
  lastSeen: string | null;
  lastLogin: string | null;
  lastActive: string | null;
  loginCount: number;
  providers: string[];
  events: LoginEvent[];
}

const PROVIDER_LABEL: Record<string, string> = {
  google:      "Google",
  credentials: "Email",
  azure:       "Microsoft",
};

/** The accesses an open row lists before «Ver los N». */
const HISTORY_PREVIEW = 4;

type Scope = "all" | "active" | "inactive";

const now = () => Date.now();

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((now() - new Date(iso).getTime()) / 86_400_000);
}

// Calendar-day difference (local), so "Hoy"/"Ayer" reflect the actual date
// rather than elapsed hours — an 11pm login viewed at 6am is "Ayer", not "Hoy".
function calendarDaysAgo(iso: string): number {
  const then = new Date(iso);
  const thenMid = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const n = new Date();
  const nowMid = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((nowMid.getTime() - thenMid.getTime()) / 86_400_000);
}

type StatusKey = "active" | "recent" | "inactive" | "never";

/**
 * The row's state as a dot and a WORD (the Servicios pattern): the colour says
 * it to the eye, the word to everyone else, so no `sr-only` stand-in is needed.
 */
const STATUS: Record<StatusKey, { label: string; dot: string; text: string }> = {
  active:   { label: "Activo",        dot: "bg-positive-deep",      text: "text-positive-strong" },
  recent:   { label: "Reciente",      dot: "bg-recency-fg",         text: "text-recency-fg" },
  inactive: { label: "Inactivo",      dot: "bg-negative-strong/70", text: "text-negative-fg" },
  never:    { label: "Sin actividad", dot: "bg-mono-600",           text: "text-ink-dim" },
};

function statusOf(lastActive: string | null): StatusKey {
  const days = daysSince(lastActive);
  if (days === null) return "never";
  if (days <= 7)     return "active";
  if (days <= 30)    return "recent";
  return "inactive";
}

/** «Hoy 9:14», «Ayer», «Hace 3 días», then the date. */
function formatDate(iso: string) {
  const days = calendarDaysAgo(iso);
  if (days === 0) return `Hoy ${new Date(iso).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" })}`;
  if (days === 1) return "Ayer";
  if (days >= 2 && days <= 6) return `Hace ${days} días`;
  return new Date(iso).toLocaleDateString("es-ES", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** The name the list shows for a member: the alias when there is one. */
const displayName = (m: MemberActivity) => m.alias?.trim() || m.member_name;

function Avatar({ name, photoUrl }: { name: string; photoUrl?: string | null }) {
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-surface-accent-l100-d10 text-on-fill">
          <span className="font-label text-sm text-accent">{initials}</span>
        </div>
      )}
    </div>
  );
}

export default function ActivityPanel() {
  const [activity, setActivity] = useState<MemberActivity[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scope, setScope]       = useState<Scope>("all");
  const [fullHistory, setFullHistory] = useState<string | null>(null);

  // `res.ok` is checked BEFORE parsing, and the payload's shape after it. The
  // route answers a lapsed session with `{ error: "Forbidden" }` and status 403
  // — valid JSON, so `.catch` never fired, `activity` became that object, and
  // the unguarded `activity.filter(...)` two lines below threw during render.
  // That unmounts the whole /admin tree to the error boundary: a blank page
  // instead of "Error al cargar actividad."
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/admin/login-events")
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const body = await r.json();
        if (!Array.isArray(body)) throw new Error("shape");
        return body;
      })
      .then(setActivity)
      .catch(() => setError("Error al cargar actividad."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeThisWeek  = activity.filter((m) => (daysSince(m.lastActive) ?? 999) <= 7).length;
  const activeThisMonth = activity.filter((m) => (daysSince(m.lastActive) ?? 999) <= 30).length;
  const neverActive     = activity.filter((m) => !m.lastActive).length;
  // «Inactivos» is everyone the month did not see — the never-seen included:
  // the filter exists to find who has not come in, and both answer that.
  const inactive        = activity.length - activeThisMonth;

  const visible = useMemo(() => {
    if (scope === "active") return activity.filter((m) => (daysSince(m.lastActive) ?? 999) <= 7);
    if (scope === "inactive") return activity.filter((m) => (daysSince(m.lastActive) ?? 999) > 30);
    return activity;
  }, [activity, scope]);

  if (loading) {
    return (
      <SkeletonGroup label="Cargando actividad" className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" rounded="lg" />
        ))}
      </SkeletonGroup>
    );
  }

  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm text-negative-fg bg-negative-surface-deep/20 border border-negative-surface rounded-xl px-4 py-3">
        <span>{error}</span>
        {/* A dead end is not a state: the retry calls the same loader the effect does. */}
        <Button variant="ghost" size="sm" onClick={load}>Reintentar</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className={PAGE_TITLE}>Actividad</h1>
        {/* The three counts ARE the lede (the Admin pass, ADR-0070): no stat tiles.
            Each number rolls in place when a reload moves it. */}
        <p className={`mt-2 ${PAGE_LEDE}`}>
          <span className="text-ink"><NumberRoll value={activeThisWeek} /> activos esta semana</span>
          {" · "}<NumberRoll value={activeThisMonth} /> este mes
          {" · "}<NumberRoll value={neverActive} /> sin entrar
        </p>
        <p className="mt-2 font-body text-sm text-ink-muted">
          De {plural(activity.length, "persona", "personas")} con acceso. Activo = entró en los últimos 7 días; reciente, en los últimos 30.
        </p>
      </div>

      <SegmentedControl
        label="Filtrar por actividad"
        tone="filled"
        size="sm"
        className="w-fit"
        value={scope}
        onChange={setScope}
        options={[
          { value: "all", label: `Todos · ${activity.length}` },
          { value: "active", label: `Activos · ${activeThisWeek}` },
          { value: "inactive", label: `Inactivos · ${inactive}` },
        ]}
      />

      {/* Member list: hairline rows, one per person (ADR-0070). */}
      <div className="border-t border-ink/[0.10]">
        {visible.length === 0 && (
          <p className="py-12 text-center font-body text-base text-ink-muted">Nadie en este filtro.</p>
        )}
        {visible.map((m) => {
          const status = STATUS[statusOf(m.lastActive)];
          const hasDetail = m.loginCount > 0 || !!m.lastSeen;
          const open = expanded === m._id;
          const name = displayName(m);
          const events = fullHistory === m._id ? m.events : m.events.slice(0, HISTORY_PREVIEW);
          return (
            <div key={m._id} data-activity-row="">
              <button
                type="button"
                onClick={() => hasDetail && setExpanded(open ? null : m._id)}
                aria-expanded={hasDetail ? open : undefined}
                aria-controls={hasDetail ? `activity-${m._id}` : undefined}
                className={`flex min-h-[68px] w-full items-center gap-3.5 py-2.5 text-left ${open ? "" : "border-b border-ink/[0.10]"} ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
              >
                <Avatar name={name} photoUrl={m.photoUrl} />

                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-body text-[17px] font-semibold leading-tight text-ink">{name}</span>
                    {m.alias?.trim() && (
                      <span className="hidden truncate font-body text-sm text-ink-muted sm:inline">{m.member_name}</span>
                    )}
                  </span>
                  <span className="mt-1 block truncate font-body text-sm leading-tight text-ink-muted">
                    {m.lastActive ? formatDate(m.lastActive) : "Nunca ha entrado"}
                    {m.loginCount > 0 && <> · {plural(m.loginCount, "acceso", "accesos")}</>}
                  </span>
                </span>

                <span className={`flex shrink-0 items-center gap-1.5 font-body text-sm ${status.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
                  {status.label}
                </span>

                {hasDetail ? (
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                    className={`shrink-0 text-ink-dim transition-transform duration-base ${open ? "rotate-180" : ""}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                ) : (
                  <span className="w-4 shrink-0" aria-hidden="true" />
                )}
              </button>

              {hasDetail && (
                <Collapse
                  open={open}
                  id={`activity-${m._id}`}
                  className="space-y-5 border-b border-ink/[0.10] pb-5 pt-1 sm:pl-[58px]"
                >
                  <div className="grid grid-cols-2 gap-4 sm:max-w-[540px]">
                    <div>
                      <p className="font-label text-[10px] uppercase tracking-widest text-ink-dim">Última visita</p>
                      <p className="mt-1 font-body text-sm text-ink">{m.lastSeen ? formatDateTime(m.lastSeen) : "—"}</p>
                    </div>
                    <div>
                      <p className="font-label text-[10px] uppercase tracking-widest text-ink-dim">Último inicio de sesión</p>
                      <p className="mt-1 font-body text-sm text-ink">{m.lastLogin ? formatDateTime(m.lastLogin) : "—"}</p>
                    </div>
                  </div>

                  {m.events.length > 0 && (
                    <div className="sm:max-w-[540px]">
                      <p className="font-label text-[11px] uppercase tracking-widest text-ink-muted">
                        Historial de accesos · {m.loginCount}
                      </p>
                      {/* The provider as a quiet word, not a coloured badge: which door
                          they came in by is a fact, not a state. */}
                      <ul className="mt-1.5 border-t border-ink/[0.10]">
                        {events.map((e) => (
                          <li key={e._id} className="flex min-h-[40px] items-center justify-between gap-4 border-b border-ink/[0.10] font-body text-sm">
                            <span className="text-ink">{formatDateTime(e.timestamp)}</span>
                            <span className="text-ink-muted">{PROVIDER_LABEL[e.provider] ?? e.provider}</span>
                          </li>
                        ))}
                      </ul>
                      {m.events.length > HISTORY_PREVIEW && fullHistory !== m._id && (
                        <Button variant="ghost" size="sm" className="mt-2 -ml-3 text-accent" onClick={() => setFullHistory(m._id)}>
                          Ver los {m.events.length}
                        </Button>
                      )}
                    </div>
                  )}
                </Collapse>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

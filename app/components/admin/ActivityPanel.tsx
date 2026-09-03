"use client";

import { useState, useEffect } from "react";

interface LoginEvent {
  _id: string;
  timestamp: string;
  provider: string;
}

interface MemberActivity {
  _id: string;
  member_name: string;
  alias?: string;
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

function activityStatus(lastActive: string | null): { color: string; label: string } {
  const days = daysSince(lastActive);
  if (days === null)  return { color: "bg-mono-700",      label: "Sin actividad" };
  if (days <= 7)      return { color: "bg-positive-deep",     label: "Activo" };
  if (days <= 30)     return { color: "bg-recency-fg",    label: "Reciente" };
  return               { color: "bg-negative-strong/70",          label: "Inactivo" };
}

function formatDate(iso: string) {
  const days = calendarDaysAgo(iso);
  if (days === 0) return "Hoy";
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

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full bg-surface-accent-l100-d10 text-on-fill flex items-center justify-center shrink-0">
      <span className="font-label text-xs text-accent">{initials}</span>
    </div>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    google:      "bg-negative-strong/15 text-negative-fg border-negative-strong/30",
    credentials: "bg-positive-deep/15 text-positive-strong border-positive-deep/30",
    azure:       "bg-badge-azure-deep/15 text-badge-azure-fg border-badge-azure-deep/30",
  };
  return (
    <span className={`font-label text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${colors[provider] ?? "bg-mono-500/15 text-mono-400 border-mono-500/30"}`}>
      {PROVIDER_LABEL[provider] ?? provider}
    </span>
  );
}

export default function ActivityPanel() {
  const [activity, setActivity] = useState<MemberActivity[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // `res.ok` is checked BEFORE parsing, and the payload's shape after it. The
  // route answers a lapsed session with `{ error: "Forbidden" }` and status 403
  // — valid JSON, so `.catch` never fired, `activity` became that object, and
  // the unguarded `activity.filter(...)` two lines below threw during render.
  // That unmounts the whole /admin tree to the error boundary: a blank page
  // instead of "Error al cargar actividad."
  useEffect(() => {
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

  const activeThisWeek  = activity.filter((m) => (daysSince(m.lastActive) ?? 999) <= 7).length;
  const activeThisMonth = activity.filter((m) => (daysSince(m.lastActive) ?? 999) <= 30).length;
  const neverActive     = activity.filter((m) => !m.lastActive).length;

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-surface-accent-wash animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-negative-fg bg-negative-surface-deep/20 border border-negative-surface rounded-xl px-4 py-3">{error}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Activos esta semana",  value: activeThisWeek,  dot: "bg-positive-deep"  },
          { label: "Activos este mes",     value: activeThisMonth, dot: "bg-recency-fg" },
          { label: "Sin actividad",        value: neverActive,     dot: "bg-mono-600"   },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-edge-accent-subtle bg-accent/5 px-4 py-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <span className={`w-2 h-2 rounded-full shrink-0 ${stat.dot}`} />
              <p className="font-display text-2xl leading-none">{stat.value}</p>
            </div>
            <p className="font-label text-[10px] uppercase tracking-widest text-mono-500">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Member list */}
      <div className="space-y-2">
        {activity.map((m) => {
          const status = activityStatus(m.lastActive);
          return (
            <div key={m._id} className="rounded-xl border border-edge-accent-subtle overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === m._id ? null : m._id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent-deep/5 dark:hover:bg-accent/5 transition-colors text-left"
              >
                <Avatar name={m.member_name} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-body text-sm font-semibold">{m.member_name}</span>
                    {m.alias?.trim() && (
                      <span className="font-label text-[11px] uppercase tracking-widest text-accent/70">&ldquo;{m.alias}&rdquo;</span>
                    )}
                  </div>
                  <p className="font-label text-[11px] uppercase tracking-widest text-mono-500 mt-0.5">
                    {m.lastActive
                      ? `Última actividad: ${formatDate(m.lastActive)}`
                      : "Sin actividad registrada"}
                  </p>
                </div>

                {/* Status dot + label */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`w-2 h-2 rounded-full ${status.color}`} aria-hidden="true" />
                  {/*
                    The label is `hidden sm:inline`, so on a phone the dot was
                    the ONLY thing separating Activo from Inactivo — and a
                    screen reader got nothing at any width. `sr-only` carries it
                    without changing the mobile layout.
                  */}
                  <span className="sr-only">{status.label}</span>
                  <span className="font-label text-[10px] uppercase tracking-widest text-mono-500 hidden sm:inline" aria-hidden="true">
                    {status.label}
                  </span>
                </div>

                {/* Chevron */}
                {(m.loginCount > 0 || m.lastSeen) && (
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className={`text-mono-500 shrink-0 transition-transform ${expanded === m._id ? "rotate-180" : ""}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                )}
              </button>

              {/* Expanded detail */}
              {expanded === m._id && (
                <div className="border-t border-accent/10 px-4 py-3 space-y-3 bg-accent/[0.04]">
                  {/* Last seen vs last login */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="font-label text-[10px] uppercase tracking-widest text-mono-600 mb-0.5">Última visita</p>
                      <p className="font-body text-xs">
                        {m.lastSeen ? formatDateTime(m.lastSeen) : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="font-label text-[10px] uppercase tracking-widest text-mono-600 mb-0.5">Último inicio de sesión</p>
                      <p className="font-body text-xs">
                        {m.lastLogin ? formatDateTime(m.lastLogin) : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Login history */}
                  {m.events.length > 0 && (
                    <div>
                      <p className="font-label text-[10px] uppercase tracking-widest text-mono-600 mb-1.5">
                        Historial de accesos ({m.loginCount})
                      </p>
                      <div className="space-y-1">
                        {m.events.map((e) => (
                          <div key={e._id} className="flex items-center justify-between gap-4">
                            <span className="font-body text-xs text-mono-400">{formatDateTime(e.timestamp)}</span>
                            <ProviderBadge provider={e.provider} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

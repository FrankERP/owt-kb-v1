import { requireActiveManager } from "@/app/utils/authGuards";
import { redirect } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import AdminPanel from "@/app/components/admin/AdminPanel";
import { resolveAdminTab } from "@/app/components/admin/adminTabs";

export const metadata = { title: "Admin — Oasis Worship Team" };

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await requireActiveManager();
  if (!session) redirect("/");
  const role = session.user.role as OWTRole;
  // Resolved here rather than in the panel so the server HTML and the first
  // client render agree, and so the role filter runs where the role is known
  // for certain. `resolveAdminTab` lives in a neutral module for the same
  // reason `paintsDayCard` does (ADR-0028).
  const initialTab = resolveAdminTab((await searchParams).tab, role);

  return (
    <>
      <Navbar title="Control Room" tags schedule />
      {/* `brand-admin-frame` is the hook the planner grid's three-column
          workspace widens through (`:has(.planner-wide)` in `app/brand.css`).
          It carries no styling of its own — the Tailwind classes beside it are
          still the default, and every other admin tab keeps the 1280px cap. */}
      <div className="brand-admin-frame mx-auto max-w-7xl px-6 pb-20 pt-10">
        {/* `mx-auto max-w-7xl` on the HEADER, not just on the frame: the frame
            above loses its 1280px cap while the planner is open, and without a
            cap of its own the header stretched to the full 1512 and sat visibly
            off the navbar's centred content. Inside the frame's own 1280px cap
            on every other tab this is a no-op. */}
        <header className="mx-auto mb-8 flex max-w-7xl flex-col gap-5 border-b border-ink-dim/10 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div className="brand-section-heading">
            <p className="font-label text-[10px] uppercase tracking-[0.26em] text-accent">Backstage operations</p>
            <h1 className="mt-2 font-display text-4xl font-semibold leading-none text-ink sm:text-5xl">Control Room</h1>
            <p className="mt-3 max-w-xl font-body text-sm text-ink-dim">
              Servicios, equipo y contenido desde una sola consola.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-positive-fg/20 bg-positive-fg/[0.055] px-3 py-1.5 sm:self-auto">
            <span className="h-1.5 w-1.5 rounded-full bg-positive-fg shadow-[0_0_10px_rgb(var(--positive-fg-rgb)/0.8)]" />
            <span className="font-label text-[10px] uppercase tracking-[0.2em] text-positive-fg/90">Acceso autorizado</span>
          </div>
        </header>
        <div className="brand-admin-shell">
          <AdminPanel role={role} initialTab={initialTab} />
        </div>
      </div>
    </>
  );
}

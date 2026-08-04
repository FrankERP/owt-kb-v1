import { requireActiveManager } from "@/app/utils/authGuards";
import { redirect } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import AdminPanel from "@/app/components/admin/AdminPanel";

export const metadata = { title: "Admin — Oasis Worship Team" };

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";

export default async function AdminPage() {
  const session = await requireActiveManager();
  if (!session) redirect("/");
  const role = session.user.role as OWTRole;

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
        <header className="mx-auto mb-8 flex max-w-7xl flex-col gap-5 border-b border-brand-steel/10 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div className="brand-section-heading">
            <p className="font-label text-[10px] uppercase tracking-[0.26em] text-brand-beam">Backstage operations</p>
            <h1 className="mt-2 font-display text-4xl font-semibold leading-none text-brand-frost sm:text-5xl">Control Room</h1>
            <p className="mt-3 max-w-xl font-body text-sm text-brand-steel/65">
              Servicios, equipo y contenido desde una sola consola.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-brand-signal/20 bg-brand-signal/[0.055] px-3 py-1.5 sm:self-auto">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-signal shadow-[0_0_10px_rgb(var(--brand-signal)/0.8)]" />
            <span className="font-label text-[10px] uppercase tracking-[0.2em] text-brand-signal/80">Acceso autorizado</span>
          </div>
        </header>
        <div className="brand-admin-shell">
          <AdminPanel role={role} />
        </div>
      </div>
    </>
  );
}

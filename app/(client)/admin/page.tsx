import { requireActiveManager } from "@/app/utils/authGuards";
import { redirect } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import AdminPanel from "@/app/components/admin/AdminPanel";
import { resolveAdminTab } from "@/app/components/admin/adminTabs";
import { resolveSolverEngine } from "@/app/utils/solverDeployment";
import { SHEET_TITLE } from "@/app/utils/homeHero";

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
  // Solver v3 C6 ENG-3: the effective engine is THIS deployment's (C2 IF2-14 — the constant, or
  // the Preview-only override on the `preview` branch deployment and locally). Resolved here, on
  // the server, and handed down as a plain string: no client module may read the override.
  const engine = resolveSolverEngine(process.env);
  // Resolved here rather than in the panel so the server HTML and the first
  // client render agree, and so the role filter runs where the role is known
  // for certain. `resolveAdminTab` lives in a neutral module for the same
  // reason `paintsDayCard` does (ADR-0028).
  const tabParam = (await searchParams).tab;
  const initialTab = resolveAdminTab(tabParam, role);
  // Whether the URL NAMED this tab or merely fell back to it. The panel follows
  // the URL only in the first case; see the re-sync in AdminPanel.
  const tabNamedInUrl = typeof tabParam === "string" && tabParam === initialTab;

  return (
    <>
      <Navbar title="Control Room" />
      {/* `brand-admin-frame` is the hook the planner grid's three-column
          workspace widens through (`:has(.planner-wide)` in `app/brand.css`).
          It carries no styling of its own — the Tailwind classes beside it are
          still the default, and every other admin tab keeps the 1280px cap.
          The bordered `.brand-admin-shell` that used to sit inside it is gone
          (ADR-0035): the page IS the workspace, and the panels' own cards are
          the only boxes. */}
      <div className="brand-admin-frame mx-auto max-w-7xl px-6 pb-20 pt-8">
        {/* `mx-auto max-w-7xl` on the HEADING, not just on the frame: the frame
            above loses its 1280px cap while the planner is open, and without a
            cap of its own the header stretched to the full 1512 and sat visibly
            off the navbar's centred content. Inside the frame's own 1280px cap
            on every other tab this is a no-op. */}
        <header className="mx-auto max-w-7xl">
          {/* The TAB is the page title now (phase 5 of the «millones» pass, 2026-10-27):
              each panel renders its own `PAGE_TITLE` h1 («Servicios», «Miembros»…), so
              «Control Room» is a small label on a phone and the rail's title from `lg`
              (`AdminRail`), never two titles stacked. The navbar keeps the name. */}
          <p className={`${SHEET_TITLE} lg:hidden`}>Control Room</p>
        </header>
        <AdminPanel role={role} initialTab={initialTab} tabNamedInUrl={tabNamedInUrl} engine={engine} />
      </div>
    </>
  );
}

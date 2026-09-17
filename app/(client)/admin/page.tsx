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
          (ADR-0037): the page IS the workspace, and the panels' own cards are
          the only boxes. */}
      <div className="brand-admin-frame mx-auto max-w-7xl px-6 pb-20 pt-8">
        {/* `mx-auto max-w-7xl` on the HEADING, not just on the frame: the frame
            above loses its 1280px cap while the planner is open, and without a
            cap of its own the header stretched to the full 1512 and sat visibly
            off the navbar's centred content. Inside the frame's own 1280px cap
            on every other tab this is a no-op. */}
        <header className="mx-auto max-w-7xl">
          <h1 className="font-display text-3xl font-semibold text-ink md:text-4xl">Control Room</h1>
        </header>
        <AdminPanel role={role} initialTab={initialTab} tabNamedInUrl={tabNamedInUrl} />
      </div>
    </>
  );
}

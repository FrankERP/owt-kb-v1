import { redirect } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import SuperAdminPanel from "@/app/components/admin/SuperAdminPanel";
import { requireActiveSession } from "@/app/utils/authGuards";

export const metadata = { title: "Super admin — Backstage" };

/**
 * The church-wide admin: people and which ministries they belong to. It lives
 * outside /admin on purpose — /admin is ALABANZA's admin (`requireActiveManager`
 * reads the worship `role`), and a person who is only in Jóvenes or Kids is not
 * worship's to manage (ADR-0075, Frank 2026-10-29). Each ministry's own admin
 * gets its people later; this page is the super-admin's view of everyone.
 *
 * Super-admin only, by the session role — which is the IMPERSONATED member's
 * while impersonating, so the page closes then. The member routes it calls check
 * the same role themselves; this gate is the screen's, not the data's.
 */
export default async function SuperAdminPage() {
  const session = await requireActiveSession();
  if (!session) redirect("/auth/signin?callbackUrl=%2Fsuper-admin");
  if (session.user.role !== "super-admin") redirect("/");

  return (
    <>
      <Navbar title="Super admin" />
      <div className="mx-auto max-w-7xl px-6 pb-20 pt-8">
        <SuperAdminPanel />
      </div>
    </>
  );
}

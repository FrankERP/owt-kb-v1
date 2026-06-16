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
      <Navbar title="Panel de Admin" tags schedule />
      <div className="px-6 py-8 max-w-7xl mx-auto">
        <AdminPanel role={role} />
      </div>
    </>
  );
}

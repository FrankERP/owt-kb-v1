import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { redirect } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import AdminPanel from "@/app/components/admin/AdminPanel";

export const metadata = { title: "Admin — Oasis Worship Team" };

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";
const ALLOWED: OWTRole[] = ["super-admin", "admin", "content-editor"];

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user.role as OWTRole | undefined;
  if (!role || !ALLOWED.includes(role)) redirect("/");

  return (
    <>
      <Navbar title="Panel de Admin" tags schedule />
      <div className="px-6 py-8 max-w-7xl mx-auto">
        <AdminPanel role={role} />
      </div>
    </>
  );
}

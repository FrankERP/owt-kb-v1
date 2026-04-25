import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { redirect } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import AdminPanel from "@/app/components/admin/AdminPanel";

export const metadata = { title: "Admin — Oasis Worship Team" };

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (session?.user.role !== "super-admin") redirect("/");

  return (
    <>
      <Navbar title="Panel de Admin" />
      <div className="px-6 py-8 max-w-3xl mx-auto">
        <AdminPanel />
      </div>
    </>
  );
}

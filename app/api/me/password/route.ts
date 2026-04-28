import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { serverClient, writeClient } from "@/sanity/lib/serverClient";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.sanityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { currentPassword, newPassword } = await req.json() as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "La nueva contraseña debe tener al menos 8 caracteres." }, { status: 400 });
  }

  const member = await serverClient.fetch<{ passwordHash: string | null } | null>(
    `*[_type == "teamMembers" && _id == $id][0] { passwordHash }`,
    { id: session.user.sanityId }
  );

  if (member?.passwordHash) {
    if (!currentPassword) {
      return NextResponse.json({ error: "Se requiere la contraseña actual." }, { status: 400 });
    }
    const valid = await bcrypt.compare(currentPassword, member.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "La contraseña actual es incorrecta." }, { status: 400 });
    }
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await writeClient.patch(session.user.sanityId).set({ passwordHash: hash }).commit();

  return NextResponse.json({ ok: true });
}

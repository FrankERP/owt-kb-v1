import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { writeClient } from "@/sanity/lib/serverClient";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function hasImageMagicBytes(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const [b0, b1, b2, b3] = [buf[0], buf[1], buf[2], buf[3]];
  const isJpeg = b0 === 0xff && b1 === 0xd8 && b2 === 0xff;
  const isPng  = b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47;
  const isGif  = b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38;
  const isWebp = buf.length >= 12 &&
    b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  return isJpeg || isPng || isGif || isWebp;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.sanityId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("photo") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "La imagen no puede superar 5 MB." }, { status: 413 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: "Solo se permiten JPEG, PNG, WebP y GIF." }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: "La imagen no puede superar 5 MB." }, { status: 413 });
  }
  if (!hasImageMagicBytes(buffer)) {
    return NextResponse.json({ error: "El archivo no es una imagen válida." }, { status: 415 });
  }

  const asset = await writeClient.assets.upload("image", buffer, {
    filename: file.name,
    contentType: file.type,
  });

  await writeClient
    .patch(session.user.sanityId)
    .set({ profilePhoto: { _type: "image", asset: { _type: "reference", _ref: asset._id } } })
    .commit();

  return NextResponse.json({ photoUrl: asset.url });
}

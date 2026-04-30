import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { writeClient } from "@/sanity/lib/serverClient";
import { textToBody } from "@/app/utils/lyrics";

type OWTRole = "super-admin" | "admin" | "content-editor" | "member";
const CONTENT_ROLES: OWTRole[] = ["super-admin", "admin", "content-editor"];
const ADMIN_ROLES: OWTRole[] = ["super-admin", "admin"];

function rng() { return Math.random().toString(36).slice(2, 9); }

async function requireContentRole() {
  const session = await getServerSession(authOptions);
  if (!CONTENT_ROLES.includes(session?.user.role as OWTRole)) return null;
  return session;
}

async function requireAdminRole() {
  const session = await getServerSession(authOptions);
  if (!ADMIN_ROLES.includes(session?.user.role as OWTRole)) return null;
  return session;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireContentRole()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as {
    title?: string;
    author?: string;
    key?: string;
    bpm?: string;
    timeSig?: string;
    lyrics?: string;
    chords?: Array<{ key: string; content: string }>;
    referenceLinks?: Array<{ label: string; url: string }>;
    tutorials?: Array<{ title: string; url: string }>;
    tagIds?: string[];
  };

  const patch: Record<string, unknown> = {};
  if (body.title?.trim())  patch.title  = body.title.trim();
  if (body.author != null) patch.author = body.author.trim();
  if (body.key    != null) patch.key    = body.key.trim();
  if (body.bpm    != null) patch.bpm    = body.bpm ? Number(body.bpm) : null;
  if (body.timeSig != null) patch.timeSig = body.timeSig.trim();
  if (body.lyrics  != null) patch.body  = textToBody(body.lyrics);
  if (body.chords  != null) {
    patch.chords = body.chords.map((c) => ({
      _type: "chord_chart", _key: rng(), key: c.key, content: c.content,
    }));
  }
  if (body.referenceLinks != null) {
    patch.referenceLinks = body.referenceLinks.map((l) => ({
      _type: "referenceLink", _key: rng(), label: l.label, url: l.url,
    }));
  }
  if (body.tutorials != null) {
    patch.tutorials2 = body.tutorials.map((t) => ({
      _type: "tutorial", _key: rng(), title: t.title, url: t.url,
    }));
  }
  if (body.tagIds != null) {
    patch.tags = body.tagIds.map((id) => ({
      _type: "reference", _ref: id, _key: rng(),
    }));
  }

  const doc = await writeClient.patch(id).set(patch).commit();
  return NextResponse.json(doc);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireAdminRole()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await writeClient.delete(id);
  return NextResponse.json({ ok: true });
}

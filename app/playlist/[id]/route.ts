// app/playlist/[id]/route.ts
import { NextResponse } from "next/server";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  // fetch playlist by params.id from your DB
  return NextResponse.json({ id: params.id, name: "My Playlist", items: [] });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  // do creation/update against playlist params.id
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  // delete playlist params.id
  return NextResponse.json({ ok: true });
}

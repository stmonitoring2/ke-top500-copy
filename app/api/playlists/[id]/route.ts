// app/api/playlists/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get the playlist (RLS will enforce visibility/ownership)
  const { data: playlist, error: pErr } = await supabase
    .from("playlists")
    .select("id,name,created_at")
    .eq("id", params.id)
    .single();

  if (pErr || !playlist) {
    return NextResponse.json({ error: pErr?.message || "Not found" }, { status: 404 });
  }

  const { data: items, error: iErr } = await supabase
    .from("playlist_items")
    .select("id,video_id,position,added_at") // add title/thumbnail columns here if present
    .eq("playlist_id", params.id)
    .order("position", { ascending: true });

  if (iErr) {
    return NextResponse.json({ error: iErr.message }, { status: 400 });
  }

  return NextResponse.json({
    id: playlist.id,
    name: playlist.name,
    created_at: playlist.created_at,
    items: (items ?? []).map((it) => ({
      id: it.id,
      videoId: it.video_id,
      position: it.position,
      added_at: it.added_at,
      // thumbnail/title: include if your table has them
    })),
  });
}

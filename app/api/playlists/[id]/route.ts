import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: playlist, error: pErr } = await supabase
    .from("playlists")
    .select("id,name,created_at,owner_id,visibility")
    .eq("id", params.id)
    .single();

  if (pErr || !playlist) {
    return NextResponse.json({ error: pErr?.message || "Not found" }, { status: 404 });
  }

  const { data: items, error: iErr } = await supabase
    .from("playlist_items")
    .select("id,video_id,title,thumbnail_url,position,added_at")
    .eq("playlist_id", params.id)
    .order("position", { ascending: true });

  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 400 });

  return NextResponse.json({
    id: playlist.id,
    name: playlist.name,
    created_at: playlist.created_at,
    items: (items ?? []).map(it => ({
      id: it.id,
      videoId: it.video_id,
      title: it.title || null,
      thumbnail: it.thumbnail_url || null,
      position: it.position,
      added_at: it.added_at
    }))
  });
}

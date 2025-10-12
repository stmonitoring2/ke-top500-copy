import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const videoId = url.searchParams.get("videoId") || "";

  const { data: pls, error } = await supabase
    .from("playlists")
    .select("id,name,created_at")
    .eq("owner_id", session.user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (!videoId) {
    return NextResponse.json({ playlists: pls?.map(p => ({ ...p, hasVideo: false })) ?? [] });
  }

  // Which of my playlists already contain this video?
  const { data: joins, error: jErr } = await supabase
    .from("playlist_items")
    .select("playlist_id")
    .in("playlist_id", (pls ?? []).map(p => p.id))
    .eq("video_id", videoId);

  if (jErr) return NextResponse.json({ error: jErr.message }, { status: 400 });

  const set = new Set((joins ?? []).map(j => j.playlist_id));
  return NextResponse.json({
    playlists: (pls ?? []).map(p => ({ ...p, hasVideo: set.has(p.id) }))
  });
}

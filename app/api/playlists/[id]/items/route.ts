import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { videoId, title, thumbnail } = await req.json();

  if (!videoId || typeof videoId !== "string") {
    return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  }

  // Use RPC that prevents duplicates and can store metadata
  const { data, error } = await supabase.rpc("add_item_if_absent", {
    p_playlist_id: params.id,
    p_video_id: videoId,
    p_title: title ?? null,
    p_thumbnail_url: thumbnail ?? null
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({
    id: data.id,
    videoId: data.video_id,
    title: data.title,
    thumbnail: data.thumbnail_url,
    position: data.position,
    added_at: data.added_at
  });
}

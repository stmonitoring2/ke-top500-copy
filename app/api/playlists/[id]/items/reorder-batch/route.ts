// app/api/playlists/[id]/items/reorder-batch/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { orderedIds } = await req.json();
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json({ error: "orderedIds required" }, { status: 400 });
    }

    const supabase = createRouteHandlerClient({ cookies });

    const { error } = await supabase.rpc("reorder_items", {
      p_playlist_id: params.id,
      p_item_ids: orderedIds,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "reorder_failed" }, { status: 500 });
  }
}

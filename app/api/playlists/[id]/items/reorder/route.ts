// app/api/playlists/[id]/items/reorder/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export const runtime = "nodejs";
export const revalidate = 0;
export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id: playlistId } = params;
    if (!playlistId) {
      return NextResponse.json({ error: "Missing playlist id" }, { status: 400 });
    }

    const { itemId, direction } = await req.json().catch(() => ({}));
    if (!itemId || !direction) {
      return NextResponse.json(
        { error: "itemId and direction are required" },
        { status: 400 }
      );
    }

    if (!["up", "down"].includes(direction)) {
      return NextResponse.json(
        { error: "direction must be 'up' or 'down'" },
        { status: 400 }
      );
    }

    const supabase = createRouteHandlerClient({ cookies });

    // Require a signed-in user (clearer 401 than relying on RLS error)
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Sanity check: the item belongs to this playlist (and you must be allowed to see it via RLS)
    const { data: itemRow, error: itemErr } = await supabase
      .from("playlist_items")
      .select("id, playlist_id")
      .eq("id", itemId)
      .single();

    if (itemErr) {
      // If RLS blocks or not found, we’ll report a generic not-found
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    if (itemRow.playlist_id !== playlistId) {
      return NextResponse.json(
        { error: "Item does not belong to this playlist" },
        { status: 400 }
      );
    }

    // Perform the move via RPC (this should also enforce ownership via your RLS-aware SQL)
    const { data: moved, error: rpcErr } = await supabase.rpc("move_item", {
      p_item_id: itemId,
      p_direction: direction, // "up" | "down"
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, item: moved }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "reorder_failed" },
      { status: 500 }
    );
  }
}

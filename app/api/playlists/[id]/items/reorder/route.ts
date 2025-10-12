// app/api/playlists/[id]/items/reorder/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { itemId, direction } = await req.json();
    if (!itemId || !direction) {
      return NextResponse.json(
        { error: "itemId and direction are required" },
        { status: 400 }
      );
    }

    const supabase = createRouteHandlerClient({ cookies });

    // This RPC checks ownership via RLS helper is_owner()
    const { data, error } = await supabase.rpc("move_item", {
      p_item_id: itemId,
      p_direction: direction, // "up" | "down"
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, item: data });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "reorder_failed" },
      { status: 500 }
    );
  }
}

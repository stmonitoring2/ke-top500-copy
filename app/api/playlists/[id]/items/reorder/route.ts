// app/api/playlists/[id]/items/reorder/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const res = new NextResponse();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          res.cookies.set(name, value, options);
        },
        remove(name: string, options: any) {
          res.cookies.set(name, "", { ...options, maxAge: 0 });
        },
      },
    }
  );

  try {
    const { itemId, direction } = await req.json();
    if (!itemId || !direction) {
      return NextResponse.json(
        { error: "itemId and direction are required" },
        { status: 400 }
      );
    }

    // must be signed in
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // call the RPC that enforces ownership via RLS helper
    const { data, error } = await supabase.rpc("move_item", {
      p_item_id: itemId,
      p_direction: direction, // "up" | "down"
    });

    if (error) {
      // surface RLS/ownership errors clearly
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    return NextResponse.json({ ok: true, item: data });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "reorder_failed" },
      { status: 500 }
    );
  }
}

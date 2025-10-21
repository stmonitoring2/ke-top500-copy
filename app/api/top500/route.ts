// app/api/top500/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs"; // keep this, but REMOVE any `revalidate` export here

/* -------------------------------------------------------
   Env: Supabase public object base (no keys needed)
------------------------------------------------------- */
const SUPABASE_PUBLIC_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public`
  : null;

/* -------------------------------------------------------
   Helper: Try static file (fallbacks to Supabase public) 
------------------------------------------------------- */
async function readStaticJSON(range: "daily" | "weekly" | "monthly") {
  const file = path.join(process.cwd(), "public", "data", `top500-${range}.json`);
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const range = (url.searchParams.get("range") || "daily") as "daily" | "weekly" | "monthly";

  const headers = {
    // Route Handlers don’t use `export const revalidate`. If you want caching here,
    // do it with `Cache-Control`:
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };

  try {
    // 1) Try the local static JSON if present
    try {
      const data = await readStaticJSON(range);
      return NextResponse.json({ items: data }, { status: 200, headers });
    } catch {
      /* fall through */
    }

    // 2) Fallback: use public Supabase storage JSON (no auth required)
    if (SUPABASE_PUBLIC_URL) {
      const fileURL = `${SUPABASE_PUBLIC_URL}/top500/top500-${range}.json`;
      const res = await fetch(fileURL, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({ items: data }, { status: 200, headers });
      }
    }

    // 3) If all failed
    return NextResponse.json(
      { error: `${range}_unavailable`, items: [] },
      { status: 200, headers }
    );
  } catch (err: any) {
    const msg =
      process.env.NODE_ENV === "development"
        ? `Failed to load data: ${err?.message || err}`
        : "Not available";
    return NextResponse.json({ error: msg, items: [] }, { status: 200, headers });
  }
}

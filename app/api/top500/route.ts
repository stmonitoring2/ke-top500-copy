import { NextResponse } from "next/server";

// If your repo is public, this URL works as-is.
// Replace `stmonitoring2/ke-top500` with YOUR GitHub user/repo if different.
const RAW_URL =
  "https://raw.githubusercontent.com/stmonitoring2/ke-top500/main/public/data/top500.json";

// Tell Next/Vercel not to cache; always run this function at request time.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const upstream = await fetch(`${RAW_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Upstream fetch failed", status: upstream.status },
        { status: 502 }
      );
    }
    const json = await upstream.json();
    return new NextResponse(JSON.stringify(json), {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}

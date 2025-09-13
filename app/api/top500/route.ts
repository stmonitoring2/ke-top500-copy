import { NextResponse } from "next/server";

// Public repo raw URL (change owner/repo if different)
const RAW_URL =
  "https://raw.githubusercontent.com/stmonitoring2/ke-top500/main/public/data/top500.json";

// Always run dynamically; never cache
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
        "cache-control": "no-store, no-cache, must-revalidate"
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}

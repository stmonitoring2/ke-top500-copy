// app/api/refresh/route.ts
import { NextResponse } from "next/server";

// Optional: call a Supabase Edge Function that rebuilds your datasets
// Set these env vars in Vercel if you use this block:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE
const SUPABASE_FUNCTION_URL = process.env.SUPABASE_URL
  ? `${process.env.SUPABASE_URL}/functions/v1/rebuild-top500`
  : null;

export async function GET(req: Request) {
  // Simple shared-secret check so only your cron can call this
  const sent = req.headers.get("x-cron-key");
  if (!process.env.CRON_SECRET || sent !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1) Kick your data refresh job (pick ONE of the options below)

    // Option A: Call a Supabase Edge Function you wrote
    if (SUPABASE_FUNCTION_URL) {
      const r = await fetch(SUPABASE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // IMPORTANT: functions expect a Bearer with the project anon/service key
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
          apikey: process.env.SUPABASE_SERVICE_ROLE || "",
        },
        // you can pass options, e.g., recompute daily/weekly/monthly
        body: JSON.stringify({ rebuild: ["daily", "7d", "30d"] }),
      });

      if (!r.ok) {
        const text = await r.text();
        throw new Error(`Edge Function failed: ${r.status} ${text}`);
      }
    }

    // Option B: If your refresh logic is inside this repo, import and run it:
    // await rebuildTop500(); // write JSON to Supabase Storage or DB

    // Option C: If your source lives elsewhere (e.g. external API), call it here.

    return NextResponse.json({ ok: true, at: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "Refresh failed" },
      { status: 500 }
    );
  }
}

// app/api/refresh/route.ts
import { NextResponse } from "next/server";

// If you deploy the Edge Function "rebuild-top500" in Supabase, set:
// - SUPABASE_URL               (e.g. https://xyzcompany.supabase.co)
// - SUPABASE_SERVICE_ROLE      (service role key, keep secret)
// - CRON_SECRET                (random string matched by Vercel Cron header)
const SUPABASE_FUNCTION_URL = process.env.SUPABASE_URL
  ? `${process.env.SUPABASE_URL}/functions/v1/rebuild-top500`
  : null;

// Optional: run this on the Edge runtime (faster cold starts)
export const runtime = "edge";

export async function GET(req: Request) {
  // ---- Authorization -------------------------------------------------------
  // Primary: shared secret via header `x-cron-key: <CRON_SECRET>`
  const sentKey = req.headers.get("x-cron-key");
  const hasVercelCronHeader = req.headers.has("x-vercel-cron"); // present when Vercel Cron hits this URL

  const authorized =
    (process.env.CRON_SECRET && sentKey === process.env.CRON_SECRET) ||
    hasVercelCronHeader;

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Dry-run support: /api/refresh?dryRun=1 (does auth but skips work)
  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "1";

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      message: "Auth passed. Skipping actual refresh.",
      at: new Date().toISOString(),
      using: SUPABASE_FUNCTION_URL ? "supabase-edge-function" : "noop",
    });
  }

  try {
    // ---- Do the work -------------------------------------------------------
    // Option A: Call your Supabase Edge Function to rebuild data
    if (SUPABASE_FUNCTION_URL) {
      if (!process.env.SUPABASE_SERVICE_ROLE) {
        throw new Error(
          "SUPABASE_SERVICE_ROLE is not set. Cannot call Edge Function securely."
        );
      }

      // 60s timeout for the rebuild call
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 60_000);

      const res = await fetch(SUPABASE_FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Functions require apikey + Authorization Bearer
          apikey: process.env.SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
        },
        // Pass any flags your function expects
        body: JSON.stringify({ rebuild: ["daily", "7d", "30d"] }),
        signal: ctrl.signal,
      });

      clearTimeout(to);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Edge Function failed: ${res.status} ${text}`);
      }

      const out = await res.json().catch(() => ({}));
      return NextResponse.json({
        ok: true,
        via: "supabase-edge-function",
        result: out,
        at: new Date().toISOString(),
      });
    }

    // Option B: Do the rebuild here (if you implemented local logic)
    // await rebuildTop500(); // Write new JSON/CSV to storage/DB
    // return NextResponse.json({ ok: true, via: "local", at: new Date().toISOString() });

    // If neither option configured, respond success (no-op) so Cron stays green
    return NextResponse.json({
      ok: true,
      via: "noop",
      info:
        "No SUPABASE_URL set and no local rebuild hooked up. Add one and redeploy.",
      at: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Refresh failed",
        at: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

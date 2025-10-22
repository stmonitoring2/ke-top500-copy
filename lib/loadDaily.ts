// lib/loadDaily.ts
import "server-only";
import { headers } from "next/headers";

/**
 * Loads /public/data/top500.json at runtime.
 * Works on Vercel because we construct an absolute URL from request headers.
 */
export async function loadDaily() {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base = host ? `${proto}://${host}` : ""; // empty if unavailable locally

  // When running locally without reverse proxy headers, base may be empty.
  // Next.js will still serve a relative URL correctly in the browser, but on the server
  // we prefer absolute if we have host.
  const url = base ? `${base}/data/top500.json` : `/data/top500.json`;

  const res = await fetch(url, {
    cache: "no-store",
    // Disable Next caching for this fetch
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`Failed to load daily JSON: ${res.status}`);
  }

  return res.json();
}

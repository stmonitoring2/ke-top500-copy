// lib/supabaseRouteClient.ts
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export function getRouteSupabase() {
  return createRouteHandlerClient({ cookies });
}

// app/me/playlists/page.tsx
import { createClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = false;

export default async function MyPlaylistsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin");

  const { data: playlists, error } = await supabase
    .from("playlists")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-semibold mb-4">My Playlists</h1>
        <p className="text-sm text-red-600">Failed to load playlists.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-xl font-semibold mb-6">My Playlists</h1>
      <ul className="space-y-3">
        {playlists?.map((p) => (
          <li key={p.id} className="rounded border p-3">
            <div className="font-medium">{p.title ?? "Untitled"}</div>
            <div className="text-xs text-neutral-500">{p.id}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}

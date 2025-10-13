export const dynamic = "force-dynamic";
export const revalidate = 0;

import { redirect } from "next/navigation";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase-server";

type PlaylistRow = {
  id: string;
  name: string;
  created_at?: string;
  // If you later add the relation, you can extend with: items: { id: string }[]
};

export default async function MyPlaylistsPage() {
  // Ensure Next never caches this render
  noStore();

  const supabase = createClient();

  // 1) Ensure we have a session (cookie should exist after /auth/magic exchange)
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    redirect("/signin?error=session");
  }
  if (!session) {
    redirect("/signin");
  }

  // 2) Load the user's playlists (adjust select if you add relations later)
  const { data: playlists, error } = await supabase
    .from("playlists")
    .select("id,name,created_at")
    .eq("owner_id", session.user.id)
    .order("created_at", { ascending: false });

  // 3) Handle RLS / table errors gracefully
  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-semibold mb-2">My Playlists</h1>
        <p className="text-sm text-red-600">
          Could not load playlists: {error.message}
        </p>
        <div className="mt-4">
          <Link className="text-sm underline" href="/">
            ← Back to Home
          </Link>
        </div>
      </div>
    );
  }

  // 4) Render
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">My Playlists</h1>
        <div className="flex gap-3">
          <Link className="text-sm underline" href="/">
            Home
          </Link>
          {/* Keep this GET link for non-JS fallback; your header uses POST + client signout */}
          <a className="text-sm underline" href="/auth/signout">
            Sign out
          </a>
        </div>
      </div>

      {!playlists || playlists.length === 0 ? (
        <p className="text-sm text-neutral-600">
          You don’t have any playlists yet. Open the homepage and use “Save” or paste a YouTube URL under the player to create one.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {playlists.map((p: PlaylistRow) => (
            <li key={p.id} className="border rounded-xl bg-white overflow-hidden">
              <Link href={`/playlist/${p.id}`} className="block p-3">
                <p className="text-sm font-semibold">{p.name}</p>
                <p className="text-xs text-neutral-500 mt-1">
                  {p.created_at ? new Date(p.created_at).toLocaleString() : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

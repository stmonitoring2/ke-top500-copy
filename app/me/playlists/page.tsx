import Link from 'next/link';
import { createSupabaseServer } from '@/lib/supabase';

export default async function MyPlaylistsPage() {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <div style={{padding:24}}>Please <a href="/signin">sign in</a>.</div>;

  const { data: playlists } = await supabase
    .from('playlists').select('*')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending:false });

  return (
    <div style={{padding:24}}>
      <h1>My Playlists</h1>
      <button onClick={async()=>{
        const name=prompt('New playlist name'); if(!name) return;
        await fetch('/api/playlists',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name })});
        location.reload();
      }}>+ New Playlist</button>

      <ul style={{marginTop:16}}>
        {playlists?.map((p:any)=>(
          <li key={p.id} style={{margin:'8px 0'}}>
            <Link href={`/playlist/${p.id}`}>{p.name}</Link> <small>({p.visibility})</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

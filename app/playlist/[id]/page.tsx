import { createSupabaseServer } from '@/lib/supabase';

function extractVideoId(input: string) {
  try {
    // Support full URLs or raw IDs
    const url = new URL(input);
    if (url.hostname.includes('youtu')) {
      if (url.searchParams.get('v')) return url.searchParams.get('v')!;
      const parts = url.pathname.split('/');
      return parts.pop() || parts.pop() || '';
    }
  } catch {}
  return input; // fallback: assume raw ID
}

export default async function PlaylistPage({ params }: { params: { id: string }}) {
  const supabase = createSupabaseServer();
  const { data, error } = await supabase
    .from('playlists')
    .select('id,name,description,visibility,owner_id,playlist_items(*)')
    .eq('id', params.id).single();

  if (error) return <div style={{padding:24}}>Playlist not found.</div>;
  const items = (data.playlist_items ?? []).sort((a:any,b:any)=>a.position-b.position);

  // Owner check (to show admin controls)
  const { data: { user } } = await supabase.auth.getUser();
  const isOwner = user?.id === data.owner_id;

  return (
    <div style={{padding:24}}>
      <h1>{data.name}</h1>
      {data.description && <p>{data.description}</p>}

      {isOwner && (
        <form style={{margin:'12px 0'}} action={async (formData) => { 'use server'; }}>
          <label>Add any YouTube link or ID: </label>
          <input id="external" name="external" placeholder="https://youtube.com/watch?v=..." style={{padding:6, width:320, marginRight:8}} />
          <button formAction={`/playlist/${params.id}/add-external`}>Add</button>
        </form>
      )}

      <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:16, marginTop:16}}>
        <div>
          {items.length ? (
            <iframe
              style={{width:'100%', aspectRatio:'16/9', borderRadius:12}}
              src={`https://www.youtube.com/embed/${items[0].video_id}`}
              title="YouTube player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
            />
          ) : <div>No videos yet.</div>}
        </div>
        <ol style={{maxHeight:'70vh', overflow:'auto', paddingRight:8}}>
          {items.map((it:any, idx:number)=>(
            <li key={it.id} style={{display:'flex', gap:8, alignItems:'center', margin:'6px 0'}}>
              <span style={{width:20, textAlign:'right'}}>{idx+1}</span>
              <a href={`https://www.youtube.com/watch?v=${it.video_id}`} target="_blank">{it.video_id}</a>
              {isOwner && (
                <button onClick={async(e)=>{
                  e.preventDefault();
                  await fetch(`/api/playlists/${params.id}/items/${it.id}`, { method:'DELETE' });
                  location.reload();
                }} style={{marginLeft:'auto'}}>Remove</button>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// Server action endpoint for adding external video by URL or ID
export const dynamic = 'force-dynamic';
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = (await import('@/lib/supabase')).createSupabaseServer();
  const form = await req.formData();
  const external = form.get('external')?.toString() || '';
  const videoId = extractVideoId(external);
  if (!videoId) return new Response('Invalid video', { status: 400 });
  const { error } = await supabase.from('playlist_items').insert({
    playlist_id: params.id, video_id: videoId, position: 999999
  });
  if (error) return new Response(error.message, { status: 400 });
  return new Response(null, { status: 302, headers: { Location: `/playlist/${params.id}` }});
}

'use client';
import useSWR from 'swr';
import { useState } from 'react';

const fetcher = (u:string)=>fetch(u).then(r=>r.json());

export default function SaveToPlaylist({ videoId }: { videoId: string }) {
  const { data: playlists } = useSWR('/api/playlists', fetcher);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Not signed in → clicking 'Save' sends to /signin
  if (!playlists) return <button onClick={()=>location.href='/signin'}>Save</button>;

  async function addTo(id: string) {
    setBusy(true);
    await fetch(`/api/playlists/${id}/items`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ videoId })
    });
    setBusy(false); setOpen(false);
    alert('Saved!');
  }

  return (
    <div style={{position:'relative', display:'inline-block'}}>
      <button disabled={busy} onClick={()=>setOpen(!open)}>{busy?'Saving…':'Save'}</button>
      {open && (
        <div style={{position:'absolute', zIndex:50, background:'#fff', border:'1px solid #ddd', borderRadius:8, padding:8, width:260}}>
          <button style={{display:'block', width:'100%', textAlign:'left'}} onClick={async()=>{
            const name=prompt('New playlist name'); if(!name) return;
            const res = await fetch('/api/playlists', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name })});
            const p = await res.json();
            await addTo(p.id);
          }}>+ New playlist…</button>
          <hr/>
          {(playlists||[]).map((p:any)=>(
            <button key={p.id} style={{display:'block', width:'100%', textAlign:'left'}} onClick={()=>addTo(p.id)}>{p.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

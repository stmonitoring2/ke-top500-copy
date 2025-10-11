import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer();
  const { data, error } = await supabase
    .from('playlists')
    .select('id,name,description,visibility,owner_id,playlist_items(*)')
    .eq('id', params.id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer();
  const body = await req.json();
  const { data, error } = await supabase.from('playlists')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer();
  const { error } = await supabase.from('playlists').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

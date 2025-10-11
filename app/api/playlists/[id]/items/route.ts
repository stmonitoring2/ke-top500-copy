import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer();
  const { data, error } = await supabase
    .from('playlist_items')
    .select('*').eq('playlist_id', params.id)
    .order('position', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServer();
  const { videoId } = await req.json();
  const { data, error } = await supabase.rpc('add_item_if_absent', {
    p_playlist_id: params.id, p_video_id: videoId
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';

export async function GET() {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json([]); // not signed in: empty list (so Save button can prompt login)
  const { data, error } = await supabase.from('playlists')
    .select('*').eq('owner_id', user.id).order('updated_at', { ascending:false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, description, visibility } = await req.json();
  const { data, error } = await supabase.from('playlists')
    .insert({ owner_id: user.id, name, description: description ?? null, visibility: visibility ?? 'private' })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
